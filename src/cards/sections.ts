// Building blocks shared by the cards. Each draws from `row` down and returns
// the next free row plus a plain-text line for the alt text.

import type { Strings } from '../i18n.ts';
import { when } from '../i18n.ts';
import type { Stats } from '../stats.ts';
import type { Colour } from '../teletext/palette.ts';
import type { Screen } from '../teletext/screen.ts';
import type { Part } from './common.ts';
import { RANK_COLOURS, fit, leader, len, num, packList, percentages } from './common.ts';

export interface Section {
  row: number;
  alt: string;
}

const LEADER = { label: 'cyan', dots: 'blue', value: 'white', extra: 'yellow' } as const;
const RECENT = { label: 'white', dots: 'blue', value: 'cyan' } as const;

/** The headline numbers, one per row, minus any the user hid. */
export function numbers(screen: Screen, row: number, stats: Stats, s: Strings, hide: ReadonlySet<Part> = new Set()): Section {
  const end = screen.cols - 1;
  const alt: string[] = [];
  const line = (part: Part, label: string, value: string, said: string, extra = '') => {
    if (hide.has(part)) return;
    leader(screen, row++, 1, end, label, value, LEADER, extra);
    alt.push(said);
  };
  const merged = num(stats.mergedPullRequests, s);
  const others = stats.contributedReposNotOwned;
  const usual = stats.usualWeek === null ? '' : ` (${Math.round(stats.usualWeek)} in an ordinary week)`;
  line('contributions', s.contributions, num(stats.contributions, s), `${num(stats.contributions, s)} contributions`);
  // The pulse: how the last week went, and how many days in a row.
  line(
    'last_7_days',
    s.last7Days,
    num(stats.last7Days, s),
    `${num(stats.last7Days, s)} contributions in the last 7 days${usual}`,
    stats.weekTrend ? s.trend[stats.weekTrend] : '',
  );
  line(
    'streak',
    s.streak,
    s.days(stats.currentStreak),
    `a streak of ${stats.currentStreak} ${stats.currentStreak === 1 ? 'day' : 'days'} (best ${stats.longestStreak})`,
    `${s.best} ${num(stats.longestStreak, s)}`,
  );
  line('commits', s.commits, num(stats.commits, s), `${num(stats.commits, s)} commits`);
  line('pull_requests', s.pullRequests, num(stats.pullRequests, s), `${num(stats.pullRequests, s)} pull requests (${merged} merged)`, `${merged} ${s.merged}`);
  line('reviews', s.reviews, num(stats.reviews, s), `${num(stats.reviews, s)} code reviews`);
  line(
    'repositories',
    s.repos,
    num(stats.repos, s),
    `${num(stats.repos, s)} repositories` + (others ? ` (${num(others, s)} owned by organisations or teammates)` : ''),
    others ? `${num(others, s)} ${s.notOwned}` : '',
  );
  return { row, alt: alt.join(', ') };
}

/** Organisations the user contributed to: the work that owner-only cards leave out. */
export function organisations(screen: Screen, row: number, stats: Stats, s: Strings, maxLines = 2): Section {
  const names = stats.orgs.map((o) => o.label ?? o.login);
  const privateLabel = s.privateOrgs(stats.privateOrgs);
  const items = stats.privateOrgs ? [...names, privateLabel] : names;
  if (!items.length) return { row, alt: '' };
  const label = s.orgs;
  const start = 2 + len(label);
  const lines = packList(items, screen.cols - 1 - start, ' · ', maxLines, s.more, (item) =>
    stats.privateOrgs && item === privateLabel ? stats.privateOrgs : 1,
  );
  screen.text(1, row, label, { fg: 'magenta' });
  lines.forEach((line, i) => {
    let col = start;
    line.split(' · ').forEach((part, k) => {
      if (k > 0) col = screen.text(col, row + i, ' · ', { fg: 'blue' });
      col = screen.text(col, row + i, part, { fg: part.startsWith('+') ? 'magenta' : 'white' });
    });
  });
  return { row: row + lines.length, alt: `Organisations: ${items.join(', ')}` };
}

/**
 * A coloured band with a label on the left and a note on the right. Several
 * notes take turns, like teletext subpages.
 */
export function band(screen: Screen, row: number, label: string, note: string | string[], colour: Colour = 'blue'): number {
  const light = colour === 'yellow' || colour === 'cyan' || colour === 'white';
  screen.fill(0, row, screen.cols, 1, colour);
  screen.text(1, row, label, { fg: light ? 'blue' : 'yellow' });
  const notes = (Array.isArray(note) ? note : [note]).filter(Boolean);
  const room = screen.cols - len(label) - 4;
  if (notes.length && room >= 4) {
    const fg: Colour = colour === 'blue' ? 'cyan' : light ? 'blue' : 'white';
    screen.cycle(row, notes.length, (i) => screen.textRight(screen.cols - 1, row, fit(notes[i]!, room), { fg }));
  }
  return row + 1;
}

export interface Fact {
  text: string;
  colour: Colour;
  /** For the alt text. */
  said: string;
}

/**
 * Short facts that take turns on one line: since when, stars, and visitors
 * to your public repositories. Hidden ones are left out, and so are empty
 * ones: no line about stars until there is one.
 */
export function facts(stats: Stats, s: Strings, hide: ReadonlySet<Part>): Fact[] {
  const out: Fact[] = [];
  const year = new Date(stats.createdAt).getUTCFullYear();
  if (!hide.has('since')) out.push({ text: s.since(year), colour: 'green', said: `On GitHub since ${year}` });
  if (!hide.has('stars') && stats.stars > 0) {
    const one = stats.starredRepos === 1 && stats.topStarred ? stats.topStarred.name : null;
    const stars = num(stats.stars, s);
    out.push({
      text: s.starsOn(stars, stats.stars, one ?? s.repoCount(stats.starredRepos)),
      colour: 'yellow',
      said: `${stars} ${stats.stars === 1 ? 'star' : 'stars'} on ${one ?? `${stats.starredRepos} ${stats.starredRepos === 1 ? 'repository' : 'repositories'}`}`,
    });
  }
  const v = stats.visitors;
  if (!hide.has('visitors') && v && v.uniques > 0) {
    out.push({
      text: s.repoVisitors(num(v.uniques, s), v.uniques),
      colour: 'cyan',
      said: `${num(v.uniques, s)} ${v.uniques === 1 ? 'visitor' : 'visitors'} to public repositories in the last 14 days (${num(v.views, s)} views)`,
    });
  }
  return out;
}

/** Language bars, scaled to the biggest language, with whole percentages. */
export function languages(screen: Screen, row: number, stats: Stats, s: Strings): Section {
  row = band(screen, row, s.languages, s.languagesBy[stats.languagesBy]);
  if (stats.languages.length === 0) {
    screen.text(1, row, s.noLanguages, { fg: 'white' });
    return { row: row + 1, alt: s.noLanguages };
  }
  const pct = percentages(stats.languages.map((l) => l.share));
  const top = Math.max(...stats.languages.map((l) => l.share));
  const nameWidth = Math.min(11, screen.cols - 16);
  const barCol = 1 + nameWidth + 1;
  const barCells = screen.cols - barCol - 6;
  stats.languages.forEach((lang, i) => {
    const other = lang.name === 'Other';
    const colour: Colour = other ? 'white' : RANK_COLOURS[i % (RANK_COLOURS.length - 1)]!;
    screen.text(1, row, fit(other ? s.other : lang.name, nameWidth), { fg: 'white' });
    screen.hbar(barCol, row, Math.max(1, Math.round((lang.share / top) * barCells * 2)), colour, 2);
    screen.textRight(screen.cols - 1, row, `${pct[i]}%`, { fg: colour });
    row++;
  });
  return { row, alt: `Languages, ${s.languagesBy[stats.languagesBy]}: ${stats.languages.map((l, i) => `${l.name} ${pct[i]}%`).join(', ')}` };
}

/**
 * The repositories with the user's latest commits, and when, in the user's
 * time zone. Private ones are never named.
 */
export function recent(screen: Screen, row: number, stats: Stats, s: Strings, timeZone: string, count = 3): Section {
  const items = stats.recentWork.slice(0, count);
  if (!items.length) return { row, alt: '' };
  row = band(screen, row, s.recent, s.lastCommit);
  const now = new Date(stats.generatedAt);
  const end = screen.cols - 1;
  const said = items.map((item) => {
    const date = when(new Date(item.at), now, timeZone, s);
    const tag = item.private && item.label ? ` · ${s.private}` : '';
    const name = fit(item.label ?? s.privateRepo, Math.max(1, end - 3 - len(date) - len(tag)));
    leader(screen, row, 1, end, name + tag, date, RECENT);
    // Private work is magenta, like the private organisations.
    if (tag) {
      screen.text(1 + len(name), row, ' · ', { fg: 'blue' });
      screen.text(1 + len(name) + 3, row, s.private, { fg: 'magenta' });
    } else if (item.private) {
      screen.text(1, row, name, { fg: 'magenta' });
    }
    row++;
    const what = item.private ? (item.label ? `a private ${item.label} repository` : 'a private repository') : item.label!;
    return `${what} ${date}`;
  });
  return { row, alt: `Recent work: ${said.join(', ')}` };
}

/**
 * The last 52 weeks as separated-mosaic bars, one sextant column per week.
 * Heights follow a square root, so one busy sprint does not flatten every
 * other week into the baseline.
 */
export function activity(screen: Screen, row: number, stats: Stats, s: Strings): Section {
  const peak = Math.max(1, ...stats.weeks);
  const heights = stats.weeks.map((w) => (w === 0 ? 0 : Math.max(1, Math.round(Math.sqrt(w / peak) * 6))));
  const graphCol = screen.cols - 1 - Math.ceil(stats.weeks.length / 2);
  if (graphCol - 2 >= len(s.weeks)) {
    screen.text(1, row + 1, s.weeks, { fg: 'yellow' });
  } else {
    screen.text(1, row++, s.weeks, { fg: 'yellow' });
  }
  screen.vbars(Math.max(1, graphCol), row, 2, heights, 'cyan', true);
  return { row: row + 2, alt: `${num(stats.lastYear, s)} contributions in the last 52 weeks` };
}

/** The Fastext row: four coloured labels, like the keys on the remote. */
export function fastext(screen: Screen, row: number, labels: string[]): number {
  const keys = labels.slice(0, 4);
  if (!keys.length) return row;
  const colours: Colour[] = ['red', 'green', 'yellow', 'cyan'];
  const slot = Math.floor(screen.cols / 4);
  keys.forEach((label, i) => screen.text(i * slot + 1, row, fit(label, slot - 1), { fg: colours[i]! }));
  return row + 1;
}
