/** Disposable public browser walkthrough; no operator database or statistics. */
import assert from 'node:assert/strict';
import { pointerBoard } from './web-pointer-board.js';
import { makeCard, makeProjection, makeAttentionItem } from './board-projection.js';
import { missionId } from '../../src/domain/mission.js';
import { toWebBoardSnapshot } from '../../src/interfaces/web/transport.js';

const reason = 'Shared failure: verification needs operator attention';
const cards = ['task-status-a', 'task-status-b'].map((id, index) => makeCard({
  id: missionId(id), title: 'Isolated status walkthrough', lane: 'active', status: 'active',
  gate: index === 0 ? 'unavailable' : 'failed', blockingReason: reason,
  commands: [{ command: 'cancel', enabled: true, reason: null, targetLane: null }],
}));
const distinct = makeCard({ id: missionId('task-status-distinct'), lane: 'review', status: 'review',
  blockingReason: 'Distinct blocking reason',
  currentWork: { operationId: 'fixture-work', phase: 'execute', summary: 'Distinct actor summary', agent: null, updatedAt: 'now', freshness: 'live' },
});
const projection = makeProjection({ active: cards, review: [distinct],
  done: [makeCard({ id: missionId('task-status-done'), lane: 'done', status: 'done', closed: true })] });
const snapshot = toWebBoardSnapshot({ ...projection, attentionQueue: [
  makeAttentionItem(cards[0], { kind: 'blocking', detail: reason }, 1),
  makeAttentionItem(cards[1], { kind: 'blocking', detail: 'Distinct attention reason' }, 2),
] });
const fixture = await pointerBoard();
try {
  const { page } = fixture;
  await fixture.render(snapshot);
  const flight = page.getByRole('region', { name: 'active stage', exact: true });
  const first = flight.locator('article').first();
  const second = flight.locator('article').nth(1);
  assert.equal(await page.getByText(reason, { exact: true }).filter({ visible: true }).count(), 2);
  assert.equal(await page.getByText('Distinct attention reason', { exact: true }).isVisible(), true);
  assert.equal(await page.getByText('Distinct blocking reason', { exact: true }).isVisible(), true);
  assert.equal(await page.getByText('Distinct actor summary', { exact: true }).isVisible(), true);
  const recovery = first.locator('details').filter({ has: page.locator('summary', { hasText: /^Recovery$/ }) });
  const summary = recovery.locator('summary');
  await summary.focus();
  assert.equal(await recovery.getAttribute('open'), null);
  await page.keyboard.press('Enter');
  assert.equal(await recovery.getAttribute('open'), '');
  assert.match(await recovery.innerText(), /recovery evidence: coordinator/);
  await page.keyboard.press('Space');
  assert.equal(await recovery.getAttribute('open'), null);
  const compactHeight = await first.evaluate(node => node.getBoundingClientRect().height);
  await summary.click();
  const expandedHeight = await first.evaluate(node => node.getBoundingClientRect().height);
  assert.ok(expandedHeight > compactHeight);
  // Chromium's accessibility tree exposes native summary expanded state.
  const accessibility = await page.context().newCDPSession(page);
  const tree = await accessibility.send('Accessibility.getFullAXTree');
  const recoveryNode = tree.nodes.find(node => node.name?.value === 'Recovery');
  assert.ok(recoveryNode?.properties?.some(property => property.name === 'expanded' && property.value.value === true));
  await accessibility.detach();
  await summary.click();
  const session = await page.context().newCDPSession(page);
  await session.send('Emulation.setTouchEmulationEnabled', { enabled: true });
  const box = await summary.boundingBox(); assert.ok(box);
  await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: box.x + box.width / 2, y: box.y + box.height / 2 }] });
  await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await page.waitForFunction(() => Array.from(document.querySelectorAll('summary')).find(node => node.textContent === 'Recovery')?.parentElement?.hasAttribute('open'));
  assert.equal(await recovery.getAttribute('open'), '');
  await session.send('Emulation.setTouchEmulationEnabled', { enabled: false });
  await session.detach();
  const unknown = first.locator('summary', { hasText: 'gate · unknown' });
  await unknown.click();
  assert.equal(await first.getByText('gate · unavailable', { exact: true }).isVisible(), true);
  assert.equal(await second.getByText('gate ✗ FAIL', { exact: true }).isVisible(), true);
  for (const article of [first, second]) {
    assert.equal(await article.evaluate(node => getComputedStyle(node).borderTopColor), 'rgb(226, 96, 78)');
  }
  const duplicate = first.locator('summary', { hasText: 'Blocking reason' });
  await duplicate.click();
  assert.equal(await first.getByText(reason, { exact: true }).filter({ visible: true }).count(), 2);
  assert.equal(await page.locator('[style*="repeating-linear-gradient"]').count(), 0);
  const done = page.locator('details.shipped');
  await done.locator(':scope > summary').click();
  assert.equal(await done.getAttribute('open'), '');
  await done.locator(':scope > summary').click();
  assert.equal(await done.getAttribute('open'), null);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const fans = page.locator('.fan.spin');
  for (const fan of await fans.all()) {
    assert.equal(await fan.evaluate(node => getComputedStyle(node).animationName), 'none');
  }
  await first.locator('[data-action-kind="mission:cancel"]').click();
  assert.equal(fixture.requests.length, 0);
  const dialog = page.getByRole('dialog');
  await dialog.waitFor();
  await dialog.getByRole('button', { name: /delete .* lifecycle rows/i }).click();
  await first.getByRole('status').filter({ hasText: /Cancelled task-status-a/ }).waitFor();
  assert.equal(await second.getByRole('status').count(), 0);
  assert.equal(fixture.requests.length, 1);
  assert.equal((fixture.requests[0] as { missionId: string }).missionId, cards[0].id);
  console.log(JSON.stringify({ compactHeight, expandedHeight, repeatedVisiblePerMission: 1,
    distinctReasons: true, recoveryKeyboardAndTouch: true, accessibleExpandedState: true,
    unknownAndFailedGates: true, redBorders: true, grilleCount: 0,
    doneDisclosure: true, reducedMotion: true, twoStageCancel: true,
    missionLocalOutcome: true, operatorWrites: 0, assetHash: fixture.assetHash }));
} finally { await fixture.close(); }
