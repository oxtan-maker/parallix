// Split along execution, shell-verifier and observation contracts to bound suite time.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { runPhaseGates } from '../../../src/adapters/config/repository-gates.js';
import { VerificationGateEvidenceReader } from '../../../src/adapters/verification/gate-evidence-reader.js';
import { createIntegrationVerificationEvidencePort, readIntegrationGateRun } from '../../../src/adapters/verification/integration-verification-proof.js';
import type { TestsActionStartFacts } from '../../../src/application/ports/verification-policy.js';
import { processIdentity, processLivenessProbe } from '../../../src/adapters/process/process-liveness.js';
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
  command: 'integrate:merge', generation: 1, phase: 'executing', providerStarted: true, agent: null, reviewer: null,
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
    configuration, resolveWorktree: () => checkout, integrationValidation: async () => null, isProcessAlive: processLivenessProbe,
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

test('an unlimited integration dry-run is observable while its real executor runs (PX-0052)', async t => {
  const checkout = gateBoardCheckout(['touch .git/started; while [ ! -f .git/go ]; do sleep 0.02; done']);
  const configuration = resolveConfiguration({ ...process.env, PARALLIX_HOME: path.join(checkout, '.git', 'home') });
  const owner = processIdentity(process.pid);
  assert.ok(owner, 'the executor has a stable process identity');
  let running: ReturnType<typeof runPhaseGates> | undefined;
  t.after(async () => { fs.writeFileSync(path.join(checkout, '.git/go'), ''); await running; fs.rmSync(checkout, { recursive: true, force: true }); });
  const observer = new VerificationGateObserver(new VerificationGateEvidenceReader({
    configuration, resolveWorktree: () => checkout, integrationValidation: async () => null,
    isProcessAlive: processLivenessProbe,
  }));
  assert.equal((JSON.parse(fs.readFileSync(path.join(checkout, 'workflow.config.json'), 'utf8')) as { adapters: { gates: { maxConcurrent?: number } } }).adapters.gates.maxConcurrent,
    undefined, 'the repository intentionally leaves integration concurrency unlimited');
  running = runPhaseGates('integration', { slug: 'px-0052', checkoutPath: checkout, log: () => {}, error: () => {},
    configuration, verificationEvidence: createIntegrationVerificationEvidencePort(configuration, owner) });
  for (let waited = 0; waited < 2000 && !fs.existsSync(path.join(checkout, '.git/started')); waited += 20) { await delay(20); }
  assert.equal(await observer.observeGate({ ...GATE_BOARD_MISSION, id: missionId('px-0052') }, null), 'running',
    'omitting maxConcurrent must not hide the live dry-run');
  fs.writeFileSync(path.join(checkout, '.git/go'), '');
  assert.equal((await running).ok, true);
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

test('integration start and authoritative settlement share one gate run correlation (TASK-2859.10)', async () => {
  const checkout = gateBoardCheckout(['true']);
  try {
    const configuration = resolveConfiguration({ ...process.env, PARALLIX_HOME: path.join(checkout, '.git', 'home') });
    const starts: TestsActionStartFacts[] = [];
    const settlements: { gateRunId: string; passed: boolean }[] = [];
    const evidence = createIntegrationVerificationEvidencePort(configuration, null,
      { observe: async facts => { starts.push(facts); }, settle: async facts => { settlements.push(facts); } });
    const result = await runPhaseGates('integration', { slug: 'task-2859.10', checkoutPath: checkout,
      gates: [{ key: 'unit', command: 'true', order: 1 }], commandRunner: () => ({ status: 0, stdout: '', stderr: '' }),
      operatorInvocation: true, verificationEvidence: evidence, log: () => {}, error: () => {} });
    const settled = readIntegrationGateRun(checkout, configuration);
    assert.equal(result.ok, true);
    assert.equal(starts.length, 1);
    assert.ok(starts[0]!.gateRunId);
    assert.equal(starts[0]!.verdictCorrelation, starts[0]!.gateRunId);
    assert.equal(starts[0]!.operatorInvocation, true);
    assert.equal(settled?.gateRunId, starts[0]!.gateRunId);
    assert.equal(settled?.status, 'passed');
    assert.deepEqual(settled?.outcomes.map(outcome => outcome.result), ['passed']);
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(settlements.map(item => [item.gateRunId, item.passed]), [[starts[0]!.gateRunId, true]],
      'the gate run verdict settles the tests start it began, by the same gate run id (TASK-2867.07)');
  } finally { fs.rmSync(checkout, { recursive: true, force: true }); }
});

test('cancelled and interrupted integration attempts cannot inherit a prior pass (TASK-2775)', async () => {
  const checkout = gateBoardCheckout(['true']);
  try {
    const { configuration, observer } = gateBoardObserver(checkout);
    const port = createIntegrationVerificationEvidencePort(configuration);
    const gates = [{ key: 'unit', command: 'true' }];
    const passed = (await port.start(checkout, gates,
      { missionId: GATE_BOARD_MISSION.id, operatorInvocation: false }))!;
    passed.complete([{ ...gates[0], exitCode: 0 }], 'passed');
    assert.equal(await observer.observeGate(GATE_BOARD_MISSION, GATE_BOARD_ATTEMPT), 'passed');
    const retry = (await port.start(checkout, gates,
      { missionId: GATE_BOARD_MISSION.id, operatorInvocation: false }))!;
    assert.equal(await observer.observeGate(GATE_BOARD_MISSION, GATE_BOARD_ATTEMPT), 'running');
    assert.equal(await observer.observeGate(GATE_BOARD_MISSION, { ...GATE_BOARD_ATTEMPT, phase: 'interrupted' }), 'not-run');
    retry.complete([{ ...gates[0], exitCode: null }], 'cancelled');
    assert.equal(await observer.observeGate(GATE_BOARD_MISSION, GATE_BOARD_ATTEMPT), 'failed');
    const repair = (await port.start(checkout, gates,
      { missionId: GATE_BOARD_MISSION.id, operatorInvocation: false }))!;
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

test('an aggregate integration run persists every failure, blocked and cancelled part distinctly (px-0050.01)', async () => {
  const checkout = fs.mkdtempSync(path.join(os.tmpdir(), 'px-gates-aggregate-record-'));
  try {
    initCommittedRepository(checkout, { 'workflow.config.json': JSON.stringify({ adapters: { gates: { preIntegration: [
      { key: 'unit', command: 'printf unit-defect >&2; exit 3', order: 1 },
      { key: 'lint', command: 'printf lint-defect >&2; exit 4', order: 2 },
      { key: 'good', command: 'true', order: 3 },
      { key: 'sonar', command: 'touch .git/must-not-run', order: 4, after: ['unit', 'good'] },
    ] } } }) });
    const { configuration, observer } = gateBoardObserver(checkout);
    const result = await runPhaseGates('integration', { slug: 'px-0050', checkoutPath: checkout, log: () => {}, error: () => {},
      maxParallel: 3, configuration, verificationEvidence: createIntegrationVerificationEvidencePort(configuration) });
    assert.equal(result.ok, false);
    assert.equal(fs.existsSync(path.join(checkout, '.git/must-not-run')), false);
    const revision = spawnSync('git', ['-C', checkout, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).stdout.trim();
    const record = JSON.parse(fs.readFileSync(path.join(checkout, '.git/integration-verification-proof.json'), 'utf8'));
    assert.equal(record.status, 'failed');
    assert.equal(record.revision, revision, 'the tested revision is retained');
    const byKey = Object.fromEntries(record.outcomes.map((outcome: { key: string }) => [outcome.key, outcome]));
    assert.deepEqual([byKey.unit.result, byKey.unit.exitCode, byKey.unit.diagnostics, byKey.unit.command], ['failed', 3, 'unit-defect', 'printf unit-defect >&2; exit 3']);
    assert.deepEqual([byKey.lint.result, byKey.lint.exitCode, byKey.lint.diagnostics], ['failed', 4, 'lint-defect']);
    assert.equal(byKey.good.result, 'passed');
    assert.deepEqual([byKey.sonar.result, byKey.sonar.exitCode, byKey.sonar.blockedBy], ['blocked', null, ['unit']]);
    assert.equal(await observer.observeGate(GATE_BOARD_MISSION, GATE_BOARD_ATTEMPT), 'failed');

    const reader = new VerificationGateEvidenceReader({ configuration, resolveWorktree: () => checkout, integrationValidation: async () => null });
    const plan = ['unit', 'lint', 'good', 'sonar'].map(key => ({ key, command: byKey[key].command }));
    const evidence = await reader.readIntegrationGates({ repositoryId: GATE_BOARD_MISSION.repositoryId, missionId: GATE_BOARD_MISSION.id }, GATE_BOARD_ATTEMPT);
    const sonar = evidence.gates.find(gate => gate.key === 'sonar')!;
    assert.deepEqual([sonar.proof.state, sonar.failure], ['absent', null], 'a blocked part is neither a pass nor a test failure');
    assert.equal(evidence.gates.find(gate => gate.key === 'unit')!.failure?.exitCode, 3);
    assert.equal(evidence.gates.find(gate => gate.key === 'good')!.proof.state, 'current');

    const port = createIntegrationVerificationEvidencePort(configuration);
    (await port.start(checkout, plan,
      { missionId: GATE_BOARD_MISSION.id, operatorInvocation: false }))!.complete([
      { key: 'unit', command: plan[0].command, exitCode: null, result: 'cancelled', signal: 'SIGTERM' },
      { key: 'good', command: 'true', exitCode: null, result: 'cancelled' },
    ], 'cancelled');
    const cancelled = await reader.readIntegrationGates({ repositoryId: GATE_BOARD_MISSION.repositoryId, missionId: GATE_BOARD_MISSION.id }, GATE_BOARD_ATTEMPT);
    assert.deepEqual(cancelled.gates.map(gate => [gate.key, gate.proof.state, gate.failure]).filter(([key]) => key === 'unit' || key === 'good'),
      [['unit', 'absent', null], ['good', 'absent', null]], 'cancelled parts are neither passes nor failures');
  } finally { fs.rmSync(checkout, { recursive: true, force: true }); }
});
