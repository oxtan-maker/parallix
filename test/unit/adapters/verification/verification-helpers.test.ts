import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as v from '../../../../src/adapters/verification/verification.js';
import { readVerificationInputs } from '../../../../src/adapters/verification/verification-proof-inputs.js';
import { mkdtemp as registeredMkdtemp } from '../../../helpers/temp-dir.js';

function tempDir(prefix = 'verification-') {
  return registeredMkdtemp(prefix);
}
function cleanup(dir: fs.PathLike) { fs.rmSync(dir, { recursive: true, force: true }); }

function writeConfig(dir: string, config: unknown) {
  fs.writeFileSync(path.join(dir, 'workflow.config.json'), JSON.stringify(config));
}

test('isTransientVerificationFailure flags unit-test-budget exhaustion', () => {
  assert.equal(v.isTransientVerificationFailure({ stdout: '[unit-test-budget:exceeded] boom', stderr: '' }), true);
  assert.equal(v.isTransientVerificationFailure({ stdout: '', stderr: '[unit-test-budget] SUITE BUDGET EXCEEDED:' }), true);
});

test('isTransientVerificationFailure treats other output as non-transient', () => {
  assert.equal(v.isTransientVerificationFailure({ stdout: 'typecheck failed', stderr: '' }), false);
  assert.equal(v.isTransientVerificationFailure({ stdout: '', stderr: '' }), false);
});

test('detectAreasFromChangedFiles maps top-level dirs to known areas', () => {
  const files = 'lib/foo.ts\nweb-client/app.ts\ndocs/guide.md\nsrc/other.ts\nREADME.md\n';
  assert.deepEqual([...v.detectAreasFromChangedFiles(files)].sort(), ['docs', 'lib', 'web-client']);
});

test('detectAreasFromChangedFiles collapses workflow-owned dirs to workflow', () => {
  const files = 'test/a.test.ts\nscripts/run.sh\nconfig/json\n';
  assert.deepEqual(v.detectAreasFromChangedFiles(files), ['workflow']);
});

test('detectAreasFromChangedFiles ignores files without a directory and unknown top dirs', () => {
  const files = 'README.md\nsrc/deep/nested.ts\n';
  assert.deepEqual(v.detectAreasFromChangedFiles(files), []);
});

test('resolveVerificationAdapter returns the configured command and default area', () => {
  const dir = tempDir();
  try {
    writeConfig(dir, { adapters: { verification: { command: 'npm run check -- {{area}}', defaultArea: 'lib' } } });
    const adapter = v.resolveVerificationAdapter(dir);
    assert.equal(adapter.command, 'npm run check -- {{area}}');
    assert.equal(adapter.defaultArea, 'lib');
  } finally { cleanup(dir); }
});

test('resolveVerificationAdapter falls back to defaults when unconfigured', () => {
  const dir = tempDir();
  try {
    writeConfig(dir, { adapters: {} });
    const adapter = v.resolveVerificationAdapter(dir);
    assert.equal(adapter.command, null);
    assert.equal(adapter.defaultArea, 'docs');
  } finally { cleanup(dir); }
});

test('resolveEffectiveArea prefers an explicitly supplied area', () => {
  const dir = tempDir();
  try {
    writeConfig(dir, { adapters: { verification: { defaultArea: 'docs' } } });
    assert.equal(v.resolveEffectiveArea('lib', dir), 'lib');
  } finally { cleanup(dir); }
});

test('resolveEffectiveArea uses the configured default area when none is supplied', () => {
  const dir = tempDir();
  try {
    writeConfig(dir, { adapters: { verification: { defaultArea: 'web-client' } } });
    assert.equal(v.resolveEffectiveArea(undefined, dir), 'web-client');
  } finally { cleanup(dir); }
});

test('formatVerificationCommand substitutes the area and returns the no-gate notice when unset', () => {
  const withGate = tempDir();
  try {
    writeConfig(withGate, { adapters: { verification: { command: 'sonar --area {{area}}' } } });
    assert.equal(v.formatVerificationCommand('lib', withGate), 'sonar --area lib');
  } finally { cleanup(withGate); }

  const noGate = tempDir();
  try {
    writeConfig(noGate, { adapters: {} });
    assert.equal(v.formatVerificationCommand(undefined, noGate), v.NO_GATE_NOTICE);
  } finally { cleanup(noGate); }
});

test('recordGateResult writes a passed record for exit code 0 and a failed record otherwise', () => {
  const dir = tempDir();
  try {
    const passed = v.recordGateResult(dir, { area: 'docs', command: 'npm check', exitCode: 0 }, { now: () => new Date('2026-09-17T00:00:00.000Z') });
    assert.ok(passed != null);
    assert.equal(passed.status, 'passed');
    assert.equal(passed.exitCode, 0);
    assert.equal(fs.existsSync(path.join(dir, '.workflow', 'gate-result.json')), true);

    const failed = v.recordGateResult(dir, { area: 'docs', command: 'npm check', exitCode: 2 });
    assert.ok(failed != null);
    assert.equal(failed.status, 'failed');
    assert.equal(failed.exitCode, 2);
  } finally { cleanup(dir); }
});

test('recordGateResult coerces a non-number exit code to a failed status', () => {
  const dir = tempDir();
  try {
    const rec = v.recordGateResult(dir, { area: 'docs', command: 'npm check', exitCode: null });
    assert.ok(rec != null);
    assert.equal(rec.status, 'failed');
    assert.equal(rec.exitCode, 1);
  } finally { cleanup(dir); }
});


test('verification inputs read clean branch and HEAD together and fail closed for dirty or malformed status (TASK-2762)', () => {
  const root = tempDir();
  const commit = 'a'.repeat(40);
  const header = `# branch.oid ${commit}\n# branch.head mission/example\n`;
  try {
    for (const scenario of [
      { status: header, ok: true, calls: 2 },
      { status: header.replace(commit, '(initial)'), ok: true, calls: 2, unborn: true },
      { status: header.replace('mission/example', '(detached)'), ok: true, calls: 2, detached: true },
      { status: header + '1 .M N... 100644 100644 100644 abc abc source.ts\n', ok: false, calls: 1 },
      { status: header + '? untracked.txt\n', ok: false, calls: 1 },
      { status: header + 'u UU conflict.txt\n', ok: false, calls: 1 },
      { status: '# branch.head mission/example\n', ok: false, calls: 1 },
      { status: header.replace(commit, 'malformed'), ok: false, calls: 1 },
      { status: header, ok: false, calls: 1, exitCode: 1 },
      { status: header, ok: false, calls: 2, trackedExitCode: 1 },
      { status: header, ok: false, calls: 2, tracked: '' },
    ]) {
      const calls: string[][] = [];
      const result = readVerificationInputs(root, args => {
        calls.push(args);
        assert.deepEqual(args.slice(0, 2), ['-C', fs.realpathSync(root)]);
        if (args[2] === 'status') {
          assert.deepEqual(args.slice(2), ['status', '--porcelain=v2', '--branch']);
          return { status: scenario.exitCode ?? 0, stdout: scenario.status, stderr: '', signal: null };
        }
        assert.deepEqual(args.slice(2), ['ls-files', '-s']);
        return { status: scenario.trackedExitCode ?? 0, stdout: scenario.tracked ?? '100644 abc 0\tsource.ts\n', stderr: '', signal: null };
      });
      assert.equal(result.ok, scenario.ok, JSON.stringify(scenario));
      assert.equal(calls.length, scenario.calls);
      if (result.ok) {
        assert.equal(result.commit, scenario.unborn ? null : commit);
        assert.equal(result.branch, scenario.detached ? '' : 'mission/example');
      }
    }
  } finally { cleanup(root); }
});
