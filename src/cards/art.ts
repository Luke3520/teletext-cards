// Mosaic pixel art. One character per sextant pixel (two per cell across,
// three per cell down). Letters are teletext colours: K black, R red,
// G green, Y yellow, B blue, M magenta, C cyan, W white. Dots are transparent.
//
// Art can come alive: layers are drawn over the base and switched on and off
// (or moved) by CSS keyframes, in whole steps like a real teletext page.

export interface ArtLayer {
  /** CSS class that animates this layer. */
  className: string;
  lines: string[];
  /** Part of the still picture, shown when there is no animation. */
  rest: boolean;
}

export interface Art {
  base: string[];
  layers: ArtLayer[];
  /** Keyframes and rules for the layers' classes. */
  css: string;
}

/** A Danish nisse: red hat with a white bobble, white beard, rosy nose. */
export const NISSE: readonly string[] = [
  '.......WW...',
  '......RRW...',
  '.....RRR....',
  '....RRRRR...',
  '...RRRRRRR..',
  '..RRRRRRRRR.',
  '.WWWWWWWWWWW',
  '..YYYYYYYYY.',
  '..YKYYYYKYY.',
  '..YYYYRYYYY.',
  '.WWWYYYYYWWW',
  '.WWWWWWWWWWW',
  '..WWWWWWWWW.',
  '...WWWWWWW..',
  '.....WWW....',
];

/**
 * The same nisse, a little bigger, with bushy brows and a pipe. Every six
 * seconds he winks and raises an eyebrow, then wiggles both; the pipe glows
 * and puffs smoke that drifts up through white, cyan and blue.
 */
const PIPE_NISSE_BASE: readonly string[] = [
  '................',
  '........WW......',
  '.......RRW......',
  '......RRRR......',
  '.....RRRRRR.....',
  '....RRRRRRRR....',
  '..WWWWWWWWWWW...',
  '...YYYYYYYYY....',
  '...YYYYYYYYY....',
  '...YYYYYYYYY....',
  '...YYKYYYKYY....',
  '...YYYYRYYYY.RR.',
  '..WWWWWWWWWWWYY.',
  '..WWWWWWYYYYYYY.',
  '...WWWWWWWWW....',
  '....WWWWWWW.....',
  '......WWW.......',
  '................',
];

/** A layer: `.` everywhere except the given pixels. */
function sprite(pixels: Array<[number, number, string]>, width = 16, height = 18): string[] {
  const rows = Array.from({ length: height }, () => Array.from({ length: width }, () => '.'));
  for (const [x, y, c] of pixels) rows[y]![x] = c;
  return rows.map((r) => r.join(''));
}

/**
 * Keyframes that show a layer only inside the given windows (in seconds) of
 * a loop, or only outside them.
 */
function windows(name: string, loop: number, spans: Array<[number, number]>, inside: boolean): string {
  const pct = (t: number) => `${Math.round((t / loop) * 10000) / 100}%`;
  const on = inside ? 'visible' : 'hidden';
  const off = inside ? 'hidden' : 'visible';
  const frames = [`0%{visibility:${off}}`];
  for (const [from, to] of spans) frames.push(`${pct(from)}{visibility:${on}}`, `${pct(to)}{visibility:${off}}`);
  frames.push(`100%{visibility:${off}}`);
  return `@keyframes ${name}{${frames.join('')}}`;
}

const LOOP = 6;
const WINK: Array<[number, number]> = [[2, 2.7]];
const WIGGLE: Array<[number, number]> = [
  [3.6, 3.9],
  [4.2, 4.5],
];

const PIPE_NISSE: Art = {
  base: [...PIPE_NISSE_BASE],
  layers: [
    // Brows: resting on the forehead, raised one row.
    { className: 'na nbl', rest: true, lines: sprite([[4, 9, 'W'], [5, 9, 'W']]) },
    { className: 'na nbr', rest: true, lines: sprite([[9, 9, 'W'], [10, 9, 'W']]) },
    { className: 'na nblu', rest: false, lines: sprite([[4, 8, 'W'], [5, 8, 'W']]) },
    { className: 'na nbru', rest: false, lines: sprite([[9, 8, 'W'], [10, 8, 'W']]) },
    // The wink: the right eye closes to a dash.
    { className: 'na nw', rest: false, lines: sprite([[9, 10, 'K'], [10, 10, 'K']]) },
    // The ember glows when he draws on the pipe.
    { className: 'na ne', rest: false, lines: sprite([[13, 11, 'Y'], [14, 11, 'Y']]) },
    // Three puffs of smoke, a second apart.
    { className: 'na np np1', rest: true, lines: sprite([[13, 10, 'W'], [14, 10, 'W']]) },
    { className: 'na np np2', rest: false, lines: sprite([[13, 10, 'W'], [14, 10, 'W']]) },
    { className: 'na np np3', rest: false, lines: sprite([[14, 10, 'W']]) },
  ],
  css: [
    '.nblu,.nbru,.nw,.ne,.np2,.np3{visibility:hidden}',
    `.nbl{animation:nbl ${LOOP}s steps(1) infinite}`,
    `.nbr{animation:nbr ${LOOP}s steps(1) infinite}`,
    `.nblu{animation:nblu ${LOOP}s steps(1) infinite}`,
    `.nbru{animation:nbru ${LOOP}s steps(1) infinite}`,
    `.nw{animation:nw ${LOOP}s steps(1) infinite}`,
    // The left brow goes up with the wink; both go up for the wiggle.
    windows('nbl', LOOP, [...WINK, ...WIGGLE], false),
    windows('nblu', LOOP, [...WINK, ...WIGGLE], true),
    windows('nbr', LOOP, WIGGLE, false),
    windows('nbru', LOOP, WIGGLE, true),
    windows('nw', LOOP, WINK, true),
    '.ne{animation:ne 1s steps(1) infinite}@keyframes ne{0%{visibility:visible}25%{visibility:hidden}100%{visibility:hidden}}',
    // Smoke rises in whole steps and cools from white to cyan to blue.
    '.np{animation:np 3s steps(1) infinite}.np2{animation-delay:-1s}.np3{animation-delay:-2s}',
    '@keyframes np{' +
      '0%{visibility:visible;transform:translate(0,0);fill:#fff}' +
      '16.67%{transform:translate(-1px,-3px)}' +
      '33.33%{transform:translate(0,-7px);fill:#0ff}' +
      '50%{transform:translate(1px,-10px)}' +
      '66.67%{transform:translate(0,-13px);fill:#00f}' +
      '83.33%{visibility:hidden}100%{visibility:hidden}}',
    '@media (prefers-reduced-motion:reduce){.na{animation:none!important}}',
  ].join(''),
};

const BUILTIN: Readonly<Record<string, Art>> = {
  nisse: { base: [...NISSE], layers: [], css: '' },
  'pipe-nisse': PIPE_NISSE,
};

export const NO_ART: Art = { base: [], layers: [], css: '' };

/**
 * Resolves the `art` option: a built-in name, `none`, or the art itself as
 * lines of colour codes (newline or `|` separated).
 */
export function resolveArt(value: string | undefined): Art {
  const v = (value ?? '').trim();
  if (!v || v.toLowerCase() === 'none') return NO_ART;
  const builtin = BUILTIN[v.toLowerCase()];
  if (builtin) return builtin;
  const base = v
    .split(/\r?\n|\|/)
    .map((line) => line.trimEnd())
    .filter((line) => line.length > 0);
  return { base, layers: [], css: '' };
}

/** The still picture: the base with the resting layers drawn over it. */
export function stillArt(art: Art): string[] {
  const out = art.base.map((l) => [...l]);
  for (const layer of art.layers) {
    if (!layer.rest) continue;
    layer.lines.forEach((line, y) =>
      [...line].forEach((c, x) => {
        if (c === '.') return;
        while (out.length <= y) out.push([]);
        out[y]![x] = c;
      }),
    );
  }
  return out.map((r) => Array.from(r, (c) => c ?? '.').join(''));
}

/** Size of the art in character cells. */
export function artSize(art: Art): { cols: number; rows: number } {
  const lines = [...art.base, ...art.layers.flatMap((l) => l.lines)];
  const width = Math.max(0, ...lines.map((l) => l.length));
  const height = Math.max(art.base.length, ...art.layers.map((l) => l.lines.length));
  return { cols: Math.ceil(width / 2), rows: Math.ceil(height / 3) };
}
