import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { NISSE, artSize, resolveArt, stillArt } from '../src/cards/art.ts';
import { fit, packList, percentages } from '../src/cards/common.ts';
import { CARDS } from '../src/cards/page.ts';
import type { RawData } from '../src/github/types.ts';
import { clock, daysBetween, strings } from '../src/i18n.ts';
import { computeStats } from '../src/stats.ts';
import { Screen } from '../src/teletext/screen.ts';
import { renderSVG } from '../src/teletext/svg.ts';

const demo = JSON.parse(readFileSync(new URL('./fixtures/demo.json', import.meta.url), 'utf8')) as RawData;
const stats = computeStats(demo);
const options = { locale: 'en' as const, timeZone: 'Europe/Copenhagen', art: resolveArt('nisse'), subtitle: ['Developer <&> tester'] };

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

  it('shows organisation labels', () => {
    const named = computeStats(demo, { orgs: { pin: [{ login: 'nordlys-labs', label: 'Nordlys Labs' }], hide: [] } });
    assert.match(CARDS.page(named, options).alt, /Organisations: Nordlys Labs, kbh-hackers/);
  });

  it('leaves out hidden parts without leaving gaps', () => {
    const full = CARDS.page(stats, options);
    const lean = CARDS.page(stats, { ...options, hide: ['commits', 'orgs', 'recent', 'since'] });
    assert.doesNotMatch(lean.alt, /commits|Organisations|Recent work/);
    assert.match(lean.alt, /contributions, \d+ contributions in the last 7 days/);
    const height = (svg: string) => Number(/height="(\d+)"/.exec(svg)![1]);
    // One number row, three org rows, and recent work (a band and three rows)
    // with its gap: 9 rows of 20px. (The since line sits beside the nisse,
    // which is taller, so it saves nothing.)
    assert.equal(height(full.svg) - height(lean.svg), 9 * 20);
    const bare = CARDS.stats(stats, {
      ...options,
      hide: ['contributions', 'last_7_days', 'streak', 'commits', 'pull_requests', 'reviews', 'repositories', 'orgs'],
    });
    assert.match(bare.alt, /^\d+ contributions in the last 52 weeks$/);
  });

  it('shows the pulse and recent work, and leaves the year to the stats card', () => {
    const page = CARDS.page(stats, options);
    assert.match(page.alt, /\d+ contributions in the last 7 days \(\d+ in an ordinary week\), a streak of \d+ days? \(best \d+\)/);
    assert.match(page.alt, /Recent work: fjord-tracker yesterday, nordlys-labs\/aurora-api 2 days ago, a private repository 4 days ago$/);
    assert.doesNotMatch(page.alt, /52 weeks|internal-billing|secret-co/);
    assert.match(CARDS.stats(stats, options).alt, /contributions in the last 52 weeks$/);
    const named = computeStats(demo, { orgs: { pin: [{ login: 'secret-co', label: 'Secret Co' }], hide: [] } });
    assert.match(CARDS.page(named, options).alt, /a private Secret Co repository 4 days ago$/);
  });

  it('animates the pipe nisse in layers, and keeps it still when asked', () => {
    const moving = CARDS.page(stats, { ...options, art: resolveArt('pipe-nisse') });
    assertWellFormed(moving.svg);
    for (const cls of ['na nbl', 'na nblu', 'na ne', 'na np np1']) assert.ok(moving.svg.includes(`class="${cls}"`), cls);
    // No blinking or winking, and a brown pipe.
    assert.doesNotMatch(moving.svg, /class="na nw"/);
    assert.match(moving.svg, /fill="#a0522d"/);
    assert.match(moving.svg, /@keyframes np\{/);
    assert.match(moving.svg, /prefers-reduced-motion:reduce\)\{\.na\{animation:none!important\}/);
    // Smoke is one colour, so its fill sits on the animated group.
    assert.match(moving.svg, /<g class="na np np1" fill="#fff">/);
    const still = CARDS.page(stats, { ...options, art: resolveArt('pipe-nisse'), animate: false });
    assert.doesNotMatch(still.svg, /class="na|@keyframes/);
  });

  it('respects reduced motion and can be static', () => {
    assert.match(CARDS.page(stats, options).svg, /prefers-reduced-motion:reduce/);
    const still = CARDS.page(stats, { ...options, animate: false, crt: false });
    assert.doesNotMatch(still.svg, /tt-in|tt-frame|filter=|@keyframes/);
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
    // "+2 private" stands for two organisations when it does not fit.
    assert.deepEqual(packList([...orgs, '+2 private'], 33, ' · ', 3, (n) => `+${n} more`, (i) => (i === '+2 private' ? 2 : 1)), [
      'DevOpsDynamite · KinoDAT23C',
      'microservices-happens',
      'exam-project-luke · +3 more',
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

  it('counts days ago in the chosen time zone', () => {
    const now = new Date('2026-10-06T04:17:00Z');
    // Half past midnight in Copenhagen, still the evening before in UTC.
    const late = new Date('2026-10-05T22:30:00Z');
    assert.equal(daysBetween(late, now, 'Europe/Copenhagen'), 0);
    assert.equal(daysBetween(late, now, 'UTC'), 1);
    assert.deepEqual(
      [0, 1, 4, 20, 90, 400, 800].map((d) => strings('en').ago(d)),
      ['today', 'yesterday', '4 days ago', '2 weeks ago', '3 months ago', 'a year ago', '2 years ago'],
    );
    assert.deepEqual([1, 3].map((d) => strings('da').ago(d)), ['i går', 'for 3 dage siden']);
  });

  it('reads built-in and custom pixel art', () => {
    assert.deepEqual(resolveArt('nisse').base, [...NISSE]);
    assert.deepEqual(resolveArt('none').base, []);
    assert.deepEqual(resolveArt('.RR.|RRRR'), { base: ['.RR.', 'RRRR'], layers: [], css: '' });
  });

  it('builds the pipe nisse: still picture and size', () => {
    const art = resolveArt('pipe-nisse');
    assert.deepEqual(artSize(art), { cols: 8, rows: 6 });
    const still = stillArt(art);
    // Resting brows and one puff of smoke are part of the still picture.
    assert.equal(still[9]!.slice(4, 6), 'WW');
    assert.equal(still[10]!.slice(13, 15), 'WW');
    // Raised brows are not; the eyes stay open and the pipe is brown.
    assert.equal(still[10]!.slice(9, 11), 'KY');
    assert.equal(still[13]!.slice(8, 15), 'NNNNNNN');
    assert.equal(still[8]!.slice(4, 6), 'YY');
  });
});
