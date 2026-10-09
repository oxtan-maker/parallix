import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { openMigratedMissionStore } from '../../fixtures/mission-sqlite-store.js';
import { fixtureMission } from '../../fixtures/mission-builders.js';
import { makePorts, makeRecorder, SLUG } from '../../helpers/handoff-ports.js';
import { HandoffCommandUseCase } from '../../../src/application/handoff-command-use-case.js';
import { MissionCheckpointService } from '../../../src/application/mission-checkpoint-service.js';
import { RepairCheckpointService } from '../../../src/application/repair-checkpoint-service.js';
import { configureRepairCheckpoints } from '../../../src/application/ports/repair-checkpoint.js';
import { createCheckpointCommand } from '../../../src/interfaces/cli/mission-writes.js';
import { missionId } from '../../../src/domain/mission.js';

/** Real SQLite, CLI evidence writes and shell gate; agent and external review effects are isolated doubles. */
export async function runRepairCheckpointFlow(mode: 'repair' | 'blocker' = 'repair') {
  const id = missionId(SLUG);
  const command = 'bash ./repair-gate.sh';
  const evidence = 'test/integration/sqlite/mission-use-case-persistence-contract.test.ts';
  const prior = { missionId: id, name: 'CP-1', goalCheck: [
    { criterion: 'repair works', evidence }, { criterion: 'prior proof retained', evidence },
  ], nextActionText: 'continue' };
  const fixture = await openMigratedMissionStore([fixtureMission(SLUG, {
    brief: { goal: 'repair', why: 'proof', scope: null, outOfScope: [] },
    successCriteria: ['repair works', 'prior proof retained'], completedSuccessCriteria: [0, 1],
    declaredGates: [command], checkpoints: [prior, { missionId: id, name: 'CP-2', firstLine: 'remaining work', goalCheck: [], nextActionText: '' }],
  })]);
  try {
    const { store, root } = fixture;
    const initial = await store.load(id);
    if (initial.kind !== 'found') { throw new Error('missing fixture'); }
    const retainedPrior = initial.mission.checkpoints[0];
    fs.writeFileSync(path.join(root, 'repair-gate.sh'), 'test -f repaired\n');
    const checkpoints = new MissionCheckpointService(store);
    const repair = new RepairCheckpointService(store);
    configureRepairCheckpoints(repair);
    const cli = createCheckpointCommand(checkpoints, () => SLUG);
    const record = async (name: string) => {
      const loaded = await store.load(id); assert.equal(loaded.kind, 'found');
      if (loaded.kind !== 'found') { throw new Error('missing fixture'); }
      await cli(['record', '--name', name, '--criterion', 'repair works', '--evidence', evidence,
        '--next', 'rerun authorized gate and handoff', '--expected-version', String(loaded.version)]);
    };
    const recorder = makeRecorder();
    let launches = 0;
    let gateRuns = 0;
    const ports = makePorts(recorder, {
      missionServices: async () => ({ store, checkpoints,
        lifecycle: { transition: async () => ({ status: 'completed', value: { version: 10 } }) },
        handoff: { recordNel: async () => ({ status: 'completed' }) },
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
        if (mode === 'blocker') {
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
    assert.equal(launches, 1, result.error);
    assert.equal(result.ok, mode === 'repair', result.error);
    const after = await store.load(id); assert.equal(after.kind, 'found');
    if (after.kind !== 'found') { throw new Error('missing fixture'); }
    assert.deepEqual(after.mission.checkpoints[0], retainedPrior);
    assert.equal(after.mission.checkpoints[2].repair?.verified, mode === 'repair');
    assert.equal(gateRuns, mode === 'repair' ? 2 : 1, 'only authorized gate reruns; blocker stops first attempt');
    const reloaded = new RepairCheckpointService(store);
    if (mode === 'blocker') {
      assert.equal((await reloaded.readBlocker(SLUG, 'CP-3'))?.command, command);
      const blockedAgain = await handoff();
      assert.equal(blockedAgain.ok, false);
      assert.match(blockedAgain.error ?? '', /human review/);
      assert.equal(launches, 1, result.error);
    }
    return { mode, missingCheckpointRejected: true, launches, gateRuns, handoff: result.ok, priorProofRetained: true, repairCheckpoint: 'CP-3' };
  } finally {
    configureRepairCheckpoints(undefined);
    await fixture.close();
  }
}

export function repairCheckpointFlowCases(): void {
  test('isolated repair persists before launch, reruns exact gate and hands off with retained proof (TASK-2695)', async () => { await runRepairCheckpointFlow(); });
  test('isolated first contract report persists across reload and stops retries and handoff (TASK-2695)', async () => { await runRepairCheckpointFlow('blocker'); });
}
