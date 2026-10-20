/** Manual disposable Chromium exercise; no operator database or mission mutations. */
import assert from 'node:assert/strict';
import { pointerBoard } from './web-pointer-board.js';
import { makeCard, makeProjection } from './board-projection.js';
import { missionId } from '../../src/domain/mission.js';
import { toWebBoardSnapshot } from '../../src/interfaces/web/transport.js';

const id = missionId('task-outcome-disposable');
const snapshot = (lane: 'active' | 'review' | 'done') => toWebBoardSnapshot(makeProjection({
  [lane]: [makeCard({ id, title: 'Disposable command outcome', lane, status: lane,
    commands: [{ command: lane === 'active' ? 'handoff' : 'review', enabled: true, reason: null, targetLane: null }] })],
}));
const fixture = await pointerBoard();
try {
  const { page } = fixture;
  await fixture.render(snapshot('active'));
  const status = page.locator('footer [role="status"]');
  const fallback = page.locator('[data-command-fallback]');
  await page.locator('[data-action-kind="handoff:record"]').click();
  await page.waitForFunction(() => document.querySelector('footer [role="status"]')?.textContent?.includes('started'));
  assert.equal(await status.getAttribute('aria-live'), 'polite');
  assert.equal(await status.isVisible(), true);
  assert.equal(await fallback.count(), 0);
  console.log(JSON.stringify({ observation: 'success footer', text: await status.innerText(), accessible: await status.ariaSnapshot() }));

  await fixture.render(snapshot('review'), true);
  assert.equal(await status.isVisible(), true);
  assert.ok((await status.innerText()).includes('started'));
  assert.equal(await fallback.count(), 0);
  console.log(JSON.stringify({ observation: 'active to review', retained: await status.innerText() }));

  // A typed failure response at the public HTTP boundary, scoped to this disposable page.
  await page.route('**/api/commands', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
    kind: 'command-result', transportVersion: 2, status: 'failed', value: null,
    error: { kind: 'execution', message: 'Disposable command failed' }, durableEvidence: [],
  }) }));
  await page.locator('[data-action-kind="review:submit"]').click();
  await page.waitForFunction(() => document.querySelector('footer [role="status"]')?.textContent === 'Disposable command failed');
  assert.equal(await status.getAttribute('aria-live'), 'polite');
  assert.equal(await fallback.count(), 0);
  console.log(JSON.stringify({ observation: 'failure footer', text: await status.innerText() }));

  await fixture.render(snapshot('done'), true);
  await fallback.waitFor({ state: 'visible' });
  assert.ok((await fallback.innerText()).includes(id));
  assert.equal(await status.count(), 0);
  const rail = page.locator('details[aria-label="done stage"]');
  await rail.locator(':scope > summary').click();
  await status.waitFor({ state: 'visible' });
  assert.equal(await fallback.count(), 0);
  assert.equal(await status.innerText(), 'Disposable command failed');
  console.log(JSON.stringify({ observation: 'done revealed', accessible: await status.ariaSnapshot() }));

  await rail.locator(':scope > summary').click();
  await fallback.waitFor({ state: 'visible' });
  assert.equal(await status.count(), 0);
  const empty = toWebBoardSnapshot(makeProjection());
  await fixture.render(empty, true);
  await fixture.render(empty, true);
  assert.ok((await fallback.innerText()).includes('Disposable command failed'));
  assert.equal(await fallback.getAttribute('aria-live'), 'polite');
  console.log(JSON.stringify({ observation: 'removed and refreshed twice', text: await fallback.innerText(), accessible: await fallback.ariaSnapshot() }));
  assert.equal(fixture.requests.length, 1, 'only the first command reaches the disposable in-memory host');
  console.log('PASS: public board success, failure, active/review/done transitions and accessible fallback; isolated browser host only');
} finally { await fixture.close(); }
