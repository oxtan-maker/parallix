import test from 'node:test';
import assert from 'node:assert/strict';
import { fixtureMission } from '../../fixtures/mission-builders.js';
import { makeProjection } from '../../fixtures/board-projection.js';
import { projectMissionCard } from '../../../src/application/projections/mission-board.js';
import { toWebBoardSnapshot } from '../../../src/interfaces/web/transport.js';
import type { Locator, Page } from 'playwright-core';
import { compactPointerSnapshot, pointerBoard, pointerSnapshot } from '../../fixtures/web-pointer-board.js';

async function clickAt(control: Locator) {
  await control.scrollIntoViewIfNeeded();
  const box = await control.boundingBox();
  assert.ok(box);
  await control.page().mouse.click(box.x + box.width / 2, box.y + box.height / 2);
}

async function waitForCommands(page: Page, timeout = 3000) {
  await page.waitForFunction(() => !document.querySelector('[data-board-card] button[aria-label*="starting"], [data-board-card] button[aria-label*="working"]'), undefined, { timeout });
}

test('pending current-work commands wait for the response before the next coordinate action (TASK-2724)', { timeout: 10_000 }, async (context) => {
  const fixture = await pointerBoard();
  context.after(fixture.close);
  const { page, requests } = fixture;
  await fixture.render(pointerSnapshot('refined', undefined, 'running'));
  fixture.hold();
  try {
    await clickAt(page.locator('[data-board-card] button[data-action-kind="handoff:record"]'));
    await page.waitForFunction(() => !!document.querySelector('[data-board-card] button[aria-label*="working"]'));
    // A held response must keep the sequential matrix waiting even when the
    // refreshed card uses the working label instead of the starting label.
    await assert.rejects(waitForCommands(page, 100), /Timeout/);
    assert.equal(requests.length, 1);
    fixture.release();
    await waitForCommands(page);
    await clickAt(page.locator('[data-board-card] button[data-action-kind="integrate:merge"]'));
    await waitForCommands(page);
    assert.deepEqual(requests.map((request) => (request as { kind: string }).kind), ['handoff:record', 'integrate:merge']);
  } finally { fixture.release(); await fixture.close(); }
});

async function clickCommand(control: Locator) {
  const page = control.page();
  // Observe this request before waiting for React to clear its pending state.
  // Running-work projections label pending actions "working", not "starting".
  const response = page.waitForResponse((result) => result.request().method() === 'POST');
  await clickAt(control);
  await response;
  await page.waitForFunction(() => !document.querySelector(
    '[data-board-card] button[aria-label*="starting"], [data-board-card] button[aria-label*="working"]',
  ));
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
          await clickCommand(card.locator(`button[aria-label^="px ${command}"]`));
          assert.deepEqual(requests.at(-1), { missionId: 'task-pointer-disposable', kind, missionStatusAtRequest: lane });
          assert.equal(await card.getAttribute('aria-selected'), 'false');
          assert.equal(await page.getByRole('dialog', { name: /Mission progress/ }).count(), 0);
        }
        await clickAt(card.locator('button[aria-label^="px cancel"]'));
        // Confirmation closes the dialog before the POST reaches the server.
        // Await delivery and pending cleanup before inspecting requests or rerendering.
        await clickCommand(page.getByRole('button', { name: 'delete task-pointer-disposable lifecycle rows' }));
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
      await clickCommand(page.locator(`[data-board-card] button[aria-label^="px ${command}"]`));
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
      // The press has to be observed by the page while the pre-refresh control is
      // still there. Issuing mouse.down() only proves the browser process got it:
      // on a loaded runner the pointerdown used to land after the refresh had
      // committed, so the scenario became a plain click on the refreshed board,
      // which legitimately selects the card and opens its terminal.
      await fixture.press(box.x + box.width / 2, box.y + box.height / 2, 'mission:cancel');
      await fixture.render(pointerSnapshot(lane, ['active', 'handoff', 'integrate']), true);
      await fixture.releasePress();
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
    await waitForCommands(page);
  } finally { await fixture.close(); }
});


test('checkpoint indicators stay below terminal and edit dialogs with usable evidence (TASK-2745)', { timeout: 20_000 }, async (context) => {
  const fixture = await pointerBoard();
  context.after(fixture.close);
  const { page } = fixture;
  const mission = fixtureMission('task-pointer-disposable', { checkpoints: [] });
  const planned = [1, 2, 3].map(number => ({ missionId: mission.id, name: `CP-${number}`, firstLine: `Step ${number}`, goalCheck: [], nextActionText: '' }));
  const show = async (partial: boolean, working: boolean, sse = false) => {
    const checkpoints = partial ? [{ ...planned[0], goalCheck: [{ criterion: 'visible', evidence: 'npm test' }], nextActionText: 'CP-2' }, ...planned.slice(1)] : planned;
    const card = projectMissionCard({ ...mission, checkpoints }, {
      latestGate: 'unknown', reviewApproval: null, flags: [], blockingReason: null,
      currentWork: working ? { operationId: 'execute', phase: 'execute', summary: 'Implement', agent: null, updatedAt: 'now', freshness: 'live' } : null,
    });
    await fixture.render(toWebBoardSnapshot(makeProjection({ active: [card] })), sse);
  };
  await page.route('**/api/terminal/**', route => route.fulfill({ json: { kind: 'live', output: 'Checkpoint terminal output' } }));
  await page.route('**/api/commands', route => route.fulfill({ json: {
    kind: 'command-result', transportVersion: 2, status: 'completed', error: null, durableEvidence: [],
    value: { missionId: mission.id, version: 1, title: mission.title, description: '', context: '', labels: [], successCriteria: ['visible'], successCriterionIds: ['sc-1'], dependencies: [] },
  } }));
  try {
    for (const partial of [false, true]) {
      await show(partial, false);
      const plan = page.getByLabel('Checkpoint plan', { exact: true });
      assert.deepEqual(await plan.locator('span').evaluateAll(nodes => nodes.map(node => node.getAttribute('aria-label'))), ['CP-1', 'CP-2', 'CP-3']);
      assert.equal(await plan.locator('.review-pip--running').count(), 0);
      await show(partial, true, true);
      const running = plan.locator('.review-pip--running');
      assert.equal(await running.count(), 1);
      assert.equal(await running.getAttribute('aria-label'), partial ? 'CP-2' : 'CP-1');
      assert.equal(await running.evaluate(node => getComputedStyle(node).animationName), 'blink');
      await show(partial, false, true);
      assert.equal(await plan.locator('.review-pip--running').count(), 0);
      assert.deepEqual(await plan.locator('span').evaluateAll(nodes => nodes.map(node => getComputedStyle(node).animationName)), ['none', 'none', 'none']);
    }
    // Open at coordinates; then hit-test at the underlying indicator location.
    const underlying = await page.getByLabel('Checkpoint plan', { exact: true }).boundingBox();
    assert.ok(underlying);
    const point = { x: underlying.x + 8, y: underlying.y + 4 };
    const assertCovered = async () => {
      assert.equal(await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.closest('[data-board-card]') === null, point), true);
    };
    await clickAt(page.locator('[data-board-card] p').first());
    const terminal = page.getByRole('dialog', { name: /Mission progress/ });
    await terminal.waitFor();
    await assertCovered();
    assert.match(await terminal.textContent() ?? '', /Checkpoint terminal output/);
    await page.mouse.click(point.x, point.y);
    assert.equal(await page.getByRole('dialog', { name: /Checkpoint evidence/ }).count(), 0);
    await terminal.waitFor({ state: 'hidden' });
    await clickAt(page.locator('[data-board-card] button[data-action-kind="mission:edit"]'));
    const edit = page.getByRole('dialog', { name: /Edit/ });
    await edit.waitFor();
    await assertCovered();
    await page.getByLabel('Title (required)', { exact: true }).fill('Disposable edit');
    assert.equal(await page.getByLabel('Title (required)', { exact: true }).inputValue(), 'Disposable edit');
    await page.keyboard.press('Escape');
    await edit.waitFor({ state: 'hidden' });
    await clickAt(page.getByRole('button', { name: 'View checkpoint evidence for CP-1' }));
    const evidence = page.getByRole('dialog', { name: /Checkpoint evidence/ });
    await evidence.waitFor();
    assert.match(await evidence.textContent() ?? '', /visible.*evidence: npm test/);
    await clickAt(evidence.getByRole('button', { name: 'close', exact: true }));
    await evidence.waitFor({ state: 'hidden' });
    console.log('TASK-2745 browser: CP-1/2/3 visible planned-only and partial; CP-1 then CP-2 blink on working and stop on idle; terminal/edit cover indicators at coordinates; editor typing and evidence access pass.');
  } finally { await fixture.close(); }
});
