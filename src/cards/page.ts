// The cards. `page` is the full Tekst-TV page; `stats` and `languages` are
// smaller pieces for people who prefer to arrange their own README.

import type { Strings } from '../i18n.ts';
import { strings } from '../i18n.ts';
import type { Stats } from '../stats.ts';
import type { Colour } from '../teletext/palette.ts';
import { Screen } from '../teletext/screen.ts';
import { renderSVG } from '../teletext/svg.ts';
import { NO_ART, artSize, stillArt } from './art.ts';
import type { Card, CardOptions, Part } from './common.ts';
import { fit, header } from './common.ts';
import type { Section } from './sections.ts';
import { activity, band, fastext, languages, numbers, organisations } from './sections.ts';

/** Text colour that reads well on a band of the given colour. */
function onBand(colour: Colour): Colour {
  if (colour === 'yellow' || colour === 'cyan' || colour === 'white' || colour === 'green') return 'black';
  return colour === 'red' || colour === 'magenta' ? 'white' : 'yellow';
}

/**
 * Draws blocks one after another with a blank row between them. Blocks that
 * draw nothing (everything in them hidden) leave no gap. Returns the next
 * free row and the alt text of each block.
 */
function stack(start: number, blocks: Array<(row: number) => Section>): { row: number; alt: string[] } {
  let next = start;
  const alt: string[] = [];
  for (const draw of blocks) {
    const res = draw(next);
    if (res.row === next) continue;
    alt.push(res.alt);
    next = res.row + 1;
  }
  return { row: Math.max(start, next - 1), alt };
}

/** Numbers with the organisations right under them. */
function numbersAndOrgs(screen: Screen, row: number, stats: Stats, s: Strings, hide: ReadonlySet<Part>, orgLines: number): Section {
  const nums = numbers(screen, row, stats, s, hide);
  const orgs = hide.has('orgs') ? { row: nums.row, alt: '' } : organisations(screen, nums.row, stats, s, orgLines);
  return { row: orgs.row, alt: [nums.alt, orgs.alt].filter(Boolean).join('. ') };
}

function finish(name: string, screen: Screen, row: number, title: string, alt: string[], options: CardOptions): Card {
  screen.crop(row);
  const description = alt.filter(Boolean).join('. ');
  return {
    name,
    alt: description,
    svg: renderSVG(screen, { title, description, animate: options.animate, crt: options.crt, idPrefix: name[0] }),
  };
}

export function pageCard(stats: Stats, options: CardOptions): Card {
  const s = strings(options.locale);
  const screen = new Screen(40, 48);
  const accent: Colour = options.accent ?? 'blue';
  const title = (options.title ?? stats.name ?? stats.login).toUpperCase();
  const alt = [title];

  header(screen, stats, options, s);

  // Title band, with the pixel art standing to the right of it.
  const art = options.art ?? NO_ART;
  const hasArt = art.base.length > 0;
  const size = artSize(art);
  const artCol = screen.cols - 1 - size.cols;
  const bandEnd = hasArt ? artCol - 1 : screen.cols;
  screen.fill(0, 1, bandEnd, 2, accent);
  screen.text(2, 1, fit(title, bandEnd - 3), { fg: onBand(accent), double: true });
  if (hasArt && (options.animate ?? true) && art.layers.length) {
    screen.art(artCol, 1, art.base);
    for (const layer of art.layers) screen.layer(artCol, 1, layer.className, layer.lines);
    screen.css.push(art.css);
  } else if (hasArt) {
    screen.art(artCol, 1, stillArt(art));
  }

  let row = 3;
  const hide = new Set<Part>(options.hide ?? []);
  const textWidth = (hasArt ? artCol - 1 : screen.cols - 1) - 2;
  (options.subtitle ?? []).slice(0, 2).forEach((line, i) => {
    screen.text(2, row++, fit(line, textWidth), { fg: i === 0 ? 'cyan' : 'white' });
    alt.push(line);
  });
  if (!hide.has('since')) screen.text(2, row++, fit(s.since(new Date(stats.createdAt).getUTCFullYear()), textWidth), { fg: 'green' });
  row = Math.max(row, hasArt ? 1 + size.rows : 0) + 1;

  const body = stack(row, [
    (r) => numbersAndOrgs(screen, r, stats, s, hide, 3),
    (r) => (hide.has('languages') ? { row: r, alt: '' } : languages(screen, r, stats, s)),
    (r) => (hide.has('activity') ? { row: r, alt: '' } : activity(screen, r, stats, s)),
  ]);
  row = body.row;
  if (options.fastext?.length) row = fastext(screen, row + 1, options.fastext);

  return finish('page', screen, row, `${title}: GitHub stats on teletext`, [...alt, ...body.alt], options);
}

/** Numbers, organisations and the 52-week graph, under a small title band. */
export function statsCard(stats: Stats, options: CardOptions): Card {
  const s = strings(options.locale);
  const screen = new Screen(40, 24);
  const title = options.title ?? stats.name ?? stats.login;
  header(screen, stats, { ...options, pageNumber: (options.pageNumber ?? 100) + 1 }, s);
  const hide = new Set<Part>(options.hide ?? []);
  const since = hide.has('since') ? '' : s.since(new Date(stats.createdAt).getUTCFullYear());
  const row = band(screen, 1, fit(title.toUpperCase(), 30), since, options.accent ?? 'blue');
  const body = stack(row + 1, [
    (r) => numbersAndOrgs(screen, r, stats, s, hide, 2),
    (r) => (hide.has('activity') ? { row: r, alt: '' } : activity(screen, r, stats, s)),
  ]);
  return finish('stats', screen, body.row, `${title}: GitHub stats`, body.alt, options);
}

/** Just the language bars. */
export function languagesCard(stats: Stats, options: CardOptions): Card {
  const s = strings(options.locale);
  const screen = new Screen(40, 16);
  const title = options.title ?? stats.name ?? stats.login;
  header(screen, stats, { ...options, pageNumber: (options.pageNumber ?? 100) + 2 }, s);
  const langs = languages(screen, 1, stats, s);
  return finish('languages', screen, langs.row, `${title}: languages`, [langs.alt], options);
}

export const CARDS = { page: pageCard, stats: statsCard, languages: languagesCard } as const;
export type CardName = keyof typeof CARDS;
