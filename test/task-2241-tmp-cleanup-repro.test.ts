
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const originalOpenSync = fs.openSync;
const originalTmpdir = os.tmpdir;

function loadSmokeHelpers() {
  process.env.PARALLIX_E2E_SMOKE_TEST_HELPERS = '1';
  const smokePath = require.resolve('./e2e-real-agent-smoke.test.ts');
  delete require.cache[smokePath];
  return require(smokePath);
}

test('real-agent smoke capture removes its first stdout file when stderr capture setup fails', () => {
  const tempRoot = fs.mkdtempSync(path.join(originalTmpdir(), 'task-2241-repro-'));
  let firstCapturePath;
  let openCalls = 0;
  try {
    os.tmpdir = () => tempRoot;
    fs.openSync = (filePath, ...args) => {
      openCalls += 1;
      if (openCalls === 1) {
        firstCapturePath = filePath;
        return originalOpenSync(filePath, ...args);
      }
      const error = new Error('ENOSPC: no space left while opening stderr capture');
// @ts-expect-error -- Legacy fixture intentionally accesses runtime-only `code` absent from its inferred mock shape.
      error.code = 'ENOSPC';
      throw error;
    };
    const { runWorkflowAllowFail } = loadSmokeHelpers();

    assert.throws(
      () => runWorkflowAllowFail(tempRoot, process.env, ['--version'], 100),
      { code: 'ENOSPC' }
    );
    assert.equal(fs.existsSync(firstCapturePath), false, 'owned stdout capture must be removed after stderr setup failure');
  } finally {
    fs.openSync = originalOpenSync;
    os.tmpdir = originalTmpdir;
    delete process.env.PARALLIX_E2E_SMOKE_TEST_HELPERS;
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('real-agent smoke captures clean up after normal, command-failure, and timeout runs', () => {
  const tempRoot = fs.mkdtempSync(path.join(originalTmpdir(), 'task-2241-terminal-'));
  try {
    os.tmpdir = () => tempRoot;
    const { runWorkflowAllowFail } = loadSmokeHelpers();
    for (const script of [
      'process.stdout.write("ok")',
      'process.stderr.write("failed"); process.exit(7)',
      'setTimeout(() => {}, 1000)'
    ]) {
      const result = runWorkflowAllowFail(tempRoot, process.env, [process.execPath, '-e', script], 30, { directCommand: true });
      assert.ok(result, 'each terminal path returns a child-process result');
      assert.deepEqual(fs.readdirSync(tempRoot), [], 'completed captures must not leave owned directories');
    }
  } finally {
    os.tmpdir = originalTmpdir;
    delete process.env.PARALLIX_E2E_SMOKE_TEST_HELPERS;
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('real-agent smoke capture retention is opt-in and never deletes operator or concurrent paths', () => {
  const tempRoot = fs.mkdtempSync(path.join(originalTmpdir(), 'task-2241-retention-'));
  const operatorFile = path.join(tempRoot, 'operator-diagnostics.log');
  const concurrentDir = path.join(tempRoot, 'parallix-real-agent-capture-concurrent');
  try {
    fs.writeFileSync(operatorFile, 'keep');
    fs.mkdirSync(concurrentDir);
    os.tmpdir = () => tempRoot;
    const { runWorkflowAllowFail } = loadSmokeHelpers();
    runWorkflowAllowFail(tempRoot, process.env, [process.execPath, '-e', 'process.stdout.write("retain")'], 1000, {
      directCommand: true,
      keepCaptureArtifacts: true
    });
    const retained = fs.readdirSync(tempRoot).filter((entry) => entry.startsWith('parallix-real-agent-capture-') && entry !== path.basename(concurrentDir));
    assert.equal(retained.length, 1, 'only this invocation may retain one owned capture directory');
    assert.ok(fs.existsSync(path.join(tempRoot, retained[0], 'stdout.log')));
    assert.equal(fs.readFileSync(operatorFile, 'utf8'), 'keep');
    assert.ok(fs.existsSync(concurrentDir));
  } finally {
    os.tmpdir = originalTmpdir;
    delete process.env.PARALLIX_E2E_SMOKE_TEST_HELPERS;
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('repeated real-agent smoke capture runs leave no Parallix-owned residue beneath the configured temporary root', () => {
  const tempRoot = fs.mkdtempSync(path.join(originalTmpdir(), 'task-2241-residue-'));
  try {
    os.tmpdir = () => tempRoot;
    const { runWorkflowAllowFail } = loadSmokeHelpers();
    for (let run = 0; run < 5; run += 1) {
      const result = runWorkflowAllowFail(tempRoot, process.env, [process.execPath, '-e', `process.stdout.write(${JSON.stringify(`run-${run}`)})`], 1000, { directCommand: true });
      assert.equal(result.status, 0);
    }
    assert.deepEqual(fs.readdirSync(tempRoot), [], 'completed runs must not accumulate Parallix-owned capture directories');
  } finally {
    os.tmpdir = originalTmpdir;
    delete process.env.PARALLIX_E2E_SMOKE_TEST_HELPERS;
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('real-agent smoke preflight reports temporary-storage exhaustion before fixture creation', () => {
  const { temporaryCapacityPreflight } = loadSmokeHelpers();
  const result = temporaryCapacityPreflight({
    tmpDir: '/owned-test-temp',
    requiredBytes: 1024,
    statfs: () => ({ bavail: 1, bsize: 512 })
  });
  assert.deepEqual(result, {
    ok: false,
    bucket: 'environment-resource',
    detail: 'temporary-storage exhaustion at /owned-test-temp: 512 bytes available, 1024 required'
  });
  delete process.env.PARALLIX_E2E_SMOKE_TEST_HELPERS;
});

test('real-agent smoke classifies ENOSPC and Git index/lock failures as environment resources', () => {
  const { classifyFailure } = loadSmokeHelpers();
  for (const stderr of [
    'fatal: Unable to create .git/index.lock: No space left on device',
    'fatal: could not lock index file: ENOSPC',
    'error: ENOSPC while writing Git index'
  ]) {
    assert.deepEqual(classifyFailure({ stdout: '', stderr, status: 1, signal: null }), {
      bucket: 'environment-resource',
      detail: 'temporary-storage or Git index/lock creation failed; reclaim capacity and retry'
    });
  }
  delete process.env.PARALLIX_E2E_SMOKE_TEST_HELPERS;
});
