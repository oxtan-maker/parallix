// Gate observation contract: the board's gate state is derived only from the
// verification authority and the owning workflow, never from lifecycle alone.
import test from 'node:test';
import assert from 'node:assert/strict';

import { VerificationGateObserver, combineGateStates } from '../../../../src/application/projections/gate-observation.js';
import type {
  DeclaredGateEvidence,
  GateEvidenceReader,
  IntegrationGateEvidence,
  MissionGateEvidence,
} from '../../../../src/application/ports/gate-evidence.js';
import type { Mission, MissionStatus } from '../../../../src/domain/mission.js';
import { missionId } from '../../../../src/domain/mission.js';
import { repositoryId } from '../../../../src/domain/repository.js';
import type { WorkflowCommand, WorkflowOperation, WorkflowPhase } from '../../../../src/domain/workflow-operation.js';

const GATE = './scripts/verify-local.sh all';
const LINT = 'npm run lint';
const HEAD = 'b'.repeat(40);
const EARLIER = 'a'.repeat(40);
const present = { kind: 'present', revision: HEAD, clean: true } as const;

function mission(status: MissionStatus, declaredGates: readonly string[] = [GATE]): Mission {
  return {
    id: missionId('task-2775-gate'), repositoryId: repositoryId('task-2775-repository'), title: 'Gate', labels: [],
    assignee: null, checkpoints: [], review: null, netEngineeringLines: null, status, closedAt: null, declaredGates,
  };
}

function operation(command: WorkflowCommand, phase: WorkflowPhase): WorkflowOperation {
  return {
    id: 'op-1', repositoryId: repositoryId('task-2775-repository'), missionId: missionId('task-2775-gate'), requestKey: 'k',
    command, generation: 1, phase, providerStarted: true, agent: 'claude', reviewer: null, originalStatus: 'active',
    previousAssignee: null, owner: { pid: 1, identity: 'p' }, createdAt: '2026-10-18T08:00:00.000Z', updatedAt: '2026-10-18T08:00:00.000Z', reason: null,
  };
}

const proof = (state: 'current' | 'stale', observedAt = '2026-10-18T09:00:00.000Z', revision = HEAD) => ({ state, revision, observedAt });
const failure = (state: 'current' | 'stale', observedAt = '2026-10-18T08:30:00.000Z', revision = HEAD) => ({ state, revision, observedAt, exitCode: 1 });

function gate(command: string, evidence: Partial<Omit<DeclaredGateEvidence, 'command'>> = {}): DeclaredGateEvidence {
  return { command, proof: { state: 'absent' }, failure: null, ...evidence };
}

function reader(declared: MissionGateEvidence | Error, integration: IntegrationGateEvidence | Error = new Error('not read')): GateEvidenceReader & { reads: number } {
  const evidence = {
    reads: 0,
    async readDeclaredGates() { evidence.reads += 1; if (declared instanceof Error) { throw declared; } return declared; },
    async readIntegrationGates() { evidence.reads += 1; if (integration instanceof Error) { throw integration; } return integration; },
  };
  return evidence;
}

const observe = (evidence: GateEvidenceReader, subject: Mission, owner: WorkflowOperation | null = null) =>
  new VerificationGateObserver(evidence).observeGate(subject, owner);

test('a mission with no declared gate is unconfigured without reading evidence (TASK-2775)', async () => {
  const evidence = reader(new Error('must not read'));
  assert.equal(await observe(evidence, mission('active', [])), 'unconfigured');
  assert.equal(await observe(evidence, mission('backlog', [])), 'unconfigured');
  assert.equal(evidence.reads, 0);
});

test('a just-started mission without a checkout or evidence has not run its gate (TASK-2775)', async () => {
  assert.equal(await observe(reader({ checkout: { kind: 'absent' }, gates: [] }), mission('refined')), 'not-run');
  assert.equal(await observe(reader({ checkout: present, gates: [gate(GATE)] }), mission('active')), 'not-run');
});

test('a checking workflow without executor evidence has not run its declared gates (TASK-2775)', async () => {
  const empty = reader({ checkout: present, gates: [gate(GATE)] });
  assert.equal(await observe(empty, mission('active'), operation('active:execute', 'checking')), 'not-run');
  assert.equal(await observe(empty, mission('active'), operation('handoff:record', 'checking')), 'not-run');
});

test('a recorded result outranks the still-checking workflow that produced it (TASK-2775)', async () => {
  // Handoff publishes `handoff` at entry and keeps the phase through commit and
  // publication, so the phase alone cannot say a gate is executing.
  const passed = reader({ checkout: present, gates: [gate(GATE, { proof: proof('current') })] });
  assert.equal(await observe(passed, mission('active'), operation('handoff:record', 'checking')), 'passed', 'after the result exists');
  const failed = reader({ checkout: present, gates: [gate(GATE, { failure: failure('current') })] });
  assert.equal(await observe(failed, mission('active'), operation('active:execute', 'checking')), 'failed', 'a current failure is a result');
});

test('agent work, review checks and stopped workflows never report a running gate (TASK-2775)', async () => {
  const evidence = reader({ checkout: present, gates: [gate(GATE, { proof: proof('stale') })] });
  assert.equal(await observe(evidence, mission('active'), operation('active:execute', 'running')), 'stale');
  assert.equal(await observe(evidence, mission('review'), operation('active:execute', 'checking')), 'stale');
  assert.equal(await observe(evidence, mission('review'), operation('review:submit', 'checking')), 'stale');
  assert.equal(await observe(evidence, mission('active'), operation('active:execute', 'stopping')), 'stale');
});

test('cancelled execution leaves no passing result behind (TASK-2775)', async () => {
  // The executor writes a proof only after a gate exits 0, so a cancelled run
  // leaves either nothing or the previous revision's result.
  assert.equal(await observe(reader({ checkout: present, gates: [gate(GATE)] }), mission('active'), operation('active:execute', 'stopping')), 'not-run');
  assert.equal(await observe(reader({ checkout: present, gates: [gate(GATE, { proof: proof('stale', undefined, EARLIER) })] }), mission('active')), 'stale');
});

test('no workflow phase alone implies declared gate execution (TASK-2775)', async () => {
  const empty = reader({ checkout: present, gates: [gate(GATE)] });
  for (const phase of ['accepted', 'preparing', 'running', 'blocked', 'interrupted', 'stopped', 'completed'] as const) {
    assert.equal(await observe(empty, mission('active'), { ...operation('active:execute', phase), generation: 3 }), 'not-run', phase);
  }
  assert.equal(await observe(empty, mission('active'), { ...operation('active:execute', 'checking'), generation: 3 }), 'not-run', 'checking alone is not executor evidence');
  assert.equal(await observe(empty, mission('active'), { ...operation('active:execute', 'stopping'), generation: 3 }), 'not-run', 'an interrupted attempt reports no running gate');
});

test('a current proof for every declared gate reports passed (TASK-2775)', async () => {
  const evidence = reader({ checkout: present, gates: [gate(GATE, { proof: proof('current') }), gate(LINT, { proof: proof('current') })] });
  assert.equal(await observe(evidence, mission('review', [GATE, LINT])), 'passed');
});

test('a current failure reports failed and outranks every other gate (TASK-2775)', async () => {
  assert.equal(await observe(reader({ checkout: present, gates: [gate(GATE, { failure: failure('current') })] }), mission('active')), 'failed');
  assert.equal(await observe(reader({
    checkout: present, gates: [gate(GATE, { proof: proof('current') }), gate(LINT, { failure: failure('current') })],
  }), mission('active', [GATE, LINT])), 'failed');
  // A failure recorded after the proof on the same inputs is the newer result.
  assert.equal(await observe(reader({
    checkout: present, gates: [gate(GATE, { proof: proof('current', '2026-10-18T08:00:00.000Z'), failure: failure('current', '2026-10-18T08:30:00.000Z') })],
  }), mission('active')), 'failed');
});

test('a retry that passes after a failure on the same inputs reports passed (TASK-2775)', async () => {
  assert.equal(await observe(reader({
    checkout: present, gates: [gate(GATE, { proof: proof('current', '2026-10-18T09:00:00.000Z'), failure: failure('current', '2026-10-18T08:30:00.000Z') })],
  }), mission('active')), 'passed');
});

test('prior success or failure is stale after inputs change or a repair commits (TASK-2775)', async () => {
  assert.equal(await observe(reader({ checkout: present, gates: [gate(GATE, { proof: proof('stale', undefined, EARLIER) })] }), mission('review')), 'stale');
  assert.equal(await observe(reader({ checkout: present, gates: [gate(GATE, { failure: failure('stale', undefined, EARLIER) })] }), mission('active')), 'stale');
  assert.equal(await observe(reader({
    checkout: { ...present, clean: false }, gates: [gate(GATE, { proof: proof('stale') })],
  }), mission('active')), 'stale');
});

test('partial current evidence does not pass the declared gate set (TASK-2775)', async () => {
  assert.equal(await observe(reader({ checkout: present, gates: [gate(GATE, { proof: proof('current') }), gate(LINT)] }), mission('active', [GATE, LINT])), 'not-run');
  assert.equal(await observe(reader({ checkout: present, gates: [gate(GATE, { proof: proof('current') })] }), mission('active', [GATE, LINT])), 'not-run');
});

test('read failures and a missing in-flight checkout are unavailable, not absent (TASK-2775)', async () => {
  assert.equal(await observe(reader(new Error('git unreadable')), mission('active')), 'unavailable');
  assert.equal(await observe(reader({ checkout: { kind: 'absent' }, gates: [] }), mission('active')), 'unavailable');
  assert.equal(await observe(reader({ checkout: { kind: 'absent' }, gates: [] }), mission('review')), 'unavailable');
});

test('integration observes the configured plan per gate, never the workflow phase (TASK-2775)', async () => {
  const unused = { checkout: { kind: 'absent' } as const, gates: [] };
  const plan = (keys: readonly string[], overrides: Partial<IntegrationGateEvidence> = {}) =>
    reader(unused, { checkout: present, configured: keys, gates: keys.map(key => ({ key, proof: { state: 'absent' as const }, failure: null })), running: null, ...overrides });
  const pass = (key: string, state: 'current' | 'stale' = 'current') => ({ key, proof: proof(state), failure: null });
  const fail = (key: string, state: 'current' | 'stale' = 'current') => ({ key, proof: { state: 'absent' as const }, failure: failure(state) });
  assert.equal(await observe(plan([]), mission('integration')), 'unconfigured', 'no configured plan');
  assert.equal(await observe(plan([]), mission('active'), operation('integrate:merge', 'checking')), 'unconfigured', 'an integration attempt selects its plan before the lane moves');
  assert.equal(await observe(plan(['unit']), mission('integration'), operation('integrate:merge', 'checking')), 'not-run',
    'integrate is checking but no gate run is observed');
  assert.equal(await observe(plan(['unit', 'docs'], { gates: [pass('unit')] }), mission('integration')), 'not-run',
    'a marker covering one hook of a two-hook plan does not pass the plan');
  assert.equal(await observe(plan(['unit', 'docs'], { gates: [pass('unit'), pass('docs')] }), mission('integration')), 'passed');
  assert.equal(await observe(plan(['unit'], { gates: [fail('unit')] }), mission('integration'), operation('integrate:merge', 'checking')), 'failed',
    'a failed run does not stay running');
  assert.equal(await observe(plan(['unit'], { gates: [pass('unit', 'stale')] }), mission('integration')), 'stale', 'a prior success after inputs changed');
  assert.equal(await observe(plan(['unit'], { running: { attempt: 'op-1:1', startedAt: '2026-10-18T09:00:00.000Z' } }), mission('integration'),
    operation('integrate:merge', 'checking')), 'running', 'the executor records a run for the open attempt');
  assert.equal(await observe(plan(['unit']), mission('done')), 'not-run');
  assert.equal(await observe(plan(['unit'], { checkout: { kind: 'absent' } }), mission('done')), 'unavailable');
  assert.equal(await observe(reader(unused, new Error('history unavailable')), mission('integration')), 'unavailable');
});

test('combined gate states rank failure over staleness over absence over success (TASK-2775)', () => {
  assert.equal(combineGateStates(['passed', 'stale', 'failed']), 'failed');
  assert.equal(combineGateStates(['passed', 'not-run', 'stale']), 'stale');
  assert.equal(combineGateStates(['passed', 'not-run']), 'not-run');
  assert.equal(combineGateStates(['passed', 'passed']), 'passed');
  assert.equal(combineGateStates([]), 'not-run');
});
