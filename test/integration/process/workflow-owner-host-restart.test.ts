import { before, after } from 'node:test';
import { bundleWorkflowChild } from '../../fixtures/workflow-bundle.js';
// Real HTTP-host replacement while one independently owned workflow remains held.
import test from 'node:test';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { workflowBoard, until } from '../../fixtures/workflow-board.js';
import { sessionCookieName } from '../../../src/interfaces/web/security.js';
import { validateWebBoardSnapshot, validateWebCommandResult } from '../../../src/interfaces/web/transport.js';

let bundle: Awaited<ReturnType<typeof bundleWorkflowChild>>;
before(async () => { bundle = await bundleWorkflowChild(); });
after(() => bundle?.close());

test('accepted workflows survive HTTP host restart, capture sync workers and exclude duplicate owners (TASK-2750)', { timeout: 60_000 }, async t => {
  const fixture = await workflowBoard(1, { cli: bundle.cli }); t.after(() => fixture.close());
  let host = await fixture.start(true);
  const firstHostPid = host.processId;
  assert.ok(firstHostPid && firstHostPid !== process.pid);
  const shell = await fetch(host.origin);
  const token = shell.headers.get('set-cookie')!.split('=')[1].split(';')[0];
  const events = await fetch(`${host.origin}/api/events`);
  const reader = events.body!.getReader(); t.after(() => reader.cancel().catch(() => {}));
  const started = performance.now();
  const post = (slug: string, key: string) => fetch(`${host.origin}/api/commands`, { method: 'POST',
    headers: { origin: host.origin, cookie: `${sessionCookieName(host)}=${token}`, 'x-px-csrf': token, 'content-type': 'application/json' },
    body: JSON.stringify({ missionId: slug, kind: 'active:execute', missionStatusAtRequest: 'refined', requestKey: key }) });
  const reply = await post(fixture.slugs[0], 'delivery-one');
  assert.equal(reply.status, 202);
  const acceptance = await reply.json(); assert.equal(validateWebCommandResult(acceptance).ok, true);
  const acceptedAt = performance.now() - started;
  const operationId = acceptance.value.operationId as string;
  const loaded = await fixture.store.load(fixture.slugs[0] as never);
  assert.equal(loaded.kind === 'found' && loaded.mission.status, 'active');
  const lane = await fixture.database.query('SELECT * FROM board_lane_events WHERE mission_id = ?', [fixture.slugs[0]]);
  assert.equal(lane.length, 1);
  const frame = await reader.read(); assert.match(new TextDecoder().decode(frame.value), /invalidate|refetch/);
  await until(() => fixture.entered(fixture.slugs[0]), 'synchronous preflight entry');
  const snapshot = await (await fetch(`${host.origin}/api/board`)).json();
  assert.equal(validateWebBoardSnapshot(snapshot).ok, true);
  const card = snapshot.stages.flatMap((stage: { cards: Array<{ id: string; status: string; activity: { work: { summary: string } } }> }) => stage.cards).find((next: { id: string }) => next.id === fixture.slugs[0]);
  assert.equal(card.status, 'active'); assert.match(card.activity.work.summary, /preparing/);
  await reader.cancel();
  const owner = (await fixture.service.operation(operationId))!.owner;
  assert.ok(owner);
  assert.notEqual(owner.pid, firstHostPid);
  const beforeHistory = fixture.terminal.history(fixture.slugs[0]);
  host = await fixture.start(true); await fixture.service.recover();
  assert.notEqual(host.processId, firstHostPid, 'the original HTTP process terminated before restart');
  const status = await (await fetch(`${host.origin}${acceptance.value.statusUrl}`)).json();
  assert.equal(status.operation.id, operationId);
  assert.equal(status.operation.phase, 'preparing');
  assert.deepEqual(status.operation.owner, owner);
  const afterHistory = fixture.terminal.history(fixture.slugs[0]);
  assert.ok(beforeHistory.ok && afterHistory.ok);
  assert.equal(afterHistory.runs.filter(run => run.record.captureKind === 'coordinator').length, 1, 'recovery must not duplicate the workflow owner');
  assert.equal(afterHistory.ok && afterHistory.runs.length, beforeHistory.ok && beforeHistory.runs.length);
  assert.equal((await fixture.service.operation(operationId))?.phase, 'preparing');
  fixture.release(fixture.slugs[0]);
  await until(async () => (await fixture.service.operation(operationId))?.phase === 'completed', 'workflow progression after host restart');
  await until(async () => {
    const overview = await fixture.terminal.overview(fixture.slugs[0]);
    return 'operations' in overview && overview.operations.some(operation => operation.operationId === operationId && operation.state !== 'running');
  }, 'retained coordinator completion');
  const history = await fixture.terminal.search(fixture.slugs[0], { pattern: 'PREFLIGHT-ENTER' });
  assert.ok('hits' in history && history.hits.length > 0);
  const end = await fixture.terminal.search(fixture.slugs[0], { pattern: 'REVIEW-OUTPUT' });
  assert.ok('hits' in end && end.hits.length > 0);
  console.log(`TASK-2750 ack=${acceptedAt.toFixed(1)}ms; store active and notification precede held gate; restart retains operation ${operationId}`);
});

