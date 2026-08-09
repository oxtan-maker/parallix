

import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import path from 'path';
import { mockModule, installModuleMocks } from './lib/module-mock.js';
const checkBacklogIntegrityModule = mockModule<typeof import('../src/adapters/backlog/backlog.js')>('../src/adapters/backlog/backlog.js', import.meta.url);
await installModuleMocks();
test.afterEach(() => mock.restoreAll());
const { checkBacklogIntegrity } = checkBacklogIntegrityModule;
test('Backlog integrity check passes', () => {
  // Use REPO_ROOT if available, otherwise assume we are in workflow/test/
  const rootDir = process.env.REPO_ROOT || path.join(import.meta.dirname, '..', '..');
  const issues = checkBacklogIntegrity(rootDir);

  if (issues.length > 0) {
    console.error('[FAIL] Backlog integrity issues found:');
    issues.forEach(issue => {
      if (issue.type === 'duplicate-completed') {
        console.error(`  - ${issue.file}: task ${issue.taskId} duplicates canonical copy ${issue.canonicalFile}`);
      } else {
        console.error(`  - ${issue.file}: filename ID (${issue.filenameId}) does not match frontmatter ID (${issue.frontmatterId})`);
      }
    });
  }

  assert.equal(issues.length, 0, 'Backlog should have no integrity issues');
});
