import test from 'node:test';
import assert from 'node:assert/strict';
import { verificationStatistics } from '../../../../src/application/projections/verification-statistics.js';
import { advanceExecutionActivity } from '../../../../src/domain/execution-activity.js';
import { parseExecutionActivityEntry } from '../../../../src/application/recording/execution-activity-recorder.js';
import { repositoryId } from '../../../../src/domain/repository.js';
import { missionId } from '../../../../src/domain/mission.js';
import type { WorkflowOperation } from '../../../../src/domain/workflow-operation.js';

// Same-millisecond boundaries are ordered by durable operational-history ids
// only when every tied row carries one; otherwise the order is unprovable and
// must not create owned time (PX-0055.02).
const instant = (ms: number) => new Date(Date.UTC(2026, 10, 2) + ms).toISOString();
const history = (ms: number, id: number | undefined, eventType: string, data: object) => ({ ...(id === undefined ? {} : { id }), eventType,
  createdAt: instant(ms), eventData: JSON.stringify({ repositoryId: 'repo', missionId: 'px-1', ...data }) });
const work = (state: string, phase = 'recovery', actor = 'lead') => ({ operationId: 'lead-op', operationGeneration: null, sourceId: 'lead-op',
  dependencies: [], revision: 'rev', phase, state, actor, model: null, timeState: 'working' });
type Move = [from: string, to: string, ms: number, key: string, id?: number];
const lifecycle = (moves: Move[]) => moves.map(([fromStatus, toStatus, ms, idempotencyKey, id]) => ({ ...(id === undefined ? {} : { id }),
  repositoryId: 'repo', missionId: 'px-1', fromStatus, toStatus, occurredAt: instant(ms), trigger: 'move', agent: 'human', idempotencyKey }));
const owned = (report: ReturnType<typeof verificationStatistics>) => report.elapsedOwnership?.rows.filter(value => value.step !== 'unexplained');
const completedOperation = (id: string, mission = 'px-1', generation = 1): WorkflowOperation => ({
  id, repositoryId: repositoryId('repo'), missionId: missionId(mission), requestKey: id, command: 'active:execute',
  generation, phase: 'completed', providerStarted: true, agent: null, reviewer: null, originalStatus: 'active',
  previousAssignee: null, owner: null, createdAt: instant(0), updatedAt: instant(10), reason: null,
});

test('a resumed parent closes its child in historical ownership as in the activity owner (PX-0055.02)', () => {
  const publication = (ms: number, id: number, sourceId: string, state: string, actor: string) => history(ms, id, 'mission.current-work', {
    operationId: 'op', operationGeneration: 1, sourceId, dependencies: sourceId === 'child' ? ['parent'] : [],
    revision: 'rev', phase: 'execute', state, actor, model: null, timeState: 'working',
  });
  const events = [publication(1, 1, 'parent', 'running', 'parallix'), publication(2, 2, 'child', 'running', 'codex'),
    publication(3, 3, 'parent', 'running', 'parallix'), publication(8, 4, 'child', 'ended', 'codex'),
    publication(9, 5, 'parent', 'ended', 'parallix')];
  let snapshot = advanceExecutionActivity(null, parseExecutionActivityEntry(events[0]!)!, 'parent');
  snapshot = advanceExecutionActivity(snapshot, parseExecutionActivityEntry(events[1]!)!, 'child');
  snapshot = advanceExecutionActivity(snapshot, parseExecutionActivityEntry(events[2]!)!, 'parent');
  assert.deepEqual(snapshot?.closedSources, ['child']);
  const report = verificationStatistics({ repositoryId: 'repo', operations: [], history: events,
    lifecycle: lifecycle([['backlog', 'refined', 0, 'refined', 1], ['integration', 'done', 10, 'done', 2]]) });
  assert.deepEqual(owned(report)?.map(row => [row.step, row.durationMs]), [['preparation', 1], ['implement', 1], ['preparation', 6]]);
  assert.equal(report.elapsedOwnership?.unexplainedMs, 2);
});

test('a closed activity source cannot reopen through an ignored audit publication (PX-0055.02)', () => {
  const publication = (ms: number, id: number, state: string) => history(ms, id, 'mission.current-work',
    { ...work(state, 'execute', 'codex'), operationGeneration: 1 });
  const report = verificationStatistics({ repositoryId: 'repo', operations: [],
    lifecycle: lifecycle([['backlog', 'refined', 0, 'refined', 1], ['integration', 'done', 10, 'done', 2]]),
    history: [publication(1, 1, 'running'), publication(3, 2, 'ended'), publication(5, 3, 'running'), publication(9, 4, 'ended')] });
  assert.deepEqual(owned(report)?.map(row => [row.actor, row.durationMs]), [['codex', 2]]);
  assert.equal(report.elapsedOwnership?.unexplainedMs, 8);
});

test('a superseded operation never regains elapsed ownership after its replacement ends (PX-0055.02)', () => {
  const publication = (ms: number, id: number, operationId: string, state: string, actor: string) =>
    history(ms, id, 'mission.current-work', { ...work(state, 'execute', actor), operationId,
      sourceId: operationId, operationGeneration: 1 });
  const report = verificationStatistics({ repositoryId: 'repo', operations: [],
    lifecycle: lifecycle([['backlog', 'refined', 0, 'refined', 1], ['integration', 'done', 10, 'done', 2]]), history: [
      publication(1, 1, 'old', 'running', 'codex'), publication(3, 2, 'new', 'running', 'lead'),
      publication(5, 3, 'new', 'ended', 'lead'), publication(7, 4, 'old', 'running', 'codex'),
      publication(9, 5, 'old', 'ended', 'codex')] });
  assert.deepEqual(owned(report)?.map(row => [row.actor, row.durationMs]), [['codex', 2], ['lead', 2]]);
  assert.equal(report.elapsedOwnership?.unexplainedMs, 6);
});

test('an audit publication rejected by the admitted activity owner receives no elapsed ownership (PX-0055.02 F13)', () => {
  const publication = (ms: number, id: number, operationId: string, state: string, actor: string, ownerAccepted: boolean) =>
    history(ms, id, 'mission.current-work', { ...work(state, 'execute', actor), operationId,
      sourceId: operationId, operationGeneration: 1, ownerAccepted });
  const report = verificationStatistics({ repositoryId: 'repo', operations: [],
    lifecycle: lifecycle([['backlog', 'refined', 0, 'refined', 1], ['integration', 'done', 10, 'done', 2]]), history: [
      publication(1, 1, 'admitted', 'running', 'codex', true),
      publication(3, 2, 'rejected', 'running', 'custom', false),
      publication(5, 3, 'rejected', 'ended', 'custom', false),
      publication(8, 4, 'admitted', 'ended', 'codex', true),
    ] });
  assert.deepEqual(owned(report)?.map(row => [row.actor, row.durationMs]), [['codex', 7]],
    'audit-only publications cannot replace the admitted activity owner');
  assert.equal(report.elapsedOwnership?.unexplainedMs, 3);
});

test('pre-flag superseded audit publications create neither finalization nor an operation handoff (PX-0055.02 F15)', () => {
  const publication = (ms: number, id: number, operationId: string, state: string, actor: string,
    summary?: string) => history(ms, id, 'mission.current-work', {
    ...work(state, 'execute', actor), operationId, sourceId: operationId, operationGeneration: 1,
    ...(summary === undefined ? {} : { summary }),
  });
  const finalization = verificationStatistics({ repositoryId: 'repo', operations: [],
    lifecycle: lifecycle([['backlog', 'refined', 0, 'refined', 1], ['integration', 'done', 10, 'done', 2]]), history: [
      publication(1, 1, 'old', 'running', 'codex'),
      publication(2, 2, 'replacement', 'running', 'custom'),
      publication(3, 3, 'replacement', 'ended', 'custom'),
      publication(4, 4, 'old', 'ended', 'codex'),
      publication(8, 5, 'old', 'ended', 'parallix', 'workflow completed'),
    ] });
  assert.deepEqual(owned(finalization)?.map(row => [row.step, row.actor, row.durationMs]), [
    ['implement', 'codex', 1], ['implement', 'custom', 1],
  ], 'a legacy audit terminal rejected by replay cannot manufacture Parallix finalization');
  assert.equal(finalization.elapsedOwnership?.unexplainedMs, 8);

  const handoff = verificationStatistics({ repositoryId: 'repo', operations: [],
    lifecycle: lifecycle([['backlog', 'refined', 0, 'refined', 1], ['integration', 'done', 10, 'done', 2]]), history: [
      publication(1, 1, 'old', 'running', 'codex'),
      publication(2, 2, 'replacement', 'running', 'custom'),
      publication(3, 3, 'replacement', 'ended', 'custom'),
      publication(4, 4, 'old', 'ended', 'parallix', 'workflow completed'),
      publication(8, 5, 'later', 'running', 'codex'),
    ] });
  assert.ok(!owned(handoff)?.some(row => row.step === 'responsibility-handoff'),
    'a legacy audit terminal rejected by replay cannot open an external handoff');
  assert.equal(handoff.elapsedOwnership?.unexplainedMs, 6);
});

test('workflow lifecycle authorization, not activity acceptance, owns completion boundaries (PX-0055.02 H115)', () => {
  const publication = (ms: number, id: number, operationId: string, state: string, actor: string,
    summary?: string) => history(ms, id, 'mission.current-work', {
    ...work(state, 'execute', actor), operationId, sourceId: operationId, operationGeneration: 1,
    ...(summary === undefined ? {} : { summary }),
  });
  const input = { repositoryId: 'repo',
    lifecycle: lifecycle([['backlog', 'refined', 0, 'refined', 1], ['integration', 'done', 10, 'done', 2]]), history: [
      publication(1, 1, 'op-1', 'running', 'codex'),
      publication(2, 2, 'op-1', 'ended', 'codex'),
      publication(4, 3, 'op-1', 'ended', 'parallix', 'workflow completed'),
      publication(7, 4, 'op-2', 'running', 'custom'),
      publication(9, 5, 'op-2', 'ended', 'custom'),
    ] };
  const report = verificationStatistics({ ...input,
    operations: [completedOperation('op-1'), completedOperation('op-2')] });
  assert.deepEqual(owned(report)?.map(row => [row.step, row.actor, row.durationMs]), [
    ['implement', 'codex', 1], ['preparation', 'parallix', 2],
    ['responsibility-handoff', 'external', 3], ['implement', 'custom', 2],
  ], 'the completed workflow operation authorizes its terminal after the activity source closes');
  assert.equal(report.elapsedOwnership?.unexplainedMs, 2);

  const unavailable = verificationStatistics({ ...input, operations: [completedOperation('op-2')] });
  assert.deepEqual(owned(unavailable)?.map(row => [row.step, row.actor, row.durationMs]), [
    ['implement', 'codex', 1], ['implement', 'custom', 2],
  ], 'an audit summary without its durable workflow operation owns no completion boundary');
  assert.equal(unavailable.elapsedOwnership?.unexplainedMs, 7);

  const wrongGeneration = verificationStatistics({ ...input,
    operations: [completedOperation('op-1', 'px-1', 2), completedOperation('op-2')] });
  assert.deepEqual(owned(wrongGeneration)?.map(row => [row.step, row.actor, row.durationMs]), [
    ['implement', 'codex', 1], ['implement', 'custom', 2],
  ], 'the durable workflow operation must authorize the observed generation');
  assert.equal(wrongGeneration.elapsedOwnership?.unexplainedMs, 7);
});

test('lead-published lifecycle completion preserves the proven external handoff (PX-0055.02 F18)', () => {
  const publication = (ms: number, id: number, operationId: string, state: string, actor: string,
    summary?: string) => history(ms, id, 'mission.current-work', {
    ...work(state, 'execute', actor), operationId, sourceId: operationId, operationGeneration: 1,
    ...(summary === undefined ? {} : { summary }),
  });
  const report = verificationStatistics({ repositoryId: 'repo',
    operations: [completedOperation('op-1'), completedOperation('op-2')],
    lifecycle: lifecycle([['backlog', 'refined', 0, 'refined', 1], ['integration', 'done', 10, 'done', 2]]), history: [
      publication(1, 1, 'op-1', 'running', 'codex'),
      publication(2, 2, 'op-1', 'ended', 'codex'),
      publication(4, 3, 'op-1', 'ended', 'lead', 'workflow completed'),
      publication(7, 4, 'op-2', 'running', 'custom'),
      publication(9, 5, 'op-2', 'ended', 'custom'),
    ] });
  assert.deepEqual(owned(report)?.map(row => [row.step, row.actor, row.durationMs]), [
    ['implement', 'codex', 1], ['responsibility-handoff', 'external', 3], ['implement', 'custom', 2],
  ], 'the external-handoff owner does not derive completion authority from the publisher actor');
  assert.equal(report.elapsedOwnership?.unexplainedMs, 4);
});

test('a pre-flag superseded running publication cannot end explicit lead responsibility (PX-0055.02 F15)', () => {
  const publication = (ms: number, id: number, operationId: string, state: string, actor: string) =>
    history(ms, id, 'mission.current-work', { ...work(state, 'execute', actor), operationId,
      sourceId: operationId, operationGeneration: 1 });
  const report = verificationStatistics({ repositoryId: 'repo', operations: [],
    lifecycle: lifecycle([['backlog', 'refined', 0, 'refined', 1], ['integration', 'done', 10, 'done', 2]]), history: [
      publication(1, 1, 'old', 'running', 'codex'),
      publication(2, 2, 'replacement', 'running', 'custom'),
      publication(3, 3, 'replacement', 'ended', 'custom'),
      history(4, 4, 'lead.operator-judgment', { action: 'escalate', summary: 'operator required' }),
      publication(5, 5, 'old', 'running', 'codex'),
    ] });
  assert.deepEqual(owned(report)?.map(row => [row.step, row.actor, row.durationMs]), [
    ['implement', 'codex', 1], ['implement', 'custom', 1], ['lead-escalation', 'human', 6],
  ]);
  assert.equal(report.elapsedOwnership?.unexplainedMs, 2);
});

test('same-millisecond work after an escalation ends it by durable id so the later human handoff stays owned (PX-0055.02 F2)', () => {
  const report = verificationStatistics({ repositoryId: 'repo', operations: [],
    lifecycle: lifecycle([['backlog', 'refined', 0, 'refined'], ['review', 'integration', 8, 'approved'], ['integration', 'done', 10, 'done']]), history: [
      history(5, 1, 'lead.operator-judgment', { action: 'escalate', summary: 'operator required', evidenceRefs: ['progress:blocked'] }),
      history(5, 2, 'mission.current-work', work('running')), history(7, 3, 'mission.current-work', work('ended')),
    ] });
  assert.deepEqual(owned(report), [
    { step: 'recovery', actor: 'lead', model: null, state: 'working', durationMs: 2 },
    { step: 'human-review', actor: 'human', model: null, state: 'held', durationMs: 2 },
  ]);
  assert.equal(report.flowMissions[0]?.lead.escalations, 0, 'the escalation owns no interval when work starts in its millisecond');
});

// An unprovable tie owns no time under either input order, and keys disagree with both orders (PX-0055.02 F4/F5).
test('a lane event without a durable id never outranks an identified same-millisecond return (PX-0055.02 F3)', () => {
  const tie: Move[] = [['review', 'integration', 8, 'z-approved'], ['integration', 'active', 8, 'a-returned', 5]];
  for (const order of [tie, [...tie].reverse()]) {
    const report = verificationStatistics({ repositoryId: 'repo', operations: [], history: [], lifecycle: lifecycle([
      ['backlog', 'refined', 0, 'refined', 1], ...order, ['active', 'done', 10, 'done', 6]]) });
    assert.deepEqual(owned(report), [], 'the unprovable tie fabricates no human-review time');
    assert.equal(report.elapsedOwnership?.unexplainedMs, report.elapsedOwnership?.totalMs);
  }
});

test('a current-work row without a durable id is not reordered after an identified same-millisecond end (PX-0055.02 F3)', () => {
  const tie = [history(2, undefined, 'mission.current-work', work('running')), history(2, 1, 'mission.current-work', work('ended'))];
  for (const order of [tie, [...tie].reverse()]) {
    const report = verificationStatistics({ repositoryId: 'repo', operations: [], lifecycle: lifecycle([
      ['backlog', 'refined', 0, 'refined', 1], ['integration', 'done', 10, 'done', 2]]), history: order });
    assert.equal(owned(report)?.reduce((sum, value) => sum + value.durationMs, 0), 0, 'no open interval is fabricated through delivery');
  }
});

test('competing same-source openers in a partial same-millisecond tie own no time under either input order (PX-0055.02 F6)', () => {
  const run = (state: string, actor: string, phase: string) => ({ ...work(state, phase, actor), operationGeneration: 1, model: null });
  const tie = [history(2, undefined, 'mission.current-work', run('running', 'codex', 'execute')),
    history(2, 3, 'mission.current-work', run('running', 'custom', 'review'))];
  const reports = [tie, [...tie].reverse()].map(order => verificationStatistics({ repositoryId: 'repo', operations: [], lifecycle: lifecycle([
    ['backlog', 'refined', 0, 'refined', 1], ['integration', 'done', 10, 'done', 2]]), history: [...order, history(7, 4, 'mission.current-work', run('ended', 'custom', 'review'))] }));
  for (const report of reports) { assert.deepEqual(owned(report), [], 'neither competing opener is chosen as the owner'); }
  assert.deepEqual(reports[0]?.elapsedOwnership?.rows, reports[1]?.elapsedOwnership?.rows);
});

// An unordered tie is still a boundary at its own instant: intervals that open
// before it close there, and only the interval starting inside the tie is
// suppressed (PX-0055.02 F6).
test('an interval opening before an unprovable tie closes at that tie instead of reaching past it (PX-0055.02 F6)', () => {
  const source = (state: string, sourceId: string, phase: string, actor: string) => ({ operationId: sourceId, operationGeneration: 1,
    sourceId, dependencies: [], revision: 'rev', phase, state, actor, model: null, timeState: 'working' });
  const tie = [history(4, undefined, 'mission.current-work', source('running', 'src-b', 'execute', 'codex')),
    history(4, 5, 'mission.current-work', source('running', 'src-b', 'review', 'custom'))];
  for (const order of [tie, [...tie].reverse()]) {
    const report = verificationStatistics({ repositoryId: 'repo', operations: [], lifecycle: lifecycle([
      ['backlog', 'refined', 0, 'refined', 1], ['integration', 'done', 10, 'done', 2]]), history: [
      history(1, 1, 'mission.current-work', source('blocked', 'src-a', 'review-response', 'codex')), ...order,
      history(8, 9, 'mission.current-work', source('running', 'src-c', 'execute', 'codex'))] });
    assert.deepEqual(owned(report), [
      { step: 'repair', actor: 'codex', model: null, state: 'working', durationMs: 3 },
      { step: 'implement', actor: 'codex', model: null, state: 'working', durationMs: 2 },
    ], 'the blocked interval closes at the tie and the tied openers own nothing');
  }
});

test('a terminal publication tied with an unprovable later start owns no responsibility handoff (PX-0055.02 F6)', () => {
  const operation = (state: string, operationId: string, extra: object = {}) => ({ operationId, operationGeneration: 1,
    sourceId: operationId, dependencies: [], revision: 'rev', phase: 'execute', state, actor: 'codex', model: null, timeState: 'working', ...extra });
  const tie = [history(4, undefined, 'mission.current-work', operation('ended', 'op-1', { actor: 'parallix', summary: 'workflow completed' })),
    history(4, 5, 'mission.current-work', { ...operation('running', 'op-2'), revision: null })];
  for (const order of [tie, [...tie].reverse()]) {
    const report = verificationStatistics({ repositoryId: 'repo', operations: [], lifecycle: lifecycle([
      ['backlog', 'refined', 0, 'refined', 1], ['integration', 'done', 10, 'done', 2]]), history: [...order,
      history(8, 9, 'mission.current-work', operation('running', 'op-3'))] });
    assert.ok(!owned(report)!.some(value => value.step === 'responsibility-handoff'), 'the gap may be zero inside the tie');
  }
});

test('a terminal publication tied with an unprovable same-operation row owns no finalization interval (PX-0055.02 F6)', () => {
  const terminal = (id: number | undefined, ms: number, extra: object) => history(ms, id, 'mission.current-work',
    { operationId: 'op-1', operationGeneration: 1, sourceId: 'op-1', dependencies: [], revision: 'rev', phase: 'execute',
      state: 'ended', actor: 'parallix', model: null, timeState: 'working', ...extra });
  const tie = [terminal(undefined, 8, { summary: 'workflow completed' }), terminal(9, 8, {})];
  for (const order of [tie, [...tie].reverse()]) {
    const report = verificationStatistics({ repositoryId: 'repo', operations: [], lifecycle: lifecycle([
      ['backlog', 'refined', 0, 'refined', 1], ['integration', 'done', 10, 'done', 2]]), history: [terminal(1, 4, {}), ...order] });
    assert.ok(!owned(report)!.some(value => value.step === 'preparation'), 'the last preceding row may sit in the terminal millisecond');
  }
});

test('ambiguous activity ownership blocks derived operation finalization (PX-0055.02 F14)', () => {
  const activity = (ms: number, id: number | undefined, sourceId: string, state: string, actor: string,
    summary?: string) => history(ms, id, 'mission.current-work', {
    operationId: 'op-1', operationGeneration: 1, sourceId, dependencies: [], revision: 'rev', phase: 'execute',
    state, actor, model: null, timeState: 'working', ...(summary === undefined ? {} : { summary }),
  });
  const report = verificationStatistics({ repositoryId: 'repo', operations: [completedOperation('op-1')], lifecycle: lifecycle([
    ['backlog', 'refined', 0, 'refined', 1], ['integration', 'done', 10, 'done', 9]]), history: [
    activity(1, 1, 'parent', 'running', 'parallix'),
    activity(4, undefined, 'child-a', 'running', 'codex'),
    activity(4, 4, 'child-b', 'running', 'custom'),
    activity(4, 5, 'parent', 'ended', 'parallix'),
    activity(8, 8, 'parent', 'ended', 'parallix', 'workflow completed'),
  ] });
  assert.deepEqual(owned(report), [
    { step: 'preparation', actor: 'parallix', model: null, state: 'working', durationMs: 3 },
  ], 'a derived finalization interval cannot replace activity whose retained publication order is ambiguous');
  assert.equal(report.elapsedOwnership?.unexplainedMs, 7);
});

test('a lead escalation tied with an unprovable current-work row owns no interval (PX-0055.02 F6)', () => {
  const tie = [history(2, undefined, 'lead.operator-judgment', { action: 'escalate', summary: 'operator required', evidenceRefs: ['progress:blocked'] }),
    history(2, 9, 'mission.current-work', { ...work('running'), revision: null })];
  for (const order of [tie, [...tie].reverse()]) {
    const report = verificationStatistics({ repositoryId: 'repo', operations: [], lifecycle: lifecycle([
      ['backlog', 'refined', 0, 'refined', 1], ['integration', 'done', 10, 'done', 2]]), history: order });
    assert.ok(!owned(report)!.some(value => value.step === 'lead-escalation'), 'the escalation may end inside its own millisecond');
    assert.equal(report.elapsedOwnership?.unexplainedMs, report.elapsedOwnership?.totalMs);
  }
});

// A running resume at the block's own millisecond closes the block when durable ids
// prove it followed, whatever the source names sort as (PX-0055.02 F8).
test('a same-millisecond recovery resume closes a blocked interval by durable id regardless of source names (PX-0055.02 F8)', () => {
  const activity = (state: string, sourceId: string, actor: string, operationGeneration: number | null) => ({ operationId: sourceId,
    operationGeneration, sourceId, dependencies: [], revision: 'rev', phase: actor === 'lead' ? 'recovery' : 'review-response',
    state, actor, model: null, timeState: 'working' });
  const durations = [['a-blocked', 'z-recovery'], ['z-blocked', 'a-recovery']].map(([blocked, recovery]) => owned(verificationStatistics({
    repositoryId: 'repo', operations: [], lifecycle: lifecycle([['backlog', 'refined', 0, 'refined', 1], ['integration', 'done', 10, 'done', 2]]),
    history: [history(1, 1, 'mission.current-work', activity('blocked', blocked!, 'codex', 1)),
      history(1, 2, 'mission.current-work', activity('running', recovery!, 'lead', null)),
      history(7, 3, 'mission.current-work', activity('ended', recovery!, 'lead', null))] })));
  assert.deepEqual(durations[0], [{ step: 'recovery', actor: 'lead', model: null, state: 'working', durationMs: 6 }]);
  assert.deepEqual(durations[1], durations[0]);
});

test('a same-millisecond resume without durable ids does not close a blocked interval (PX-0055.02 F8)', () => {
  const activity = (state: string, sourceId: string) => ({ operationId: sourceId, operationGeneration: 1, sourceId, dependencies: [],
    revision: 'rev', phase: 'review-response', state, actor: 'codex', model: null, timeState: 'working' });
  const report = verificationStatistics({ repositoryId: 'repo', operations: [], lifecycle: lifecycle([
    ['backlog', 'refined', 0, 'refined', 1], ['integration', 'done', 10, 'done', 2]]), history: [
    history(1, 1, 'mission.current-work', activity('blocked', 'src-a')),
    history(1, undefined, 'mission.current-work', activity('running', 'src-b')),
    history(7, 3, 'mission.current-work', activity('ended', 'src-b'))] });
  assert.ok(!owned(report)?.some(value => value.step === 'implement'), 'the unprovable resume opens nothing');
});

// The blocked source's own later terminal must not mask the earlier id-proven resume
// of another source (PX-0055.02 F9).
test('a later same-source terminal does not mask an id-proven same-millisecond recovery resume (PX-0055.02 F9)', () => {
  const activity = (state: string, sourceId: string, actor: string, operationGeneration: number | null) => ({ operationId: sourceId,
    operationGeneration, sourceId, dependencies: [], revision: 'rev', phase: actor === 'lead' ? 'recovery' : 'review-response',
    state, actor, model: null, timeState: 'working' });
  const results = [['a-blocked', 'z-recovery'], ['z-blocked', 'a-recovery']].map(([blocked, recovery]) => owned(verificationStatistics({
    repositoryId: 'repo', operations: [], lifecycle: lifecycle([['backlog', 'refined', 0, 'refined', 1], ['integration', 'done', 10, 'done', 2]]),
    history: [history(1, 1, 'mission.current-work', activity('blocked', blocked!, 'codex', 1)),
      history(1, 2, 'mission.current-work', activity('running', recovery!, 'lead', null)),
      history(7, 3, 'mission.current-work', activity('ended', recovery!, 'lead', null)),
      history(9, 4, 'mission.current-work', activity('ended', blocked!, 'codex', 1))] })));
  assert.deepEqual(results[0], [{ step: 'recovery', actor: 'lead', model: null, state: 'working', durationMs: 6 }]);
  assert.deepEqual(results[1], results[0]);
});

// A later activity frame from another source is the mission's top frame, so it owns
// the disputed time over the frame it interrupted; source spelling never ranks (PX-0055.02 F11).
test('a later blocked publication bounds earlier running work by durable order, not source spelling (PX-0055.02 F11)', () => {
  const activity = (state: string, sourceId: string, actor: string, operationGeneration: number | null) => ({ operationId: sourceId,
    operationGeneration, sourceId, dependencies: [], revision: 'rev', phase: actor === 'lead' ? 'recovery' : 'review-response',
    state, actor, model: null, timeState: state === 'blocked' ? 'waiting' : 'working' });
  const results = [['a-recovery', 'z-blocked'], ['z-recovery', 'a-blocked']].map(([recovery, blocked]) => owned(verificationStatistics({
    repositoryId: 'repo', operations: [], lifecycle: lifecycle([['backlog', 'refined', 0, 'refined', 1], ['integration', 'done', 10, 'done', 2]]),
    history: [history(1, 1, 'mission.current-work', activity('running', recovery!, 'lead', null)),
      history(2, 2, 'mission.current-work', activity('running', blocked!, 'codex', 1)),
      history(2, 3, 'mission.current-work', activity('blocked', blocked!, 'codex', 1)),
      history(7, 4, 'mission.current-work', activity('ended', recovery!, 'lead', null)),
      history(9, 5, 'mission.current-work', activity('ended', blocked!, 'codex', 1))] })));
  assert.deepEqual(results[0], [
    { step: 'recovery', actor: 'lead', model: null, state: 'working', durationMs: 1 },
    { step: 'repair', actor: 'codex', model: null, state: 'waiting', durationMs: 7 },
  ], 'the explicit block owns its full interval and running work is bounded at the interruption');
  assert.deepEqual(results[1], results[0]);
});

// A nested frame returns to its parent within the same operation. A replacement
// operation never resumes superseded work (the separate regression above).
test('a nested recovery frame returns responsibility to its parent whatever the source names (PX-0055.02 F11)', () => {
  const activity = (state: string, sourceId: string, actor: string) => ({ operationId: 'shared-operation', operationGeneration: 1,
    sourceId, dependencies: [], revision: 'rev', phase: actor === 'lead' ? 'recovery' : 'execute', state, actor,
    model: null, timeState: 'working' });
  const results = [['a-implement', 'z-recovery'], ['z-implement', 'a-recovery']].map(([implement, recovery]) => owned(verificationStatistics({
    repositoryId: 'repo', operations: [], lifecycle: lifecycle([['backlog', 'refined', 0, 'refined', 1], ['integration', 'done', 10, 'done', 2]]),
    history: [history(1, 1, 'mission.current-work', activity('running', implement!, 'codex')),
      history(3, 2, 'mission.current-work', activity('running', recovery!, 'lead')),
      history(7, 3, 'mission.current-work', activity('ended', recovery!, 'lead')),
      history(9, 4, 'mission.current-work', activity('ended', implement!, 'codex'))] })));
  assert.deepEqual(results[0], [
    { step: 'implement', actor: 'codex', model: null, state: 'working', durationMs: 2 },
    { step: 'recovery', actor: 'lead', model: null, state: 'working', durationMs: 4 },
    { step: 'implement', actor: 'codex', model: null, state: 'working', durationMs: 2 },
  ], 'the suspended parent keeps the time outside its nested frame');
  assert.deepEqual(results[1], results[0]);
});

// Two root frames opened inside one unordered millisecond have no provable top frame,
// so the disputed slice stays unowned under either source naming (PX-0055.02 F11).
test('two root frames opened in an unprovable same-millisecond tie own no disputed time under either source naming (PX-0055.02 F11)', () => {
  const activity = (state: string, sourceId: string, actor: string, phase: string) => ({ operationId: sourceId,
    operationGeneration: 1, sourceId, dependencies: [], revision: 'rev', phase, state, actor, model: null, timeState: 'working' });
  const results = [['a-first', 'z-second'], ['z-first', 'a-second']].map(([first, second]) => owned(verificationStatistics({
    repositoryId: 'repo', operations: [], lifecycle: lifecycle([['backlog', 'refined', 0, 'refined', 1], ['integration', 'done', 10, 'done', 2]]),
    history: [history(1, undefined, 'mission.current-work', activity('running', first!, 'codex', 'execute')),
      history(1, 5, 'mission.current-work', activity('running', second!, 'custom', 'review')),
      history(4, 6, 'mission.current-work', activity('ended', second!, 'custom', 'review')),
      history(8, 7, 'mission.current-work', activity('ended', first!, 'codex', 'execute'))] })));
  assert.deepEqual(results[0], [], 'ending one operation does not prove the other survived supersession');
  assert.deepEqual(results[1], results[0]);
});

test('three root frames with one unidentified same-millisecond opening stay unowned under every permutation (PX-0055.02 F12)', () => {
  const activity = (state: string, sourceId: string, actor: string, phase: string) => ({ operationId: sourceId,
    operationGeneration: 1, sourceId, dependencies: [], revision: 'rev', phase, state, actor, model: null, timeState: 'working' });
  const openings = [
    history(2, undefined, 'mission.current-work', activity('running', 'source-a', 'codex', 'execute')),
    history(2, 5, 'mission.current-work', activity('running', 'source-b', 'custom', 'review')),
    history(2, 6, 'mission.current-work', activity('running', 'source-c', 'lead', 'recovery')),
  ];
  const permutations = [[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]];
  for (const order of permutations) {
    const report = verificationStatistics({ repositoryId: 'repo', operations: [], lifecycle: lifecycle([
      ['backlog', 'refined', 0, 'refined', 1], ['integration', 'done', 10, 'done', 2]]), history: [
      ...order.map(index => openings[index]!),
      history(7, 7, 'mission.current-work', activity('ended', 'source-a', 'codex', 'execute')),
      history(7, 8, 'mission.current-work', activity('ended', 'source-b', 'custom', 'review')),
      history(7, 9, 'mission.current-work', activity('ended', 'source-c', 'lead', 'recovery')),
    ] });
    assert.deepEqual(owned(report), [], `permutation ${order.join('')} must not select a top frame`);
    assert.equal(report.elapsedOwnership?.unexplainedMs, 10);
  }
});

test('an unordered nested publication can regain a proven owner after its peer ends (PX-0055.02)', () => {
  const publication = (ms: number, id: number | undefined, sourceId: string, state: string, actor: string) =>
    history(ms, id, 'mission.current-work', { ...work(state, 'execute', actor), operationId: 'shared', sourceId, operationGeneration: 1 });
  const openings = [publication(1, undefined, 'first', 'running', 'codex'), publication(1, 5, 'second', 'running', 'custom')];
  for (const order of [openings, [...openings].reverse()]) {
    const report = verificationStatistics({ repositoryId: 'repo', operations: [],
      lifecycle: lifecycle([['backlog', 'refined', 0, 'refined', 1], ['integration', 'done', 10, 'done', 2]]),
      history: [...order, publication(4, 6, 'second', 'ended', 'custom'), publication(8, 7, 'first', 'ended', 'codex')] });
    assert.deepEqual(owned(report)?.map(row => [row.actor, row.durationMs]), [['codex', 4]]);
    assert.equal(report.elapsedOwnership?.unexplainedMs, 6);
  }
});

test('large legacy publication ambiguity stays unobserved within a finite replay budget (PX-0055.02)', () => {
  const report = verificationStatistics({ repositoryId: 'repo', operations: [],
    lifecycle: lifecycle([['backlog', 'refined', 0, 'refined', 1], ['review', 'integration', 3, 'approved', 2],
      ['integration', 'done', 10, 'done', 3]]), history: Array.from({ length: 8 }, (_, index) =>
      history(1, undefined, 'mission.current-work', { ...work('running'), operationId: `op-${index}`, sourceId: `op-${index}` })) });
  assert.deepEqual(owned(report), [], 'an uncertain running activity cannot become a lower-priority human handoff');
  assert.equal(report.elapsedOwnership?.unexplainedMs, 10);
  assert.ok(report.unknowns.some(value => value.includes('bounded historical replay')));
});

// A block and another source's running row at one millisecond with no durable order is
// an unprovable boundary; source spelling must not decide who owns the time (PX-0055.02 F10).
test('a partial same-millisecond block cannot establish an operation over an admitted running frame (PX-0055.02 F10)', () => {
  const activity = (state: string, sourceId: string, actor: string, operationGeneration: number | null) => ({ operationId: sourceId,
    operationGeneration, sourceId, dependencies: [], revision: 'rev', phase: actor === 'lead' ? 'recovery' : 'review-response',
    state, actor, model: null, timeState: 'working' });
  const results = [['a-blocked', 'z-recovery'], ['z-blocked', 'a-recovery']].map(([blocked, recovery]) => owned(verificationStatistics({
    repositoryId: 'repo', operations: [], lifecycle: lifecycle([['backlog', 'refined', 0, 'refined', 1], ['integration', 'done', 10, 'done', 2]]),
    history: [history(1, 1, 'mission.current-work', activity('blocked', blocked!, 'codex', 1)),
      history(1, undefined, 'mission.current-work', activity('running', recovery!, 'lead', null)),
      history(7, 3, 'mission.current-work', activity('ended', recovery!, 'lead', null)),
      history(9, 4, 'mission.current-work', activity('ended', blocked!, 'codex', 1))] })));
  assert.deepEqual(results[0], [{ step: 'recovery', actor: 'lead', model: null, state: 'working', durationMs: 6 }],
    'the activity owner rejects a foreign blocked publication after running, or supersedes it when running follows');
  assert.deepEqual(results[1], results[0]);
});
