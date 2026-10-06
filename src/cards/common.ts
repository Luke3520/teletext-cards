// Shared pieces for the cards: options, text fitting, leader rows, bars.

import type { Locale, Strings } from '../i18n.ts';
import type { Art } from './art.ts';
import { clock, formatNumber } from '../i18n.ts';
import type { Colour } from '../teletext/palette.ts';
import type { Screen } from '../teletext/screen.ts';
import type { Stats } from '../stats.ts';

/** Parts of the page and stats cards that `hide` can switch off. */
export const PARTS = ['since', 'contributions', 'commits', 'pull_requests', 'reviews', 'repositories', 'orgs', 'languages', 'activity'] as const;
export type Part = (typeof PARTS)[number];

export interface CardOptions {
  locale: Locale;
  timeZone: string;
  /** Big double-height line on the page. Defaults to the user's name. */
  title?: string;
  /** Up to two lines under the title. */
  subtitle?: string[];
  /** Service name in the header row. Defaults to the login in capitals. */
  brand?: string;
  /** Teletext page number, 100-899. */
  pageNumber?: number;
  /** Colour of the title band. */
  accent?: Colour;
  /** Mosaic pixel art for the page, already resolved. */
  art?: Art;
  /** Up to four Fastext labels for the bottom row: red, green, yellow, cyan. */
  fastext?: string[];
  /** Parts to leave out. */
  hide?: Part[];
  /** Page-arrival animation and flashing. */
  animate?: boolean;
  /** Phosphor glow and scanlines. */
  crt?: boolean;
}

export interface Card {
  /** File name without extension: page, stats, languages. */
  name: string;
  svg: string;
  /** Plain-text summary, for the SVG <desc> and README alt text. */
  alt: string;
}

/** Rank colours for language bars. Teletext has eight colours; black is the screen. */
export const RANK_COLOURS: readonly Colour[] = ['green', 'yellow', 'cyan', 'magenta', 'red', 'white'];

/** Cuts text to `width` characters, ending in an ellipsis when it had to cut. */
export function fit(text: string, width: number): string {
  const chars = [...text];
  if (chars.length <= width) return text;
  return width <= 1 ? chars.slice(0, width).join('') : `${chars.slice(0, width - 1).join('')}…`;
}

export function len(text: string): number {
  return [...text].length;
}

/** `LABEL ........ value`, label at `col`, value ending at `end`. */
export function leader(
  screen: Screen,
  row: number,
  col: number,
  end: number,
  label: string,
  value: string,
  colours: { label: Colour; dots: Colour; value: Colour; extra?: Colour },
  extra = '',
): void {
  const right = extra ? `${value} · ${extra}` : value;
  const room = end - col - len(right) - 1;
  const shown = fit(label, Math.max(1, room - 1));
  screen.text(col, row, shown, { fg: colours.label });
  const dotsFrom = col + len(shown) + 1;
  const dotsTo = end - len(right) - 1;
  if (dotsTo > dotsFrom) screen.text(dotsFrom, row, '.'.repeat(dotsTo - dotsFrom), { fg: colours.dots });
  const start = screen.textRight(end, row, right, { fg: colours.value });
  if (extra) {
    screen.text(start + len(value), row, ' · ', { fg: colours.dots });
    screen.text(start + len(value) + 3, row, extra, { fg: colours.extra ?? colours.value });
  }
}

/**
 * Packs a list into at most `maxLines` lines no wider than `width`, joined by
 * `sep`. Each item goes on the first line with room for it, so short names
 * fill the gaps that long ones leave. What does not fit becomes "+N more".
 */
export function packList(
  items: string[],
  width: number,
  sep: string,
  maxLines: number,
  more: (n: number) => string,
  /** How many things an item stands for, e.g. 2 for "+2 private". */
  weight: (item: string) => number = () => 1,
): string[] {
  const span = (parts: string[]) => parts.reduce((t, p, i) => t + len(p) + (i ? len(sep) : 0), 0);
  const lines: string[][] = [];
  let hidden = 0;
  for (const raw of items) {
    const item = fit(raw, width);
    const line = lines.find((l) => span([...l, item]) <= width);
    if (line) line.push(item);
    else if (lines.length < maxLines) lines.push([item]);
    else hidden += weight(raw);
  }
  if (hidden) {
    const last = lines[lines.length - 1]!;
    while (last.length > 1 && span([...last, more(hidden)]) > width) {
      hidden += weight(last.pop()!);
    }
    if (span([...last, more(hidden)]) <= width) last.push(more(hidden));
  }
  return lines.map((l) => l.join(sep));
}

/** Whole percentages that add up to 100 (largest remainder). */
export function percentages(shares: number[]): number[] {
  const total = shares.reduce((a, b) => a + b, 0) || 1;
  const raw = shares.map((s) => (s / total) * 100);
  const floors = raw.map(Math.floor);
  let left = 100 - floors.reduce((a, b) => a + b, 0);
  const order = raw.map((r, i) => [r - Math.floor(r), i] as const).sort((a, b) => b[0] - a[0]);
  for (const [, i] of order) {
    if (left-- <= 0) break;
    floors[i]!++;
  }
  return floors;
}

/** The teletext header row: page number, rolling counter, service name, date and time. */
export function header(screen: Screen, stats: Stats, options: CardOptions, s: Strings): void {
  const page = String(options.pageNumber ?? 100);
  const brand = (options.brand ?? stats.login).toUpperCase();
  const { date, time } = clock(new Date(stats.generatedAt), options.timeZone, s);
  const cols = screen.cols;

  screen.text(0, 0, `P${page}`, { fg: 'white' });
  // The rolling counter races through other pages until ours arrives.
  const first = Number(page) + 137;
  const rolling = Array.from({ length: 9 }, (_, i) => String(((first + i * 7 - 100) % 800) + 100));
  screen.rolling(len(page) + 2, 0, [...rolling, page], { fg: 'white' });

  const right = `${date} ${time}`;
  const brandCol = len(page) + 6;
  const brandRoom = cols - len(right) - 1 - brandCol;
  if (brandRoom >= 3) screen.text(brandCol, 0, fit(brand, brandRoom), { fg: 'yellow' });
  const start = screen.textRight(cols, 0, right, { fg: 'white' });
  // The clock's colon blinks, like a set that is switched on.
  screen.text(start + len(date) + 1 + 2, 0, ':', { fg: 'yellow', flash: true });
  screen.text(start + len(date) + 1, 0, time.slice(0, 2), { fg: 'yellow' });
  screen.text(start + len(date) + 4, 0, time.slice(3), { fg: 'yellow' });
}

export function num(value: number, s: Strings): string {
  return formatNumber(value, s);
}
