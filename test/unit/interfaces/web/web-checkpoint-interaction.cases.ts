import { webProjection } from '../../../fixtures/web-projection.js';
// Checkpoint disclosure and progress interactions share the presentation suite owner.
import test from 'node:test';
import assert from 'node:assert/strict';
import { HTMLButtonElement as DomButton, HTMLElement as DomHtmlElement } from 'happy-dom';
import { act } from 'react';
import { renderBoard } from './web-board-harness.fixture.js';
import { makeCard, makeProjection } from '../../../fixtures/board-projection.js';
import { coveredRepairCheckpoints } from '../../../fixtures/covered-repair-checkpoints.js';
import { missionId } from '../../../../src/domain/mission.js';
import { agentFamily } from '../../../../src/domain/agents.js';

const snapshot = (cards: ReturnType<typeof makeCard>[]) => webProjection.snapshot(makeProjection({ active: cards }));
const isSameNode = (actual: unknown, expected: unknown) => actual === expected;

test('checkpoint track never blinks through activity transitions and retains disclosure (TASK-2773.04)', async () => {
  const card = makeCard({ checkpoint: 'CP-2', checkpointEvidence: [
    { name: 'CP-2', description: 'done', goalCheck: [{ criterion: 'done', evidence: 'npm test' }], state: 'completed' },
    { name: 'CP-9', description: 'current description', goalCheck: [], state: 'current' },
  ] });
  const page = await renderBoard({ board: snapshot([card]) });
  try {
    for (const freshness of ['live', 'unverified', 'stale', null] as const) {
      for (const blockingReason of [null, 'waiting']) {
        await page.rerender(snapshot([{ ...card, blockingReason, currentWork: freshness === null ? null : {
          operationId: 'execute', phase: 'execute', summary: 'execute', agent: null, updatedAt: 'now', freshness,
        } }]));
        assert.equal(page.mount.querySelectorAll('[aria-label="Checkpoint plan"] .review-pip--running').length, 0);
        assert.equal(page.mount.querySelector<DomHtmlElement>('[data-checkpoint-fill]')!.style.width, '50%');
        assert.match(page.mount.querySelector('[aria-label="Checkpoint plan"]')!.getAttribute('aria-description')!, /Current: CP-9/);
        const button = page.mount.querySelector<DomButton>('button[aria-label^="View checkpoint evidence for"]')!;
        assert.ok(button.querySelector('[data-checkpoint-track]'), 'the progress track itself is the dialog control');
        assert.equal(button.style.cursor, 'pointer');
        assert.equal(page.mount.querySelector('[aria-label="Checkpoint plan"]')!.textContent, '', 'the track replaces the visible count/current/recorded summary row');
        assert.match(button.title, /1\/2 completed.*Current: CP-9.*Recorded: CP-2/);
        assert.doesNotMatch(button.textContent, /View checkpoints/);
        button.focus();
        await act(async () => { button.click(); });
        const dialog = page.window.document.querySelector('[role="dialog"]')!;
        assert.match(dialog.textContent, /current description/);
        assert.equal(page.window.document.querySelectorAll('[role="dialog"]').length, 1);
        await act(async () => { dialog.querySelector<DomButton>('button')!.click(); });
        assert.ok(isSameNode(page.window.document.activeElement, button), 'closing restores opener focus');
      }
    }
  } finally { await page.close(); }
});


test('execution advances to the next checkpoint after recorded completion (TASK-2776)', async () => {
  const { projectMissionCard } = await import('../../../../src/application/projections/mission-board.js');
  const base = makeCard();
  const projected = projectMissionCard({ ...base, assignee: null, closedAt: null, review: null,
    netEngineeringLines: null, checkpoints: [1, 2, 3].map(number => ({
      missionId: base.id, name: `CP-${number}`, firstLine: 'Step',
      goalCheck: number === 1 ? [{ criterion: 'done', evidence: 'npm test' }] : [],
      nextActionText: number === 1 ? 'Resume CP-2' : '',
    })),
  }, { latestGate: 'unavailable', reviewApproval: null, flags: [], blockingReason: null,
    currentWork: { operationId: 'execute', phase: 'execute', summary: 'Implementing', agent: null, updatedAt: 'now', freshness: 'live' },
  });
  const page = await renderBoard({ board: snapshot([projected]) });
  try {
    assert.equal(page.mount.querySelectorAll('[aria-label="Checkpoint plan"] .review-pip--running').length, 0);
    assert.equal(projected.checkpoint, 'CP-1');
    assert.equal(projected.currentCheckpoint, 'CP-2');
    assert.match(page.mount.querySelector('[aria-label="Checkpoint plan"]')!.getAttribute('aria-description')!, /Current: CP-2/);
    assert.match(page.mount.querySelector('[aria-label="Checkpoint plan"]')!.getAttribute('aria-description')!, /Recorded: CP-1/);
    const percentage = Number.parseFloat(page.mount.querySelector<DomHtmlElement>('[data-checkpoint-fill]')!.style.width);
    assert.ok(Math.abs(percentage - 100 / 3) < 1e-9, 'one of three supplied checkpoints is completed');
  } finally { await page.close(); }
});

test('canonically settled repair renders full progress and a completed historical row (px-0072)', async () => {
  const { projectMissionCard } = await import('../../../../src/application/projections/mission-board.js');
  const base = makeCard();
  const project = (checkpoints: ReturnType<typeof coveredRepairCheckpoints>) => projectMissionCard({ ...base, assignee: null,
    closedAt: null, review: null, netEngineeringLines: null, checkpoints }, { latestGate: 'failed', reviewApproval: null,
    flags: [], blockingReason: null, currentWork: null });
  const settled = project(coveredRepairCheckpoints(base.id));
  const page = await renderBoard({ board: snapshot([settled]) });
  try {
    const plan = page.mount.querySelector('[aria-label="Checkpoint plan"]')!;
    assert.match(plan.getAttribute('aria-description')!, /^3\/3 completed/);
    assert.doesNotMatch(plan.getAttribute('aria-description')!, /Current:/);
    assert.equal(page.mount.querySelector<DomHtmlElement>('[data-checkpoint-fill]')!.style.width, '100%');
    assert.ok(page.mount.querySelector('[data-checkpoint-complete]'), 'all-complete mark shown');
    await act(async () => { page.mount.querySelector<DomButton>('button[aria-label^="View checkpoint evidence for"]')!.click(); });
    const dialog = page.window.document.querySelector('[role="dialog"]')!;
    const repairRow = [...dialog.querySelectorAll<DomButton>('nav button')].find(button => button.textContent.includes('CP-2'))!;
    assert.match(repairRow.textContent, /CP-2 · completed/);
    assert.doesNotMatch(dialog.textContent, /CP-2 · future/);
  } finally { await page.close(); }
  const open = project(coveredRepairCheckpoints(base.id, { coveredOccurrences: [] }));
  const reopened = await renderBoard({ board: snapshot([open]) });
  try {
    assert.match(reopened.mount.querySelector('[aria-label="Checkpoint plan"]')!.getAttribute('aria-description')!, /^2\/3 completed · Current: CP-2/);
    assert.equal(reopened.mount.querySelector('[data-checkpoint-complete]'), null);
  } finally { await reopened.close(); }
});

for (const lane of ['refined', 'active', 'review', 'integration', 'done'] as const) {
  test(`checkpoint dialog opens unrecorded long plans in ${lane} (TASK-2773.04)`, async () => {
    const plan = Array.from({ length: 100 }, (_, i) => ({ name: `CP-${i}`, description: `Description ${i}`, goalCheck: [] }));
    const card = makeCard({ lane, status: lane, checkpoint: null, checkpointEvidence: plan });
    const projection = makeProjection({ [lane]: [card] });
    const page = await renderBoard({ board: webProjection.snapshot(projection), detail: webProjection.detail(projection, card.id) });
    try {
      const button = page.mount.querySelector<DomButton>('button[aria-label^="View checkpoint evidence for"]')!;
      await act(async () => { button.click(); });
      const dialog = page.window.document.querySelector('[role="dialog"]')!;
      const selectors = dialog.querySelectorAll<DomButton>('nav button');
      assert.equal(selectors.length, 100);
      await act(async () => { selectors[99].click(); });
      assert.match(dialog.textContent, /Description 99/);
      assert.match(dialog.textContent, /No evidence recorded/);
      await act(async () => { page.window.dispatchEvent(new page.window.KeyboardEvent('keydown', { key: 'Escape' })); });
      assert.equal(page.window.document.querySelector('[role="dialog"]'), null);
      assert.equal(page.calls.length, 1, 'opening the disclosure performs exactly one detail read');
    } finally { await page.close(); }
  });
}

test('done checkpoint modal escapes card stacking contexts and cleans up (TASK-2773.04 F1)', async () => {
  const cards = ['task-first', 'task-second'].map(id => makeCard({ id: missionId(id), lane: 'done', status: 'done',
    checkpointEvidence: [{ name: 'CP-1', description: id, goalCheck: [] }] }));
  const projection = makeProjection({ done: cards });
  const page = await renderBoard({ board: webProjection.snapshot(projection), detail: webProjection.detail(projection, cards[0].id) });
  try {
    const buttons = page.mount.querySelectorAll<DomButton>('button[aria-label^="View checkpoint evidence for"]');
    buttons[0].focus();
    await act(async () => { buttons[0].click(); });
    const dialog = page.window.document.querySelector('[role="dialog"]')!;
    assert.ok(dialog, 'first done card opens its dialog');
    assert.ok(isSameNode(dialog.parentElement?.parentElement, page.window.document.body), 'backdrop is outside all card stacking contexts');
    assert.equal(page.mount.querySelector('[role="dialog"]'), null);
    await act(async () => { dialog.parentElement!.dispatchEvent(new page.window.MouseEvent('click', { bubbles: true })); });
    assert.equal(page.window.document.querySelector('[role="dialog"]'), null);
    assert.ok(isSameNode(page.window.document.activeElement, buttons[0]));
    await act(async () => { buttons[1].click(); });
    assert.equal(page.window.document.querySelectorAll('[role="dialog"]').length, 1);
    assert.match(page.window.document.querySelector('[role="dialog"]')!.textContent, /task-second/);
    await page.rerender(webProjection.snapshot(makeProjection()));
    assert.equal(page.window.document.querySelector('[role="dialog"]'), null, 'removing the card removes its portal');
    assert.ok(page.calls.length >= 1, 'opening a disclosure reads detail on demand');
  } finally { await page.close(); }
});

