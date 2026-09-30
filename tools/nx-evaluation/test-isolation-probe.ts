/** Reproduce the covered unit-file isolation comparison without changing the gate. */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { selectTierFiles } from '../../test/lib/test-tier-selection.js';

const root = process.cwd();
const selection = process.argv[2];
const isolation = process.argv[3];
if (!['all', 'safe', 'safe-reverse', 'unsafe', 'sample'].includes(selection ?? '')
  || !['none', 'process'].includes(isolation ?? '')) {
  throw new Error('usage: node --import tsx tools/nx-evaluation/test-isolation-probe.ts <all|safe|safe-reverse|unsafe|sample> <none|process>');
}

// This deliberately narrow filter is an experiment, not a proof of purity:
// dependencies can mutate state, and test files may gain new side effects.
const sharedStateMarker = /mockModule|mock\.module|mock\.method|mock\.timers|mock\.fn|process\.(env|chdir|exit)|globalThis\.|before\(|after\(|beforeEach\(|afterEach\(/;
const unit = selectTierFiles(root).unit;
const files = selection === 'all' ? unit
  : selection === 'sample' ? unit.filter((_, index) => index % 10 === 0)
    : unit.filter(file => sharedStateMarker.test(fs.readFileSync(file, 'utf8')) === (selection === 'unsafe'));
if (selection === 'safe-reverse') files.reverse();

const nodeArgs = [
  '--import', 'tsx',
  '--import', pathToFileURL(path.join(root, 'test/bootstrap-parallix-home.ts')).href,
  '--import', pathToFileURL(path.join(root, 'test/lib/cpu-test-hook.mjs')).href,
  '--experimental-test-module-mocks',
  `--test-isolation=${isolation}`,
  '--test-concurrency=4',
  '--enable-source-maps',
  '--experimental-test-coverage',
  '--test-coverage-include-all',
  '--test-coverage-include=src/**/*.ts',
  '--test-coverage-exclude=test/**',
  '--test-coverage-exclude=prompts/**',
  '--test-coverage-exclude=config/*.json',
  '--test-coverage-exclude=.workflow/**',
  '--test-coverage-exclude=node_modules/**',
  '--test-coverage-lines=0',
  '--test', ...files,
];
process.stderr.write(`[isolation-probe] Node=${process.version} files=${files.length} selection=${selection} isolation=${isolation}\n`);
const result = spawnSync(process.execPath, nodeArgs, {
  cwd: root,
  env: { ...process.env, NODE_NO_WARNINGS: '1' },
  stdio: 'inherit',
  timeout: 300_000,
});
if (result.error) process.stderr.write(`${result.error}\n`);
process.exit(result.status ?? 125);
