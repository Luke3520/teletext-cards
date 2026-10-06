// GitHub Action entry point. Runs on Node 24, which strips the TypeScript
// types itself, so there is no build step and nothing in node_modules.

import { appendFileSync } from 'node:fs';
import { protectedBranches, publish } from './publish.ts';
import { originText, run, sourcesText } from './run.ts';
import { parseSettings } from './settings.ts';
import type { Stats } from './stats.ts';

function input(name: string): string | undefined {
  const value = process.env[`INPUT_${name.replace(/ /g, '_').toUpperCase()}`];
  return value === undefined || value === '' ? undefined : value;
}

function output(name: string, value: string): void {
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `${name}=${value}\n`);
}

function summary(stats: Stats, files: string[]): void {
  if (!process.env.GITHUB_STEP_SUMMARY) return;
  const rows: Array<[string, string | number]> = [
    ['Contributions (all time)', stats.contributions],
    ['Contributions (last year)', stats.lastYear],
    ['Commits', stats.commits],
    ['Pull requests (merged)', `${stats.pullRequests} (${stats.mergedPullRequests})`],
    ['Code reviews', stats.reviews],
    ['Last 7 days', `${stats.last7Days}${stats.usualWeek === null ? '' : ` (an ordinary week: ${Math.round(stats.usualWeek)})`}`],
    ['Streak', `${stats.currentStreak} days (best ${stats.longestStreak})`],
    ['Stars', stats.stars],
    ...(stats.visitors ? [['Repo visitors, 14 days', `${stats.visitors.uniques} (${stats.visitors.views} views)`] as [string, string]] : []),
    ['Repositories', `${stats.repos} owned or worked on (${stats.contributedReposNotOwned} owned by orgs or others)`],
    ['Organisations', [...stats.orgs.map((o) => o.label ?? o.login), ...(stats.privateOrgs ? [`+${stats.privateOrgs} private`] : [])].join(', ') || 'none'],
    ['Languages', stats.languages.map((l) => `${l.name} ${(l.share * 100).toFixed(1)}%`).join(', ') || 'none'],
    ['Languages come from', originText(stats)],
    ['Biggest language sources', sourcesText(stats)],
    ['Private contributions (anonymous)', stats.privateContributions],
  ];
  const md = [
    `### Teletext cards for @${stats.login}`,
    '',
    '| | |',
    '|---|---|',
    ...rows.map(([k, v]) => `| ${k} | ${v} |`),
    '',
    `Wrote ${files.map((f) => `\`${f}\``).join(', ')}.`,
    '',
  ].join('\n');
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, md);
}

async function main(): Promise<void> {
  const settings = parseSettings(input, { username: process.env.GITHUB_REPOSITORY_OWNER });
  if (settings.publishBranch && protectedBranches().includes(settings.publishBranch)) {
    throw new Error(
      `publish_branch is "${settings.publishBranch}", where your workflow or README lives. The cards are force-pushed ` +
        'as a single commit, which would replace everything on it. Give them a branch of their own, such as output.',
    );
  }
  const log = (message: string) => console.log(message);
  const { stats, files } = await run(settings, { log });

  output('files', files.join(','));
  output('contributions', String(stats.contributions));
  summary(stats, files);

  if (settings.publishBranch) {
    const repository = process.env.GITHUB_REPOSITORY;
    if (!repository) throw new Error('publish_branch needs GITHUB_REPOSITORY, which GitHub Actions sets.');
    publish({
      dir: settings.outputDir,
      branch: settings.publishBranch,
      repository,
      token: input('publish_token') ?? settings.token,
      message: settings.commitMessage,
      serverUrl: process.env.GITHUB_SERVER_URL,
      log,
    });
  }
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  // Workflow command: shows up as an annotation on the run.
  console.log(`::error title=teletext-cards::${message.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A')}`);
  process.exitCode = 1;
});
