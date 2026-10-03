// web-command-request — pure unit coverage of the browser-to-host mutation
// envelope (TASK-2433, ADR 0055). No sockets, no adapters, no clock: the
// validator is a pure fail-closed function in the transport contract module.

import test from 'node:test';
import assert from 'node:assert/strict';
import { validateWebCommandRequest } from '../src/interfaces/web/transport.js';
import type { WebCommandRequest } from '../src/interfaces/web/transport.js';

function identityRequest(kind: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    missionId: 'task-2433',
    kind,
    missionStatusAtRequest: 'active',
    ...overrides,
  };
}

function handoffPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    netEngineeringLines: 120,
    capturedAt: '2026-08-28T00:00:00.000Z',
    ...overrides,
  };
}

function problems(result: ReturnType<typeof validateWebCommandRequest>): string[] {
  assert.equal(result.ok, false, `expected a rejection, got ${JSON.stringify(result)}`);
  return result.ok ? [] : [...result.problems];
}

test('web command request: accepts a well-formed identity-only request for each of the five card-advertised kinds', () => {
  for (const kind of ['active:execute', 'draft:create', 'integrate:merge', 'handoff:record', 'review:submit']) {
    const result = validateWebCommandRequest(identityRequest(kind));
    assert.equal(result.ok, true, `${kind} must be accepted: ${JSON.stringify(result)}`);
    assert.ok(result.ok);
    assert.deepEqual(result.value, {
      missionId: 'task-2433',
      kind,
      missionStatusAtRequest: 'active',
    });
  }
});

test('web command request: accepts a well-formed handoff:record request with the full payload', () => {
  const result = validateWebCommandRequest(identityRequest('handoff:record', {
    payload: handoffPayload({
      predictedBucket: 'Medium',
      artifacts: [
        { kind: 'file', location: 'src/x.ts', byteSize: 1234 },
        { kind: 'git-range', location: 'a..b', byteSize: null },
        { kind: 'url', location: 'https://example.invalid/log', byteSize: 7 },
      ],
      reviewRounds: 2,
    }),
  }));
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.ok(result.ok);
  assert.deepEqual(result.value, {
    missionId: 'task-2433',
    kind: 'handoff:record',
    missionStatusAtRequest: 'active',
    payload: {
      netEngineeringLines: 120,
      predictedBucket: 'Medium',
      capturedAt: '2026-08-28T00:00:00.000Z',
      artifacts: [
        { kind: 'file', location: 'src/x.ts', byteSize: 1234 },
        { kind: 'git-range', location: 'a..b', byteSize: null },
        { kind: 'url', location: 'https://example.invalid/log', byteSize: 7 },
      ],
      reviewRounds: 2,
    },
  } satisfies WebCommandRequest);
});

test('web command request: rejects every unknown top-level key, including the forbidden client-side controls', () => {
  for (const key of ['operationId', 'capabilities', 'agent', 'command', 'args', 'env', 'path', 'file', 'sql', 'ref', 'currentStatus', 'expectedVersion']) {
    const result = validateWebCommandRequest(identityRequest('active:execute', { [key]: 'forged' }));
    assert.ok(!result.ok, `${key} must be rejected as an unknown top-level key`);
    assert.ok(problems(result).some(problem => problem.includes(key)), `${key} rejection must name the key`);
  }
});

test('web command request: rejects each kind that is not card-advertised, and any unknown kind', () => {
  for (const kind of ['mission:intake', 'checkpoint:record', 'approve:review', 'review:act-on-findings', 'board:nuke', '']) {
    const result = validateWebCommandRequest(identityRequest(kind));
    assert.ok(!result.ok, `${kind} must be rejected as an unsupported kind`);
    assert.ok(problems(result).some(problem => problem.includes('kind')), `${kind} rejection must name the kind`);
  }
});

test('web command request: rejects missing or mistyped required fields', () => {
  const missing = { kind: 'active:execute', missionStatusAtRequest: 'active' };
  assert.ok(!validateWebCommandRequest(missing).ok, 'a missing missionId must be rejected');
  for (const [key, value] of [['missionId', 42], ['kind', 42], ['missionStatusAtRequest', null]] as const) {
    const result = validateWebCommandRequest(identityRequest('active:execute', { [key]: value }));
    assert.ok(!result.ok, `${key} of the wrong type must be rejected`);
  }
  const emptyId = validateWebCommandRequest(identityRequest('active:execute', { missionId: '' }));
  assert.ok(!emptyId.ok, 'an empty missionId must be rejected');
  for (const body of [null, 5, 'active:execute', [], [1, 2]]) {
    assert.ok(!validateWebCommandRequest(body).ok, `a non-object body must be rejected: ${String(body)}`);
  }
});

test('web command request: rejects a payload key on every identity-only kind', () => {
  for (const kind of ['active:execute', 'draft:create', 'integrate:merge', 'review:submit']) {
    const result = validateWebCommandRequest(identityRequest(kind, { payload: handoffPayload() }));
    assert.ok(!result.ok, `payload on ${kind} must be rejected`);
    assert.ok(problems(result).some(problem => problem.includes('payload')), `${kind} rejection must name the payload key`);
  }
});

test('web command request: rejects a null or non-object handoff payload', () => {
  for (const payload of [null, 5, 'nope', ['nope']]) {
    const result = validateWebCommandRequest(identityRequest('handoff:record', { payload }));
    assert.ok(!result.ok, `a non-object handoff payload must be rejected: ${String(payload)}`);
  }
});

test('web command request: rejects handoff payloads with missing, mistyped, or out-of-range fields', () => {
  const cases: { name: string; payload: Record<string, unknown> }[] = [
    { name: 'missing netEngineeringLines', payload: handoffPayload({ netEngineeringLines: undefined }) as Record<string, unknown> },
    { name: 'missing capturedAt', payload: handoffPayload({ capturedAt: undefined }) as Record<string, unknown> },
    { name: 'negative netEngineeringLines', payload: handoffPayload({ netEngineeringLines: -1 }) },
    { name: 'non-finite netEngineeringLines', payload: handoffPayload({ netEngineeringLines: Infinity }) },
    { name: 'string netEngineeringLines', payload: handoffPayload({ netEngineeringLines: '120' }) },
    { name: 'null capturedAt', payload: handoffPayload({ capturedAt: null }) },
    { name: 'non-string capturedAt', payload: handoffPayload({ capturedAt: 1234 }) },
    { name: 'predictedBucket null', payload: handoffPayload({ predictedBucket: null }) },
    { name: 'predictedBucket Unknown', payload: handoffPayload({ predictedBucket: 'Unknown' }) },
    { name: 'predictedBucket lowercase', payload: handoffPayload({ predictedBucket: 'large' }) },
    { name: 'non-array artifacts', payload: handoffPayload({ artifacts: 'x' }) },
    { name: 'artifact without kind', payload: handoffPayload({ artifacts: [{ location: 'a', byteSize: 1 }] }) },
    { name: 'artifact without location', payload: handoffPayload({ artifacts: [{ kind: 'file', byteSize: 1 }] }) },
    { name: 'artifact without byteSize', payload: handoffPayload({ artifacts: [{ kind: 'file', location: 'a' }] }) },
    { name: 'artifact unknown kind', payload: handoffPayload({ artifacts: [{ kind: 'blob', location: 'a', byteSize: 1 }] }) },
    { name: 'artifact non-finite byteSize', payload: handoffPayload({ artifacts: [{ kind: 'file', location: 'a', byteSize: Infinity }] }) },
    { name: 'artifact string location', payload: handoffPayload({ artifacts: [{ kind: 'file', location: 9, byteSize: 1 }] }) },
    { name: 'artifact extra key', payload: handoffPayload({ artifacts: [{ kind: 'file', location: 'a', byteSize: 1, content: 'x' }] }) },
    { name: 'negative reviewRounds', payload: handoffPayload({ reviewRounds: -1 }) },
    { name: 'fractional reviewRounds', payload: handoffPayload({ reviewRounds: 1.5 }) },
    { name: 'null reviewRounds', payload: handoffPayload({ reviewRounds: null }) },
    { name: 'handoff payload extra key', payload: handoffPayload({ expectedVersion: 3 }) },
  ];
  for (const { name, payload } of cases) {
    const result = validateWebCommandRequest(identityRequest('handoff:record', { payload }));
    assert.ok(!result.ok, `${name} must be rejected: ${JSON.stringify(result)}`);
    assert.ok(problems(result).length > 0, `${name} must report at least one problem`);
  }
});

test('web command request: accepts a zero-line handoff payload with null byteSize and no optional keys', () => {
  const result = validateWebCommandRequest(identityRequest('handoff:record', {
    payload: handoffPayload({ netEngineeringLines: 0, artifacts: [{ kind: 'url', location: 'u', byteSize: null }] }),
  }));
  assert.equal(result.ok, true, JSON.stringify(result));
});
