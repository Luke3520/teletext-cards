// The cards. `page` is the full Tekst-TV page; `stats` and `languages` are
// smaller pieces for people who prefer to arrange their own README.

import { strings } from '../i18n.ts';
import type { Stats } from '../stats.ts';
import type { Colour } from '../teletext/palette.ts';
import { Screen } from '../teletext/screen.ts';
import { renderSVG } from '../teletext/svg.ts';
import { artSize } from './art.ts';
import type { Card, CardOptions } from './common.ts';
import { fit, header } from './common.ts';
import { activity, band, fastext, languages, numbers, organisations } from './sections.ts';

/** Text colour that reads well on a band of the given colour. */
function onBand(colour: Colour): Colour {
  if (colour === 'yellow' || colour === 'cyan' || colour === 'white' || colour === 'green') return 'black';
  return colour === 'red' || colour === 'magenta' ? 'white' : 'yellow';
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
  const art = options.art ?? [];
  const size = artSize(art);
  const artCol = screen.cols - 1 - size.cols;
  const bandEnd = art.length ? artCol - 1 : screen.cols;
  screen.fill(0, 1, bandEnd, 2, accent);
  screen.text(2, 1, fit(title, bandEnd - 3), { fg: onBand(accent), double: true });
  if (art.length) screen.art(artCol, 1, art);

  let row = 3;
  const textWidth = (art.length ? artCol - 1 : screen.cols - 1) - 2;
  (options.subtitle ?? []).slice(0, 2).forEach((line, i) => {
    screen.text(2, row++, fit(line, textWidth), { fg: i === 0 ? 'cyan' : 'white' });
    alt.push(line);
  });
  screen.text(2, row++, fit(s.since(new Date(stats.createdAt).getUTCFullYear()), textWidth), { fg: 'green' });
  row = Math.max(row, art.length ? 1 + size.rows : 0) + 1;

  const nums = numbers(screen, row, stats, s);
  const orgs = organisations(screen, nums.row, stats, s, 3);
  const langs = languages(screen, orgs.row + 1, stats, s);
  const act = activity(screen, langs.row + 1, stats, s);
  row = act.row;
  if (options.fastext?.length) row = fastext(screen, row + 1, options.fastext);

  return finish('page', screen, row, `${title}: GitHub stats on teletext`, [...alt, nums.alt, orgs.alt, langs.alt, act.alt], options);
}

/** Numbers, organisations and the 52-week graph, under a small title band. */
export function statsCard(stats: Stats, options: CardOptions): Card {
  const s = strings(options.locale);
  const screen = new Screen(40, 24);
  const title = options.title ?? stats.name ?? stats.login;
  header(screen, stats, { ...options, pageNumber: (options.pageNumber ?? 100) + 1 }, s);
  let row = band(screen, 1, fit(title.toUpperCase(), 30), s.since(new Date(stats.createdAt).getUTCFullYear()), options.accent ?? 'blue');
  const nums = numbers(screen, row + 1, stats, s);
  const orgs = organisations(screen, nums.row, stats, s);
  const act = activity(screen, orgs.row + 1, stats, s);
  row = act.row;
  return finish('stats', screen, row, `${title}: GitHub stats`, [nums.alt, orgs.alt, act.alt], options);
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
