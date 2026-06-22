const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { checkBacklogIntegrity } = require('../lib/tools/backlog');

test('Backlog integrity check passes', () => {
  // Use REPO_ROOT if available, otherwise assume we are in workflow/test/
  const rootDir = process.env.REPO_ROOT || path.join(__dirname, '..', '..');
  const issues = checkBacklogIntegrity(rootDir);
  
  if (issues.length > 0) {
    console.error('[FAIL] Backlog integrity issues found:');
    issues.forEach(issue => {
      console.error(`  - ${issue.file}: filename ID (${issue.filenameId}) does not match frontmatter ID (${issue.frontmatterId})`);
    });
  }
  
  assert.equal(issues.length, 0, 'Backlog should have no integrity issues');
});
