// Split along execution, shell-verifier and observation contracts to bound suite time.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { runPhaseGates } from '../../../src/adapters/config/repository-gates.js';
import { VerificationGateEvidenceReader } from '../../../src/adapters/verification/gate-evidence-reader.js';
import { createIntegrationVerificationEvidencePort } from '../../../src/adapters/verification/integration-verification-proof.js';
import type { ParallixConfiguration } from '../../../src/application/ports/configuration.js';
import { VerificationGateObserver } from '../../../src/application/projections/gate-observation.js';
import { resolveConfiguration } from '../../../src/composition/config.js';
import type { Mission } from '../../../src/domain/mission.js';
import { missionId } from '../../../src/domain/mission.js';
import { repositoryId } from '../../../src/domain/repository.js';
import type { WorkflowOperation } from '../../../src/domain/workflow-operation.js';
import { initCommittedRepository } from '../../fixtures/git-repository.js';

// The integration gate phase is the authority for its own execution: the board
// reads the executor's run record, never a workflow phase guess (TASK-2775).
const GATE_BOARD_MISSION: Mission = {
  id: missionId('task-2775-gate'), repositoryId: repositoryId('task-2775-repository'), title: 'Gate board', labels: [],
  assignee: null, checkpoints: [], review: null, netEngineeringLines: null, status: 'integration', closedAt: null,
  declaredGates: ['./scripts/verify-local.sh all'],
};
const GATE_BOARD_ATTEMPT: WorkflowOperation = {
  id: 'op-7', repositoryId: repositoryId('task-2775-repository'), missionId: missionId('task-2775-gate'), requestKey: 'integrate-1',
  command: 'integrate:merge', generation: 1, phase: 'checking', providerStarted: true, agent: null, reviewer: null,
  originalStatus: 'review', previousAssignee: null, owner: { pid: 1, identity: 'p' },
  createdAt: '2026-10-18T08:00:00.000Z', updatedAt: '2026-10-18T08:00:00.000Z', reason: null,
};

function gateBoardCheckout(commands: readonly string[]): string {
  const checkout = fs.mkdtempSync(path.join(os.tmpdir(), 'px-gates-board-'));
  initCommittedRepository(checkout, {
    'workflow.config.json': JSON.stringify({ adapters: { gates: { preIntegration:
      commands.map((command, index) => ({ key: index === 0 ? 'unit' : `gate-${index}`, command, order: index + 1 })) } } }),
  });
  return checkout;
}

function gateBoardObserver(checkout: string): { observer: VerificationGateObserver; configuration: ParallixConfiguration } {
  const base = resolveConfiguration({ ...process.env, PARALLIX_HOME: path.join(checkout, '.git', 'home') });
  const configuration = { ...base, runtime: { ...base.runtime, workflowOperation: GATE_BOARD_ATTEMPT.id, workflowGeneration: GATE_BOARD_ATTEMPT.generation } };
  return { configuration, observer: new VerificationGateObserver(new VerificationGateEvidenceReader({
    configuration, resolveWorktree: () => checkout, integrationValidation: async () => null,
  })) };
}

test('the integration gate executor is observable on the board from start to result (TASK-2775)', async () => {
  const checkout = gateBoardCheckout(['touch .git/started; for i in $(seq 1 75); do [ -f .git/go ] && break; sleep 0.02; done; printf ok']);
  let running: ReturnType<typeof runPhaseGates> | undefined;
  try {
    const { configuration, observer } = gateBoardObserver(checkout);
    const evidence = () => createIntegrationVerificationEvidencePort(configuration);
    assert.equal(await observer.observeGate(GATE_BOARD_MISSION, GATE_BOARD_ATTEMPT), 'not-run', 'before the gate phase runs');
    running = runPhaseGates('integration', { slug: 'task-2775', checkoutPath: checkout, log: () => {}, error: () => {},
      configuration, verificationEvidence: evidence() });
    for (let waited = 0; waited < 2000 && !fs.existsSync(path.join(checkout, '.git/started')); waited += 20) { await delay(20); }
    assert.equal(await observer.observeGate(GATE_BOARD_MISSION, GATE_BOARD_ATTEMPT), 'running', 'the executor records the run it started');
    assert.equal(await observer.observeGate(GATE_BOARD_MISSION, { ...GATE_BOARD_ATTEMPT, generation: 2 }), 'not-run', 'a later attempt does not inherit the run');
    fs.writeFileSync(path.join(checkout, '.git/go'), '');
    assert.equal((await running).ok, true);
    assert.equal(await observer.observeGate(GATE_BOARD_MISSION, GATE_BOARD_ATTEMPT), 'passed', 'the settled run is the board result');
  } finally { fs.writeFileSync(path.join(checkout, '.git/go'), ''); await running; fs.rmSync(checkout, { recursive: true, force: true }); }
});

test('a failing integration gate settles the board run instead of leaving it running (TASK-2775)', async () => {
  const checkout = gateBoardCheckout(['printf ok', 'printf defect >&2; exit 7']);
  try {
    const { configuration, observer } = gateBoardObserver(checkout);
    const result = await runPhaseGates('integration', { slug: 'task-2775', checkoutPath: checkout, log: () => {}, error: () => {},
      configuration, verificationEvidence: createIntegrationVerificationEvidencePort(configuration) });
    assert.equal(result.ok, false);
    assert.equal(await observer.observeGate(GATE_BOARD_MISSION, GATE_BOARD_ATTEMPT), 'failed');
  } finally { fs.rmSync(checkout, { recursive: true, force: true }); }
});


test('cancelled and interrupted integration attempts cannot inherit a prior pass (TASK-2775)', async () => {
  const checkout = gateBoardCheckout(['true']);
  try {
    const { configuration, observer } = gateBoardObserver(checkout);
    const port = createIntegrationVerificationEvidencePort(configuration);
    const gates = [{ key: 'unit', command: 'true' }];
    const passed = port.start(checkout, gates)!;
    passed.complete([{ ...gates[0], exitCode: 0 }], 'passed');
    assert.equal(await observer.observeGate(GATE_BOARD_MISSION, GATE_BOARD_ATTEMPT), 'passed');
    const retry = port.start(checkout, gates)!;
    assert.equal(await observer.observeGate(GATE_BOARD_MISSION, GATE_BOARD_ATTEMPT), 'running');
    assert.equal(await observer.observeGate(GATE_BOARD_MISSION, { ...GATE_BOARD_ATTEMPT, phase: 'interrupted' }), 'not-run');
    retry.complete([{ ...gates[0], exitCode: null }], 'cancelled');
    assert.equal(await observer.observeGate(GATE_BOARD_MISSION, GATE_BOARD_ATTEMPT), 'failed');
    const repair = port.start(checkout, gates)!;
    repair.complete([{ ...gates[0], exitCode: 0 }], 'passed');
    assert.equal(await observer.observeGate(GATE_BOARD_MISSION, GATE_BOARD_ATTEMPT), 'passed');
    const { spawnSync } = await import('node:child_process');
    assert.equal(spawnSync('git', ['-C', checkout, 'checkout', '-b', 'mission/other'], { encoding: 'utf8' }).status, 0);
    assert.equal(await observer.observeGate(GATE_BOARD_MISSION, GATE_BOARD_ATTEMPT), 'stale', 'another mission branch cannot inherit the result');
    assert.equal(spawnSync('git', ['-C', checkout, 'checkout', 'main'], { encoding: 'utf8' }).status, 0);
    fs.writeFileSync(path.join(checkout, 'changed'), 'new input');
    assert.equal(await observer.observeGate(GATE_BOARD_MISSION, GATE_BOARD_ATTEMPT), 'stale');
  } finally { fs.rmSync(checkout, { recursive: true, force: true }); }
});
