// Building blocks shared by the cards. Each draws from `row` down and returns
// the next free row plus a plain-text line for the alt text.

import type { Strings } from '../i18n.ts';
import type { Stats } from '../stats.ts';
import type { Colour } from '../teletext/palette.ts';
import type { Screen } from '../teletext/screen.ts';
import { RANK_COLOURS, fit, leader, len, num, packList, percentages } from './common.ts';

export interface Section {
  row: number;
  alt: string;
}

const LEADER = { label: 'cyan', dots: 'blue', value: 'white', extra: 'yellow' } as const;

/** The headline numbers, one per row. */
export function numbers(screen: Screen, row: number, stats: Stats, s: Strings): Section {
  const end = screen.cols - 1;
  const repos = stats.repos;
  leader(screen, row++, 1, end, s.contributions, num(stats.contributions, s), LEADER);
  leader(screen, row++, 1, end, s.commits, num(stats.commits, s), LEADER);
  leader(screen, row++, 1, end, s.pullRequests, num(stats.pullRequests, s), LEADER, `${num(stats.mergedPullRequests, s)} ${s.merged}`);
  leader(screen, row++, 1, end, s.reviews, num(stats.reviews, s), LEADER);
  leader(
    screen,
    row++,
    1,
    end,
    s.repos,
    num(repos, s),
    LEADER,
    stats.contributedReposNotOwned ? `${num(stats.contributedReposNotOwned, s)} ${s.notOwned}` : '',
  );
  const alt =
    `${num(stats.contributions, s)} contributions, ${num(stats.commits, s)} commits, ` +
    `${num(stats.pullRequests, s)} pull requests (${num(stats.mergedPullRequests, s)} merged), ` +
    `${num(stats.reviews, s)} code reviews, ${num(repos, s)} repositories` +
    (stats.contributedReposNotOwned ? ` (${num(stats.contributedReposNotOwned, s)} owned by organisations or teammates)` : '');
  return { row, alt };
}

/** Organisations the user contributed to: the work that owner-only cards leave out. */
export function organisations(screen: Screen, row: number, stats: Stats, s: Strings, maxLines = 2): Section {
  const names = stats.orgs.map((o) => o.login);
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

/** A coloured band with a label on the left and a note on the right. */
export function band(screen: Screen, row: number, label: string, note: string, colour: Colour = 'blue'): number {
  screen.fill(0, row, screen.cols, 1, colour);
  screen.text(1, row, label, { fg: colour === 'yellow' || colour === 'cyan' || colour === 'white' ? 'blue' : 'yellow' });
  const room = screen.cols - len(label) - 4;
  if (note && room >= 4) screen.textRight(screen.cols - 1, row, fit(note, room), { fg: colour === 'blue' ? 'cyan' : 'white' });
  return row + 1;
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
