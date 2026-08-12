import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createTempRootRegistry, recoverRecordedTempRoots } from '../src/adapters/verification/temp-root-registry.js';
import { cleanupRunnerTempRoots, signalExitCode } from './lib/test-runner-temp-roots.js';

test('recorded dead roots are reclaimed while live and unrecorded roots survive', () => {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'task-2365-'));
  const manifests = path.join(fixture, 'manifests');
  fs.mkdirSync(manifests);
  const recordedRoots = [
    'parallix-real-agent-',
    'node-coverage-',
    'coverage-gate-tmp-',
    'codex-home-',
    'task-2339-aggregate-',
  ].map(prefix => fs.mkdtempSync(path.join(fixture, prefix)));
  const liveRoot = fs.mkdtempSync(path.join(fixture, 'parallix-real-agent-'));
  const unrecordedRoot = fs.mkdtempSync(path.join(fixture, 'node-coverage-'));
  const runnerRoot = fs.mkdtempSync(path.join(fixture, 'task-2339-aggregate-'));

  try {
    fs.writeFileSync(path.join(manifests, '111.json'), JSON.stringify({ pid: 111, roots: recordedRoots }));
    fs.writeFileSync(path.join(manifests, '222.json'), JSON.stringify({ pid: 222, roots: [liveRoot] }));
    fs.mkdirSync(path.join(manifests, 'test-run-333'));
    fs.writeFileSync(path.join(manifests, 'test-run-333', '444.json'), JSON.stringify([runnerRoot]));

    recoverRecordedTempRoots({ manifestDir: manifests, isProcessAlive: pid => pid === 222 });

    for (const root of recordedRoots) {
      assert.equal(fs.existsSync(root), false, `dead recorded root must be reclaimed: ${root}`);
    }
    assert.equal(fs.existsSync(path.join(manifests, '111.json')), false, 'dead owner record must be removed');
    assert.equal(fs.existsSync(liveRoot), true, 'live owner root must survive');
    assert.equal(fs.existsSync(path.join(manifests, '222.json')), true, 'live owner record must survive');
    assert.equal(fs.existsSync(unrecordedRoot), true, 'unrecorded root must survive');
    assert.equal(fs.existsSync(runnerRoot), false, 'dead runner worker root must be reclaimed');
    assert.equal(fs.existsSync(path.join(manifests, 'test-run-333')), false, 'dead runner manifest must be removed');
  } finally {
    fs.rmSync(fixture, { recursive: true, force: true });
  }
});

test('runner cleanup removes worker roots before forwarding child failure or a handled signal', () => {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'task-2365-'));
  const manifests = path.join(fixture, 'test-run-333');
  const root = fs.mkdtempSync(path.join(fixture, 'codex-home-'));
  try {
    fs.mkdirSync(manifests);
    fs.writeFileSync(path.join(manifests, '444.json'), JSON.stringify([root]));
    cleanupRunnerTempRoots(manifests);
    cleanupRunnerTempRoots(manifests);
    assert.equal(fs.existsSync(root), false, 'runner cleanup removes registered worker root');
    assert.equal(fs.existsSync(manifests), false, 'runner cleanup removes its worker manifest');
  } finally {
    fs.rmSync(fixture, { recursive: true, force: true });
  }
});

test('runner preserves each child signal exit code after cleanup', () => {
  assert.equal(signalExitCode('SIGINT'), 130);
  assert.equal(signalExitCode('SIGTERM'), 143);
  assert.equal(signalExitCode('SIGKILL'), 137);
});

test('recovery ignores raced entries and roots outside the temporary directory', () => {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'task-2365-'));
  const manifests = path.join(fixture, 'manifests');
  const outside = path.join(process.cwd(), `.task-2365-outside-${process.pid}`);
  fs.mkdirSync(manifests);
  fs.mkdirSync(outside);
  fs.writeFileSync(path.join(manifests, '111.json'), JSON.stringify([outside]));
  fs.symlinkSync(path.join(manifests, 'missing'), path.join(manifests, 'test-run-222'));
  try {
    assert.doesNotThrow(() => recoverRecordedTempRoots({ manifestDir: manifests, isProcessAlive: () => false }));
    assert.equal(fs.existsSync(outside), true, 'recorded root outside the temporary directory must survive');
  } finally {
    fs.rmSync(fixture, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  }
});
