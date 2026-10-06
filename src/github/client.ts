// A small GraphQL client for the GitHub API: fetch, retries, clear errors.

export interface GraphQLError {
  message: string;
  type?: string;
  path?: Array<string | number>;
}

export interface GraphQLResponse<T> {
  data: T | null;
  errors?: GraphQLError[];
}

export class GitHubError extends Error {}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export class GitHubClient {
  private readonly token: string;
  private readonly endpoint: string;
  private readonly log: (message: string) => void;

  constructor(token: string, options: { endpoint?: string; log?: (message: string) => void } = {}) {
    if (!token) throw new GitHubError('No GitHub token. Pass github_token (the default ${{ github.token }} works).');
    this.token = token;
    this.endpoint = options.endpoint ?? process.env.GITHUB_GRAPHQL_URL ?? 'https://api.github.com/graphql';
    this.log = options.log ?? (() => {});
  }

  /**
   * Runs a query. Partial results come back with `errors` set, because one
   * missing repository should not sink the whole card.
   */
  async query<T>(query: string, variables: Record<string, unknown> = {}): Promise<GraphQLResponse<T>> {
    for (let attempt = 1; ; attempt++) {
      let res: Response;
      try {
        res = await fetch(this.endpoint, {
          method: 'POST',
          headers: {
            authorization: `bearer ${this.token}`,
            'content-type': 'application/json',
            'user-agent': 'teletext-cards',
          },
          body: JSON.stringify({ query, variables }),
        });
      } catch (err) {
        if (attempt >= 4) throw new GitHubError(`Could not reach the GitHub API: ${(err as Error).message}`);
        await this.backoff(attempt, 'network error');
        continue;
      }

      if (res.status === 401) throw new GitHubError('GitHub rejected the token (401). Check github_token.');

      const limited =
        res.status === 429 ||
        (res.status === 403 && (res.headers.get('retry-after') !== null || res.headers.get('x-ratelimit-remaining') === '0'));
      if (limited && attempt < 4) {
        const retryAfter = Number(res.headers.get('retry-after') ?? 0);
        const reset = Number(res.headers.get('x-ratelimit-reset') ?? 0) * 1000 - Date.now();
        const wait = Math.min(Math.max(retryAfter * 1000, reset, 5000), 60_000);
        this.log(`rate limited, waiting ${Math.round(wait / 1000)}s`);
        await sleep(wait);
        continue;
      }
      if (res.status >= 500 && attempt < 4) {
        await this.backoff(attempt, `HTTP ${res.status}`);
        continue;
      }
      if (!res.ok) {
        const body = await res.text();
        throw new GitHubError(`GitHub API returned HTTP ${res.status}: ${body.slice(0, 300)}`);
      }

      const json = (await res.json()) as GraphQLResponse<T>;
      if (!json.data && json.errors?.length) {
        throw new GitHubError(`GitHub API error: ${json.errors.map((e) => e.message).join('; ')}`);
      }
      return json;
    }
  }

  private async backoff(attempt: number, reason: string): Promise<void> {
    const ms = 1000 * 2 ** (attempt - 1);
    this.log(`${reason}, retrying in ${ms / 1000}s`);
    await sleep(ms);
  }
}
