// Mosaic pixel art. One character per sextant pixel (two per cell across,
// three per cell down). Letters are teletext colours: K black, R red,
// G green, Y yellow, B blue, M magenta, C cyan, W white. Dots are transparent.

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

export const ART: Readonly<Record<string, readonly string[]>> = {
  nisse: NISSE,
};

/**
 * Resolves the `art` option: a built-in name, `none`, or the art itself as
 * lines of colour codes (newline or `|` separated).
 */
export function resolveArt(value: string | undefined): string[] {
  const v = (value ?? '').trim();
  if (!v || v.toLowerCase() === 'none') return [];
  const builtin = ART[v.toLowerCase()];
  if (builtin) return [...builtin];
  return v
    .split(/\r?\n|\|/)
    .map((line) => line.trimEnd())
    .filter((line) => line.length > 0);
}

/** Size of the art in character cells. */
export function artSize(lines: string[]): { cols: number; rows: number } {
  const width = Math.max(0, ...lines.map((l) => l.length));
  return { cols: Math.ceil(width / 2), rows: Math.ceil(lines.length / 3) };
}
