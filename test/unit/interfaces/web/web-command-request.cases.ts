// web-command-request — pure unit coverage of the browser-to-host mutation
// envelope (TASK-2433, ADR 0055). No sockets, no adapters, no clock: the
// validator is a pure fail-closed function in the transport contract module.

import test from 'node:test';
import assert from 'node:assert/strict';
import { isCreateMissionBody, validateWebCommandRequest, validateWebCreateMissionRequest } from '../../../../src/interfaces/web/transport.js';
import type { WebCommandRequest } from '../../../../src/interfaces/web/transport.js';

function identityRequest(kind: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    requestKey: 'delivery',
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
      requestKey: 'delivery',
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
    requestKey: 'delivery',
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
  for (const key of ['operationId', 'capabilities', 'command', 'args', 'env', 'path', 'file', 'sql', 'ref', 'currentStatus', 'expectedVersion']) {
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

test('web create-mission request: accepts the planning fields only and recognises its own kind (TASK-2693)', () => {
  const body = { kind: 'mission:create', requestKey: 'k', title: 'T', description: 'D', context: 'C', labels: [], successCriteria: ['x'], dependencies: ['task-1'] };
  assert.equal(isCreateMissionBody(body), true);
  assert.equal(isCreateMissionBody(identityRequest('active:execute')), false);
  const accepted = validateWebCreateMissionRequest(body);
  assert.ok(accepted.ok);
  assert.deepEqual(accepted.value, body);
  const { description: _d, context: _c, ...minimal } = body;
  assert.ok(validateWebCreateMissionRequest(minimal).ok);
});

test('web create-mission request: rejects identity, repository and status keys and mistyped fields (TASK-2693)', () => {
  const base = { kind: 'mission:create', requestKey: 'k', title: 'T', labels: [], successCriteria: [], dependencies: [] };
  for (const extra of [{ missionId: 'x' }, { repositoryId: 'r' }, { status: 'active' }, { capabilities: [] }, { title: 3 }, { labels: 'ux' }, { dependencies: [1] }, { requestKey: 'k'.repeat(129) }]) {
    assert.equal(validateWebCreateMissionRequest({ ...base, ...extra }).ok, false, JSON.stringify(extra));
  }
  assert.equal(validateWebCreateMissionRequest([]).ok, false);
  const { title: _t, ...untitled } = base;
  assert.equal(validateWebCreateMissionRequest(untitled).ok, false);
});

// Complete planning replacement is a separate typed envelope from lifecycle commands.
import { validateWebEditMissionRequest } from '../../../../src/interfaces/web/transport-edit-mission.js';
test('web edit request accepts opaque identity and complete removals, rejects lifecycle keys and missing version (TASK-2702)', () => {
  const body = { kind: 'mission:edit', missionId: 'supplied-identity-1', expectedVersion: 2,
    title: 'Revised', description: '', context: '', labels: [], successCriteria: [], dependencies: [] };
  assert.equal(validateWebEditMissionRequest(body).ok, true);
  assert.equal(validateWebEditMissionRequest({ ...body, successCriteria: ['edited', 'new'], successCriterionIds: ['sc-1', null] }).ok, true);
  for (const successCriterionIds of [[1], [''], 'sc-1']) { assert.equal(validateWebEditMissionRequest({ ...body, successCriterionIds }).ok, false); }
  assert.equal(validateWebEditMissionRequest({ kind: 'mission:edit-read', missionId: 'px-1234' }).ok, true);
  for (const patch of [{ expectedVersion: undefined }, { expectedVersion: 0 }, { expectedVersion: 1.5 }, { status: 'active' }, { assignee: 'codex' }, { dependencies: 'x' }, { description: null }]) {
    assert.equal(validateWebEditMissionRequest({ ...body, ...patch }).ok, false);
  }
});

test('workflow command requests require a nonblank retry key (TASK-2750)', () => {
  for (const kind of ['active:execute', 'draft:create', 'integrate:merge', 'handoff:record', 'review:submit']) {
    for (const requestKey of [undefined, '', '   ', '\t']) {
      assert.equal(validateWebCommandRequest(identityRequest(kind, { requestKey })).ok, false, `${kind}: ${String(requestKey)}`);
    }
  }
  for (const kind of ['workflow:stop', 'mission:cancel']) {
    assert.equal(validateWebCommandRequest(identityRequest(kind, { requestKey: undefined })).ok, true);
  }
});


test('web command request: explicit launch families are accepted only on eligible action kinds', () => {
  for (const kind of ['draft:create', 'active:execute', 'review:submit']) {
    const result = validateWebCommandRequest(identityRequest(kind, { agent: 'custom-family' }));
    assert.ok(result.ok);
    assert.equal(result.value.agent, 'custom-family');
    assert.equal(validateWebCommandRequest(identityRequest(kind)).ok, true);
    for (const agent of [null, 5, '', 'Codex', 'codex --unsafe', ' codex']) {
      assert.equal(validateWebCommandRequest(identityRequest(kind, { agent })).ok, false);
    }
  }
  for (const kind of ['workflow:stop', 'mission:cancel', 'handoff:record', 'integrate:merge']) {
    assert.equal(validateWebCommandRequest(identityRequest(kind, { agent: 'codex' })).ok, false);
  }
});


test('web launch route checks server family availability before admitting explicit requests', async () => {
  const { registerCommandRoute } = await import('../../../../src/interfaces/web/command-route.js');
  const { makeProjection } = await import('../../../fixtures/board-projection.js');
  const { agentFamily } = await import('../../../../src/domain/agents.js');
  type Handler = (request: { body: unknown }, reply: unknown) => Promise<unknown>;
  let handler: Handler;
  let available = true;
  const admitted: import('../../../../src/application/controller/board-command.js').BoardCommandRequest[] = [];
  const app = { post(_path: string, callback: Handler) { handler = callback; } };
  const dispatcher = { canExecute: () => true, async dispatch() { throw new Error('unexpected synchronous dispatch'); },
    async admit(request: typeof admitted[number]) { admitted.push(request); return { status: 'failed' as const, error: { kind: 'unavailable' as const, message: 'fixture accepted input' }, durableEvidence: [] }; } };
  registerCommandRoute(app as unknown as import('fastify').FastifyInstance, { commandDispatcher: () => dispatcher }, async () => {
    const projection = makeProjection();
    return { ...projection, metrics: { ...projection.metrics, agentAvailability: [{ family: agentFamily('custom-family'), available, blockedForMs: 0 }] } };
  });
  const reply = { status: 0, body: undefined as unknown, code(status: number) { this.status = status; return this; }, type() { return this; }, send(body: unknown) { this.body = body; return this; } };
  for (const kind of ['draft:create', 'active:execute', 'review:submit']) {
    await handler!({ body: identityRequest(kind, { agent: 'custom-family' }) }, reply);
    assert.equal(admitted.at(-1)?.agent, 'custom-family');
    assert.equal(admitted.at(-1)?.pinnedAgent, true);
  }
  assert.equal(admitted.length, 3);
  available = false;
  for (const agent of ['custom-family', 'unknown']) {
    await handler!({ body: identityRequest('active:execute', { agent }) }, reply);
    assert.equal(reply.status, 409);
    assert.match(JSON.stringify(reply.body), /unknown or unavailable/);
  }
  assert.equal(admitted.length, 3);
  await handler!({ body: identityRequest('active:execute') }, reply);
  assert.equal(admitted.length, 4);
  assert.equal(admitted.at(-1)?.agent, undefined);
  assert.equal(admitted.at(-1)?.pinnedAgent, undefined);
});
