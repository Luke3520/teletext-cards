import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseSettings } from '../src/settings.ts';

const from = (values: Record<string, string>) => (name: string) => values[name];

describe('parseSettings', () => {
  it('has sensible defaults', () => {
    const s = parseSettings(from({}), { username: 'octo' });
    assert.equal(s.username, 'octo');
    assert.deepEqual(s.cards, ['page', 'stats', 'languages']);
    assert.equal(s.outputDir, 'teletext-cards');
    assert.equal(s.card.locale, 'en');
    assert.equal(s.card.timeZone, 'UTC');
    assert.equal(s.card.accent, 'blue');
    assert.deepEqual(s.card.art, []);
    assert.equal(s.stats.languagesBy, 'authorship');
    assert.equal(s.publishBranch, '');
  });

  it('reads lists, art and subtitles', () => {
    const s = parseSettings(
      from({
        username: 'me',
        cards: 'page',
        exclude_repos: 'me/old,\nacme/*',
        art: 'nisse',
        subtitle: 'Line one|Line two',
        fastext: 'A, B, C, D, E',
        accent: 'Red',
        locale: 'da',
      }),
    );
    assert.deepEqual(s.stats.excludeRepos, ['me/old', 'acme/*']);
    assert.ok(s.card.art!.length > 0);
    assert.deepEqual(s.card.subtitle, ['Line one', 'Line two']);
    assert.deepEqual(s.card.fastext, ['A', 'B', 'C', 'D']);
    assert.equal(s.card.accent, 'red');
    assert.equal(s.card.locale, 'da');
  });

  it('rejects bad input with a useful message', () => {
    assert.throws(() => parseSettings(from({})), /username is required/);
    assert.throws(() => parseSettings(from({ username: 'x', cards: 'page,pie' })), /Unknown card "pie"/);
    assert.throws(() => parseSettings(from({ username: 'x', accent: 'black' })), /accent must be/);
    assert.throws(() => parseSettings(from({ username: 'x', timezone: 'Mars/Olympus' })), /Unknown timezone/);
    assert.throws(() => parseSettings(from({ username: 'x', page_number: '42' })), /page_number/);
    assert.throws(() => parseSettings(from({ username: 'x', animate: 'maybe' })), /animate must be true or false/);
  });
});
