// Fetches everything the cards need for one user.
//
// The usual stats cards only look at repositories the user owns. We start from
// the user's contributions instead: GitHub records every commit, pull request,
// issue and review in a contributionsCollection, whichever account or
// organisation owns the repository. A collection spans at most one year, so we
// walk back one year at a time to the day the account was created.

import type { GitHubClient } from './client.ts';
import type { ContributionWindow, OwnedRepo, RawData, RepoDetail, RepoRef } from './types.ts';

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

type DetailNode = Omit<RepoDetail, 'commits'> & {
  defaultBranchRef: { target: { history?: { totalCount: number }; authored?: { totalCount: number } } | null } | null;
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

  // Every repository the user touched or owns, forks excluded: a fork's
  // languages belong to its upstream.
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

  const repos = await fetchDetails(client, user.id, [...refs.keys()]);
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
    repos,
  };
}

async function fetchDetails(client: GitHubClient, userId: string, names: string[]): Promise<RepoDetail[]> {
  const out: RepoDetail[] = [];
  for (let i = 0; i < names.length; i += 20) {
    const batch = names.slice(i, i + 20);
    const fields = batch
      .map((name, k) => {
        const [owner, repo] = name.split('/');
        return `r${k}: repository(owner: ${JSON.stringify(owner)}, name: ${JSON.stringify(repo)}) { ...Detail }`;
      })
      .join('\n');
    const res = await client.query<Record<string, DetailNode | null>>(`query Repos($uid: ID!) {\n${fields}\n}\n${DETAIL}`, { uid: userId });
    batch.forEach((_, k) => {
      const node = res.data?.[`r${k}`];
      if (!node) return; // deleted, renamed or no longer visible to this token
      const { defaultBranchRef, ...rest } = node;
      const target = defaultBranchRef?.target;
      out.push({
        ...rest,
        commits: target?.history ? { total: target.history.totalCount, authored: target.authored?.totalCount ?? 0 } : null,
      });
    });
  }
  return out;
}
