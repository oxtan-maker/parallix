const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

const repoRoot = path.resolve(__dirname, '..');

test('px runtime smoke test verifies node px.ts executes without module resolution errors', () => {
  const result = spawnSync('node', ['px.ts', '--version'], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  const output = `${result.stdout || ''}${result.stderr || ''}`;

  assert.equal(result.status, 0, output);
  assert.doesNotMatch(output, /ERR_MODULE_NOT_FOUND/);
});
