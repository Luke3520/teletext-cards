// The little of opentype.js that build-glyphs.ts uses.
declare module 'opentype.js' {
  export interface PathCommand {
    type: 'M' | 'L' | 'C' | 'Q' | 'Z';
    x: number;
    y: number;
    x1: number;
    y1: number;
    x2: number;
    y2: number;
  }
  export interface Glyph {
    index: number;
    path: { commands: PathCommand[] };
  }
  export interface Font {
    charToGlyph(ch: string): Glyph;
  }
  const opentype: { parse(buffer: ArrayBuffer): Font };
  export default opentype;
}
