// A teletext screen: a grid of character cells plus a mosaic pixel layer.
//
// Cells are 6x10 teletext pixels. Mosaic ("sextant") pixels split every cell
// into 2 columns and 3 rows, 3 pixels wide and 3, 4 and 3 pixels tall, like the
// block graphics of a real SAA5050.

import type { Colour } from './palette.ts';
import { ART_CODES } from './palette.ts';

export interface TextStyle {
  fg?: Colour;
  bg?: Colour;
  /** Double-height text. Occupies this row and the one below it. */
  double?: boolean;
  /** Blink on and off, like the teletext Flash attribute. */
  flash?: boolean;
}

export interface Cell {
  ch: string;
  fg: Colour;
  bg: Colour;
  double: boolean;
  flash: boolean;
  /** Bottom half of a double-height character above: drawn by that row. */
  covered: boolean;
}

export interface MosaicPixel {
  colour: Colour;
  separated: boolean;
}

/** Text that cycles through `frames` before settling on the last one. */
export interface FrameText {
  col: number;
  row: number;
  frames: string[];
  style: TextStyle;
  /** Seconds each intermediate frame stays on screen. */
  slot: number;
}

/** A row that takes turns showing different text, like teletext subpages. */
export interface Subpages {
  row: number;
  /** The row's cells as each subpage draws them. */
  pages: Cell[][];
  /** Seconds each subpage stays on screen. */
  hold: number;
}

export const CELL_W = 6;
export const CELL_H = 10;
/** Pixel offsets and heights of the three sextant rows inside a cell. */
export const SEXTANT_ROWS: ReadonlyArray<readonly [number, number]> = [
  [0, 3],
  [3, 4],
  [7, 3],
];

export class Screen {
  readonly cols: number;
  readonly cells: Cell[][];
  readonly pixels = new Map<number, MosaicPixel>();
  readonly frames: FrameText[] = [];
  /** Animated overlays, each drawn in its own group with a CSS class. */
  readonly layers: Array<{ className: string; pixels: Map<number, MosaicPixel> }> = [];
  /** Extra CSS for those classes. */
  readonly css: string[] = [];
  /** Rows that cycle through subpages. */
  readonly subpages: Subpages[] = [];

  constructor(cols: number, rows: number) {
    this.cols = cols;
    this.cells = Array.from({ length: rows }, () =>
      Array.from({ length: cols }, (): Cell => ({ ch: ' ', fg: 'white', bg: 'black', double: false, flash: false, covered: false })),
    );
  }

  get rows(): number {
    return this.cells.length;
  }

  /** Drops every row from `rows` down. Layouts draw on a tall screen, then crop. */
  crop(rows: number): void {
    this.cells.length = Math.min(this.cells.length, rows);
    const limit = rows * 3 * this.cols * 2;
    for (const map of [this.pixels, ...this.layers.map((l) => l.pixels)]) {
      for (const key of map.keys()) if (key >= limit) map.delete(key);
    }
    for (let i = this.subpages.length - 1; i >= 0; i--) if (this.subpages[i]!.row >= rows) this.subpages.splice(i, 1);
  }

  private cell(col: number, row: number): Cell | undefined {
    return this.cells[row]?.[col];
  }

  /** Writes text from (col, row). Text that runs off the right edge is cut. Returns the column after the text. */
  text(col: number, row: number, value: string, style: TextStyle = {}): number {
    let c = col;
    for (const ch of value) {
      const cell = this.cell(c, row);
      if (cell) {
        cell.ch = ch;
        cell.fg = style.fg ?? 'white';
        if (style.bg) cell.bg = style.bg;
        cell.double = style.double ?? false;
        cell.flash = style.flash ?? false;
        cell.covered = false;
        if (style.double) {
          const below = this.cell(c, row + 1);
          if (below) {
            below.ch = ' ';
            below.covered = true;
            below.bg = cell.bg;
          }
        }
      }
      c++;
    }
    return c;
  }

  /** Text that ends at `endCol` (exclusive). Returns the start column. */
  textRight(endCol: number, row: number, value: string, style: TextStyle = {}): number {
    const start = endCol - [...value].length;
    this.text(start, row, value, style);
    return start;
  }

  /** Sets the background colour of a block of cells. */
  fill(col: number, row: number, width: number, height: number, bg: Colour): void {
    for (let r = row; r < row + height; r++) {
      for (let c = col; c < col + width; c++) {
        const cell = this.cell(c, r);
        if (cell) cell.bg = bg;
      }
    }
  }

  /**
   * Makes a row take turns showing `count` versions of itself, like teletext
   * subpages: `draw(i)` draws version i on the row. Only the text changes;
   * the colours behind it stay. A still picture shows the first version.
   */
  cycle(row: number, count: number, draw: (i: number) => void, hold = 4): void {
    const start = this.cells[row];
    if (!start || count < 1) return;
    const pages: Cell[][] = [];
    for (let i = 0; i < count; i++) {
      this.cells[row] = start.map((c) => ({ ...c }));
      draw(i);
      pages.push(this.cells[row]!);
    }
    this.cells[row] = pages[0]!.map((c) => ({ ...c }));
    if (count > 1) this.subpages.push({ row, pages, hold });
  }

  /** Text that rolls through `frames` on load (the page-search counter). */
  rolling(col: number, row: number, frames: string[], style: TextStyle = {}, slot = 0.09): void {
    this.frames.push({ col, row, frames, style, slot });
  }

  /** Sets one mosaic pixel. px counts sextant columns, py sextant rows. */
  pixel(px: number, py: number, colour: Colour, separated = false): void {
    if (px < 0 || py < 0 || px >= this.cols * 2 || py >= this.rows * 3) return;
    this.pixels.set(py * this.cols * 2 + px, { colour, separated });
  }

  /**
   * One mosaic character. Bits follow teletext order: 1 top left, 2 top right,
   * 4 middle left, 8 middle right, 16 bottom left, 32 bottom right.
   */
  mosaic(col: number, row: number, mask: number, colour: Colour, separated = false): void {
    for (let bit = 0; bit < 6; bit++) {
      if (mask & (1 << bit)) this.pixel(col * 2 + (bit % 2), row * 3 + Math.floor(bit / 2), colour, separated);
    }
  }

  /**
   * A horizontal bar, `halves` half-cells long. `thickness` is how many of the
   * cell's three sextant rows it fills, from the top.
   */
  hbar(col: number, row: number, halves: number, colour: Colour, thickness = 3, separated = false): void {
    for (let i = 0; i < halves; i++) {
      for (let sy = 0; sy < thickness; sy++) this.pixel(col * 2 + i, row * 3 + sy, colour, separated);
    }
  }

  /**
   * Vertical bars standing on the bottom of a block `rows` cells tall: one bar
   * per sextant column, each `heights[i]` sextant rows high.
   */
  vbars(col: number, row: number, rows: number, heights: number[], colour: Colour, separated = false): void {
    const bottom = (row + rows) * 3 - 1;
    heights.forEach((h, i) => {
      for (let k = 0; k < Math.min(h, rows * 3); k++) this.pixel(col * 2 + i, bottom - k, colour, separated);
    });
  }

  /**
   * Pixel art at mosaic resolution: one string per sextant row, one character
   * per sextant column. Letters are colour codes (K R G Y B M C W); anything
   * else is transparent.
   */
  art(col: number, row: number, lines: string[], separated = false): void {
    this.paint(this.pixels, col, row, lines, separated);
  }

  /** Pixel art in its own layer, animated by the CSS class `className`. */
  layer(col: number, row: number, className: string, lines: string[]): void {
    const pixels = new Map<number, MosaicPixel>();
    this.paint(pixels, col, row, lines, false);
    this.layers.push({ className, pixels });
  }

  private paint(target: Map<number, MosaicPixel>, col: number, row: number, lines: string[], separated: boolean): void {
    lines.forEach((line, y) => {
      [...line].forEach((code, x) => {
        const colour = ART_CODES[code.toUpperCase()];
        const px = col * 2 + x;
        const py = row * 3 + y;
        if (!colour || px < 0 || py < 0 || px >= this.cols * 2 || py >= this.rows * 3) return;
        target.set(py * this.cols * 2 + px, { colour, separated });
      });
    });
  }
}
