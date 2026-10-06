// One parser for both the Action inputs and the CLI flags.

import type { CardName } from './cards/page.ts';
import { CARDS } from './cards/page.ts';
import { resolveArt } from './cards/art.ts';
import type { CardOptions } from './cards/common.ts';
import type { Locale } from './i18n.ts';
import { STRINGS } from './i18n.ts';
import type { LanguageMode, StatsOptions } from './stats.ts';
import { COLOURS, isColour } from './teletext/palette.ts';

export interface Settings {
  username: string;
  token: string;
  outputDir: string;
  cards: CardName[];
  stats: StatsOptions;
  card: CardOptions;
  publishBranch: string;
  commitMessage: string;
}

export class SettingsError extends Error {}

/** Splits on commas and newlines. */
export function list(value: string | undefined): string[] {
  return (value ?? '')
    .split(/[\n,]/)
    .map((v) => v.trim())
    .filter(Boolean);
}

function bool(name: string, value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value.trim() === '') return fallback;
  const v = value.trim().toLowerCase();
  if (['true', 'yes', '1', 'on'].includes(v)) return true;
  if (['false', 'no', '0', 'off'].includes(v)) return false;
  throw new SettingsError(`${name} must be true or false, got "${value}"`);
}

function int(name: string, value: string | undefined, fallback: number, min: number, max: number): number {
  if (value === undefined || value.trim() === '') return fallback;
  const n = Number(value);
  if (!Number.isInteger(n) || n < min || n > max) throw new SettingsError(`${name} must be a whole number from ${min} to ${max}, got "${value}"`);
  return n;
}

function oneOf<T extends string>(name: string, value: string | undefined, allowed: readonly T[], fallback: T): T {
  const v = value?.trim().toLowerCase();
  if (!v) return fallback;
  if (!(allowed as readonly string[]).includes(v)) throw new SettingsError(`${name} must be one of ${allowed.join(', ')}, got "${value}"`);
  return v as T;
}

/**
 * Reads settings through `get`, which returns the raw string for an input
 * name such as `exclude_repos`, or undefined when it was not given.
 */
export function parseSettings(get: (name: string) => string | undefined, defaults: { username?: string } = {}): Settings {
  const username = get('username')?.trim() || defaults.username || '';
  if (!username) throw new SettingsError('username is required');

  const cards = list(get('cards') ?? 'page,stats,languages').map((c) => c.toLowerCase());
  for (const c of cards) {
    if (!(c in CARDS)) throw new SettingsError(`Unknown card "${c}". Available: ${Object.keys(CARDS).join(', ')}`);
  }

  const timeZone = get('timezone')?.trim() || 'UTC';
  try {
    new Intl.DateTimeFormat('en', { timeZone });
  } catch {
    throw new SettingsError(`Unknown timezone "${timeZone}". Use an IANA name such as Europe/Copenhagen.`);
  }

  const accent = get('accent')?.trim().toLowerCase() || 'blue';
  if (!isColour(accent) || accent === 'black') {
    throw new SettingsError(`accent must be a teletext colour: ${COLOURS.filter((c) => c !== 'black').join(', ')}`);
  }

  const subtitle = (get('subtitle') ?? '')
    .split(/\r?\n|\|/)
    .map((l) => l.trim())
    .filter(Boolean);

  return {
    username,
    token: get('github_token')?.trim() ?? '',
    outputDir: get('output_dir')?.trim() || 'teletext-cards',
    cards: cards as CardName[],
    stats: {
      excludeRepos: list(get('exclude_repos')),
      excludeLanguages: list(get('exclude_languages')),
      languagesBy: oneOf<LanguageMode>('languages_by', get('languages_by'), ['authorship', 'commits', 'bytes'], 'authorship'),
      languagesCount: int('languages_count', get('languages_count'), 5, 1, 10),
    },
    card: {
      locale: oneOf<Locale>('locale', get('locale'), Object.keys(STRINGS) as Locale[], 'en'),
      timeZone,
      title: get('title')?.trim() || undefined,
      subtitle,
      brand: get('brand')?.trim() || undefined,
      pageNumber: int('page_number', get('page_number'), 100, 100, 899),
      accent,
      art: resolveArt(get('art') ?? 'none'),
      fastext: list(get('fastext')).slice(0, 4),
      animate: bool('animate', get('animate'), true),
      crt: bool('crt', get('crt'), true),
    },
    publishBranch: get('publish_branch')?.trim() ?? '',
    commitMessage: get('commit_message')?.trim() || 'Update teletext cards',
  };
}
