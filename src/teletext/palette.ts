// The eight teletext colours. Level 1 teletext has nothing else, and neither do we.

export const COLOURS = ['black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white'] as const;

export type Colour = (typeof COLOURS)[number];

export const PALETTE: Readonly<Record<Colour, string>> = {
  black: '#000',
  red: '#f00',
  green: '#0f0',
  yellow: '#ff0',
  blue: '#00f',
  magenta: '#f0f',
  cyan: '#0ff',
  white: '#fff',
};

/** Single-letter colour codes for pixel art: `R` red, `Y` yellow, `.` transparent. */
export const ART_CODES: Readonly<Record<string, Colour>> = {
  K: 'black',
  R: 'red',
  G: 'green',
  Y: 'yellow',
  B: 'blue',
  M: 'magenta',
  C: 'cyan',
  W: 'white',
};

export function isColour(value: string): value is Colour {
  return (COLOURS as readonly string[]).includes(value);
}
