import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
import test from 'node:test';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';

// Regression group from test/codeql-suite-options.test.ts
{
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
}

// Regression group from test/codeql-cache-bootstrap.test.ts
{
test('clean cache directory bootstraps the CodeQL gate on --dry-run', () => {
  // A fresh cache dir whose leaf does not yet exist: the runner must mkdir it
  // before writing the CLI download or cloning the packs.
  const freshCache = path.join(os.tmpdir(), `task-2502-codeql-cache-${process.pid}`);
  assert.equal(fs.existsSync(freshCache), false, 'fresh cache leaf must not pre-exist');

  // Provide the pinned codeql on PATH so the CLI bootstrap takes the PATH
  // branch (no 400 MB download) and the gate can run.
  const realCodeql = spawnSync('bash', ['-c', 'command -v codeql'], { encoding: 'utf8' }).stdout.trim();
  if (!realCodeql) {
    test.skip('no codeql on PATH to exercise the clean-cache gate'); // skip-reason: pinned codeql must be on PATH to bootstrap
    return;
  }

  // Pre-populate the packs in the fresh cache so resolve_packs hits the cached
  // branch (skip the network clone) and the dry-run can complete.
  const packsSrc = path.join(freshCache, 'codeql-packs-codeql-cli/v2.27.0/javascript/ql/src');
  fs.mkdirSync(packsSrc, { recursive: true });

  const env = {
    ...process.env,
    CODEQL_CACHE_DIR: freshCache,
    // A valid pinned codeql on PATH satisfies the version check without download.
    PATH: `${path.dirname(realCodeql)}:${process.env.PATH}`,
  };

  try {
    const res = spawnSync('bash', ['scripts/codeql-sast.sh', '--dry-run'], {
      cwd: process.cwd(),
      encoding: 'utf8',
      env,
    });
    assert.equal(res.status, 0, `clean-cache --dry-run failed:\n${res.stdout}\n${res.stderr}`);
    assert.match(res.stdout, /dry-run: plan resolved/, 'runner should resolve and exit 0');
  } finally {
    fs.rmSync(freshCache, { recursive: true, force: true });
  }
});
}
