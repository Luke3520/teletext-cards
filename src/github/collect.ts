// Fetches everything the cards need for one user.
//
// The usual stats cards only look at repositories the user owns. We start from
// the user's contributions instead: GitHub records every commit, pull request,
// issue and review in a contributionsCollection, whichever account or
// organisation owns the repository. A collection spans at most one year, so we
// walk back one year at a time to the day the account was created.

import type { GitHubClient } from './client.ts';
import type { ContributionWindow, ForkWork, OwnedRepo, RawData, RepoDetail, RepoRef, TokenAccess } from './types.ts';

const DAY = 86_400_000;

const REF = `fragment Ref on Repository { nameWithOwner isPrivate isFork owner { __typename login } }`;

const PROFILE = `query Profile($login: String!) {
  user(login: $login) {
    id login name createdAt
    followers { totalCount }
    pullRequests { totalCount }
    merged: pullRequests(states: MERGED) { totalCount }
    issues { totalCount }
  }
}`;

const OWNED = `query Owned($login: String!, $after: String) {
  user(login: $login) {
    repositories(first: 100, after: $after, ownerAffiliations: OWNER, isFork: false) {
      pageInfo { hasNextPage endCursor }
      nodes { nameWithOwner isPrivate isArchived stargazerCount }
    }
  }
}`;

const ACCESS = `query Access($login: String!) {
  user(login: $login) {
    repositories(ownerAffiliations: OWNER, privacy: PRIVATE) { totalCount }
    organizations(first: 100) {
      totalCount
      nodes {
        repositories(privacy: PRIVATE, first: 100) {
          totalCount
          nodes { nameWithOwner isPrivate isFork createdAt owner { __typename login } }
        }
      }
    }
  }
}`;

interface AccessData {
  user: {
    repositories: { totalCount: number };
    organizations: {
      totalCount: number;
      nodes: Array<{ repositories: { totalCount: number; nodes: Array<RepoRef | null> } } | null>;
    };
  };
}

const PULL_REQUESTS = `query PullRequests($login: String!, $after: String) {
  user(login: $login) {
    pullRequests(first: 100, after: $after, orderBy: { field: CREATED_AT, direction: DESC }) {
      pageInfo { hasNextPage endCursor }
      nodes { repository { nameWithOwner isPrivate isFork createdAt owner { __typename login } } }
    }
  }
}`;

/** Enough for a thousand pull requests; older ones rarely add a new fork. */
const MAX_PR_PAGES = 10;

const BY_REPO = `(maxRepositories: 100) { contributions { totalCount } repository { ...Ref } }`;

const WINDOW = `query Window($login: String!, $from: DateTime!, $to: DateTime!) {
  user(login: $login) {
    contributionsCollection(from: $from, to: $to) {
      totalCommitContributions totalIssueContributions totalPullRequestContributions
      totalPullRequestReviewContributions totalRepositoryContributions restrictedContributionsCount
      contributionCalendar { totalContributions weeks { contributionDays { date contributionCount } } }
      commitContributionsByRepository${BY_REPO}
      pullRequestContributionsByRepository${BY_REPO}
      issueContributionsByRepository${BY_REPO}
      pullRequestReviewContributionsByRepository${BY_REPO}
    }
  }
}
${REF}`;

const DETAIL = `fragment Detail on Repository {
  nameWithOwner isPrivate isFork stargazerCount owner { __typename login }
  languages(first: 25, orderBy: { field: SIZE, direction: DESC }) { totalSize edges { size node { name color } } }
  defaultBranchRef { target { ... on Commit { history { totalCount } authored: history(author: { id: $uid }) { totalCount } } } }
}`;

interface ProfileData {
  user: {
    id: string;
    login: string;
    name: string | null;
    createdAt: string;
    followers: { totalCount: number };
    pullRequests: { totalCount: number };
    merged: { totalCount: number };
    issues: { totalCount: number };
  } | null;
}

interface OwnedData {
  user: { repositories: { pageInfo: { hasNextPage: boolean; endCursor: string | null }; nodes: OwnedRepo[] } };
}

interface WindowData {
  user: { contributionsCollection: Omit<ContributionWindow, 'from' | 'to'> };
}

interface PullRequestsData {
  user: {
    pullRequests: {
      pageInfo: { hasNextPage: boolean; endCursor: string | null };
      nodes: Array<{ repository: RepoRef | null } | null>;
    };
  };
}

type DetailNode = Omit<RepoDetail, 'commits'> & {
  defaultBranchRef: {
    target: { history?: { totalCount: number }; authored?: { totalCount: number }; sinceFork?: { totalCount: number } } | null;
  } | null;
};

/**
 * Contribution windows of at most one year, newest first, on UTC day
 * boundaries so that no day is split between two windows.
 */
export function contributionWindows(createdAt: Date, now: Date): Array<{ from: Date; to: Date }> {
  const windows: Array<{ from: Date; to: Date }> = [];
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const born = Date.UTC(createdAt.getUTCFullYear(), createdAt.getUTCMonth(), createdAt.getUTCDate());
  let to = now.getTime();
  let from = today - 364 * DAY;
  while (to >= born) {
    windows.push({ from: new Date(Math.max(from, born)), to: new Date(to) });
    to = from - 1000;
    from -= 365 * DAY;
  }
  return windows;
}

export interface CollectOptions {
  login: string;
  now?: Date;
  log?: (message: string) => void;
}

export async function collect(client: GitHubClient, options: CollectOptions): Promise<RawData> {
  const log = options.log ?? (() => {});
  const now = options.now ?? new Date();

  const profile = await client.query<ProfileData>(PROFILE, { login: options.login });
  const user = profile.data?.user;
  if (!user) throw new Error(`GitHub user "${options.login}" was not found. Organisations are not supported.`);

  const access = await checkAccess(client, user.login);

  const ownedRepos: OwnedRepo[] = [];
  for (let after: string | null = null; ; ) {
    const page: { data: OwnedData | null } = await client.query<OwnedData>(OWNED, { login: user.login, after });
    const repos = page.data!.user.repositories;
    ownedRepos.push(...repos.nodes);
    if (!repos.pageInfo.hasNextPage) break;
    after = repos.pageInfo.endCursor;
  }
  log(`${ownedRepos.length} repositories owned by ${user.login}`);

  const windows: ContributionWindow[] = [];
  for (const { from, to } of contributionWindows(new Date(user.createdAt), now)) {
    const res = await client.query<WindowData>(WINDOW, { login: user.login, from: from.toISOString(), to: to.toISOString() });
    windows.push({ from: from.toISOString(), to: to.toISOString(), ...res.data!.user.contributionsCollection });
  }
  log(`${windows.length} yearly contribution windows since ${user.createdAt.slice(0, 10)}`);

  const forks = await findForkWork(client, user.login);
  if (forks.length) log(`${forks.length} forks with your pull requests, which GitHub does not count as contributions`);

  // Every repository the user touched or owns. Forks only come in through
  // pull requests (above): GitHub leaves them out of contributions.
  const refs = new Map<string, RepoRef>();
  for (const w of windows) {
    for (const list of [
      w.commitContributionsByRepository,
      w.pullRequestContributionsByRepository,
      w.issueContributionsByRepository,
      w.pullRequestReviewContributionsByRepository,
    ]) {
      for (const { repository } of list) if (!repository.isFork) refs.set(repository.nameWithOwner, repository);
    }
  }
  for (const repo of ownedRepos) {
    if (!refs.has(repo.nameWithOwner)) {
      refs.set(repo.nameWithOwner, { nameWithOwner: repo.nameWithOwner, isPrivate: repo.isPrivate, isFork: false, owner: { __typename: 'User', login: user.login } });
    }
  }
  for (const { repository } of forks) refs.set(repository.nameWithOwner, repository);
  // Private organisation repos: their commit history tells us what GitHub's
  // contribution data may hide (see computeStats).
  for (const repo of access?.orgPrivateRepoRefs ?? []) if (!refs.has(repo.nameWithOwner)) refs.set(repo.nameWithOwner, repo);

  const repos = await fetchDetails(client, user.id, [...refs.values()]);
  log(`${repos.length} repositories with contributions or owned, ${repos.filter((r) => r.owner.login !== user.login).length} of them owned by others`);

  return {
    fetchedAt: now.toISOString(),
    user: {
      id: user.id,
      login: user.login,
      name: user.name,
      createdAt: user.createdAt,
      followers: user.followers.totalCount,
      pullRequests: user.pullRequests.totalCount,
      mergedPullRequests: user.merged.totalCount,
      issues: user.issues.totalCount,
    },
    ownedRepos,
    windows,
    forks,
    access,
    repos,
  };
}

/** Counts what the token can see. Only for the log; never fails the run. */
async function checkAccess(client: GitHubClient, login: string): Promise<TokenAccess | undefined> {
  try {
    const res = await client.query<AccessData>(ACCESS, { login });
    const u = res.data?.user;
    if (!u) return undefined;
    const orgs = u.organizations.nodes.filter((o): o is NonNullable<typeof o> => o !== null);
    return {
      ownedPrivateRepos: u.repositories.totalCount,
      organizations: u.organizations.totalCount,
      orgPrivateRepos: orgs.reduce((t, o) => t + o.repositories.totalCount, 0),
      orgsWithPrivateRepos: orgs.filter((o) => o.repositories.totalCount > 0).length,
      orgPrivateRepoRefs: orgs.flatMap((o) => o.repositories.nodes.filter((r): r is RepoRef => r !== null && r.isPrivate)),
    };
  } catch {
    return undefined;
  }
}

/** Forks the user opened pull requests in, with how many. */
async function findForkWork(client: GitHubClient, login: string): Promise<ForkWork[]> {
  const found = new Map<string, ForkWork>();
  let after: string | null = null;
  for (let page = 0; page < MAX_PR_PAGES; page++) {
    const res: { data: PullRequestsData | null } = await client.query<PullRequestsData>(PULL_REQUESTS, { login, after });
    const prs = res.data!.user.pullRequests;
    for (const node of prs.nodes) {
      const repo = node?.repository;
      if (!repo?.isFork) continue;
      const seen = found.get(repo.nameWithOwner);
      if (seen) seen.pullRequests++;
      else found.set(repo.nameWithOwner, { repository: repo, pullRequests: 1 });
    }
    if (!prs.pageInfo.hasNextPage) break;
    after = prs.pageInfo.endCursor;
  }
  return [...found.values()];
}

async function fetchDetails(client: GitHubClient, userId: string, refs: RepoRef[]): Promise<RepoDetail[]> {
  const out: RepoDetail[] = [];
  for (let i = 0; i < refs.length; i += 20) {
    const batch = refs.slice(i, i + 20);
    const fields = batch
      .map((ref, k) => {
        const [owner, repo] = ref.nameWithOwner.split('/');
        // In a fork, only commits since the fork are new work.
        const sinceFork =
          ref.isFork && ref.createdAt
            ? ` defaultBranchRef { target { ... on Commit { sinceFork: history(author: { id: $uid }, since: ${JSON.stringify(ref.createdAt)}) { totalCount } } } }`
            : '';
        return `r${k}: repository(owner: ${JSON.stringify(owner)}, name: ${JSON.stringify(repo)}) { ...Detail${sinceFork} }`;
      })
      .join('\n');
    const res = await client.query<Record<string, DetailNode | null>>(`query Repos($uid: ID!) {\n${fields}\n}\n${DETAIL}`, { uid: userId });
    batch.forEach((_, k) => {
      const node = res.data?.[`r${k}`];
      if (!node) return; // deleted, renamed or no longer visible to this token
      const { defaultBranchRef, ...rest } = node;
      const target = defaultBranchRef?.target;
      const authored = (rest.isFork ? target?.sinceFork : target?.authored)?.totalCount ?? 0;
      out.push({
        ...rest,
        createdAt: batch[k]!.createdAt,
        commits: target?.history ? { total: target.history.totalCount, authored } : null,
      });
    });
  }
  return out;
}
