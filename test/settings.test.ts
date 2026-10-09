import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseHide, parseOrgs, parseSettings } from '../src/settings.ts';

const from = (values: Record<string, string>) => (name: string) => values[name];

describe('parseSettings', () => {
  it('has sensible defaults', () => {
    const s = parseSettings(from({}), { username: 'octo' });
    assert.equal(s.username, 'octo');
    assert.deepEqual(s.cards, ['page', 'stats', 'languages']);
    assert.equal(s.outputDir, 'teletext-cards');
    assert.equal(s.card.locale, 'en');
    assert.equal(s.card.timeZone, 'UTC');
    assert.equal(s.card.clock, 'date');
    assert.equal(s.card.accent, 'blue');
    assert.deepEqual(s.card.art!.base, []);
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
    assert.ok(s.card.art!.base.length > 0);
    assert.deepEqual(s.card.subtitle, ['Line one', 'Line two']);
    assert.deepEqual(s.card.fastext, ['A', 'B', 'C', 'D']);
    assert.equal(s.card.accent, 'red');
    assert.equal(s.card.locale, 'da');
  });

  it('reads the orgs choices: pin, rename, hide', () => {
    assert.deepEqual(parseOrgs('bikerental=BikeRental CPH, Betalingsblik,\n-exam-project-luke'), {
      pin: [{ login: 'bikerental', label: 'BikeRental CPH' }, { login: 'Betalingsblik' }],
      hide: ['exam-project-luke'],
    });
    assert.deepEqual(parseOrgs(''), { pin: [], hide: [] });
    assert.throws(() => parseOrgs('not an org'), /not an organisation login/);
  });

  it('reads which parts to hide, with friendly aliases', () => {
    assert.deepEqual(parseHide('orgs, 52 weeks'.replace('52 weeks', 'weeks')), ['orgs', 'activity']);
    assert.deepEqual(parseHide('PRs, repos, pull-requests, Since'), ['pull_requests', 'repositories', 'pull_requests', 'since']);
    assert.deepEqual(parseHide('this week, streaks, recent-work, last_7_days'), ['last_7_days', 'streak', 'recent', 'last_7_days']);
    assert.deepEqual(parseHide(''), []);
    assert.deepEqual(parseHide('star, visits, traffic'), ['stars', 'visitors', 'visitors']);
    assert.throws(() => parseHide('followers'), /unknown part "followers"/);
    assert.deepEqual(parseSettings(from({ username: 'x', hide: 'orgs' })).card.hide, ['orgs']);
  });

  it('rejects bad input with a useful message', () => {
    assert.throws(() => parseSettings(from({})), /username is required/);
    assert.throws(() => parseSettings(from({ username: 'x', cards: 'page,pie' })), /Unknown card "pie"/);
    assert.throws(() => parseSettings(from({ username: 'x', accent: 'black' })), /accent must be/);
    assert.throws(() => parseSettings(from({ username: 'x', timezone: 'Mars/Olympus' })), /Unknown timezone/);
    assert.equal(parseSettings(from({ username: 'x', clock: 'Time' })).card.clock, 'time');
    assert.throws(() => parseSettings(from({ username: 'x', clock: 'sundial' })), /clock must be one of date, time, none/);
    assert.throws(() => parseSettings(from({ username: 'x', page_number: '42' })), /page_number/);
    assert.throws(() => parseSettings(from({ username: 'x', animate: 'maybe' })), /animate must be true or false/);
  });
});
