import { webProjection } from '../../../fixtures/web-projection.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { HTMLButtonElement as DomButton, HTMLElement as DomHtmlElement } from 'happy-dom';
import { act } from 'react';
import { agentFamily } from '../../../../src/domain/agents.js';
import { missionId } from '../../../../src/domain/mission.js';
import { makeCard, makeProjection } from '../../../fixtures/board-projection.js';
import { renderBoard } from './web-board-harness.fixture.js';

test('checkpoint evidence opens from the label and closes from its dialog (TASK-2660, TASK-2745)', async () => {
  const card = makeCard({
    id: missionId('task-2660-detail'),
    status: 'review',
    lane: 'review',
    checkpoint: 'CP-2.md',
    checkpointDescription: 'CP-2: components extracted',
    checkpointEvidence: [
      { name: 'CP-1', description: 'CP-1: plan', goalCheck: [{ criterion: 'runs the gate', evidence: 'npm test' }] },
      { name: 'CP-2', description: 'CP-2: components extracted', goalCheck: [
        { criterion: 'adds rows', evidence: 'test/unit/x' },
        { criterion: 'wires the wire', evidence: 'src/interfaces/web/transport.ts' },
      ] },
    ],
  });
  const projection = makeProjection({ review: [card] });
  const page = await renderBoard({ board: webProjection.snapshot(projection), detail: webProjection.detail(projection, card.id) });
  try {
    const label = page.mount.querySelector<DomHtmlElement>('button[aria-label^="View checkpoint evidence for"]')!;
    assert.equal(page.window.document.querySelector('[role="dialog"]'), null, 'no panel before the first click');
    await act(async () => { label.dispatchEvent(new page.window.MouseEvent('click', { bubbles: true, detail: 0 })); });
    const dialog = page.window.document.querySelector('[role="dialog"]');
    assert.ok(dialog !== null, 'the panel opens on click');
    assert.match(dialog?.textContent ?? '', /CP-2: components extracted/, 'the panel renders the checkpoint description');
    assert.match(dialog?.textContent ?? '', /Last recorded Goal Check evidence/);
    assert.match(dialog?.textContent ?? '', /adds rows/);
    assert.match(dialog?.textContent ?? '', /wires the wire/);
    assert.match(dialog?.textContent ?? '', /test\/unit\/x/);
    assert.match(dialog?.textContent ?? '', /src\/interfaces\/web\/transport\.ts/);
    assert.doesNotMatch(dialog?.textContent ?? '', /runs the gate/, 'an unopened checkpoint keeps its rows hidden');
    await act(async () => { page.window.document.querySelector<DomButton>('[role="dialog"] button')!.click(); });
    assert.equal(page.window.document.querySelector('[role="dialog"]'), null, 'the dialog close control closes the panel');
  } finally { await page.close(); }
});

test('a completed detail read missing the selected checkpoint ends in an explicit changed state (PX-0058.04)', async () => {
  const card = makeCard({ id: missionId('task-detail-changed'), checkpoint: 'CP-1',
    checkpointEvidence: [{ name: 'CP-1', description: 'Recorded', goalCheck: [{ criterion: 'visible', evidence: 'npm test' }] }] });
  const projection = makeProjection({ active: [card] });
  const detail = { ...webProjection.detail(projection, card.id), checkpointEvidence: [] };
  const page = await renderBoard({ board: webProjection.snapshot(projection), detail });
  try {
    const label = page.mount.querySelector<DomHtmlElement>('button[aria-label^="View checkpoint evidence for"]')!;
    await act(async () => { label.click(); });
    const dialog = page.window.document.querySelector('[role="dialog"]')!;
    assert.match(dialog.textContent, /Checkpoint evidence changed; refresh the board/);
    assert.doesNotMatch(dialog.textContent, /Loading checkpoint evidence/);
  } finally { await page.close(); }
});

test('the checkpoint evidence panel closes on Escape (TASK-2660)', async () => {
  const card = makeCard({
    id: missionId('task-2660-escape'),
    status: 'review',
    lane: 'review',
    checkpoint: 'CP-1.md',
    checkpointDescription: 'CP-1: plan',
    checkpointEvidence: [
      { name: 'CP-1', description: 'CP-1: plan', goalCheck: [{ criterion: 'runs the gate', evidence: 'npm test' }] },
    ],
  });
  const projection = makeProjection({ review: [card] });
  const page = await renderBoard({ board: webProjection.snapshot(projection), detail: webProjection.detail(projection, card.id) });
  try {
    const label = page.mount.querySelector<DomHtmlElement>('button[aria-label^="View checkpoint evidence for"]')!;
    await act(async () => { label.dispatchEvent(new page.window.MouseEvent('click', { bubbles: true, detail: 0 })); });
    assert.ok(page.window.document.querySelector('[role="dialog"]'), 'the panel opens on click');
    await act(async () => { page.window.dispatchEvent(new page.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); });
    assert.equal(page.window.document.querySelector('[role="dialog"]'), null, 'Escape closes the panel');
  } finally { await page.close(); }
});

test('selecting a different checkpoint keeps the dialog open and shows its rows (TASK-2660)', async () => {
  const card = makeCard({
    id: missionId('task-2660-select'),
    status: 'review',
    lane: 'review',
    checkpoint: 'CP-1.md',
    checkpointDescription: 'CP-1: plan',
    checkpointEvidence: [
      { name: 'CP-1', description: 'CP-1: plan', goalCheck: [{ criterion: 'first gate', evidence: 'npm test' }] },
      { name: 'CP-2', description: 'CP-2: components extracted', goalCheck: [{ criterion: 'second gate', evidence: 'npm run build' }] },
    ],
  });
  const projection = makeProjection({ review: [card] });
  const page = await renderBoard({ board: webProjection.snapshot(projection), detail: webProjection.detail(projection, card.id) });
  try {
    const label = page.mount.querySelector<DomHtmlElement>('button[aria-label^="View checkpoint evidence for"]')!;
    await act(async () => { label.dispatchEvent(new page.window.MouseEvent('click', { bubbles: true, detail: 0 })); });
    const dialog = page.window.document.querySelector('[role="dialog"]');
    assert.ok(dialog !== null, 'the panel opens on click');
    assert.match(dialog?.textContent ?? '', /CP-1: plan/, 'the panel opens on the first active checkpoint');
    // The CP-2 selector button click bubbles up to the backdrop; only a direct
    // backdrop click dismisses the panel, so selecting a checkpoint keeps it open.
    const selectors = page.window.document.querySelectorAll('nav[aria-label="Checkpoints"] button');
    const cp2 = [...selectors].find((button) => (button.textContent ?? '').includes('CP-2 · unknown'));
    assert.ok(cp2, 'the CP-2 selector button is present');
    await act(async () => { cp2.dispatchEvent(new page.window.MouseEvent('click', { bubbles: true, detail: 0 })); });
    assert.ok(page.window.document.querySelector('[role="dialog"]'), 'selecting a checkpoint keeps the dialog open');
    const reopened = page.window.document.querySelector('[role="dialog"]');
    assert.match(reopened?.textContent ?? '', /CP-2: components extracted/, 'the dialog shows the selected checkpoint description');
    assert.match(reopened?.textContent ?? '', /second gate/, 'the dialog shows the selected checkpoint evidence rows');
    assert.doesNotMatch(reopened?.textContent ?? '', /first gate/, 'the dialog dropped the previous checkpoint rows');
  } finally { await page.close(); }
});

test('review attempt disclosure loads full history on demand from the typed detail read (PX-0058.04)', async () => {
  const card = makeCard({ id: missionId('task-review-detail'), status: 'review', lane: 'review', reviewRound: 1,
    reviewDisposition: 'REQUEST_CHANGES', reviewHistory: [{ number: 1, reviewer: agentFamily('codex'),
      implementer: agentFamily('custom'), phase: 'fixing', disposition: 'REQUEST_CHANGES', comment: 'full retained comment',
      findingSummaries: ['missing freshness'], pushbacks: ['revision is stable'], fixes: ['added explicit state'] }] });
  const projection = makeProjection({ review: [card] });
  const page = await renderBoard({ board: webProjection.snapshot(projection), detail: webProjection.detail(projection, card.id) });
  try {
    assert.doesNotMatch(page.mount.textContent, /full retained comment|missing freshness/,
      'bulky review detail is absent before disclosure');
    const open = page.mount.querySelector<DomButton>(`button[aria-label="View review history for ${card.id}"]`)!;
    await act(async () => { open.click(); });
    const dialog = page.window.document.querySelector('[role="dialog"]')!;
    assert.match(dialog.textContent, /full retained comment/);
    assert.match(dialog.textContent, /missing freshness/);
    assert.equal(page.calls.length, 1, 'the review disclosure performs one on-demand detail read');
  } finally { await page.close(); }
});

test('an open review disclosure keeps its loaded detail across unrelated board revisions (PX-0058.04)', async () => {
  const card = makeCard({ id: missionId('task-review-retained'), status: 'review', lane: 'review', reviewRound: 1,
    reviewHistory: [{ number: 1, reviewer: agentFamily('codex'), implementer: agentFamily('custom'), phase: 'reviewing',
      disposition: 'COMMENT', comment: 'retained review detail', findingSummaries: [], pushbacks: [], fixes: [] }] });
  const projection = makeProjection({ review: [card] });
  const board = webProjection.snapshot(projection);
  const detail = webProjection.detail(projection, card.id);
  const page = await renderBoard({ board, detail });
  try {
    const open = page.mount.querySelector<DomButton>(`button[aria-label="View review history for ${card.id}"]`)!;
    await act(async () => { open.click(); });
    assert.match(page.window.document.querySelector('[role="dialog"]')!.textContent, /retained review detail/);
    await page.rerender({ ...board, freshness: { ...board.freshness, revision: 'unrelated-board-revision' } });
    assert.match(page.window.document.querySelector('[role="dialog"]')!.textContent, /retained review detail/);
    assert.equal(page.calls.length, 1, 'a live board revision does not re-download an open disclosure');
  } finally { await page.close(); }
});

test('an open checkpoint disclosure keeps its loaded detail across unrelated board revisions (PX-0058.04)', async () => {
  const card = makeCard({ id: missionId('task-checkpoint-retained'), checkpoint: 'CP-1',
    checkpointEvidence: [{ name: 'CP-1', description: 'Recorded',
      goalCheck: [{ criterion: 'retained checkpoint detail', evidence: 'npm test' }] }] });
  const projection = makeProjection({ active: [card] });
  const board = webProjection.snapshot(projection);
  const page = await renderBoard({ board, detail: webProjection.detail(projection, card.id) });
  try {
    const open = page.mount.querySelector<DomButton>('button[aria-label^="View checkpoint evidence for"]')!;
    await act(async () => { open.click(); });
    assert.match(page.window.document.querySelector('[role="dialog"]')!.textContent, /retained checkpoint detail/);
    await page.rerender({ ...board, freshness: { ...board.freshness, revision: 'unrelated-board-revision' } });
    assert.match(page.window.document.querySelector('[role="dialog"]')!.textContent, /retained checkpoint detail/);
    assert.equal(page.calls.length, 1, 'a live board revision does not re-download checkpoint detail');
  } finally { await page.close(); }
});

test('a detail read one projection ahead waits for the board and retries without an unavailable state (PX-0058.04)', async () => {
  const card = makeCard({ id: missionId('task-review-race'), status: 'review', lane: 'review', reviewRound: 1,
    reviewHistory: [{ number: 1, reviewer: agentFamily('codex'), implementer: agentFamily('custom'), phase: 'reviewing',
      disposition: 'COMMENT', comment: 'newer review detail', findingSummaries: [], pushbacks: [], fixes: [] }] });
  const projection = makeProjection({ review: [card] });
  const current = webProjection.snapshot(projection);
  const newerRevision = 'newer-completed-projection';
  const newerDetail = { ...webProjection.detail(projection, card.id),
    freshness: { ...current.freshness, revision: newerRevision } };
  const page = await renderBoard({ board: current, respond: async () => new Response(JSON.stringify(newerDetail), {
    headers: { 'content-type': 'application/json' },
  }) });
  try {
    const open = page.mount.querySelector<DomButton>(`button[aria-label="View review history for ${card.id}"]`)!;
    await act(async () => { open.click(); });
    const dialog = page.window.document.querySelector('[role="dialog"]')!;
    assert.match(dialog.textContent, /Loading review history/);
    assert.doesNotMatch(dialog.textContent, /Review history unavailable/);
    await page.rerender({ ...current, freshness: { ...current.freshness, revision: newerRevision } });
    assert.match(dialog.textContent, /newer review detail/);
    assert.doesNotMatch(dialog.textContent, /Review history unavailable/);
    assert.equal(page.calls.length, 2, 'the snapshot/detail race gets one retry against the current board');
  } finally { await page.close(); }
});
