import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { protectedBranches } from '../src/publish.ts';

describe('protectedBranches', () => {
  it('guards the branch the workflow runs on and the default branch', () => {
    const event = join(mkdtempSync(join(tmpdir(), 'teletext-event-')), 'event.json');
    writeFileSync(event, JSON.stringify({ repository: { default_branch: 'trunk' } }));
    const names = protectedBranches({ GITHUB_REF_TYPE: 'branch', GITHUB_REF_NAME: 'dev', GITHUB_EVENT_PATH: event });
    assert.deepEqual(names.sort(), ['dev', 'main', 'master', 'trunk']);
    assert.ok(!names.includes('output'));
  });

  it('copes without an event, and ignores tags', () => {
    assert.deepEqual(protectedBranches({ GITHUB_REF_TYPE: 'tag', GITHUB_REF_NAME: 'v1', GITHUB_EVENT_PATH: '/nowhere.json' }).sort(), ['main', 'master']);
  });
});
