// The eight teletext colours. Level 1 teletext has nothing else, and neither
// does our text. Pixel art may also use brown, which teletext never had.

export const COLOURS = ['black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white'] as const;

export type Colour = (typeof COLOURS)[number] | 'brown';

export const PALETTE: Readonly<Record<Colour, string>> = {
  black: '#000',
  red: '#f00',
  green: '#0f0',
  yellow: '#ff0',
  blue: '#00f',
  magenta: '#f0f',
  cyan: '#0ff',
  white: '#fff',
  brown: '#a0522d',
};

/** Single-letter colour codes for pixel art: `R` red, `Y` yellow, `N` brown, `.` transparent. */
export const ART_CODES: Readonly<Record<string, Colour>> = {
  K: 'black',
  R: 'red',
  G: 'green',
  Y: 'yellow',
  B: 'blue',
  M: 'magenta',
  C: 'cyan',
  W: 'white',
  N: 'brown',
};

/** One of the eight teletext colours (not brown: that is for pixel art only). */
export function isColour(value: string): value is Colour {
  return (COLOURS as readonly string[]).includes(value);
}
