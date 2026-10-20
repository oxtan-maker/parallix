// Split along execution, shell-verifier and observation contracts to bound suite time.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { verifyActiveUnits } from '../../../scripts/verify-active-units.js';

for (const scenario of ['fresh', 'reuse', 'build-failure']) {
test('repository active verifier real shell ' + scenario + ' contract (TASK-2715)', async () => {
  const reuse = scenario === 'reuse';
  const { initCommittedRepository } = await import('../../fixtures/git-repository.js');
  const { spawnSync } = await import('node:child_process');
  const repoRoot = path.resolve(import.meta.dirname, '../../..');
  const checkout = fs.mkdtempSync(path.join(os.tmpdir(), 'px-active-verifier-'));
  try {
    const repo = initCommittedRepository(checkout, {
      '.gitignore': 'node_modules\n',
      'bin/npm': '#!/bin/sh\nif [ "$FAIL_BUILD" = 1 ]; then exit 7; fi\nif [ "$1" = test ]; then\n  test "$PARALLIX_TEST_COVERAGE" = 0 && test -z "$NODE_V8_COVERAGE" && test -z "$NODE_OPTIONS" || exit 8\n  printf "uncovered\\n" >> .git/unit-count\nfi\n',
      'package.json': '{"type":"module","version":"1.0.0"}',
      'scripts/verify-local.sh': fs.readFileSync(path.join(repoRoot, 'scripts/verify-local.sh'), 'utf8'),
    });
    fs.chmodSync(path.join(checkout, 'bin/npm'), 0o755);
    fs.symlinkSync(process.execPath, path.join(checkout, 'bin/node'));
    fs.symlinkSync(path.join(repoRoot, 'scripts/verify-active-units.ts'), path.join(checkout, 'scripts/verify-active-units.ts'));
    repo.git('add', '.'); repo.git('commit', '-m', 'verifier');
    fs.symlinkSync(path.join(repoRoot, 'node_modules'), path.join(checkout, 'node_modules'));
    const home = path.join(checkout, '.git', 'home');
    const previousHome = process.env.PARALLIX_HOME;
    const previousPath = process.env.PATH;
    if (reuse) {
      try {
        process.env.PARALLIX_HOME = home;
        process.env.PATH = path.join(checkout, 'bin') + ':' + previousPath;
        assert.equal(verifyActiveUnits({ root: checkout, log: () => {}, runUnits: () => {
          fs.writeFileSync(path.join(checkout, '.git/unit-count'), 'uncovered\n');
          return 0;
        } }), 0);
      } finally {
        if (previousHome === undefined) delete process.env.PARALLIX_HOME;
        else process.env.PARALLIX_HOME = previousHome;
        process.env.PATH = previousPath;
      }
    }
    {
      const result = spawnSync('sh', ['scripts/verify-local.sh', 'all'], { cwd: checkout, encoding: 'utf8', timeout: 5000,
        env: { ...process.env, PATH: `${path.join(checkout, 'bin')}:${process.env.PATH}`, PARALLIX_EXECUTION_ROOT: checkout, PARALLIX_HOME: path.join(checkout, '.git', 'home'),
          FAIL_BUILD: scenario === 'build-failure' ? '1' : '0', PARALLIX_TEST_COVERAGE: 'true', NODE_V8_COVERAGE: path.join(checkout, '.git', 'raw') } });
      if (scenario === 'build-failure') {
        assert.notEqual(result.status, 0, 'a build failure must not be masked by successful or cached units');
        assert.equal(fs.existsSync(path.join(checkout, '.git/unit-count')), false);
        return;
      }
      assert.equal(result.status, 0, result.stdout + result.stderr);
      if (reuse) { assert.match(result.stdout, /reused successful uncovered proof/); }
    }
    assert.equal(fs.readFileSync(path.join(checkout, '.git/unit-count'), 'utf8'), 'uncovered\n');
    assert.equal(fs.existsSync(path.join(checkout, 'coverage')), false);
    assert.equal(fs.existsSync(path.join(checkout, '.git/raw')), false);
  } finally { fs.rmSync(checkout, { recursive: true, force: true }); }
});

}
