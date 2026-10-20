// Split by proof contract; preserves assertions and isolation from verification-proof-reuse.
import childProcess from 'child_process';
import fs from 'fs';
import assert from 'node:assert/strict';
import test from 'node:test';
import os from 'os';
import path from 'path';
import { recoveryEvidenceFileSystem } from '../../../src/adapters/filesystem/recovery-evidence-fs.js';
import { writeActiveVerificationProof } from '../../../src/adapters/verification/active-verification-proof.js';
import { VerificationGateEvidenceReader } from '../../../src/adapters/verification/gate-evidence-reader.js';
import { createIntegrationVerificationEvidencePort } from '../../../src/adapters/verification/integration-verification-proof.js';
import { captureRecoveryEvidence } from '../../../src/application/recovery-evidence.js';
import { resolveConfiguration } from '../../../src/composition/config.js';
import { missionId } from '../../../src/domain/mission.js';
import { repositoryId } from '../../../src/domain/repository.js';
import { initCommittedRepository } from '../../fixtures/git-repository.js';

test('gate evidence reader classifies proofs, failures and validation against the checkout (TASK-2775)', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-evidence-'));
  try {
    const repo = initCommittedRepository(root, {
      'src/input.ts': 'export const value = 1;\n',
      'workflow.config.json': JSON.stringify({ adapters: { gates: { preIntegration: [
        { key: 'unit', command: 'true', order: 0 }, { key: 'docs', command: 'true', order: 1 },
      ] } } }),
    });
    const command = './scripts/verify-local.sh all';
    const configuration = resolveConfiguration({ ...process.env, PARALLIX_HOME: path.join(root, '.git', 'home') });
    const scope = { repositoryId: repositoryId('task-2775-repository'), missionId: missionId('task-2775-gate') };
    const head = () => repo.git('rev-parse', 'HEAD').trim();
    const commit = (value: number) => { fs.writeFileSync(path.join(root, 'src/input.ts'), `export const value = ${value};\n`); repo.git('commit', '-am', `change ${value}`); };
    const marker = null;
    const reader = new VerificationGateEvidenceReader({ configuration, resolveWorktree: () => root, integrationValidation: async () => marker });
    const declared = async () => (await reader.readDeclaredGates(scope, [command])).gates[0];

    assert.deepEqual(await declared(), { command, proof: { state: 'absent' }, failure: null });
    // Scoping: another mission's failure lives in another store and never becomes
    // this mission's gate result, even in the same checkout.
    captureRecoveryEvidence({ command, cwd: root, capturedRevision: head(), exitCode: 4, signal: null, stdout: '', stderr: 'foreign mission', diagnostic: 'foreign mission', missionId: missionId('task-2775-foreign') }, { fs: recoveryEvidenceFileSystem });
    assert.equal((await declared()).failure, null, 'another mission\'s failure is not this mission\'s gate');
    captureRecoveryEvidence({ command, cwd: root, capturedRevision: head(), exitCode: 2, signal: null, stdout: '', stderr: 'boom', diagnostic: 'boom', missionId: scope.missionId }, { fs: recoveryEvidenceFileSystem });
    assert.equal((await declared()).failure?.state, 'current', 'a failure on HEAD is current');
    commit(2);
    assert.equal((await declared()).failure?.state, 'stale', 'a repair commit makes the failure stale');
    assert.equal(writeActiveVerificationProof(command, root, { configuration }).ok, true);
    assert.deepEqual({ proof: (await declared()).proof.state, failure: (await declared()).failure?.state }, { proof: 'current', failure: 'stale' });
    // Scoping: the proof slot belongs to this checkout's branch, so another
    // mission branch of the same repository cannot lend this one a success.
    repo.git('checkout', '-b', 'mission/task-2775-foreign');
    assert.deepEqual((await declared()).proof, { state: 'absent' }, 'a proof on another mission branch is not this checkout\'s result');
    repo.git('checkout', 'main');
    assert.equal((await declared()).proof.state, 'current', 'the same inputs on the owning branch keep the result current');
    commit(3);
    assert.equal((await declared()).proof.state, 'stale', 'changed inputs make the prior success stale');
    fs.writeFileSync(path.join(root, 'src/input.ts'), 'export const value = 4;\n');
    const dirty = await reader.readDeclaredGates(scope, [command]);
    assert.deepEqual({ clean: dirty.checkout.kind === 'present' && dirty.checkout.clean, proof: dirty.gates[0].proof.state }, { clean: false, proof: 'stale' });
    repo.git('checkout', '--', 'src/input.ts');
    captureRecoveryEvidence({ command, cwd: root, capturedRevision: head(), exitCode: 1, signal: null, stdout: '', stderr: 'publication', diagnostic: 'publication' }, { fs: recoveryEvidenceFileSystem });
    assert.equal((await declared()).failure?.state, 'current', 'publication failures captured under the worktree name count too');

    await assert.rejects(new VerificationGateEvidenceReader({ configuration, resolveWorktree: () => root, integrationValidation: null }).readIntegrationGates(scope, null), /history is unavailable/);
    await assert.rejects(new VerificationGateEvidenceReader({ configuration, resolveWorktree: () => path.join(root, 'missing'), integrationValidation: null }).readDeclaredGates(scope, [command]), /unreadable/);
    assert.deepEqual(await new VerificationGateEvidenceReader({ configuration, resolveWorktree: () => null, integrationValidation: null }).readDeclaredGates(scope, [command]), { checkout: { kind: 'absent' }, gates: [] });
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});


// Separate execution-observation contract keeps both cases inside the existing
// finite per-case CPU limit; proof identity assertions above stay intact.
test('gate evidence reader scopes integration execution to its owning attempt (TASK-2775)', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-run-evidence-'));
  try {
    initCommittedRepository(root, { 'workflow.config.json': JSON.stringify({ adapters: { gates: { preIntegration: [
      { key: 'unit', command: 'true', order: 0 }, { key: 'docs', command: 'true', order: 1 },
    ] } } }) });
    const configuration = resolveConfiguration({ ...process.env, PARALLIX_HOME: path.join(root, '.git', 'home') });
    const scope = { repositoryId: repositoryId('task-2775-repository'), missionId: missionId('task-2775-gate') };
    let marker: { sha: string; hooks: readonly string[]; createdAt: string } | null = null;
    // The executor's own run record is the only authority for a running plan,
    // and it belongs to the attempt that started it.
    const runConfiguration = { ...configuration, runtime: { ...configuration.runtime, workflowOperation: 'op-9', workflowGeneration: 2 } };
    const runReader = new VerificationGateEvidenceReader({ configuration: runConfiguration, resolveWorktree: () => root, integrationValidation: async () => marker });
    const runGates = [{ key: 'unit', command: 'true' }, { key: 'docs', command: 'true' }];
    const run = createIntegrationVerificationEvidencePort(runConfiguration).start(root, runGates);
    if (!run) { throw new Error('a configured plan with a matching run must start observable'); }
    const running = await runReader.readIntegrationGates(scope, { id: 'op-9', generation: 2, phase: 'checking' });
    assert.equal(running.running?.attempt, 'op-9:2', 'the executor records a run for the attempt that started it');
    assert.ok(running.running?.startedAt);
    assert.equal((await runReader.readIntegrationGates(scope, { id: 'op-9', generation: 3, phase: 'checking' })).running, null, 'a superseded attempt does not own the run');
    run.complete([{ key: 'unit', command: 'true', exitCode: 0 }, { key: 'docs', command: 'true', exitCode: 1 }], 'failed');
    const settled = await runReader.readIntegrationGates(scope, { id: 'op-9', generation: 2, phase: 'checking' });
    assert.equal(settled.running, null, 'a settled run is never running');
    assert.deepEqual(settled.gates.map(gate => ({ key: gate.key, proof: gate.proof.state, exit: gate.failure?.exitCode ?? null })),
      [{ key: 'unit', proof: 'current', exit: null }, { key: 'docs', proof: 'absent', exit: 1 }], 'per-gate outcomes are observed');
    marker = { sha: settled.checkout.kind === 'present' ? settled.checkout.revision : '', hooks: ['unit', 'docs'], createdAt: new Date(Date.now() + 1).toISOString() };
    const repaired = await runReader.readIntegrationGates(scope, null);
    assert.deepEqual(repaired.gates.map(gate => gate.proof.state), ['current', 'current'], 'later validated hook coverage supersedes failed execution');
    fs.writeFileSync(path.join(root, '.git', 'integration-verification-proof.json'), '{malformed');
    await assert.rejects(runReader.readIntegrationGates(scope, null), /evidence is unreadable/);

  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});


test('gate evidence reader preserves partial integration marker hook coverage (TASK-2775)', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-marker-evidence-'));
  try {
    const repo = initCommittedRepository(root, {
      'src/input.ts': 'export const value = 1;\n',
      'workflow.config.json': JSON.stringify({ adapters: { gates: { preIntegration: [
        { key: 'unit', command: 'true', order: 0 }, { key: 'docs', command: 'true', order: 1 },
      ] } } }),
    });
    const configuration = resolveConfiguration({ ...process.env, PARALLIX_HOME: path.join(root, '.git', 'home') });
    const scope = { repositoryId: repositoryId('task-2775-repository'), missionId: missionId('task-2775-gate') };
    const head = () => repo.git('rev-parse', 'HEAD').trim();
    const commit = (value: number) => { fs.writeFileSync(path.join(root, 'src/input.ts'), `export const value = ${value};\n`); repo.git('commit', '-am', `change ${value}`); };
    let marker: { sha: string; failed?: boolean; hooks: readonly string[]; createdAt: string } | null = null;
    const reader = new VerificationGateEvidenceReader({ configuration, resolveWorktree: () => root, integrationValidation: async () => marker });
    const integration = () => reader.readIntegrationGates(scope, null);
    assert.deepEqual((await integration()).configured, ['unit', 'docs']);
    assert.deepEqual((await integration()).gates, [
      { key: 'unit', proof: { state: 'absent' }, failure: null },
      { key: 'docs', proof: { state: 'absent' }, failure: null },
    ], 'a configured plan with no observed run leaves every gate unproven');
    assert.equal((await integration()).running, null);
    // A validation marker covers only the hooks it names; it never passes the plan.
    marker = { sha: head(), failed: false, hooks: ['unit'], createdAt: '2026-10-18T09:00:00.000Z' };
    assert.deepEqual((await integration()).gates, [
      { key: 'unit', proof: { state: 'current', revision: head(), observedAt: marker.createdAt }, failure: null },
      { key: 'docs', proof: { state: 'absent' }, failure: null },
    ], 'partial hook coverage stays partial');
    marker = { sha: head(), failed: true, hooks: ['unit'], createdAt: '2026-10-18T09:30:00.000Z' };
    assert.deepEqual((await integration()).gates[0].failure, { state: 'current', revision: head(), observedAt: marker.createdAt, exitCode: null });
    commit(5);
    assert.equal((await integration()).gates[0].failure?.state, 'stale', 'a marker for an earlier revision is stale');

  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

// Count the actual boundary, including helpers that do not use a supplied Git double.
test('board gate inputs are shared per build and refreshed on the next read (TASK-2775)', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-read-snapshot-'));
  const { syncBuiltinESMExports } = await import('node:module');
  const originalSpawn = childProcess.spawnSync;
  const originalRead = fs.readFileSync;
  try {
    const repo = initCommittedRepository(root, { 'src/input.ts': 'export const value = 1;\n' });
    const bin = path.join(root, '.git', 'bin');
    fs.mkdirSync(bin);
    const npm = path.join(bin, 'npm');
    fs.writeFileSync(npm, '#!/bin/sh\nexit 0\n', { mode: 0o755 });
    const configuration = resolveConfiguration({ ...process.env, PATH: bin, PARALLIX_HOME: path.join(root, '.git', 'home') });
    assert.equal(writeActiveVerificationProof('true', root, { configuration }).ok, true);
    let calls: string[][] = [];
    let launcherReads = 0;
    t.mock.method(childProcess, 'spawnSync', (...args: Parameters<typeof originalSpawn>) => {
      if (args[0] === 'git') { calls.push(args[1] as string[]); }
      return originalSpawn(...args);
    });
    t.mock.method(fs, 'readFileSync', (...args: Parameters<typeof originalRead>) => {
      if (args[0] === npm) { launcherReads++; }
      return originalRead(...args);
    });
    syncBuiltinESMExports();
    const second = path.join(root, '.git', 'second-checkout');
    repo.git('worktree', 'add', '-b', 'mission/second', second);
    calls = []; launcherReads = 0;
    const reader = new VerificationGateEvidenceReader({ configuration, resolveWorktree: id => id === 'task-second' ? second : root, integrationValidation: async () => null });
    const beginRead = () => (reader as import('../../../src/application/ports/gate-evidence.js').GateEvidenceReader).beginRead?.();
    const scope = { repositoryId: repositoryId('fixture'), missionId: missionId('task-fixture') };
    const read = (id = scope.missionId) => reader.readDeclaredGates({ ...scope, missionId: id }, ['true', 'false']);
    beginRead();
    for (let i = 0; i < 40; i++) {
      const result = await read(missionId(`task-fixture-${i}`));
      assert.deepEqual(result.gates.map(gate => gate.proof.state), ['current', 'absent']);
    }
    assert.ok(calls.length <= 6, `one input snapshot, not one per mission or command: ${calls.length} Git spawns`);
    assert.equal(calls.filter(args => args.includes('--porcelain')).length, 1, 'checkout and proof identity share status');
    assert.equal(launcherReads, 1, 'one toolchain hash per build');
    t.diagnostic(`40 mission reads, 2 commands, 1 worktree: ${calls.length} Git spawns and ${launcherReads} npm launcher hash`);
    assert.equal((await reader.readDeclaredGates({ ...scope, missionId: missionId('task-second') }, ['true'])).gates[0].proof.state, 'absent', 'another worktree has a separate input and proof scope');
    assert.equal(launcherReads, 1, 'the toolchain is shared across worktrees within a build');
    fs.writeFileSync(path.join(root, 'src/input.ts'), 'export const value = 2;\n');
    calls = []; launcherReads = 0;
    beginRead();
    assert.equal((await read()).gates[0].proof.state, 'stale', 'a new build observes dirty inputs');
    assert.equal(calls.filter(args => args.includes('--porcelain')).length, 1);
    assert.equal(launcherReads, 1);
    // A clean new revision, branch and launcher must not inherit the cached identity.
    repo.git('commit', '-am', 'changed input');
    calls = [];
    beginRead();
    for (let i = 0; i < 40; i++) { assert.equal((await read()).gates[0].proof.state, 'stale'); }
    assert.ok(calls.length <= 6, 'stale proof classification also shares its rebase metadata reads');
    repo.git('checkout', '-b', 'mission/other');
    beginRead();
    assert.equal((await read()).gates[0].proof.state, 'absent');
    repo.git('checkout', 'main');
    fs.appendFileSync(npm, '# changed launcher\n');
    beginRead();
    assert.equal((await read()).gates[0].proof.state, 'absent', 'toolchain cache expires with the build');
  } finally {
    t.mock.restoreAll(); syncBuiltinESMExports();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('runtime board benchmark counts the real gate read boundary (TASK-2775)', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-read-benchmark-'));
  try {
    initCommittedRepository(root);
    const { boardBuild } = await import('../../../scripts/benchmark-runtime.js');
    const one = await boardBuild(1, root);
    const forty = await boardBuild(40, root);
    assert.ok(one > 0, 'the benchmark must execute Git instead of stubbing observeGate');
    assert.equal(forty, one, 'shared-checkout gate work is bounded per build');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
