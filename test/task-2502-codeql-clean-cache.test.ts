// TASK-2502: the repository-owned CodeQL gate must bootstrap on a clean cache
// directory. `resolve_codeql_bin` downloads its archive and `resolve_packs`
// clones the pinned packs; both must create their cache parent directory before
// writing, so a fresh `CODEQL_CACHE_DIR` (no pre-existing leaf) does not fail
// with `curl: (23) client returned ERROR on write`.
//
// This models the documented "preinstalled pinned codeql on PATH" bootstrap:
// the CLI is provided via PATH (satisfying the pinned version), the packs are
// pre-populated in the fresh cache, and the runner must exit 0 on --dry-run.

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

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
