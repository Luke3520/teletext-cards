import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import type { ContributionWindow, RawData, RepoDetail, RepoRef } from '../src/github/types.ts';
import { computeStats, languageShares, languageSources } from '../src/stats.ts';

const demo = JSON.parse(readFileSync(new URL('./fixtures/demo.json', import.meta.url), 'utf8')) as RawData;

function ref(nameWithOwner: string, org = false, isPrivate = false): RepoRef {
  return { nameWithOwner, isPrivate, isFork: false, owner: { __typename: org ? 'Organization' : 'User', login: nameWithOwner.split('/')[0]! } };
}

function repo(nameWithOwner: string, langs: Array<[string, number]>, total: number, authored: number): RepoDetail {
  return {
    ...ref(nameWithOwner),
    stargazerCount: 0,
    languages: { totalSize: langs.reduce((t, [, s]) => t + s, 0), edges: langs.map(([name, size]) => ({ size, node: { name, color: null } })) },
    commits: { total, authored },
  };
}

function window(from: string, to: string, days: Array<[string, number]>, extra: Partial<ContributionWindow> = {}): ContributionWindow {
  return {
    from,
    to,
    totalCommitContributions: 0,
    totalIssueContributions: 0,
    totalPullRequestContributions: 0,
    totalPullRequestReviewContributions: 0,
    totalRepositoryContributions: 0,
    restrictedContributionsCount: 0,
    contributionCalendar: {
      totalContributions: days.reduce((t, [, c]) => t + c, 0),
      weeks: [{ contributionDays: days.map(([date, contributionCount]) => ({ date, contributionCount })) }],
    },
    commitContributionsByRepository: [],
    pullRequestContributionsByRepository: [],
    issueContributionsByRepository: [],
    pullRequestReviewContributionsByRepository: [],
    ...extra,
  };
}

function raw(windows: ContributionWindow[], repos: RepoDetail[] = []): RawData {
  return {
    fetchedAt: '2026-10-06T12:00:00Z',
    user: { id: 'U1', login: 'me', name: 'Me', createdAt: '2026-09-01T00:00:00Z', followers: 0, pullRequests: 5, mergedPullRequests: 4, issues: 1 },
    ownedRepos: [{ nameWithOwner: 'me/solo', isPrivate: false, isArchived: false, stargazerCount: 3 }],
    windows,
    repos,
  };
}

describe('computeStats', () => {
  it('counts work in organisation and teammate repositories, not just owned ones', () => {
    const stats = computeStats(demo);
    assert.equal(stats.contributedRepos, 11);
    assert.equal(stats.contributedReposNotOwned, 7);
    assert.deepEqual(
      stats.orgs.map((o) => o.login),
      ['nordlys-labs', 'kbh-hackers', 'open-fjord', 'eksamen-hold'],
    );
  });

  it('names, renames, orders and hides organisations as asked', () => {
    const plain = computeStats(demo);
    assert.deepEqual(plain.orgs.map((o) => o.login), ['nordlys-labs', 'kbh-hackers', 'open-fjord', 'eksamen-hold']);
    assert.equal(plain.privateOrgs, 1);

    const stats = computeStats(demo, {
      orgs: { pin: [{ login: 'Secret-Co', label: 'Secret Co' }, { login: 'open-fjord' }, { login: 'typo-org' }], hide: ['kbh-hackers'] },
    });
    // Pinned first, in order and with labels; a pinned private org is named.
    assert.deepEqual(
      stats.orgs.map((o) => o.label ?? o.login),
      ['Secret Co', 'open-fjord', 'nordlys-labs', 'eksamen-hold'],
    );
    assert.equal(stats.privateOrgs, 0);
    assert.deepEqual(stats.unmatchedOrgs, ['typo-org']);
    // Hiding only changes the ORGS line, not the work that is counted.
    assert.equal(stats.contributedRepos, plain.contributedRepos);
  });

  it('counts team forks, which GitHub leaves out of contributions', () => {
    const fork: RepoRef = { ...ref('team/app-tests', true), isFork: true, createdAt: '2026-09-10T00:00:00Z' };
    const stats = computeStats({ ...raw([]), forks: [{ repository: fork, pullRequests: 4 }] });
    assert.deepEqual(stats.orgs, [{ login: 'team', contributions: 4 }]);
    assert.equal(stats.contributedReposNotOwned, 1);
  });

  it('counts each repository once, owned or contributed', () => {
    const w = window('2026-09-01T00:00:00Z', '2026-10-06T12:00:00Z', [], {
      commitContributionsByRepository: [
        { contributions: { totalCount: 2 }, repository: ref('me/solo') },
        { contributions: { totalCount: 2 }, repository: ref('org/a', true) },
      ],
    });
    const stats = computeStats(raw([w]));
    assert.equal(stats.ownedRepos, 1);
    assert.equal(stats.contributedRepos, 2);
    assert.equal(stats.repos, 2);
  });

  it('counts private-only organisations without naming them', () => {
    const stats = computeStats(demo);
    assert.equal(stats.privateOrgs, 1);
    assert.ok(!JSON.stringify(stats).includes('secret-co'));
  });

  it('counts org and team repositories in the language mix', () => {
    const { languageOrigin: o } = computeStats(demo);
    assert.ok(o.org > 0.3, `org share ${o.org}`);
    assert.ok(o.own > 0 && o.person > 0 && o.private > 0);
    assert.ok(Math.abs(o.own + o.org + o.person + o.private - 1) < 1e-9);
  });

  it('adds up the calendar across windows and keeps one value per day', () => {
    const stats = computeStats(
      raw([
        window('2026-10-01T00:00:00Z', '2026-10-06T12:00:00Z', [
          ['2026-10-05', 2],
          ['2026-10-06', 1],
        ]),
        // Overlaps the day above: must not be counted twice.
        window('2026-09-01T00:00:00Z', '2026-10-05T23:59:59Z', [
          ['2026-10-04', 3],
          ['2026-10-05', 2],
        ]),
      ]),
    );
    assert.equal(stats.contributions, 6);
    assert.equal(stats.lastYear, 6);
    assert.equal(stats.currentStreak, 3);
    assert.equal(stats.longestStreak, 3);
    assert.equal(stats.activeDays, 3);
  });

  it('ignores calendar days outside a window', () => {
    const stats = computeStats(raw([window('2026-10-05T00:00:00Z', '2026-10-06T12:00:00Z', [['2026-09-20', 9], ['2026-10-06', 1]])]));
    assert.equal(stats.contributions, 1);
  });

  it('keeps a streak alive until today is over', () => {
    const stats = computeStats(raw([window('2026-09-01T00:00:00Z', '2026-10-06T12:00:00Z', [['2026-10-04', 1], ['2026-10-05', 1]])]));
    assert.equal(stats.currentStreak, 2);
  });

  it('returns 52 weeks, oldest first, ending today', () => {
    const stats = computeStats(raw([window('2026-09-01T00:00:00Z', '2026-10-06T12:00:00Z', [['2026-10-06', 4], ['2026-09-29', 2]])]));
    assert.equal(stats.weeks.length, 52);
    assert.equal(stats.weeks[51], 4);
    assert.equal(stats.weeks[50], 2);
  });

  it('leaves out excluded repositories and forks', () => {
    const base = window('2026-09-01T00:00:00Z', '2026-10-06T12:00:00Z', [], {
      commitContributionsByRepository: [
        { contributions: { totalCount: 5 }, repository: ref('org/a', true) },
        { contributions: { totalCount: 5 }, repository: ref('org/b', true) },
        { contributions: { totalCount: 5 }, repository: { ...ref('me/fork'), isFork: true } },
      ],
    });
    const stats = computeStats(raw([base]), { excludeRepos: ['org/b'] });
    assert.equal(stats.contributedRepos, 1);
    assert.deepEqual(stats.orgs, [{ login: 'org', contributions: 5 }]);
    assert.equal(computeStats(raw([base]), { excludeRepos: ['org/*'] }).contributedRepos, 0);
  });

  it('reads private repos from their history when GitHub hides their contributions', () => {
    const hidden = window('2026-09-01T00:00:00Z', '2026-10-06T12:00:00Z', [['2026-10-01', 9]], { restrictedContributionsCount: 9, totalCommitContributions: 2 });
    const platform = { ...repo('shop/platform', [['Java', 1000]], 40, 30), isPrivate: true, owner: { __typename: 'Organization', login: 'shop' } };
    const stats = computeStats(raw([hidden], [platform]));
    assert.equal(stats.recoveredPrivateRepos, 1);
    assert.equal(stats.commits, 2 + 30);
    assert.equal(stats.privateOrgs, 1);
    assert.equal(stats.contributedReposNotOwned, 1);
    assert.equal(stats.contributions, 9);
    assert.deepEqual(stats.languages.map((l) => l.name), ['Java']);
    // Nothing hidden: nothing to recover, so nothing is counted twice.
    const open = computeStats(raw([{ ...hidden, restrictedContributionsCount: 0 }], [platform]));
    assert.equal(open.recoveredPrivateRepos, 0);
    assert.equal(open.commits, 2);
  });

  it('sums stars of owned repositories', () => {
    assert.equal(computeStats(raw([])).stars, 3);
  });

  it('compares the last 7 days with an ordinary week', () => {
    const days = (from: string, to: string, count: number): Array<[string, number]> => {
      const out: Array<[string, number]> = [];
      for (let t = Date.parse(`${from}T00:00:00Z`); t <= Date.parse(`${to}T00:00:00Z`); t += 86_400_000) {
        out.push([new Date(t).toISOString().slice(0, 10), count]);
      }
      return out;
    };
    const span = (list: Array<[string, number]>) => raw([window('2026-09-01T00:00:00Z', '2026-10-06T12:00:00Z', list)]);
    // Today is still empty, so the week is the 7 days before it. The account
    // is five weeks old: four whole weeks to compare with.
    const busy = computeStats(span([...days('2026-09-01', '2026-09-28', 1), ...days('2026-09-29', '2026-10-05', 3)]));
    assert.equal(busy.last7Days, 21);
    assert.equal(busy.usualWeek, 7);
    assert.equal(busy.weekTrend, 'up');
    // Once something happens today, today counts.
    const steady = computeStats(span(days('2026-09-01', '2026-10-06', 1)));
    assert.equal(steady.last7Days, 7);
    assert.equal(steady.weekTrend, 'flat');
    const quiet = computeStats(span(days('2026-09-01', '2026-09-28', 2)));
    assert.equal(quiet.last7Days, 0);
    assert.equal(quiet.weekTrend, 'down');
    // A new account has no ordinary week yet.
    const base = raw([]);
    const fresh = computeStats({ ...base, user: { ...base.user, createdAt: '2026-10-01T00:00:00Z' } });
    assert.equal(fresh.usualWeek, null);
    assert.equal(fresh.weekTrend, null);
  });

  it('lists recent work newest first, leaving out the profile repository', () => {
    const stats = computeStats(demo);
    // teletext-demo/teletext-demo has the newest commit, but it is the README.
    assert.deepEqual(stats.recentWork.slice(0, 3).map((r) => r.label), ['fjord-tracker', 'nordlys-labs/aurora-api', null]);
    assert.equal(stats.recentWork[2]!.private, true);
    assert.ok(!stats.recentWork.some((r) => r.label?.includes('teletext-demo')));
    // A pinned organisation lends its name to its private repositories; a hidden one drops out.
    const named = computeStats(demo, { orgs: { pin: [{ login: 'secret-co', label: 'Secret Co' }], hide: ['nordlys-labs'] } });
    assert.deepEqual(named.recentWork.slice(0, 3).map((r) => r.label), ['fjord-tracker', 'Secret Co', 'kbh-hackers/cykelsti']);
  });

  it('never names a private repository in recent work, and mentions them once', () => {
    const secret = (name: string, at: string): RepoDetail => ({ ...repo(name, [], 1, 1), isPrivate: true, lastCommitAt: at });
    const stats = computeStats(
      raw([], [secret('acme/billing', '2026-10-05T10:00:00Z'), secret('acme/payroll', '2026-10-04T10:00:00Z'), { ...repo('me/solo', [], 1, 1), lastCommitAt: '2026-10-03T10:00:00Z' }]),
    );
    assert.deepEqual(stats.recentWork.map((r) => r.label), [null, 'solo']);
    assert.ok(!JSON.stringify(stats.recentWork).match(/billing|payroll|acme/));
  });
});

describe('languageShares', () => {
  const repos = [
    repo('me/solo', [['Java', 1000]], 10, 10),
    // A big team repository where I wrote a quarter of the commits.
    repo('org/team', [['Go', 6000], ['CSS', 2000]], 100, 25),
    // Never committed to it: it does not count, however large.
    repo('org/huge', [['C++', 1_000_000]], 500, 0),
  ];

  it('scales each repository by the share of commits you authored', () => {
    const shares = languageShares(repos);
    assert.deepEqual(
      shares.map((l) => [l.name, Math.round(l.share * 1000) / 1000]),
      [
        ['Go', 0.5],
        ['Java', 0.333],
        ['CSS', 0.167],
      ],
    );
  });

  it('splits your commits by language in commits mode', () => {
    const shares = languageShares(repos, { languagesBy: 'commits' });
    // 10 commits of Java; 25 split 3:1 between Go and CSS.
    assert.deepEqual(
      shares.map((l) => [l.name, Math.round(l.share * 1000) / 1000]),
      [
        ['Go', 0.536],
        ['Java', 0.286],
        ['CSS', 0.179],
      ],
    );
  });

  it('counts whole repositories in bytes mode', () => {
    const shares = languageShares(repos, { languagesBy: 'bytes' });
    assert.equal(shares[0]!.name, 'C++');
  });

  it('drops excluded languages and groups the tail as Other', () => {
    const shares = languageShares(repos, { excludeLanguages: ['css'], languagesCount: 1 });
    assert.deepEqual(
      shares.map((l) => l.name),
      ['Go', 'Other'],
    );
    assert.ok(Math.abs(shares.reduce((t, l) => t + l.share, 0) - 1) < 1e-9);
  });

  it('counts a fork by the commits made after forking', () => {
    // RepoDetail.commits.authored of a fork only holds post-fork commits.
    const fork = { ...repo('team/fork', [['Ruby', 1000]], 100, 50), isFork: true };
    assert.deepEqual(languageShares([fork]), [{ name: 'Ruby', color: null, share: 1 }]);
  });

  it('says which repositories the languages come from, without naming private ones', () => {
    const secret = { ...repo('acme/secret', [['Go', 1000]], 10, 10), isPrivate: true, owner: { __typename: 'Organization', login: 'acme' } };
    const team = { ...repo('acme/app', [['Go', 2000]], 10, 5), owner: { __typename: 'Organization', login: 'acme' } };
    const mate = repo('mate/exam', [['Java', 500]], 10, 10);
    const { languageSources: sources, languageOrigin: origin } = languageSources([repo('me/solo', [['Java', 1000]], 10, 10), team, mate, secret], 'me');
    // Weights: me/solo 1000, acme/app 1000, mate/exam 500, private 1000.
    assert.deepEqual(sources, [
      { repo: 'acme/app', kind: 'org', share: 1000 / 3500 },
      { repo: 'me/solo', kind: 'own', share: 1000 / 3500 },
      { repo: 'mate/exam', kind: 'person', share: 500 / 3500 },
      { repo: null, kind: 'private', share: 1000 / 3500 },
    ]);
    assert.deepEqual(origin, { own: 1000 / 3500, org: 1000 / 3500, person: 500 / 3500, private: 1000 / 3500 });
  });

  it('skips empty repositories', () => {
    assert.deepEqual(languageShares([{ ...repo('me/empty', [['Java', 10]], 0, 0), commits: null }]), []);
  });
});
