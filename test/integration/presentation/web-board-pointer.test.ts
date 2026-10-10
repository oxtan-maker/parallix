import test from 'node:test';
import assert from 'node:assert/strict';
import type { Locator } from 'playwright-core';
import { compactPointerSnapshot, pointerBoard, pointerSnapshot } from '../../fixtures/web-pointer-board.js';

async function clickAt(control: Locator) {
  await control.scrollIntoViewIfNeeded();
  const box = await control.boundingBox();
  assert.ok(box);
  await control.page().mouse.click(box.x + box.width / 2, box.y + box.height / 2);
}

test('board coordinate control matrix across lanes and work states (TASK-2705)', { timeout: 45_000 }, async (context) => {
  const fixture = await pointerBoard();
  context.after(fixture.close);
  const { page, requests } = fixture;
  page.setDefaultTimeout(3000);
  try {
    for (const lane of ['backlog', 'refined', 'active', 'review', 'integration'] as const) {
      await fixture.render(compactPointerSnapshot(lane));
      assert.equal(await page.locator('[data-board-card] button').count(), 3, `${lane}: normal projection includes Edit and stays compact`);
      for (const work of ['idle', 'running', 'unverified', 'stale', 'stopped'] as const) {
        await fixture.render(pointerSnapshot(lane, undefined, work));
        const before = requests.length;
        const card = page.locator('[data-board-card]');
        assert.equal(await card.locator('button:not([data-action-kind="mission:edit"])').count(), 5, `${lane}/${work} enabled projected controls`);
        assert.equal(await card.locator('button[aria-label^="px review"]').count(), 0);
        await clickAt(card.locator('button[aria-label^="px cancel"]'));
        assert.equal(await card.getAttribute('aria-selected'), 'false');
        const dialog = page.getByRole('dialog', { name: 'Confirm cancelling task-pointer-disposable' });
        await dialog.waitFor();
        assert.equal(await page.evaluate(() => document.activeElement?.textContent), 'keep mission');
        const box = await dialog.boundingBox();
        assert.ok(box && box.y >= 0 && box.y + box.height <= 700);
        await page.keyboard.press('Tab');
        assert.match(await page.evaluate(() => document.activeElement?.textContent ?? ''), /delete task-pointer-disposable/);
        await page.keyboard.press('Shift+Tab');
        assert.equal(await page.evaluate(() => document.activeElement?.textContent), 'keep mission');
        // The backdrop covers the card: this coordinate cannot activate a terminal.
        const underlying = await card.boundingBox(); assert.ok(underlying);
        await page.mouse.click(underlying.x + 8, underlying.y + 8);
        assert.equal(await dialog.count(), 1);
        assert.equal(await page.getByRole('dialog', { name: /Mission progress/ }).count(), 0);
        await page.keyboard.press('Escape');
        assert.equal(await dialog.count(), 0);
        assert.equal(requests.length, before);
        for (const [command, kind] of [['active', 'active:execute'], ['draft', 'draft:create'], ['handoff', 'handoff:record'], ['integrate', 'integrate:merge']] as const) {
          await clickAt(card.locator(`button[aria-label^="px ${command}"]`));
          await page.waitForFunction(() => !document.querySelector('[data-board-card] button[aria-label*="starting"]'));
          assert.deepEqual(requests.at(-1), { missionId: 'task-pointer-disposable', kind, missionStatusAtRequest: lane });
          assert.equal(await card.getAttribute('aria-selected'), 'false');
          assert.equal(await page.getByRole('dialog', { name: /Mission progress/ }).count(), 0);
        }
        await clickAt(card.locator('button[aria-label^="px cancel"]'));
        await clickAt(page.getByRole('button', { name: 'delete task-pointer-disposable lifecycle rows' }));
        await page.waitForFunction(() => !document.querySelector('[role="dialog"]'));
        assert.equal(requests.length, before + 5);
        assert.deepEqual(requests.at(-1), { missionId: 'task-pointer-disposable', kind: 'mission:cancel', missionStatusAtRequest: lane });
        // A blocked card retains one explanatory control, without unrelated buttons.
        await fixture.render(pointerSnapshot(lane, ['review', 'cancel'], work));
        assert.equal(await page.locator('[data-board-card] button:not([data-action-kind="mission:edit"])').count(), 2);
        await clickAt(page.locator('button[aria-label^="px review"]'));
        assert.equal(requests.length, before + 5);
        assert.match(await page.getByRole('status').first().textContent() ?? '', /Review submission is not available/);
        console.log(`matrix ${lane}/${work}: PASS enabled, unavailable, cancel, keep, focus, overlay; asset=${fixture.assetHash}`);
      }
    }
    // Browser contract also accepts all four actions if the server supplies them enabled.
    const simultaneous = pointerSnapshot('active');
    const supplied = { ...simultaneous, stages: simultaneous.stages.map((stage) => ({...stage, cards: stage.cards.map((card) => ({...card, actions: card.actions.map((action) => action.kind === 'review:submit' ? {...action, state: 'enabled' as const, reason: null} : action)}))})) };
    await fixture.render(supplied);
    const before = requests.length;
    for (const command of ['active', 'handoff', 'review', 'integrate']) {
      await clickAt(page.locator(`[data-board-card] button[aria-label^="px ${command}"]`));
      await page.waitForFunction(() => !document.querySelector('[data-board-card] button[aria-label*="starting"]'));
    }
    assert.deepEqual(requests.slice(before).map((request) => (request as {kind: string}).kind), ['active:execute', 'handoff:record', 'review:submit', 'integrate:merge']);
  } finally { await fixture.close(); }
});

test('SSE refresh during coordinate press cannot invoke another action or fall through (TASK-2705)', { timeout: 20_000 }, async (context) => {
  const fixture = await pointerBoard();
  context.after(fixture.close);
  const {page, requests} = fixture;
  page.setDefaultTimeout(3000);
  try {
    for (const lane of ['backlog', 'refined', 'active', 'review', 'integration'] as const) {
      await fixture.render(pointerSnapshot(lane));
      const control = page.locator('[data-board-card] button[aria-label^="px cancel"]');
      const box = await control.boundingBox(); assert.ok(box);
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down();
      await fixture.render(pointerSnapshot(lane, ['active', 'handoff', 'integrate']), true);
      await page.mouse.up();
      assert.equal(requests.length, 0);
      assert.equal(await page.locator('[data-board-card]').getAttribute('aria-selected'), 'false');
      assert.equal(await page.locator('[role="dialog"]').count(), 0);
      assert.equal(await page.getByRole('dialog', { name: /Mission progress/ }).count(), 0);
      await fixture.render(pointerSnapshot(lane));
      await clickAt(page.locator('[data-board-card] button[aria-label^="px cancel"]'));
      const refreshed = pointerSnapshot(lane);
      const unavailable = {...refreshed, stages: refreshed.stages.map((stage) => ({...stage, cards: stage.cards.map((card) => ({...card, actions: card.actions.map((action) => action.kind === 'mission:cancel' ? {...action, state: 'ineligible' as const, reason: 'refreshed cancellation denied'} : action)}))}))};
      await fixture.render(unavailable, true);
      await clickAt(page.getByRole('button', {name: 'delete task-pointer-disposable lifecycle rows'}));
      assert.equal(requests.length, 0);
      assert.match(await page.getByRole('dialog').getByRole('status').textContent() ?? '', /refreshed cancellation denied/);
      await fixture.render(pointerSnapshot(lane, ['active']), true);
      await clickAt(page.getByRole('button', {name: 'delete task-pointer-disposable lifecycle rows'}));
      assert.equal(requests.length, 0);
      assert.match(await page.getByRole('dialog').getByRole('status').textContent() ?? '', /Cancellation was not sent.*no longer available/);
      await page.keyboard.press('Escape');
    }
  } finally { await fixture.close(); }
});

test('tall board modal and pending coordinate presses remain safe (TASK-2705)', { timeout: 20_000 }, async (context) => {
  const fixture = await pointerBoard();
  context.after(fixture.close);
  const {page, requests} = fixture;
  page.setDefaultTimeout(3000);
  try {
    const base = pointerSnapshot('backlog');
    const tall = {...base, stages: base.stages.map((stage) => ({...stage, cards: stage.cards.flatMap((card) => Array.from({length: 40}, (_, index) => ({...card, id: index === 39 ? card.id : `task-disposable-${index}`}))) }))};
    await fixture.render(tall);
    const cancel = page.locator('[data-board-card="task-pointer-disposable"] button[aria-label^="px cancel"]');
    await clickAt(cancel);
    const dialog = page.getByRole('dialog');
    const box = await dialog.boundingBox(); assert.ok(box);
    assert.ok(box.y >= 0 && box.y + box.height <= 700);
    assert.equal(await page.evaluate(() => document.activeElement?.textContent), 'keep mission');
    await page.keyboard.press('Escape');
    await fixture.render(pointerSnapshot('active'));
    await page.evaluate(() => {
      (window as unknown as { unsafeDrag: boolean }).unsafeDrag = false;
      document.addEventListener('dragstart', (event) => {
        if (!event.defaultPrevented) { (window as unknown as { unsafeDrag: boolean }).unsafeDrag = true; }
      });
    });
    const start = await page.locator('[data-board-card] button[aria-label^="px active"]').boundingBox(); assert.ok(start);
    await page.mouse.move(start.x + start.width / 2, start.y + start.height / 2);
    await page.mouse.down();
    await page.mouse.move(start.x + start.width + 80, start.y + start.height / 2, {steps: 10});
    await page.mouse.up();
    assert.equal(await page.evaluate(() => (window as unknown as {unsafeDrag: boolean}).unsafeDrag), false);
    assert.equal(requests.length, 0);
    fixture.hold();
    const active = page.locator('[data-board-card] button[aria-label^="px active"]');
    await clickAt(active);
    await page.waitForFunction(() => !!document.querySelector('[data-board-card] button[aria-label*="starting"]'));
    await clickAt(active);
    await clickAt(page.locator('[data-board-card] button[aria-label^="px handoff"]'));
    await clickAt(page.locator('[data-board-card] button[aria-label^="px cancel"]'));
    assert.equal(requests.length, 1);
    assert.equal(await page.getByRole('dialog').count(), 0);
    assert.match(await page.getByRole('status').first().textContent() ?? '', /already running/);
    fixture.release();
    await page.waitForFunction(() => !document.querySelector('[data-board-card] button[aria-label*="starting"]'));
  } finally { await fixture.close(); }
});
