import assert from 'node:assert/strict';
import type { Locator } from 'playwright-core';
import { pointerCancel } from './web-pointer-cancel.js';
import { compactPointerSnapshot, pointerBoard, pointerSnapshot } from './web-pointer-board.js';

async function press(control: Locator) {
  await control.scrollIntoViewIfNeeded();
  const box = await control.boundingBox(); assert.ok(box);
  await control.page().mouse.click(box.x + box.width / 2, box.y + box.height / 2);
}

// Run directly for a disposable operator check; no real workflow commands or data.
const cancellation = await pointerCancel();
try {
  await cancellation.render(pointerSnapshot('backlog', ['cancel']));
  const {page} = cancellation;
  const button = page.locator('[data-board-card] button:not([data-action-kind="mission:edit"])');
  await press(button);
  assert.equal(await page.locator('[data-board-card]').getAttribute('aria-selected'), 'false');
  assert.equal(await page.evaluate(() => document.activeElement?.textContent), 'keep mission');
  await page.keyboard.press('Enter');
  assert.equal(cancellation.requests.length, 0);
  assert.equal((await cancellation.facts()).missions.length, 2);
  await press(button);
  await page.keyboard.press('Tab');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => !document.querySelector('[role="dialog"]'));
  const facts = await cancellation.facts();
  assert.deepEqual(facts.missions.map((row) => row.id), ['task-pointer-bystander']);
  assert.equal(facts.usage.length, 2);
  assert.equal(facts.taskPresent, false);
  assert.equal(facts.archived, true);
  assert.equal(cancellation.requests.length, 1);
  console.log('PASS manual unselected backlog Cancel/Keep/confirm: disposable SQLite, bystander/usage preserved; asset', cancellation.assetHash);
} finally { await cancellation.close(); }

const fixture = await pointerBoard();
try {
  const {page, requests} = fixture;
  const lanes = ['backlog', 'refined', 'active', 'review', 'integration'] as const;
  const compact = compactPointerSnapshot('backlog');
  const board = { ...compact, stages: compact.stages.map((stage) => {
    const lane = lanes.find((lane) => lane === stage.lane);
    return lane ? compactPointerSnapshot(lane).stages.find((next) => next.lane === lane)! : stage;
  }) };
  await fixture.render(board);
  assert.equal(await page.locator('[data-board-card]').count(), 5);
  assert.equal(await page.locator('[data-board-card] button:not([data-action-kind="mission:edit"])').count(), 10);
  await page.screenshot({ path: '/tmp/task-2705-compact-board.png' });
  console.log('PASS manual normal server projections: five lanes, two controls per card; screenshot /tmp/task-2705-compact-board.png');
  const base = pointerSnapshot('active');
  const supplied = {...base, stages: base.stages.map((stage) => ({...stage, cards: stage.cards.map((card) => ({...card, actions: card.actions.map((action) => ({...action, state: 'enabled' as const, reason: null}))}))}))};
  await fixture.render(supplied);
  for (const command of ['active', 'handoff', 'review', 'integrate']) {
    await press(page.locator(`[data-board-card] button[aria-label^="px ${command}"]`));
    await page.waitForFunction(() => !document.querySelector('[data-board-card] button[aria-label*="starting"]'));
  }
  assert.deepEqual(requests.map((request) => (request as {kind: string}).kind), ['active:execute', 'handoff:record', 'review:submit', 'integrate:merge']);
  const backlog = pointerSnapshot('backlog', ['cancel']);
  const tall = {...backlog, stages: backlog.stages.map((stage) => ({...stage, cards: stage.cards.flatMap((card) => Array.from({length: 40}, (_, index) => ({...card, id: index === 39 ? card.id : `task-disposable-${index}`}))) }))};
  await fixture.render(tall);
  await press(page.locator('[data-board-card="task-pointer-disposable"] button[data-action-kind="mission:cancel"]'));
  const box = await page.getByRole('dialog').boundingBox(); assert.ok(box);
  assert.ok(box.y >= 0 && box.y + box.height <= 700);
  assert.equal(await page.evaluate(() => document.activeElement?.textContent), 'keep mission');
  await page.keyboard.press('Escape');
  await fixture.render(pointerSnapshot('backlog'));
  const cancel = page.locator('[data-board-card] button[aria-label^="px cancel"]');
  const control = await cancel.boundingBox(); assert.ok(control);
  await page.mouse.move(control.x + control.width / 2, control.y + control.height / 2);
  await page.mouse.down();
  await fixture.render(pointerSnapshot('backlog', ['active', 'handoff']), true);
  await page.mouse.up();
  assert.equal(requests.length, 4);
  assert.equal(await page.locator('[data-board-card]').getAttribute('aria-selected'), 'false');
  assert.equal(await page.getByRole('dialog').count(), 0);
  console.log('PASS manual simultaneous supplied actions (command boundary doubled), tall board visibility, SSE press/release; asset', fixture.assetHash);
} finally { await fixture.close(); }
