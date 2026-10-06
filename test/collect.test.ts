import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { GitHubClient, GraphQLResponse } from '../src/github/client.ts';
import { collect, contributionWindows } from '../src/github/collect.ts';

const DAY = 86_400_000;

describe('contributionWindows', () => {
  const created = new Date('2023-09-22T06:43:55Z');
  const now = new Date('2026-10-06T07:37:00Z');
  const windows = contributionWindows(created, now);

  it('runs from now back to the day the account was created', () => {
    assert.equal(windows[0]!.to.toISOString(), now.toISOString());
    assert.equal(windows.at(-1)!.from.toISOString(), '2023-09-22T00:00:00.000Z');
  });

  it('never spans more than a year, as the API requires', () => {
    for (const w of windows) assert.ok(w.to.getTime() - w.from.getTime() < 365 * DAY);
  });

  it('leaves no gaps and no overlaps between windows', () => {
    for (let i = 1; i < windows.length; i++) assert.equal(windows[i - 1]!.from.getTime() - windows[i]!.to.getTime(), 1000);
  });

  it('starts every window at midnight UTC', () => {
    for (const w of windows) assert.equal(w.from.toISOString().slice(11), '00:00:00.000Z');
  });

  it('makes one window for a new account', () => {
    assert.equal(contributionWindows(new Date('2026-10-01T10:00:00Z'), now).length, 1);
  });
});

/** A fake client that answers by query name and records what was asked. */
let reposQuery = '';

function fakeClient(answer: (name: string, variables: Record<string, unknown>, query: string) => unknown) {
  const calls: Array<{ name: string; variables: Record<string, unknown> }> = [];
  const client = {
    async query<T>(query: string, variables: Record<string, unknown> = {}): Promise<GraphQLResponse<T>> {
      const name = /query (\w+)/.exec(query)![1]!;
      calls.push({ name, variables });
      if (name === 'Repos') reposQuery = query;
      return { data: answer(name, variables, query) as T };
    },
  } as unknown as GitHubClient;
  return { client, calls };
}

const emptyWindow = {
  totalCommitContributions: 1,
  totalIssueContributions: 0,
  totalPullRequestContributions: 0,
  totalPullRequestReviewContributions: 0,
  totalRepositoryContributions: 0,
  restrictedContributionsCount: 0,
  contributionCalendar: { totalContributions: 0, weeks: [] },
  commitContributionsByRepository: [
    { contributions: { totalCount: 3 }, repository: { nameWithOwner: 'acme/api', isPrivate: false, isFork: false, owner: { __typename: 'Organization', login: 'acme' } } },
    { contributions: { totalCount: 1 }, repository: { nameWithOwner: 'me/fork', isPrivate: false, isFork: true, owner: { __typename: 'User', login: 'me' } } },
  ],
  pullRequestContributionsByRepository: [],
  issueContributionsByRepository: [],
  pullRequestReviewContributionsByRepository: [],
};

describe('collect', () => {
  it('follows contributions into organisation repos and pages through owned repos', async () => {
    const { client, calls } = fakeClient((name, variables, query) => {
      if (name === 'Profile') {
        return {
          user: {
            id: 'U1', login: 'me', name: 'Me', createdAt: '2025-01-01T00:00:00Z',
            followers: { totalCount: 1 }, pullRequests: { totalCount: 2 }, merged: { totalCount: 1 }, issues: { totalCount: 0 },
          },
        };
      }
      if (name === 'Owned') {
        const first = variables.after === null;
        return {
          user: {
            repositories: {
              pageInfo: { hasNextPage: first, endCursor: first ? 'c1' : null },
              nodes: [{ nameWithOwner: first ? 'me/one' : 'me/two', isPrivate: false, isArchived: false, stargazerCount: 1 }],
            },
          },
        };
      }
      if (name === 'Window') return { user: { contributionsCollection: emptyWindow } };
      if (name === 'Access') {
        return {
          user: {
            repositories: { totalCount: 2 },
            organizations: { totalCount: 3, nodes: [{ repositories: { totalCount: 1 } }, { repositories: { totalCount: 0 } }, null] },
          },
        };
      }
      if (name === 'PullRequests') {
        const team = { nameWithOwner: 'team/tests', isPrivate: false, isFork: true, createdAt: '2026-02-01T00:00:00Z', owner: { __typename: 'Organization', login: 'team' } };
        return {
          user: {
            pullRequests: {
              pageInfo: { hasNextPage: false, endCursor: null },
              nodes: [{ repository: team }, { repository: team }, { repository: { ...team, nameWithOwner: 'acme/api', isFork: false } }, { repository: null }],
            },
          },
        };
      }
      if (name === 'Repos') {
        // Answer every alias; pretend me/two was deleted meanwhile.
        const out: Record<string, unknown> = {};
        for (const m of query.matchAll(/(r\d+): repository\(owner: "([^"]+)", name: "([^"]+)"\)/g)) {
          const full = `${m[2]}/${m[3]}`;
          out[m[1]!] =
            full === 'me/two'
              ? null
              : {
                  nameWithOwner: full, isPrivate: false, isFork: full === 'team/tests', stargazerCount: 0,
                  owner: { __typename: m[2] === 'me' ? 'User' : 'Organization', login: m[2] },
                  languages: { totalSize: 10, edges: [{ size: 10, node: { name: 'Go', color: null } }] },
                  defaultBranchRef: { target: { history: { totalCount: 4 }, authored: { totalCount: 2 }, sinceFork: { totalCount: 1 } } },
                };
        }
        return out;
      }
      throw new Error(`unexpected query ${name}`);
    });

    const data = await collect(client, { login: 'me', now: new Date('2026-10-06T00:00:00Z') });

    assert.deepEqual(data.ownedRepos.map((r) => r.nameWithOwner), ['me/one', 'me/two']);
    assert.equal(calls.filter((c) => c.name === 'Window').length, 2);
    assert.deepEqual(data.repos.map((r) => r.nameWithOwner).sort(), ['acme/api', 'me/one', 'team/tests']);
    assert.deepEqual(data.repos.find((r) => r.nameWithOwner === 'acme/api')!.commits, { total: 4, authored: 2 });
    assert.deepEqual(data.access, { ownedPrivateRepos: 2, organizations: 3, orgPrivateRepos: 1, orgsWithPrivateRepos: 1 });
    assert.equal(calls.find((c) => c.name === 'Repos')!.variables.uid, 'U1');
    // Forks come from pull requests, and only post-fork commits count as authored.
    assert.deepEqual(data.forks, [
      { repository: { nameWithOwner: 'team/tests', isPrivate: false, isFork: true, createdAt: '2026-02-01T00:00:00Z', owner: { __typename: 'Organization', login: 'team' } }, pullRequests: 2 },
    ]);
    assert.deepEqual(data.repos.find((r) => r.nameWithOwner === 'team/tests')!.commits, { total: 4, authored: 1 });
    assert.match(reposQuery, /sinceFork: history\(author: \{ id: \$uid \}, since: "2026-02-01T00:00:00Z"\)/);
  });

  it('carries on when the access check fails', async () => {
    const { client } = fakeClient((name) => {
      if (name === 'Profile') {
        return {
          user: {
            id: 'U1', login: 'me', name: null, createdAt: '2026-10-01T00:00:00Z',
            followers: { totalCount: 0 }, pullRequests: { totalCount: 0 }, merged: { totalCount: 0 }, issues: { totalCount: 0 },
          },
        };
      }
      if (name === 'Access') throw new Error('Resource not accessible by integration');
      if (name === 'Owned') return { user: { repositories: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: [] } } };
      if (name === 'Window') return { user: { contributionsCollection: { ...emptyWindow, commitContributionsByRepository: [] } } };
      if (name === 'PullRequests') return { user: { pullRequests: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: [] } } };
      return {};
    });
    const data = await collect(client, { login: 'me', now: new Date('2026-10-06T00:00:00Z') });
    assert.equal(data.access, undefined);
  });

  it('explains a missing user', async () => {
    const { client } = fakeClient(() => ({ user: null }));
    await assert.rejects(collect(client, { login: 'nobody' }), /was not found/);
  });
});
