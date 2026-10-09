// Command line: render cards locally.
//
//   GITHUB_TOKEN=... node src/cli.ts --username octocat --out cards
//   node src/cli.ts --fixture test/fixtures/demo.json --out examples
//
// Every Action input works as a flag: exclude_repos becomes --exclude-repos.

import { parseArgs } from 'node:util';
import { run } from './run.ts';
import { parseSettings } from './settings.ts';

const NAMES = [
  'username', 'github_token', 'output_dir', 'cards', 'locale', 'timezone', 'clock', 'title', 'subtitle', 'brand',
  'page_number', 'accent', 'art', 'fastext', 'exclude_repos', 'exclude_languages', 'languages_by',
  'languages_count', 'orgs', 'hide', 'animate', 'crt',
];

const { values: parsed } = parseArgs({
  options: {
    ...Object.fromEntries(NAMES.map((n) => [n.replace(/_/g, '-'), { type: 'string' as const }])),
    out: { type: 'string' },
    fixture: { type: 'string' },
    'save-raw': { type: 'string' },
    help: { type: 'boolean', short: 'h' },
  },
});

const values = parsed as Record<string, string | boolean | undefined>;

if (values.help) {
  console.log(`Usage: node src/cli.ts --username <login> [--out dir] [--fixture raw.json] [--save-raw raw.json]
Flags: ${NAMES.map((n) => `--${n.replace(/_/g, '-')}`).join(' ')}
The token comes from --github-token or the GITHUB_TOKEN environment variable.`);
  process.exit(0);
}

const fixture = values.fixture as string | undefined;
const get = (name: string): string | undefined => {
  if (name === 'output_dir') return (values.out as string | undefined) ?? (values['output-dir'] as string | undefined);
  if (name === 'github_token') return (values['github-token'] as string | undefined) ?? process.env.GITHUB_TOKEN;
  return values[name.replace(/_/g, '-')] as string | undefined;
};

try {
  const settings = parseSettings(get, { username: fixture ? 'fixture' : undefined });
  const { files } = await run(settings, { fixture, saveRaw: values['save-raw'] as string | undefined, log: (m) => console.error(m) });
  console.log(files.join('\n'));
} catch (err) {
  console.error(`error: ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
}
