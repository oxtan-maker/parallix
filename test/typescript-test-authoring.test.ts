// @ts-nocheck -- TASK-2277: preserve legacy CommonJS mock behavior while mock-shape typings are hardened separately.

import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { taskOwnedTestSources, taskOwnedSuiteTitles } from './lib/test-organization-policy.js';
import { selectTierFiles } from './lib/test-tier-selection.js';

type Reporter = {
  report(message: string): void;
};

test('TypeScript-authored test records a typed mock interaction', () => {
  const messages: string[] = [];
  const reporter: Reporter = {
    report(message) {
      messages.push(message);
    },
  };

  reporter.report('TypeScript test executed');

  assert.deepEqual(messages, ['TypeScript test executed']);
});

// TASK-2622.20: authoring guidance must have an executable backstop.

function testSources(): string[] {
  const root = path.join(import.meta.dirname, '..');
  const files: string[] = [];
  function walk(relative: string) {
    for (const entry of fs.readdirSync(path.join(root, relative), { withFileTypes: true })) {
      const child = path.posix.join(relative, entry.name);
      if (entry.isDirectory()) walk(child);
      else if (entry.isFile()) files.push(child);
    }
  }
  walk('test');
  return files;
}

test('test ownership rejects numeric task filenames in suites, cases and helpers (TASK-2622.20)', () => {
  assert.deepEqual(taskOwnedTestSources([
    'test/task-1234.test.ts', 'test/nested/task-1234-regression.cases.ts',
    'test/helpers/task-1234.ts', 'test/task_1234.test.js',
    'test/feature-task-1234.test.ts', 'test/fixtures/task-1234.json',
    'test/task-metadata-pure.test.ts', 'test/task-label-persistence.test.ts',
    'test/fixtures/task-1234.md', 'test/mission-contract.test.ts',
  ]), [
    'test/feature-task-1234.test.ts', 'test/fixtures/task-1234.json',
    'test/helpers/task-1234.ts', 'test/nested/task-1234-regression.cases.ts',
    'test/task-1234.test.ts', 'test/task_1234.test.js',
  ].sort());
  assert.deepEqual(taskOwnedTestSources(testSources()), [],
    'Extend the owning behavior contract; keep TASK IDs in case names/comments, including case modules and helpers.');
});

test('every executable test suite remains discoverable in a verification tier (TASK-2622.20)', () => {
  const root = path.join(import.meta.dirname, '..');
  const tiers = selectTierFiles(root);
  const discovered = new Set([...tiers.unit, ...tiers.allIntegration].map(file => path.relative(root, file)));
  for (const e2e of ['e2e-mission-lifecycle.test.ts', 'e2e-real-agent-smoke.test.ts']) discovered.add('test/' + e2e);
  const suites = testSources().filter(file => /\.test\.[cm]?[jt]sx?$/.test(file));
  assert.deepEqual(suites.filter(file => !discovered.has(file)), [],
    'A nested or renamed suite must not vanish from runtime discovery.');
  assert.ok(tiers.unit.includes(path.join(root, 'test', 'typescript-test-authoring.test.ts')),
    'The authoring guard must remain in the default unit suite.');
});

test('suite titles name behavior while task IDs remain case provenance (TASK-2622.20)', () => {
  assert.deepEqual(taskOwnedSuiteTitles("describe(" + "'task-1234 regression', () => {}); test('regression (TASK-1234)', () => {});"), ['task-1234 regression']);
  const violations = testSources().filter(file => /\.(?:test|cases)\.ts$/.test(file)).flatMap(file =>
    taskOwnedSuiteTitles(fs.readFileSync(path.join(import.meta.dirname, '..', file), 'utf8')).map(title => ({ file, title })));
  assert.deepEqual(violations, [], 'Name suites for the contract; keep TASK provenance in cases/comments.');
});
