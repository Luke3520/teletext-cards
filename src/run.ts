// Fetch, count, draw, write. Shared by the Action and the CLI.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Card } from './cards/common.ts';
import { CARDS } from './cards/page.ts';
import { GitHubClient } from './github/client.ts';
import { collect } from './github/collect.ts';
import type { RawData } from './github/types.ts';
import type { Settings } from './settings.ts';
import type { Stats } from './stats.ts';
import { computeStats } from './stats.ts';

export interface RunResult {
  stats: Stats;
  cards: Card[];
  files: string[];
}

export interface RunOptions {
  /** Read GitHub data from this JSON file instead of the API. */
  fixture?: string;
  /** Save the fetched GitHub data here, to replay it later as a fixture. */
  saveRaw?: string;
  log?: (message: string) => void;
}

const pct = (share: number) => `${(share * 100).toFixed(1)}%`;

/** "your repos 52.0%, org repos 41.5%, ..." */
export function originText(stats: Stats): string {
  const o = stats.languageOrigin;
  const parts: Array<[string, number]> = [
    ['your repos', o.own],
    ['org repos', o.org],
    ["other people's repos", o.person],
    ['private repos', o.private],
  ];
  return parts.filter(([, v]) => v > 0).map(([k, v]) => `${k} ${pct(v)}`).join(', ') || 'none';
}

/** "owner/repo 40.0% (org), ..." */
export function sourcesText(stats: Stats): string {
  return stats.languageSources.map((src) => `${src.repo ?? 'private repos'} ${pct(src.share)} (${src.kind})`).join(', ') || 'none';
}

export async function run(settings: Settings, options: RunOptions = {}): Promise<RunResult> {
  const log = options.log ?? (() => {});

  let raw: RawData;
  if (options.fixture) {
    raw = JSON.parse(readFileSync(options.fixture, 'utf8')) as RawData;
    log(`using fixture ${options.fixture}`);
  } else {
    const client = new GitHubClient(settings.token, { log });
    raw = await collect(client, { login: settings.username, log });
  }
  if (options.saveRaw) writeFileSync(options.saveRaw, JSON.stringify(raw));

  const stats = computeStats(raw, settings.stats);
  log(
    `${stats.contributions} contributions (${stats.lastYear} in the last year), ${stats.commits} commits, ` +
      `${stats.pullRequests} pull requests (${stats.mergedPullRequests} merged), ${stats.reviews} reviews`,
  );
  log(
    `${stats.repos} repositories owned or worked on, ${stats.contributedReposNotOwned} of them owned by orgs or others; ` +
      `orgs: ${stats.orgs.map((o) => o.login).join(', ') || 'none'}${stats.privateOrgs ? ` (+${stats.privateOrgs} private)` : ''}`,
  );
  log(`languages by ${stats.languagesBy}: ${stats.languages.map((l) => `${l.name} ${(l.share * 100).toFixed(1)}%`).join(', ') || 'none'}`);
  log(`languages come from: ${originText(stats)}`);
  log(`biggest language sources: ${sourcesText(stats)}`);

  const cards = settings.cards.map((name) => CARDS[name](stats, settings.card));

  mkdirSync(settings.outputDir, { recursive: true });
  const files = cards.map((card) => {
    const file = join(settings.outputDir, `${card.name}.svg`);
    writeFileSync(file, card.svg);
    log(`wrote ${file} (${(card.svg.length / 1024).toFixed(1)} kB)`);
    return file;
  });
  return { stats, cards, files };
}
