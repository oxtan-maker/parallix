// TASK-2502: the documented `--suite <name>` flag must work. The runner parses
// options with a `while (($#))` loop that shifts each argument exactly once, so
// the value consumed by `--suite NAME` is not re-encountered as an unknown
// option. The two-argument form is the documented interface; `--suite=NAME` is
// accepted too.

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

function run(args: string[]) {
  return spawnSync('bash', ['scripts/codeql-sast.sh', ...args], {
    encoding: 'utf8',
    cwd: process.cwd(),
  });
}

test('--suite <name> (two-argument form) is accepted on --dry-run', () => {
  const res = run(['--suite', 'codeql/javascript-queries', '--dry-run']);
  assert.equal(res.status, 0, `--suite NAME should exit 0:\n${res.stdout}\n${res.stderr}`);
  assert.match(res.stdout, /Suite:\s+codeql\/javascript-queries/, 'recorded suite should be echoed');
  assert.match(res.stdout, /dry-run: plan resolved/, 'dry-run should resolve and exit 0');
});

test('--suite with no value exits non-zero', () => {
  // No second argument: $2 is unset, so the runner's ${2:?...} guard fires.
  const res = run(['--suite']);
  assert.notEqual(res.status, 0, '--suite with no value must fail');
  assert.match(res.stderr, /--suite requires a value/, 'should report the missing value');
});

test('--suite=NAME (equals form) is accepted on --dry-run', () => {
  const res = run(['--suite=codeql/javascript-queries', '--dry-run']);
  assert.equal(res.status, 0, `--suite=NAME should exit 0:\n${res.stdout}\n${res.stderr}`);
  assert.match(res.stdout, /Suite:\s+codeql\/javascript-queries/, 'equals form should set the suite');
});
