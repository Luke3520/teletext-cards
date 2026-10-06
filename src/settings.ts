// One parser for both the Action inputs and the CLI flags.

import type { CardName } from './cards/page.ts';
import { CARDS } from './cards/page.ts';
import { resolveArt } from './cards/art.ts';
import type { CardOptions, Part } from './cards/common.ts';
import { PARTS } from './cards/common.ts';
import type { Locale } from './i18n.ts';
import { STRINGS } from './i18n.ts';
import type { LanguageMode, OrgDisplay, StatsOptions } from './stats.ts';
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

const PART_ALIASES: Readonly<Record<string, Part>> = {
  prs: 'pull_requests',
  pullrequests: 'pull_requests',
  repos: 'repositories',
  organisations: 'orgs',
  organizations: 'orgs',
  langs: 'languages',
  star: 'stars',
  visits: 'visitors',
  views: 'visitors',
  traffic: 'visitors',
  repovisitors: 'visitors',
  thisweek: 'last_7_days',
  '7days': 'last_7_days',
  streaks: 'streak',
  recentwork: 'recent',
  weeks: 'activity',
  graph: 'activity',
};

/** The `hide` input: parts of the page and stats cards to leave out. */
export function parseHide(value: string | undefined): Part[] {
  return list(value).map((raw) => {
    const key = raw.toLowerCase().replace(/[\s-]+/g, '_');
    const part = (PARTS as readonly string[]).includes(key) ? (key as Part) : PART_ALIASES[key.replace(/_/g, '')];
    if (!part) throw new SettingsError(`hide: unknown part "${raw}". Parts: ${PARTS.join(', ')}`);
    return part;
  });
}

/**
 * The `orgs` input: `name` pins an organisation (named even if private),
 * `name=Label` also renames it, `-name` hides it.
 */
export function parseOrgs(value: string | undefined): OrgDisplay {
  const pin: OrgDisplay['pin'] = [];
  const hide: string[] = [];
  for (const entry of list(value)) {
    if (entry.startsWith('-')) {
      hide.push(entry.slice(1).trim());
      continue;
    }
    const eq = entry.indexOf('=');
    const login = (eq < 0 ? entry : entry.slice(0, eq)).trim();
    const label = eq < 0 ? '' : entry.slice(eq + 1).trim();
    if (!/^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?$/.test(login)) throw new SettingsError(`orgs: "${login}" is not an organisation login`);
    pin.push(label ? { login, label } : { login });
  }
  return { pin, hide };
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
      orgs: parseOrgs(get('orgs')),
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
      hide: parseHide(get('hide')),
      animate: bool('animate', get('animate'), true),
      crt: bool('crt', get('crt'), true),
    },
    publishBranch: get('publish_branch')?.trim() ?? '',
    commitMessage: get('commit_message')?.trim() || 'Update teletext cards',
  };
}
