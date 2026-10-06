import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { NISSE, resolveArt } from '../src/cards/art.ts';
import { fit, packList, percentages } from '../src/cards/common.ts';
import { CARDS } from '../src/cards/page.ts';
import type { RawData } from '../src/github/types.ts';
import { clock, strings } from '../src/i18n.ts';
import { computeStats } from '../src/stats.ts';
import { Screen } from '../src/teletext/screen.ts';
import { renderSVG } from '../src/teletext/svg.ts';

const demo = JSON.parse(readFileSync(new URL('./fixtures/demo.json', import.meta.url), 'utf8')) as RawData;
const stats = computeStats(demo);
const options = { locale: 'en' as const, timeZone: 'Europe/Copenhagen', art: [...NISSE], subtitle: ['Developer <&> tester'] };

/** Checks that every tag is closed in order. Enough to catch broken markup. */
function assertWellFormed(svg: string): void {
  const stack: string[] = [];
  for (const m of svg.matchAll(/<(\/?)([a-zA-Z][\w:-]*)[^>]*?(\/?)>/g)) {
    const [, closing, name, selfClosing] = m;
    if (selfClosing) continue;
    if (closing) assert.equal(stack.pop(), name, `unexpected </${name}>`);
    else stack.push(name!);
  }
  assert.deepEqual(stack, [], 'unclosed tags');
}

describe('cards', () => {
  for (const [name, make] of Object.entries(CARDS)) {
    it(`${name}: well-formed, self-contained SVG with a title and description`, () => {
      const card = make(stats, options);
      assertWellFormed(card.svg);
      assert.match(card.svg, /^<svg xmlns="http:\/\/www.w3.org\/2000\/svg"/);
      assert.match(card.svg, /<title id="\w-title">[^<]+<\/title>/);
      assert.match(card.svg, /<desc id="\w-desc">[^<]+<\/desc>/);
      // Nothing to fetch: GitHub's image proxy would block it anyway.
      assert.doesNotMatch(card.svg.replace('http://www.w3.org/2000/svg', ''), /https?:|@import|url\((?!#)/);
      assert.ok(card.svg.length < 60_000, `${name} is ${card.svg.length} bytes`);
    });
  }

  it('names the organisations and escapes user text', () => {
    const card = CARDS.page(stats, options);
    assert.match(card.alt, /nordlys-labs, kbh-hackers, open-fjord, eksamen-hold, \+1 private/);
    assert.match(card.svg, /Developer &lt;&amp;&gt; tester/);
  });

  it('respects reduced motion and can be static', () => {
    assert.match(CARDS.page(stats, options).svg, /prefers-reduced-motion:reduce/);
    const still = CARDS.page(stats, { ...options, animate: false, crt: false });
    assert.doesNotMatch(still.svg, /tt-in|tt-frame|filter=/);
  });
});

describe('renderSVG', () => {
  it('draws double height with a vertical stretch and skips the covered row', () => {
    const screen = new Screen(4, 2);
    screen.text(0, 0, 'A', { double: true });
    const svg = renderSVG(screen, { title: 't', description: 'd', animate: false, crt: false });
    assert.match(svg, /<use href="#ttg41" transform="matrix\(1 0 0 2 0 0\)"\/>/);
    assert.equal(screen.cells[1]![0]!.covered, true);
  });

  it('only defines the glyphs it uses, and falls back for unknown characters', () => {
    const screen = new Screen(3, 1);
    screen.text(0, 0, 'A✗A');
    const svg = renderSVG(screen, { title: 't', description: 'd', animate: false, crt: false });
    assert.equal((svg.match(/<path id=/g) ?? []).length, 2);
    assert.match(svg, /id="ttg3f"/);
  });

  it('merges runs of contiguous mosaic pixels', () => {
    const screen = new Screen(4, 1);
    screen.hbar(0, 0, 8, 'green');
    const svg = renderSVG(screen, { title: 't', description: 'd', animate: false, crt: false });
    assert.equal((svg.match(/<rect x="0" y="\d+" width="24"/g) ?? []).length, 3);
  });
});

describe('layout helpers', () => {
  it('fits text with an ellipsis', () => {
    assert.equal(fit('Copenhagen', 6), 'Copen…');
    assert.equal(fit('Kbh', 6), 'Kbh');
  });

  it('packs lists into the gaps and says how many did not fit', () => {
    const orgs = ['DevOpsDynamite', 'microservices-happens', 'exam-project-luke', 'KinoDAT23C', 'shift-left-happens'];
    assert.deepEqual(packList(orgs, 33, ' · ', 3, (n) => `+${n} more`), [
      'DevOpsDynamite · KinoDAT23C',
      'microservices-happens',
      'exam-project-luke · +1 more',
    ]);
    const lines = packList(['alpha', 'beta', 'gamma', 'delta', 'epsilon'], 14, ' · ', 2, (n) => `+${n}`);
    assert.deepEqual(lines, ['alpha · beta', 'gamma · +2']);
    for (const l of lines) assert.ok(l.length <= 14);
  });

  it('rounds percentages to add up to 100', () => {
    assert.deepEqual(percentages([1, 1, 1]), [34, 33, 33]);
    assert.equal(percentages([0.296, 0.293, 0.251, 0.061, 0.043, 0.056]).reduce((a, b) => a + b, 0), 100);
  });

  it('formats teletext dates in the chosen zone and language', () => {
    const at = new Date('2026-10-06T22:30:00Z');
    assert.deepEqual(clock(at, 'Europe/Copenhagen', strings('da')), { date: 'ons 07 okt', time: '00:30' });
    assert.deepEqual(clock(at, 'UTC', strings('en')), { date: 'Tue 06 Oct', time: '22:30' });
  });

  it('reads built-in and custom pixel art', () => {
    assert.equal(resolveArt('nisse').length, NISSE.length);
    assert.deepEqual(resolveArt('none'), []);
    assert.deepEqual(resolveArt('.RR.|RRRR'), ['.RR.', 'RRRR']);
  });
});
