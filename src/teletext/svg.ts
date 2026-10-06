// Renders a Screen to a self-contained SVG.
//
// Text is drawn with <use> references to Bedstead glyph paths, so the file
// needs no font and looks the same in every browser. Everything a row draws
// sits in one group, which lets the page "arrive" row by row like a real
// teletext page. Motion is skipped for viewers who prefer reduced motion.

import { GLYPHS } from './glyphs.ts';
import { PALETTE } from './palette.ts';
import type { Colour } from './palette.ts';
import { CELL_H, CELL_W, SEXTANT_ROWS } from './screen.ts';
import type { Cell, MosaicPixel, Screen, TextStyle } from './screen.ts';

export interface RenderOptions {
  /** Accessible name: the first thing a screen reader says. */
  title: string;
  /** Plain-text version of everything on the card. */
  description: string;
  /** Rendered size of one character cell, in CSS pixels. */
  cellWidth?: number;
  cellHeight?: number;
  /** Black border around the text area, in CSS pixels. */
  padding?: number;
  /** Corner radius of the screen. */
  radius?: number;
  /** Phosphor glow, scanlines and a soft vignette. */
  crt?: boolean;
  /** Animate the page arriving: rolling header, then rows top to bottom. */
  animate?: boolean;
  /** Seconds before the first row appears when animating. */
  arrival?: number;
  /** Prefix for ids, so several cards can share one HTML page. */
  idPrefix?: string;
}

const FALLBACK = '?';

function esc(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function n(v: number): string {
  return String(Math.round(v * 100) / 100);
}

function glyphFor(ch: string): string | undefined {
  if (ch === ' ') return undefined;
  return ch in GLYPHS ? ch : FALLBACK;
}

class Glyphs {
  readonly used = new Map<string, string>();
  private readonly prefix: string;

  constructor(prefix: string) {
    this.prefix = prefix;
  }

  id(ch: string): string {
    let id = this.used.get(ch);
    if (!id) {
      id = `${this.prefix}g${ch.codePointAt(0)!.toString(16)}`;
      this.used.set(ch, id);
    }
    return id;
  }

  defs(): string {
    return [...this.used].map(([ch, id]) => `<path id="${id}" d="${GLYPHS[ch]}"/>`).join('');
  }
}

/** Groups SVG snippets by fill colour and flash, so each colour is written once. */
class Layer {
  private readonly groups = new Map<string, string[]>();

  add(colour: Colour, flash: boolean, svg: string): void {
    const key = `${colour}|${flash ? 1 : 0}`;
    const list = this.groups.get(key);
    if (list) list.push(svg);
    else this.groups.set(key, [svg]);
  }

  /** The colour and markup when everything is one colour without flash. */
  only(): { colour: Colour; body: string } | null {
    if (this.groups.size !== 1) return null;
    const [key, parts] = [...this.groups][0]!;
    const [colour, flash] = key.split('|') as [Colour, string];
    return flash === '1' ? null : { colour, body: parts.join('') };
  }

  toString(): string {
    let out = '';
    for (const [key, parts] of this.groups) {
      const [colour, flash] = key.split('|') as [Colour, string];
      const cls = flash === '1' ? ' class="tt-fl"' : '';
      out += `<g fill="${PALETTE[colour]}"${cls}>${parts.join('')}</g>`;
    }
    return out;
  }
}

function drawText(layer: Layer, glyphs: Glyphs, cell: Pick<Cell, 'ch' | 'fg' | 'double' | 'flash'>, col: number, row: number): void {
  const ch = glyphFor(cell.ch);
  if (!ch) return;
  const id = glyphs.id(ch);
  const x = col * CELL_W;
  const y = row * CELL_H;
  const use = cell.double
    ? `<use href="#${id}" transform="matrix(1 0 0 2 ${x} ${y})"/>`
    : `<use href="#${id}" x="${x}" y="${y}"/>`;
  layer.add(cell.fg, cell.flash, use);
}

function drawBackgrounds(screen: Screen, row: number): string {
  let out = '';
  const cells = screen.cells[row]!;
  let start = 0;
  for (let c = 1; c <= screen.cols; c++) {
    if (c === screen.cols || cells[c]!.bg !== cells[start]!.bg) {
      const bg = cells[start]!.bg;
      if (bg !== 'black') {
        out += `<rect x="${start * CELL_W}" y="${row * CELL_H}" width="${(c - start) * CELL_W}" height="${CELL_H}" fill="${PALETTE[bg]}"/>`;
      }
      start = c;
    }
  }
  return out;
}

function drawPixels(pixels: ReadonlyMap<number, MosaicPixel>, cols: number, row: number, layer: Layer): void {
  const width = cols * 2;
  for (let sy = 0; sy < 3; sy++) {
    const py = row * 3 + sy;
    const [dy, h] = SEXTANT_ROWS[sy]!;
    const y = row * CELL_H + dy;
    let px = 0;
    while (px < width) {
      const p = pixels.get(py * width + px);
      if (!p) {
        px++;
        continue;
      }
      if (p.separated) {
        // Separated graphics: each block loses its left column and bottom row.
        layer.add(p.colour, false, `<rect x="${px * 3 + 1}" y="${y}" width="2" height="${h - 1}"/>`);
        px++;
        continue;
      }
      // Merge a run of same-coloured contiguous pixels into one rectangle.
      let end = px + 1;
      while (end < width) {
        const q = pixels.get(py * width + end);
        if (!q || q.separated || q.colour !== p.colour) break;
        end++;
      }
      layer.add(p.colour, false, `<rect x="${px * 3}" y="${y}" width="${(end - px) * 3}" height="${h}"/>`);
      px = end;
    }
  }
}

function frameGroups(screen: Screen, glyphs: Glyphs, animate: boolean): { svg: string; duration: number } {
  let svg = '';
  let duration = 0;
  for (const f of screen.frames) {
    const style: Required<Pick<TextStyle, 'fg' | 'double' | 'flash'>> = {
      fg: f.style.fg ?? 'white',
      double: f.style.double ?? false,
      flash: f.style.flash ?? false,
    };
    const frames = animate ? f.frames : f.frames.slice(-1);
    frames.forEach((text, i) => {
      const layer = new Layer();
      [...text].forEach((ch, k) => drawText(layer, glyphs, { ch, ...style }, f.col + k, f.row));
      const last = i === frames.length - 1;
      if (!animate) {
        svg += `<g>${layer}</g>`;
      } else if (last) {
        svg += `<g class="tt-a tt-in" style="animation-duration:${n(i * f.slot)}s">${layer}</g>`;
      } else {
        svg += `<g class="tt-a tt-frame" style="animation-duration:${n(f.slot)}s;animation-delay:${n(i * f.slot)}s">${layer}</g>`;
      }
    });
    duration = Math.max(duration, (frames.length - 1) * f.slot);
  }
  return { svg, duration };
}

export function renderSVG(screen: Screen, options: RenderOptions): string {
  const cellWidth = options.cellWidth ?? 16;
  const cellHeight = options.cellHeight ?? 20;
  const padding = options.padding ?? 20;
  const radius = options.radius ?? 14;
  const crt = options.crt ?? true;
  const animate = options.animate ?? true;
  const p = options.idPrefix ?? 'tt';
  const glyphs = new Glyphs(p);

  const sx = cellWidth / CELL_W;
  const sy = cellHeight / CELL_H;
  const width = screen.cols * cellWidth + padding * 2;
  const height = screen.rows * cellHeight + padding * 2;

  const header = frameGroups(screen, glyphs, animate);
  const arrival = options.arrival ?? Math.max(header.duration, 0.3);

  // Row 0 is the header and is on screen from the start, as on a real set.
  const rowGroup = (r: number, body: string): string =>
    !body ? '' : animate && r > 0 ? `<g class="tt-a tt-in" style="animation-duration:${n(arrival + r * 0.035)}s">${body}</g>` : `<g>${body}</g>`;

  // Backgrounds go first for every row: double-height text reaches into the
  // row below and must not be painted over by that row's background.
  let backgrounds = '';
  let foregrounds = '';
  for (let r = 0; r < screen.rows; r++) {
    const text = new Layer();
    const mosaic = new Layer();
    screen.cells[r]!.forEach((cell, c) => {
      if (!cell.covered) drawText(text, glyphs, cell, c, r);
    });
    drawPixels(screen.pixels, screen.cols, r, mosaic);
    backgrounds += rowGroup(r, drawBackgrounds(screen, r));
    foregrounds += rowGroup(r, `${mosaic}${text}`);
  }
  // Animated art layers. A one-colour layer carries its fill on the animated
  // group itself, so keyframes can change the colour.
  let art = '';
  for (const { className, pixels } of screen.layers) {
    const layer = new Layer();
    for (let r = 0; r < screen.rows; r++) drawPixels(pixels, screen.cols, r, layer);
    const one = layer.only();
    art += one ? `<g class="${esc(className)}" fill="${PALETTE[one.colour]}">${one.body}</g>` : `<g class="${esc(className)}">${layer}</g>`;
  }
  if (art) art = animate ? `<g class="tt-a tt-in" style="animation-duration:${n(arrival + 0.035)}s">${art}</g>` : `<g>${art}</g>`;
  const rows = backgrounds + foregrounds + art;

  const css = [
    animate &&
      `.tt-in{animation-name:tt-hide;animation-timing-function:steps(1)}` +
        `.tt-frame{visibility:hidden;animation-name:tt-show;animation-timing-function:steps(1)}` +
        `@keyframes tt-hide{from,to{visibility:hidden}}@keyframes tt-show{from,to{visibility:visible}}`,
    animate && `.tt-fl{animation:tt-flash 1s steps(1) infinite}@keyframes tt-flash{75%{opacity:0}}`,
    animate && `@media (prefers-reduced-motion:reduce){.tt-a,.tt-fl{animation:none!important}}`,
    ...(animate ? screen.css : []),
  ]
    .filter(Boolean)
    .join('');

  const clip = `<clipPath id="${p}-clip"><rect width="${width}" height="${height}" rx="${radius}"/></clipPath>`;
  const effects = crt
    ? `<filter id="${p}-glow" x="-5%" y="-5%" width="110%" height="110%">` +
      `<feGaussianBlur stdDeviation=".55" result="b"/>` +
      `<feComponentTransfer in="b" result="g"><feFuncA type="linear" slope=".85"/></feComponentTransfer>` +
      `<feMerge><feMergeNode in="g"/><feMergeNode in="SourceGraphic"/></feMerge></filter>` +
      `<pattern id="${p}-scan" width="4" height="${n(sy * 2)}" patternUnits="userSpaceOnUse">` +
      `<rect width="4" height="${n(sy * 0.6)}" fill="#000" fill-opacity=".22"/></pattern>` +
      `<radialGradient id="${p}-vig" cx="50%" cy="45%" r="75%">` +
      `<stop offset=".6" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".45"/></radialGradient>` +
      `<linearGradient id="${p}-glass" x1="0" y1="0" x2=".6" y2="1">` +
      `<stop offset="0" stop-color="#fff" stop-opacity=".07"/><stop offset=".35" stop-color="#fff" stop-opacity="0"/></linearGradient>`
    : '';
  const overlays = crt
    ? `<rect width="${width}" height="${height}" fill="url(#${p}-scan)"/>` +
      `<rect width="${width}" height="${height}" fill="url(#${p}-vig)"/>` +
      `<rect width="${width}" height="${height}" fill="url(#${p}-glass)"/>`
    : '';

  const content =
    `<g transform="translate(${padding} ${padding}) scale(${n(sx)} ${n(sy)})"${crt ? ` filter="url(#${p}-glow)"` : ''}>` +
    `${header.svg}${rows}</g>`;

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" ` +
    `role="img" aria-labelledby="${p}-title ${p}-desc">` +
    `<title id="${p}-title">${esc(options.title)}</title>` +
    `<desc id="${p}-desc">${esc(options.description)}</desc>` +
    (css ? `<style>${css}</style>` : '') +
    `<defs>${glyphs.defs()}${clip}${effects}</defs>` +
    `<g clip-path="url(#${p}-clip)">` +
    `<rect width="${width}" height="${height}" fill="#000"/>` +
    content +
    overlays +
    `</g></svg>`
  );
}
