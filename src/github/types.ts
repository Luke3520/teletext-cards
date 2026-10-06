// What we fetch from GitHub, before any counting. Kept as plain JSON so a run
// can be saved as a fixture and replayed (see `--fixture` in the CLI).

export interface RepoRef {
  nameWithOwner: string;
  isPrivate: boolean;
  isFork: boolean;
  owner: { __typename: 'User' | 'Organization' | string; login: string };
  /** When the repository was created; for a fork, when it was forked. */
  createdAt?: string;
}

/**
 * A fork the user opened pull requests in. GitHub never counts work in forks
 * as contributions, yet teams often work in one (a course project forked from
 * a starter repo, say). We find them through the user's pull requests.
 */
export interface ForkWork {
  repository: RepoRef;
  pullRequests: number;
}

export interface ContributionsByRepo {
  contributions: { totalCount: number };
  repository: RepoRef;
}

export interface ContributionWindow {
  from: string;
  to: string;
  totalCommitContributions: number;
  totalIssueContributions: number;
  totalPullRequestContributions: number;
  totalPullRequestReviewContributions: number;
  totalRepositoryContributions: number;
  restrictedContributionsCount: number;
  contributionCalendar: {
    totalContributions: number;
    weeks: Array<{ contributionDays: Array<{ date: string; contributionCount: number }> }>;
  };
  commitContributionsByRepository: ContributionsByRepo[];
  pullRequestContributionsByRepository: ContributionsByRepo[];
  issueContributionsByRepository: ContributionsByRepo[];
  pullRequestReviewContributionsByRepository: ContributionsByRepo[];
}

export interface OwnedRepo {
  nameWithOwner: string;
  isPrivate: boolean;
  isArchived: boolean;
  stargazerCount: number;
}

export interface RepoDetail extends RepoRef {
  stargazerCount: number;
  languages: { totalSize: number; edges: Array<{ size: number; node: { name: string; color: string | null } }> };
  /**
   * Commits on the default branch: all of them, and the ones the user
   * authored. For a fork, only commits made after it was forked count as
   * authored, so work done upstream is not counted twice. Null for empty repos.
   */
  commits: { total: number; authored: number } | null;
}

export interface RawData {
  fetchedAt: string;
  user: {
    id: string;
    login: string;
    name: string | null;
    createdAt: string;
    followers: number;
    pullRequests: number;
    mergedPullRequests: number;
    issues: number;
  };
  ownedRepos: OwnedRepo[];
  windows: ContributionWindow[];
  /** Missing in data saved by older versions. */
  forks?: ForkWork[];
  repos: RepoDetail[];
}
