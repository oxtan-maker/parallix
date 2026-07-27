// task-2319 — regression test: root NOTICES must be untracked and ignored by
// an exact root-level .gitignore entry, while nested NOTICES files are not hidden.
//
// Reads committed .gitignore and package.json, plus git tracking state.
// Hermetic for fs-based checks; crosses the process boundary only for git
// tracking verification (spawnSync). Red-to-green: fails when NOTICES is
// tracked (pre-mission) and when the ignore pattern is unanchored (round-1
// defect); passes only with the committed /NOTICES root-anchored rule.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const GITIGNORE = fs.readFileSync(path.join(ROOT, '.gitignore'), 'utf8');
const GITIGNORE_LINES = GITIGNORE.split('\n').map(line => line.trim()).filter(Boolean);

test('task-2319: NOTICES is not tracked in git', () => {
  // git ls-files --error-unmatch exits 1 when the path is not tracked.
  const result = spawnSync('git', ['ls-files', '--error-unmatch', 'NOTICES'], {
    cwd: ROOT,
    encoding: 'utf8',
  });
  assert.notEqual(result.status, 0,
    'NOTICES must not be tracked — it is a generated packaging artifact');
});

test('task-2319: .gitignore contains root-anchored /NOTICES entry', () => {
  const noticesLine = GITIGNORE_LINES.find(line => line.includes('NOTICES'));
  assert.ok(noticesLine, '.gitignore must contain a NOTICES rule');
  assert.equal(noticesLine, '/NOTICES',
    'the NOTICES rule must be root-anchored (/NOTICES), not bare NOTICES');
});

test('task-2319: .gitignore does NOT contain a bare (unanchored) NOTICES rule', () => {
  const bareNotices = GITIGNORE_LINES.find(line => line === 'NOTICES');
  assert.equal(bareNotices, undefined,
    'a bare NOTICES pattern matches at every directory level — the rule must be /NOTICES');
});

test('task-2319: /NOTICES pattern matches only the root artifact (not nested)', () => {
  const noticesLine = GITIGNORE_LINES.find(line => line.includes('NOTICES'));
  assert.ok(noticesLine.startsWith('/'),
    'the NOTICES rule must start with / so it is root-anchored');
});

test('task-2319: NOTICES is listed in package.json files[] (published artifact)', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  assert.ok(Array.isArray(pkg.files), 'package.json must have a files array');
  assert.ok(pkg.files.includes('NOTICES'),
    'NOTICES must remain in the published package files[]');
});
