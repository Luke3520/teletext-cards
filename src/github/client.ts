// A small client for the GitHub API: GraphQL, plus REST for the little that
// GraphQL does not offer. Retries, clear errors.

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
  private readonly api: string;
  private readonly log: (message: string) => void;

  constructor(token: string, options: { endpoint?: string; api?: string; log?: (message: string) => void } = {}) {
    if (!token) throw new GitHubError('No GitHub token. Pass github_token (the default ${{ github.token }} works).');
    this.token = token;
    this.endpoint = options.endpoint ?? process.env.GITHUB_GRAPHQL_URL ?? 'https://api.github.com/graphql';
    this.api = options.api ?? process.env.GITHUB_API_URL ?? 'https://api.github.com';
    this.log = options.log ?? (() => {});
  }

  /**
   * Runs a query. Partial results come back with `errors` set, because one
   * missing repository should not sink the whole card.
   */
  async query<T>(query: string, variables: Record<string, unknown> = {}): Promise<GraphQLResponse<T>> {
    const res = await this.send(this.endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query, variables }),
    });
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

  /**
   * A REST GET, for what GraphQL does not offer. "Forbidden" and "not found"
   * come back as an answer without data, for callers that can do without.
   */
  async get<T>(path: string): Promise<{ status: number; data: T | null }> {
    const res = await this.send(`${this.api}${path}`, { headers: { accept: 'application/vnd.github+json' } });
    if ((res.status === 403 || res.status === 404) && res.headers.get('x-ratelimit-remaining') !== '0') {
      await res.body?.cancel();
      return { status: res.status, data: null };
    }
    if (!res.ok) {
      const body = await res.text();
      throw new GitHubError(`GitHub API returned HTTP ${res.status} for ${path}: ${body.slice(0, 300)}`);
    }
    return { status: res.status, data: (await res.json()) as T };
  }

  /** Sends a request, retrying network errors, rate limits and server errors. */
  private async send(url: string, init: RequestInit): Promise<Response> {
    for (let attempt = 1; ; attempt++) {
      let res: Response;
      try {
        res = await fetch(url, {
          ...init,
          headers: { authorization: `bearer ${this.token}`, 'user-agent': 'teletext-cards', ...(init.headers as Record<string, string>) },
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
        await res.body?.cancel();
        await sleep(wait);
        continue;
      }
      if (res.status >= 500 && attempt < 4) {
        await res.body?.cancel();
        await this.backoff(attempt, `HTTP ${res.status}`);
        continue;
      }
      return res;
    }
  }

  private async backoff(attempt: number, reason: string): Promise<void> {
    const ms = 1000 * 2 ** (attempt - 1);
    this.log(`${reason}, retrying in ${ms / 1000}s`);
    await sleep(ms);
  }
}
