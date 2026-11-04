// TASK-2343: regression assertions routed to their owning write/read contract.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { GATE_RESULT_RELATIVE_PATH, recordGateResult } from '../../../../src/adapters/verification/verification.js';
import { mkdtemp as registeredMkdtemp } from '../../../helpers/temp-dir.js';
import { createVerificationObservation } from '../../../../src/composition/verification-observation.js';
import { configureVerificationObservation, type VerificationMeasurement } from '../../../../src/application/ports/verification-observation.js';
import type { OperationalHistoryEntry, OperationalHistoryRepository } from '../../../../src/application/ports/operation-history.js';
import { runPhaseGates } from '../../../../src/adapters/config/repository-gates.js';

test('recordGateResult writes the exit code and derives the status from it', () => {
  const missionDir = registeredMkdtemp('px-gate-');
  try {
    const record = recordGateResult(missionDir, {
      area: 'all', command: './scripts/verify-local.sh all', exitCode: 0,
    });
    assert.ok(record);
    assert.equal(record!.status, 'passed');
    assert.equal(record!.exitCode, 0);

    const written = JSON.parse(fs.readFileSync(path.join(missionDir, GATE_RESULT_RELATIVE_PATH), 'utf8'));
    assert.equal(written.exitCode, 0);
    assert.equal(written.command, './scripts/verify-local.sh all');

    const failing = recordGateResult(missionDir, {
      area: 'all', command: './scripts/verify-local.sh all', exitCode: 1,
    });
    assert.equal(failing!.status, 'failed');
  } finally {
    fs.rmSync(missionDir, { recursive: true, force: true });
  }
});

test('a null gate exit code is recorded as failed, never as passed', () => {
  const missionDir = registeredMkdtemp('px-gate-');
  try {
    const record = recordGateResult(missionDir, { area: 'all', command: 'gate', exitCode: null });
    assert.equal(record!.status, 'failed');
  } finally {
    fs.rmSync(missionDir, { recursive: true, force: true });
  }
});

function observations() {
  const entries: OperationalHistoryEntry[] = [];
  const history = { append: async (entry: OperationalHistoryEntry) => { entries.push(entry); } } as OperationalHistoryRepository;
  const port = createVerificationObservation(history, () => ({ repositoryId: 'repo', missionId: 'px-1', revision: 'revision' }));
  return { port, values: () => entries.map(entry => JSON.parse(entry.eventData) as VerificationMeasurement) };
}

test('attempt starts precede execution and repeated terminals retain identity and missing CPU (px-0025)', async () => {
  const { port, values } = observations();
  configureVerificationObservation(port);
  try {
    let executions = 0;
    // EX_TEMPFAIL supplies infrastructure identity; diagnostic text alone does not.
    for (const status of [75, 1, 0]) {
      await runPhaseGates('handoff', { slug: 'px-1', checkoutPath: '.',
        gates: [{ key: 'check', command: 'check', order: 0 }], log: () => {}, error: () => {},
        commandRunner: () => {
          assert.equal(values().at(-1)?.result, 'running');
          assert.ok(values().at(-1)?.startedAt);
          executions++;
          return { status, stdout: '', stderr: status ? 'connection refused' : '' };
        } });
    }
    assert.equal(executions, 3);
    const terminals = values().filter(value => value.finishedAt);
    assert.equal(terminals.length, 3);
    assert.equal(new Set(terminals.map(value => value.id)).size, 3);
    assert.deepEqual(terminals.map(value => value.result), ['failed', 'failed', 'passed']);
    assert.equal(terminals[0].failureReason?.code, 'infrastructure');
    assert.equal(terminals[1].failureReason?.code, 'gate-failed');
    assert.deepEqual(terminals.map(value => value.cpu), [null, null, null]);
    assert.equal(terminals[0].repositoryId, 'repo');
    assert.equal(terminals[0].missionId, 'px-1');
    assert.equal(terminals[0].revision, 'revision');
    assert.equal(terminals[0].operationId, null);
    assert.equal(terminals[2].failureReason, null);
    assert.equal(terminals[2].profile, null);
  } finally { configureVerificationObservation(null); }
});

test('zero CPU, proof reuse and incomplete starts remain distinct (px-0025)', async () => {
  const { port, values } = observations();
  const input = { root: '.', mission: 'px-1', batchId: 'batch', gate: 'gate', command: 'check', phase: 'review', after: [] };
  const incomplete = await port.begin(input);
  await incomplete!.started();
  const measured = await port.begin(input);
  await measured!.started();
  await measured!.complete({ result: 'passed', failureReason: null, exitCode: 0, wallMs: 0,
    cpu: { userUs: 0, systemUs: 0, provenance: 'bash-time-waited-tree', boundary: 'tree', parent: null } });
  const reused = await port.begin(input);
  await reused!.complete({ result: 'reused', failureReason: null, exitCode: 0, wallMs: null, cpu: null });
  assert.equal(values()[1].finishedAt, null);
  assert.equal(values()[1].cpu, null);
  assert.equal(values().find(value => value.cpu !== null)?.cpu?.userUs, 0);
  assert.equal(values().at(-1)?.startedAt, null);
  assert.equal(values().at(-1)?.result, 'reused');
});

test('fresh gate observations retain workflow generation and source joins (TASK-2835)', async () => {
  const entries: OperationalHistoryEntry[] = [];
  const history = { append: async (entry: OperationalHistoryEntry) => { entries.push(entry); } } as OperationalHistoryRepository;
  const operation = { id: 'operation-1', generation: 4, sourceId: 'run-7' };
  const port = createVerificationObservation(history,
    () => ({ repositoryId: 'repo', missionId: 'px-1', revision: 'revision' }), undefined,
    () => operation as never);
  const observation = await port.begin({ root: '.', mission: 'px-1', batchId: 'batch-2', gate: 'check', command: 'check',
    phase: 'pre-review', after: [], plan: ['check'] });
  await observation!.started();
  await observation!.complete({ result: 'passed', failureReason: null, exitCode: 0, wallMs: 1, cpu: null });
  const value = JSON.parse(entries.at(-1)!.eventData) as VerificationMeasurement & {
    operationGeneration?: number; sourceId?: string;
  };
  assert.equal(value.operationId, 'operation-1');
  assert.equal(value.operationGeneration, 4);
  assert.equal(value.sourceId, 'run-7');
});

test('durable gate history links configured predecessors and failed cross-batch reruns after restart (TASK-2835)', async () => {
  const entries: OperationalHistoryEntry[] = [];
  const history = {
    append: async (entry: OperationalHistoryEntry) => { entries.push(entry); },
    findByType: async () => entries,
    findAll: async () => entries,
    clear: async () => { entries.length = 0; },
  } as OperationalHistoryRepository;
  const identity = () => ({ repositoryId: 'repo', missionId: 'px-1', revision: 'revision' });
  const operation = () => ({ id: 'operation-1', generation: 2, sourceId: 'run-2' });
  const first = createVerificationObservation(history, identity, undefined, operation);
  const failed = await first.begin({ root: '.', mission: 'px-1', batchId: 'batch-1', gate: 'compile', command: 'compile', phase: 'pre-review', after: [] });
  await failed!.started();
  await failed!.complete({ result: 'failed', failureReason: { version: 1, code: 'gate-failed' }, exitCode: 1, wallMs: 1, cpu: null });
  const failedId = (JSON.parse(entries.at(-1)!.eventData) as VerificationMeasurement).id;

  // A new port instance models process restart; only retained history carries the dependency.
  const resumed = createVerificationObservation(history, identity, undefined, operation);
  const rerun = await resumed.begin({ root: '.', mission: 'px-1', batchId: 'batch-2', gate: 'compile', command: 'compile', phase: 'pre-review', after: [] });
  await rerun!.started();
  await rerun!.complete({ result: 'passed', failureReason: null, exitCode: 0, wallMs: 1, cpu: null });
  const rerunValue = JSON.parse(entries.at(-1)!.eventData) as VerificationMeasurement;
  assert.deepEqual(rerunValue.dependencies, [failedId]);

  const packageGate = await resumed.begin({ root: '.', mission: 'px-1', batchId: 'batch-2', gate: 'package', command: 'package', phase: 'pre-review', after: ['compile'] });
  const packageValue = JSON.parse(entries.at(-1)!.eventData) as VerificationMeasurement;
  assert.deepEqual(packageValue.dependencies, [rerunValue.id]);
  await packageGate!.complete({ result: 'reused', failureReason: null, exitCode: 0, wallMs: null, cpu: null });
});
