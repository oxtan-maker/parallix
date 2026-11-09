/** Disposable Chromium checkpoint exercise; no operator data or workflow writes. */
import assert from 'node:assert/strict';
import type { Locator } from 'playwright-core';
import { pointerBoard } from './web-pointer-board.js';
import { makeCard, makeProjection } from './board-projection.js';
import { missionId } from '../../src/domain/mission.js';
import { toWebBoardSnapshot } from '../../src/interfaces/web/transport.js';

type Checkpoint = NonNullable<ReturnType<typeof makeCard>['checkpointEvidence']>[number];

const pullRequest = { kind: 'pull-request' as const, provider: 'forgejo', id: '47', url: 'https://example.invalid/pr/47',
  sourceBranch: 'mission/task-checkpoint-partial', targetBranch: 'main' };

function checkpoints(length: number, completed: number, known = true): Checkpoint[] {
  return Array.from({ length }, (_unused, index) => ({
    name: `CP-${index + 1}`,
    description: `Disposable step ${index + 1}`,
    goalCheck: index < completed ? [{ criterion: 'Fixture checked', evidence: 'Disposable browser observation' }] : [],
    ...(known ? { state: index < completed ? 'completed' as const : index === completed ? 'current' as const : 'future' as const } : {}),
  }));
}

const cases = [
  makeCard({ id: missionId('task-checkpoint-partial'), title: 'Partial checkpoint plan', gate: 'running', checkpoint: 'CP-1',
    checkpointEvidence: checkpoints(3, 1), pullRequest, reviewRound: 3 }),
  makeCard({ id: missionId('task-checkpoint-complete'), title: 'Complete checkpoint plan', gate: 'passed', checkpoint: 'CP-3',
    checkpointEvidence: checkpoints(3, 3), reviewRound: 2 }),
  makeCard({ id: missionId('task-checkpoint-unknown'), title: 'Unknown checkpoint progress', gate: 'failed', checkpoint: 'CP-1',
    checkpointEvidence: checkpoints(3, 1, false), reviewRound: 3 }),
  makeCard({ id: missionId('task-checkpoint-long'), title: 'One hundred checkpoint plan', gate: 'unavailable', checkpoint: 'CP-99',
    checkpointEvidence: checkpoints(100, 99), pullRequest: { ...pullRequest, id: '826' }, reviewRound: 5 }),
];

async function geometry(card: Locator) {
  return card.evaluate((element) => {
    const row = element.querySelector<HTMLElement>('[data-card-progress-row]')!;
    const progress = row.querySelector<HTMLElement>('[aria-label="Checkpoint plan"]');
    const gate = row.querySelector<HTMLElement>('[data-gate-status]')!;
    const review = row.querySelector<HTMLElement>('[aria-label="Pull request and review"]')
      ?? row.querySelector<HTMLElement>('[aria-label="Review attempts"]')!;
    const rowBox = row.getBoundingClientRect();
    const progressBox = progress?.getBoundingClientRect() ?? null;
    const gateBox = gate.getBoundingClientRect();
    const reviewBox = review.getBoundingClientRect();
    return {
      rowHeight: rowBox.height,
      rowWidth: row.clientWidth,
      rowContentWidth: row.scrollWidth,
      progressWidth: progressBox?.width ?? null,
      gateWidth: gateBox.width,
      reviewWidth: reviewBox.width,
      rowOverflow: row.scrollWidth > row.clientWidth,
      cardOverflow: element.scrollWidth > element.clientWidth,
      overlap: progressBox !== null && (progressBox.right > gateBox.left || gateBox.right > reviewBox.left),
      ordered: progressBox !== null && progressBox.left < gateBox.left && gateBox.left < reviewBox.left,
      sameLine: progressBox !== null && Math.abs((progressBox.top + progressBox.bottom) / 2 - (reviewBox.top + reviewBox.bottom) / 2) < 1,
    };
  });
}

const fixture = await pointerBoard();
try {
  await fixture.render(toWebBoardSnapshot(makeProjection({ active: cases })));
  for (const viewport of [{ width: 1600, height: 900 }, { width: 390, height: 844 }]) {
    await fixture.page.setViewportSize(viewport);
    for (const card of cases) {
      const article = fixture.page.locator(`[data-board-card="${card.id}"]`);
      const result = await geometry(article);
      assert.ok(result.rowHeight <= 32, `${card.id} row is ${result.rowHeight}px at ${viewport.width}px`);
      assert.equal(result.rowOverflow, false, `${card.id} row stays bounded at ${viewport.width}px: ${JSON.stringify(result)}`);
      assert.equal(result.cardOverflow, false, `${card.id} card stays bounded at ${viewport.width}px`);
      assert.equal(result.overlap, false, `${card.id} progress and gate do not overlap at ${viewport.width}px`);
      assert.equal(result.ordered, true, `${card.id} reads checkpoints, gate, review at ${viewport.width}px`);
      assert.equal(result.sameLine, true, `${card.id} progression stays on one line at ${viewport.width}px`);
    }
    assert.equal(await fixture.page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth), false,
      `board has no horizontal overflow at ${viewport.width}px`);
    const screenshotCard = fixture.page.locator('[data-board-card="task-checkpoint-partial"]');
    await screenshotCard.scrollIntoViewIfNeeded();
    if (viewport.width < 500) {
      await screenshotCard.evaluate((element) => {
        const clone = element.cloneNode(true) as HTMLElement;
        clone.id = 'px-0032-narrow-capture';
        clone.removeAttribute('data-board-card');
        Object.assign(clone.style, { position: 'fixed', inset: '8px auto auto 8px', width: `${element.getBoundingClientRect().width}px`, zIndex: '10000' });
        document.body.append(clone);
      });
      const capture = fixture.page.locator('#px-0032-narrow-capture');
      await capture.screenshot({ path: `/tmp/px-0032-progression-${viewport.width}.png` });
      await capture.evaluate((element) => element.remove());
    } else { await fixture.page.screenshot({ path: `/tmp/px-0032-progression-${viewport.width}.png` }); }
  }

  const partial = fixture.page.locator('[data-board-card="task-checkpoint-partial"]');
  assert.match(await partial.getByRole('group', { name: 'Checkpoint plan' }).getAttribute('aria-description') ?? '', /1\/3 completed · Current: CP-2/);
  assert.equal(await partial.locator('[data-checkpoint-summary]').count(), 0, 'the original bar has no added progress label');
  assert.match(await partial.textContent() ?? '', /gate · running.*PR #47/s);
  assert.equal(await partial.locator('[data-review-attempt]').count(), 3, 'multiple review attempts remain in the progression row');
  const disclosure = partial.getByRole('button', { name: /View checkpoint evidence/ });
  await disclosure.focus();
  await fixture.page.keyboard.press('Enter');
  const dialog = fixture.page.getByRole('dialog', { name: /Checkpoint evidence/ });
  assert.match(await dialog.textContent() ?? '', /✓ CP-1 · completed.*▶ CP-2 · current.*○ CP-3 · future/s);
  await fixture.page.keyboard.press('Escape');
  assert.equal(await dialog.count(), 0);
  assert.equal(await disclosure.evaluate((element) => element === document.activeElement), true, 'closing restores disclosure focus');
  await partial.focus();
  await fixture.page.keyboard.press('Enter');
  const reviewDialog = fixture.page.getByRole('dialog', { name: /Mission progress/ });
  await reviewDialog.waitFor();
  await fixture.page.keyboard.press('Escape');

  const complete = fixture.page.locator('[data-board-card="task-checkpoint-complete"]');
  assert.match(await complete.getByRole('group', { name: 'Checkpoint plan' }).getAttribute('aria-description') ?? '', /3\/3 completed/);
  assert.match(await complete.textContent() ?? '', /gate ✓/);
  const unknown = fixture.page.locator('[data-board-card="task-checkpoint-unknown"]');
  assert.match(await unknown.textContent() ?? '', /checkpoints · completion unknown.*gate ✗ FAIL/s);
  assert.equal(await unknown.locator('[data-checkpoint-track]').count(), 0, 'unknown state has no invented progress track');
  const long = fixture.page.locator('[data-board-card="task-checkpoint-long"]');
  assert.match(await long.getByRole('group', { name: 'Checkpoint plan' }).getAttribute('aria-description') ?? '', /99\/100 completed · Current: CP-100/);
  assert.match(await long.textContent() ?? '', /gate · unknown/);
  assert.equal(fixture.requests.length, 0);
  console.log('PASS: checkpoints → gates → review stays compact at desktop/narrow widths with accessible dialogs and zero command writes');
} finally { await fixture.close(); }
