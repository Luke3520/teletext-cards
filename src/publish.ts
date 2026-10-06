// Force-pushes the generated cards as a single commit to a branch of the
// current repository, so the default branch's history stays clean.

import { execFileSync } from 'node:child_process';
import { cpSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export interface PublishOptions {
  dir: string;
  branch: string;
  /** owner/name */
  repository: string;
  token: string;
  message: string;
  serverUrl?: string;
  log?: (message: string) => void;
}

const BOT_NAME = 'github-actions[bot]';
const BOT_EMAIL = '41898282+github-actions[bot]@users.noreply.github.com';

export function publish(options: PublishOptions): void {
  const log = options.log ?? (() => {});
  if (!/^[\w.-]+\/[\w.-]+$/.test(options.repository)) throw new Error(`Bad repository "${options.repository}"`);
  if (!/^[\w./-]+$/.test(options.branch) || options.branch.includes('..')) throw new Error(`Bad branch name "${options.branch}"`);
  const server = (options.serverUrl ?? 'https://github.com').replace(/\/$/, '');

  const work = mkdtempSync(join(tmpdir(), 'teletext-cards-'));
  try {
    cpSync(options.dir, work, { recursive: true });
    // The token travels in an environment-provided git config entry, never in
    // the remote URL or on the command line.
    const basic = Buffer.from(`x-access-token:${options.token}`).toString('base64');
    const env = {
      ...process.env,
      GIT_CONFIG_COUNT: '1',
      GIT_CONFIG_KEY_0: `http.${server}/.extraheader`,
      GIT_CONFIG_VALUE_0: `AUTHORIZATION: basic ${basic}`,
      GIT_AUTHOR_NAME: BOT_NAME,
      GIT_AUTHOR_EMAIL: BOT_EMAIL,
      GIT_COMMITTER_NAME: BOT_NAME,
      GIT_COMMITTER_EMAIL: BOT_EMAIL,
    };
    const git = (...args: string[]) => execFileSync('git', args, { cwd: work, env, stdio: ['ignore', 'pipe', 'pipe'] }).toString();
    git('init', '--quiet', '--initial-branch', options.branch);
    git('add', '--all');
    git('commit', '--quiet', '--message', options.message);
    git('push', '--quiet', '--force', `${server}/${options.repository}.git`, `HEAD:refs/heads/${options.branch}`);
    log(`pushed cards to ${options.repository}@${options.branch}`);
  } catch (err) {
    const e = err as { stderr?: Buffer; message: string };
    const detail = e.stderr?.toString().trim() || e.message;
    if (/403|denied|not allowed/i.test(detail)) {
      throw new Error(`Could not push to ${options.branch}: ${detail}\nGive the workflow write access: add "permissions: contents: write" to the job.`);
    }
    throw new Error(`Could not push to ${options.branch}: ${detail}`);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}
