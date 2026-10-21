import { agentFamily } from '../../../src/domain/agents.js';
import { handoffTransitionValue } from '../../helpers/handoff-ports.js';
import { missionVersion } from '../../../src/application/domain-ports.js';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test, { before } from 'node:test';
import { prepareMigratedSchema, migratedSchemaPath } from '../../fixtures/migrated-database.js';
import { openMigratedMissionStore } from '../../fixtures/mission-sqlite-store.js';
import { fixtureMission } from '../../fixtures/mission-builders.js';
import { makePorts, makeRecorder, SLUG } from '../../helpers/handoff-ports.js';
import { HandoffCommandUseCase } from '../../../src/application/handoff-command-use-case.js';
import { MissionCheckpointService } from '../../../src/application/mission-checkpoint-service.js';
import { RepairCheckpointService } from '../../../src/application/repair-checkpoint-service.js';
import { configureRepairCheckpoints } from '../../../src/application/ports/repair-checkpoint.js';
import { createCheckpointCommand } from '../../../src/interfaces/cli/mission-writes.js';
import { missionId } from '../../../src/domain/mission.js';
import { effectiveRepairObligations } from '../../../src/domain/repair-coverage.js';
import { SqliteMissionStore } from '../../../src/adapters/sqlite/mission-store.js';
import { runCheckpointVerification } from '../../../src/application/rebound-checkpoints.js';

/** Real SQLite, CLI evidence writes and shell gate; agent and external review effects are isolated doubles. */
export async function runRepairCheckpointFlow(mode: 'repair' | 'blocker' | 'force' = 'repair') {
  const id = missionId(SLUG);
  const command = 'bash ./repair-gate.sh';
  const evidence = 'test/integration/sqlite/mission-use-case-persistence-contract.test.ts';
  const prior = { missionId: id, name: 'CP-1', goalCheck: [
    { criterion: 'repair works', evidence }, { criterion: 'prior proof retained', evidence },
  ], nextActionText: 'continue' };
  const fixture = await openMigratedMissionStore([fixtureMission(SLUG, {
    assignee: agentFamily('codex'),
    brief: { goal: 'repair', why: 'proof', scope: null, outOfScope: [] },
    successCriteria: ['repair works', 'prior proof retained'], completedSuccessCriteria: [0, 1],
    declaredGates: [command], checkpoints: [prior, { missionId: id, name: 'CP-2', firstLine: 'remaining work', goalCheck: [], nextActionText: '' }],
  })], migratedSchemaPath());
  try {
    const { store, root } = fixture;
    const initial = await store.load(id);
    if (initial.kind !== 'found') { throw new Error('missing fixture'); }
    const retainedPrior = initial.mission.checkpoints[0];
    fs.writeFileSync(path.join(root, 'repair-gate.sh'), 'test -f repaired\n');
    const checkpoints = new MissionCheckpointService(store);
    const repair = new RepairCheckpointService(store);
    configureRepairCheckpoints(repair);
    const cli = createCheckpointCommand(checkpoints, () => SLUG, undefined, true);
    const record = async (name: string, force = false) => {
      const loaded = await store.load(id); assert.equal(loaded.kind, 'found');
      if (loaded.kind !== 'found') { throw new Error('missing fixture'); }
      await cli(['record', ...(force ? ['--force'] : []), '--name', name, '--criterion', 'repair works', '--evidence', evidence,
        '--next', 'rerun authorized gate and handoff', '--expected-version', String(loaded.version)]);
    };
    const recorder = makeRecorder();
    let launches = 0;
    let gateRuns = 0;
    const ports = makePorts(recorder, {
      agentSelection: { eligibleAgentsForStep: () => ['claude', 'codex'], selectAgent: () => 'claude' },
      missionServices: async () => ({ store, checkpoints,
        lifecycle: { transition: async () => ({ durableEvidence: [],  status: 'completed' as const, value: handoffTransitionValue(missionVersion(10)) }) },
        handoff: { recordNel: async () => ({ durableEvidence: [],  status: 'completed' as const }) },
      }),
      process: { spawnSync: (cmd: string, args: string[], options: object) => {
        gateRuns++;
        return spawnSync(cmd, args, { ...options, cwd: root, encoding: 'utf8', timeout: 2000 });
      } },
      agents: { startAgent: async (_step: string, options: { prompt: (_agent: string) => string }) => {
        launches++;
        const prompt = options.prompt('codex');
        const name = /Harness-created repair checkpoint: (CP-\d+)/.exec(prompt)?.[1];
        assert.equal(name, 'CP-3', 'checkpoint is durable before the launch');
        const loaded = await store.load(id); assert.equal(loaded.kind, 'found');
        if (loaded.kind !== 'found') { throw new Error('missing fixture'); }
        assert.equal(loaded.mission.checkpoints[2].repair?.command, command);
        assert.deepEqual(loaded.mission.checkpoints[0], retainedPrior);
        if (mode !== 'repair') {
          await cli(['report-invalid-contract', '--name', name!, '--command', command,
            '--diagnostic', 'fixture contract is invalid', '--authority-reason', 'operator owns locked check',
            '--proposed-correction', 'operator should select corrected owner', '--expected-version', String(loaded.version)]);
        } else {
          fs.writeFileSync(path.join(root, 'repaired'), 'fixed\n');
          await record(name!);
        }
        return { result: { status: 0 } };
      } },
    });
    const useCase = new HandoffCommandUseCase(ports);
    const handoff = () => useCase.performHandoff(SLUG, { worktree: root, recoverGateFailure: true, log: line => recorder.log.push(line), error: line => recorder.errors.push(line) });
    const missing = await handoff();
    assert.equal(missing.ok, false);
    assert.match(missing.error ?? '', /Planned checkpoint evidence is missing.*CP-2/);
    assert.equal(launches, 0);
    await record('CP-2');
    const result = await handoff();
    assert.equal(launches, 1, result.error ?? '');
    assert.equal(result.ok, mode === 'repair', result.error ?? '');
    const after = await store.load(id); assert.equal(after.kind, 'found');
    if (after.kind !== 'found') { throw new Error('missing fixture'); }
    assert.deepEqual(after.mission.checkpoints[0], retainedPrior);
    assert.equal(after.mission.checkpoints[2].repair?.verified, mode === 'repair');
    assert.equal(gateRuns, mode === 'repair' ? 2 : 1, 'only authorized gate reruns; blocker stops first attempt');
    const reloaded = new RepairCheckpointService(store);
    if (mode !== 'repair') {
      assert.equal((await reloaded.readBlocker(SLUG, 'CP-3'))?.command, command);
      const blockedAgain = await handoff();
      assert.equal(blockedAgain.ok, false);
      assert.match(blockedAgain.error ?? '', /human review/);
      assert.equal(launches, 1, result.error ?? '');
    }
    let finalHandoff = result.ok;
    if (mode === 'force') {
      fs.writeFileSync(path.join(root, 'repaired'), 'fixed\n');
      await record('CP-3', true);
      assert.equal(await reloaded.readBlocker(SLUG, 'CP-3'), undefined);
      const resolved = await handoff();
      assert.equal(resolved.ok, true, resolved.error ?? '');
      finalHandoff = resolved.ok;
      assert.equal(gateRuns, 2, 'forced evidence still runs the required gate');
      assert.equal(launches, 1, 'operator recovery needs no agent relaunch');
    }
    return { mode, missingCheckpointRejected: true, launches, gateRuns, handoff: finalHandoff, priorProofRetained: true, repairCheckpoint: 'CP-3' };
  } finally {
    configureRepairCheckpoints(undefined);
    await fixture.close();
  }
}

export function repairCheckpointFlowCases(): void {
  // Share only the closed empty schema; every case retains its own writable DB.
  before(prepareMigratedSchema);
  test('exact-success occurrence coverage and provenance survive SQLite reload atomically (TASK-2802)', async () => {
    const slug = 'coverage-persistence';
    const mission = fixtureMission(slug, { brief: { goal: 'g', why: 'w', scope: 's', outOfScope: [] },
      declaredGates: ['git diff --check'], successCriteria: ['criterion'], completedSuccessCriteria: [0] });
    const fixture = await openMigratedMissionStore([mission], migratedSchemaPath());
    try {
      const { store } = fixture;
      const repair = new RepairCheckpointService(store);
      const request = { slug, command: 'git diff --check', worktree: fixture.root, failureRevision: 'failed-head',
        failureEvidenceId: 'failure-1', attempt: 1 };
      const record = async (name: string) => {
        const result = await new MissionCheckpointService(store).record({ operationId: 'record', missionId: mission.id,
          capabilities: new Set(['checkpoint:record']), checkpoint: { missionId: mission.id, name, nextActionText: 'handoff',
            goalCheck: [{ criterion: 'criterion', evidence: 'test/integration/sqlite/repair-checkpoint-flow.cases.ts' }] } });
        assert.equal(result.status, 'completed');
      };
      await repair.open({ ...request, incidentId: 'older' });
      await record('CP-2');
      await repair.open({ ...request, incidentId: 'newer', failureEvidenceId: 'failure-2' });
      await record('CP-3');
      const before = await store.load(mission.id);
      assert.equal(before.kind, 'found');
      if (before.kind !== 'found') { throw new Error('missing fixture'); }
      // Failed execution never reaches certification and writes neither proof nor success.
      const context = { slug, worktree: fixture.root, implementer: 'codex', readHead: () => 'fixed-head',
        repairCheckpoints: repair, startAgent: async () => ({ result: { status: 0 } }),
        verify: () => ({ ok: false, command: request.command }) };
      const prepared = { repairPort: repair, repairCheckpoint: { name: 'CP-3', version: before.version }, fixPrompt: '' };
      const failed = await runCheckpointVerification(context, prepared, 1);
      await failed.certify();
      assert.deepEqual(await store.load(mission.id), before);
      // The actual shell check supplies the successful result; the harness supplies provenance.
      const initialized = spawnSync('git', ['init', '-q'], { cwd: fixture.root, timeout: 1000 });
      assert.equal(initialized.status, 0);
      const passing = { ...context, verify: () => ({ ok: spawnSync('git', ['diff', '--check'],
        { cwd: fixture.root, timeout: 1000 }).status === 0, command: request.command,
      exactExecution: { command: request.command, worktree: fixture.root, exitCode: 0 as const } }) };
      const passed = await runCheckpointVerification(passing, prepared, 1);
      assert.equal(passed.verified.ok, true);
      await passed.certify();
      const reloaded = await new SqliteMissionStore(fixture.database).load(mission.id);
      assert.equal(reloaded.kind, 'found');
      if (reloaded.kind !== 'found') { throw new Error('missing reloaded fixture'); }
      assert.deepEqual(reloaded.mission.checkpoints[1], before.mission.checkpoints[1]);
      assert.equal(reloaded.mission.checkpoints[1].repair!.verified, false);
      assert.deepEqual(effectiveRepairObligations(reloaded.mission.checkpoints, mission.declaredGates, mission.successCriteria), []);
      const proof = reloaded.mission.checkpoints[2].repair!.exactSuccessCoverage!;
      assert.equal(proof.execution.producer, 'rebound-exact-verifier');
      assert.equal(proof.executionRevision, 'fixed-head');
      assert.equal(proof.verifiedMissionRevision, reloaded.version);
      assert.equal(proof.coveredOccurrences[0].incidentId, 'older');
      assert.equal(proof.checkpointEvidenceRevision, before.mission.checkpoints[2].recording!.missionRevision);
    } finally { await fixture.close(); }
  });
  test('forced CLI evidence clears a persisted blocker and reruns handoff gate', async () => { await runRepairCheckpointFlow('force'); });
  test('isolated repair persists before launch, reruns exact gate and hands off with retained proof (TASK-2695)', async () => { await runRepairCheckpointFlow(); });
  test('isolated first contract report persists across reload and stops retries and handoff (TASK-2695)', async () => { await runRepairCheckpointFlow('blocker'); });
}
