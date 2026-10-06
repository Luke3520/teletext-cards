// Turns raw GitHub data into the numbers on the cards. Pure and synchronous,
// so it is easy to test against saved fixtures.

import type { ContributionsByRepo, RawData, RepoDetail, RepoRef } from './github/types.ts';

export type LanguageMode = 'authorship' | 'commits' | 'bytes';

export interface StatsOptions {
  /** Repositories to leave out: `owner/name` or `owner/*`. */
  excludeRepos?: string[];
  /** Languages to leave out, case-insensitive. */
  excludeLanguages?: string[];
  /** How each repository's languages are weighted. */
  languagesBy?: LanguageMode;
  /** How many languages to list before grouping the rest as "Other". */
  languagesCount?: number;
}

export interface LanguageShare {
  name: string;
  color: string | null;
  /** Fraction of the total, 0..1. */
  share: number;
}

export interface OrgSummary {
  login: string;
  contributions: number;
}

export interface Stats {
  login: string;
  name: string | null;
  createdAt: string;
  generatedAt: string;
  /** Every contribution GitHub counts, all time, including anonymous private ones. */
  contributions: number;
  /** Contributions in the last 365 days, as on the profile page. */
  lastYear: number;
  commits: number;
  pullRequests: number;
  mergedPullRequests: number;
  reviews: number;
  issues: number;
  /** Contributions in private repositories the token cannot see. */
  privateContributions: number;
  ownedRepos: number;
  stars: number;
  /** Repositories you own or worked on: owned plus contributed, counted once. */
  repos: number;
  /** Repositories with at least one contribution, all time, whoever owns them. Includes team forks. */
  contributedRepos: number;
  /** ...of which owned by organisations or other people. */
  contributedReposNotOwned: number;
  /** Organisations with a public repository the user contributed to, busiest first. */
  orgs: OrgSummary[];
  /** Organisations known only through private repositories: counted, never named. */
  privateOrgs: number;
  languages: LanguageShare[];
  languagesBy: LanguageMode;
  activeDays: number;
  currentStreak: number;
  longestStreak: number;
  /** Contributions per week for the last 52 weeks, oldest first. */
  weeks: number[];
}

const DAY = 86_400_000;

function day(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

function matcher(patterns: string[]): (name: string) => boolean {
  const rules = patterns.map((p) => p.trim().toLowerCase()).filter(Boolean);
  return (name) => {
    const n = name.toLowerCase();
    return rules.some((r) => (r.endsWith('/*') ? n.startsWith(r.slice(0, -1)) : n === r));
  };
}

interface Touched {
  ref: RepoRef;
  contributions: number;
}

export function computeStats(raw: RawData, options: StatsOptions = {}): Stats {
  const excluded = matcher(options.excludeRepos ?? []);
  const login = raw.user.login;
  const lower = login.toLowerCase();
  const now = new Date(raw.fetchedAt).getTime();

  // Calendar days from every window. Windows do not overlap, but if GitHub
  // ever hands back a day twice we keep the larger count rather than add.
  const days = new Map<string, number>();
  for (const w of raw.windows) {
    const first = w.from.slice(0, 10);
    const last = w.to.slice(0, 10);
    for (const week of w.contributionCalendar.weeks) {
      for (const d of week.contributionDays) {
        if (d.date < first || d.date > last) continue;
        days.set(d.date, Math.max(days.get(d.date) ?? 0, d.contributionCount));
      }
    }
  }
  const countOn = (ms: number) => days.get(day(ms)) ?? 0;

  const sum = (pick: (w: RawData['windows'][number]) => number) => raw.windows.reduce((t, w) => t + pick(w), 0);

  // Repositories with contributions, whoever owns them.
  const touched = new Map<string, Touched>();
  const add = (list: ContributionsByRepo[]) => {
    for (const { repository, contributions } of list) {
      if (repository.isFork || excluded(repository.nameWithOwner)) continue;
      const t = touched.get(repository.nameWithOwner);
      if (t) t.contributions += contributions.totalCount;
      else touched.set(repository.nameWithOwner, { ref: repository, contributions: contributions.totalCount });
    }
  };
  for (const w of raw.windows) {
    add(w.commitContributionsByRepository);
    add(w.pullRequestContributionsByRepository);
    add(w.issueContributionsByRepository);
    add(w.pullRequestReviewContributionsByRepository);
  }
  // Team forks: real work that GitHub's contribution count leaves out.
  for (const { repository, pullRequests } of raw.forks ?? []) {
    if (excluded(repository.nameWithOwner) || touched.has(repository.nameWithOwner)) continue;
    touched.set(repository.nameWithOwner, { ref: repository, contributions: pullRequests });
  }

  const orgs = new Map<string, { contributions: number; public: boolean }>();
  for (const { ref, contributions } of touched.values()) {
    if (ref.owner.__typename !== 'Organization') continue;
    const o = orgs.get(ref.owner.login) ?? { contributions: 0, public: false };
    o.contributions += contributions;
    o.public ||= !ref.isPrivate;
    orgs.set(ref.owner.login, o);
  }
  const named = [...orgs]
    .filter(([, o]) => o.public)
    .map(([orgLogin, o]) => ({ login: orgLogin, contributions: o.contributions }))
    .sort((a, b) => b.contributions - a.contributions || a.login.localeCompare(b.login));

  // Streaks and the weekly graph, day by day from account creation to today.
  const today = Date.UTC(new Date(now).getUTCFullYear(), new Date(now).getUTCMonth(), new Date(now).getUTCDate());
  const created = new Date(raw.user.createdAt);
  const born = Date.UTC(created.getUTCFullYear(), created.getUTCMonth(), created.getUTCDate());
  let longest = 0;
  let run = 0;
  let active = 0;
  for (let t = born; t <= today; t += DAY) {
    if (countOn(t) > 0) {
      active++;
      run++;
      longest = Math.max(longest, run);
    } else run = 0;
  }
  // Today still counts as part of a streak until it is over.
  let current = 0;
  for (let t = countOn(today) > 0 ? today : today - DAY; t >= born && countOn(t) > 0; t -= DAY) current++;

  const weeks: number[] = [];
  for (let w = 51; w >= 0; w--) {
    let total = 0;
    for (let d = 0; d < 7; d++) total += countOn(today - (w * 7 + 6 - d) * DAY);
    weeks.push(total);
  }
  let lastYear = 0;
  for (let d = 0; d < 365; d++) lastYear += countOn(today - d * DAY);

  const owned = raw.ownedRepos.filter((r) => !excluded(r.nameWithOwner));

  return {
    login,
    name: raw.user.name,
    createdAt: raw.user.createdAt,
    generatedAt: raw.fetchedAt,
    contributions: [...days.values()].reduce((a, b) => a + b, 0),
    lastYear,
    commits: sum((w) => w.totalCommitContributions),
    pullRequests: raw.user.pullRequests,
    mergedPullRequests: raw.user.mergedPullRequests,
    reviews: sum((w) => w.totalPullRequestReviewContributions),
    issues: raw.user.issues,
    privateContributions: sum((w) => w.restrictedContributionsCount),
    ownedRepos: owned.length,
    stars: owned.reduce((t, r) => t + r.stargazerCount, 0),
    repos: new Set([...owned.map((r) => r.nameWithOwner.toLowerCase()), ...[...touched.keys()].map((k) => k.toLowerCase())]).size,
    contributedRepos: touched.size,
    contributedReposNotOwned: [...touched.values()].filter((t) => t.ref.owner.login.toLowerCase() !== lower).length,
    orgs: named,
    privateOrgs: orgs.size - named.length,
    languages: languageShares(raw.repos.filter((r) => !excluded(r.nameWithOwner)), options),
    languagesBy: options.languagesBy ?? 'authorship',
    activeDays: active,
    currentStreak: current,
    longestStreak: longest,
    weeks,
  };
}

/**
 * Language mix across every repository the user touched.
 *
 * - authorship (default): each repository's bytes, scaled by the share of its
 *   default-branch commits the user authored. A team repo where you wrote a
 *   third of the commits counts a third. Your own solo repo counts in full.
 * - commits: the user's authored commits, split by each repository's mix.
 * - bytes: raw bytes of every repository, the classic (inflated) method.
 *
 * Forks are included with only the commits made after forking (see
 * RepoDetail.commits), so code written upstream is not counted twice.
 */
export function languageShares(repos: RepoDetail[], options: StatsOptions = {}): LanguageShare[] {
  const mode = options.languagesBy ?? 'authorship';
  const count = Math.max(1, options.languagesCount ?? 5);
  const skip = new Set((options.excludeLanguages ?? []).map((l) => l.trim().toLowerCase()));

  const totals = new Map<string, { weight: number; color: string | null }>();
  for (const repo of repos) {
    if (!repo.commits) continue;
    const { total, authored } = repo.commits;
    if (mode !== 'bytes' && (total === 0 || authored === 0)) continue;
    const size = repo.languages.edges.reduce((t, e) => t + e.size, 0);
    if (size === 0) continue;
    for (const { size: bytes, node } of repo.languages.edges) {
      if (skip.has(node.name.toLowerCase())) continue;
      const weight =
        mode === 'bytes' ? bytes : mode === 'commits' ? (authored * bytes) / size : bytes * Math.min(1, authored / total);
      const t = totals.get(node.name);
      if (t) t.weight += weight;
      else totals.set(node.name, { weight, color: node.color });
    }
  }

  const all = [...totals].map(([name, t]) => ({ name, color: t.color, weight: t.weight })).sort((a, b) => b.weight - a.weight || a.name.localeCompare(b.name));
  const grand = all.reduce((t, l) => t + l.weight, 0);
  if (grand === 0) return [];

  const top = all.slice(0, count);
  const rest = all.slice(count).reduce((t, l) => t + l.weight, 0);
  const list = top.map((l) => ({ name: l.name, color: l.color, share: l.weight / grand }));
  if (rest / grand >= 0.005) list.push({ name: 'Other', color: null, share: rest / grand });
  return list;
}
