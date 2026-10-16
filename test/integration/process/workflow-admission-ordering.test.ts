// SQLite and HTTP/SSE boundaries; worker execution is held at the process port.
import test from 'node:test';
import assert from 'node:assert/strict';
import { workflowBoard, until } from '../../fixtures/workflow-board.js';
import { workflowHttp } from '../../fixtures/workflow-http.js';
import { validateWebBoardSnapshot } from '../../../src/interfaces/web/transport.js';

test('ten admissions commit active, one lane event and preparing before held work; retries join and competitors conflict (TASK-2750)', { timeout: 10_000 }, async t => {
  const fixture = await workflowBoard(10, { inProcess: true }); t.after(() => fixture.close());
  const host = await fixture.start();
  const http = await workflowHttp(host);
  const events = await fetch(`${host.origin}/api/events`);
  const reader = events.body!.getReader(); t.after(() => reader.cancel().catch(() => {}));
  // Consume connection frame before admission so only a committed change can satisfy the wait.
  await reader.read();
  const ids: string[] = [];
  for (const [index, slug] of fixture.slugs.entries()) {
    const response = await http.post(slug, `delivery-${index}`);
    assert.equal(response.status, 202, response.status === 202 ? '' : await response.text());
    ids.push((await response.json()).value.operationId);
    await until(() => fixture.entered(slug), 'held preparation');
    const loaded = await fixture.store.load(slug as never);
    assert.equal(loaded.kind === 'found' && loaded.mission.status, 'active');
    const lane = await fixture.database.query('SELECT * FROM board_lane_events WHERE mission_id = ?', [slug]);
    assert.equal(lane.length, 1);
    assert.equal((await fixture.service.operation(ids[index]))?.phase, 'preparing');
  }
  const frame = await reader.read(); assert.match(new TextDecoder().decode(frame.value), /invalidate/);
  const snapshot = await http.snapshot(); assert.equal(validateWebBoardSnapshot(snapshot).ok, true);
  for (const slug of fixture.slugs) {
    const card = snapshot.stages.flatMap((stage: { cards: Array<{ id: string; status: string; activity: { work: { summary: string } } }> }) => stage.cards).find((card: { id: string }) => card.id === slug);
    assert.equal(card.status, 'active'); assert.match(card.activity.work.summary, /preparing/);
  }
  const duplicate = await http.post(fixture.slugs[0], 'delivery-0'); assert.equal(duplicate.status, 202);
  assert.equal((await duplicate.json()).value.operationId, ids[0]);
  assert.equal((await http.post(fixture.slugs[0], 'competing-tab')).status, 409);
  // A fresh browser/host sees the same committed owners before any gate release.
  const reloaded = await workflowHttp(await fixture.start());
  const reload = await reloaded.snapshot();
  const cards = reload.stages.flatMap((stage: { cards: Array<{ id: string; status: string; activity: { work: { summary: string } } }> }) => stage.cards);
  assert.deepEqual(cards.map((card: { id: string }) => card.id).sort(), [...fixture.slugs].sort());
  for (const card of cards) { assert.equal(card.status, 'active'); assert.match(card.activity.work.summary, /preparing/); }
  for (const slug of fixture.slugs) { fixture.release(slug); }
  for (const id of ids) { await until(async () => (await fixture.service.operation(id))?.phase === 'completed', 'completion after barrier release'); }
});
