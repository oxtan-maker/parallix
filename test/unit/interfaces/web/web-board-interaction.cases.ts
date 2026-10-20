import { renderBoard as renderBoardFixture } from './web-board-harness.fixture.js';
import { agentFamily } from '../../../../src/domain/agents.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { Window, Element as DomElement, HTMLButtonElement as DomButton, HTMLElement as DomHtmlElement } from 'happy-dom';
import { act } from 'react';
import { EMPTY_FLIGHT_LANE_WIDTH_PX, FLIGHT_LANE_MIN_WIDTH_PX, restoreActionFocus } from '../../../../web/src/board.js';
import { toWebBoardSnapshot } from '../../../../src/interfaces/web/transport.js';
import { makeCard, makeProjection } from '../../../fixtures/board-projection.js';
import { missionId } from '../../../../src/domain/mission.js';

const action = { command: 'handoff', enabled: true, reason: null, targetLane: 'review' } as const;
const cancel = { command: 'cancel', enabled: true, reason: null, targetLane: null, label: 'cancel ✕' } as const;
const request = { missionId: 'task-2436-interaction', kind: 'handoff:record', missionStatusAtRequest: 'active' };
const commandResult = (status = 'completed', error: { readonly kind: string; readonly message: string } | null = null) => ({ kind: 'command-result' as const, transportVersion: 2, status, value: null, error, durableEvidence: [] });

function snapshot(cards = [makeCard({ id: missionId('task-2436-interaction'), status: 'active', lane: 'active', commands: [action] })]) {
  return toWebBoardSnapshot(makeProjection({ active: cards }));
}

function renderBoard(options: Omit<Parameters<typeof renderBoardFixture>[0], 'board'> & { board?: ReturnType<typeof snapshot> } = {}) {
  return renderBoardFixture({ ...options, board: options.board ?? snapshot() });
}

function payload(calls: readonly RequestInit[]) {
  return JSON.parse(String(calls[0].body));
}

/**
 * Node identity as a boolean. `assert.equal(nodeA, nodeB)` serialises both
 * happy-dom nodes to build its diff when it fails, and that walk exhausts the
 * machine's memory, so element comparisons never reach the assertion.
 */
function isSameNode(actual: unknown, expected: unknown) {
  return actual === expected;
}

/**
 * The lane wrapper the board puts around a flight column; its inline style is
 * the lane's allocation, so a transition is observed where the layout is set.
 */
function laneWrapper(mount: DomElement, lane: string): DomHtmlElement {
  const section = mount.querySelector(`section[aria-label="${lane} stage"]`);
  assert.ok(section?.parentElement, `${lane} renders inside its lane wrapper`);
  return section!.parentElement as DomHtmlElement;
}

/** The allocation a rendered lane carries, as the browser sees it. */
function laneAllocation(mount: DomElement, lane: string) {
  const style = laneWrapper(mount, lane).style;
  return { flexGrow: style.flexGrow, flexShrink: style.flexShrink, flexBasis: style.flexBasis, minWidth: style.minWidth };
}

const COMPACT_ALLOCATION = { flexGrow: '0', flexShrink: '0', flexBasis: `${EMPTY_FLIGHT_LANE_WIDTH_PX}px`, minWidth: `${EMPTY_FLIGHT_LANE_WIDTH_PX}px` };
const POPULATED_ALLOCATION = { flexGrow: '1', flexShrink: '1', flexBasis: '0%', minWidth: `${FLIGHT_LANE_MIN_WIDTH_PX}px` };

test('board click and keyboard activation send one projected typed request', async () => {
  const page = await renderBoard();
  try {
    const button = page.mount.querySelector<DomButton>('button[aria-label^="px "][aria-label*=" — enabled"]')!;
    await act(async () => { button.click(); });
    assert.equal(page.calls.length, 1);
    assert.equal(typeof payload(page.calls).requestKey, 'string');
    assert.deepEqual({ ...payload(page.calls), requestKey: undefined }, { ...request, requestKey: undefined });
  } finally {
    await page.close();
  }
});

test('board keyboard activation sends the same projected typed request', async () => {
  const page = await renderBoard();
  try {
    const button = page.mount.querySelector<DomButton>('button[aria-label^="px "][aria-label*=" — enabled"]')!;
    await act(async () => {
      button.dispatchEvent(new page.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      button.dispatchEvent(new page.window.MouseEvent('click', { bubbles: true, detail: 0 }));
    });
    assert.equal(page.calls.length, 1);
    assert.equal(typeof payload(page.calls).requestKey, 'string');
    assert.deepEqual({ ...payload(page.calls), requestKey: undefined }, { ...request, requestKey: undefined });
  } finally { await page.close(); }
});

test('independent missions dispatch concurrently and retain separate pending state (TASK-2657)', async () => {
  let resolveFirst: ((response: Response) => void) | undefined;
  let resolveSecond: ((response: Response) => void) | undefined;
  let requestNumber = 0;
  const deferred: () => Promise<Response> = () => new Promise<Response>((resolve) => {
    requestNumber += 1;
    if (requestNumber === 1) { resolveFirst = resolve; } else { resolveSecond = resolve; }
  });
  const first = makeCard({ id: missionId('task-2657-a'), status: 'active', lane: 'active', commands: [action] });
  const second = makeCard({ id: missionId('task-2657-b'), status: 'active', lane: 'active', commands: [action] });
  const page = await renderBoard({ board: toWebBoardSnapshot(makeProjection({ active: [first, second] })), respond: deferred });
  try {
    const buttons = [...page.mount.querySelectorAll<DomButton>('button[aria-label^="px "][aria-label*=" — enabled"]')];
    await act(async () => { buttons[0].click(); });
    await act(async () => { buttons[1].click(); });
    assert.equal(page.calls.length, 2, 'B must cross the sendCommand boundary while A is unresolved');
    assert.match(buttons[0].getAttribute('aria-label') ?? '', /starting/);
    assert.match(buttons[1].getAttribute('aria-label') ?? '', /starting/);
    resolveFirst!(new Response(JSON.stringify(commandResult()), { headers: { 'content-type': 'application/json' } }));
    await act(async () => { await new Promise<void>((resolve) => queueMicrotask(resolve)); });
    assert.match(page.mount.querySelector(`[data-board-card="${first.id}"] footer [role="status"]`)?.textContent ?? '', /started/);
    assert.match(buttons[1].getAttribute('aria-label') ?? '', /starting/, 'A completion must not clear B pending state');
    await act(async () => {
      resolveSecond!(new Response(JSON.stringify(commandResult('failed', { kind: 'execution', message: 'second mission failure' })), { headers: { 'content-type': 'application/json' } }));
    });
    const firstOutcome = () => page.mount.querySelector(`[data-board-card="${first.id}"] footer [role="status"]`);
    const secondOutcome = () => page.mount.querySelector(`[data-board-card="${second.id}"] footer [role="status"]`);
    assert.match(firstOutcome()?.textContent ?? '', /started/);
    assert.match(secondOutcome()?.textContent ?? '', /second mission failure/);
    assert.equal(page.mount.querySelectorAll('[data-command-fallback]').length, 0);
    await act(async () => { buttons[0].click(); });
    assert.match(firstOutcome()?.textContent ?? '', /Starting/);
    assert.match(secondOutcome()?.textContent ?? '', /second mission failure/);
    await act(async () => { resolveSecond!(new Response(JSON.stringify(commandResult()), { headers: { 'content-type': 'application/json' } })); });
  } finally { await page.close(); }
});

test('rapid repeated activation synchronously sends one request (TASK-2657)', async () => {
  let resolveRequest: ((response: Response) => void) | undefined;
  const page = await renderBoard({ respond: () => new Promise<Response>((resolve) => { resolveRequest = resolve; }) });
  try {
    const button = page.mount.querySelector<DomButton>('button[aria-label^="px "][aria-label*=" — enabled"]')!;
    await act(async () => { button.click(); button.click(); });
    assert.equal(page.calls.length, 1, 'the ref latch must reject a repeat before React rerenders');
    assert.match(page.mount.querySelector('[role="status"]')?.textContent ?? '', /already running/i);
    resolveRequest!(new Response(JSON.stringify(commandResult()), { headers: { 'content-type': 'application/json' } }));
  } finally { await page.close(); }
});

test('a pending mission rejects its cancellation surface with feedback (TASK-2657)', async () => {
  let resolveRequest: ((response: Response) => void) | undefined;
  const card = makeCard({ id: missionId('task-2657-cancel'), status: 'active', lane: 'active', commands: [action, cancel] });
  const page = await renderBoard({ board: snapshot([card]), respond: () => new Promise<Response>((resolve) => { resolveRequest = resolve; }) });
  try {
    const buttons = [...page.mount.querySelectorAll<DomButton>('button')];
    await act(async () => { buttons.find((button) => /px handoff/.test(button.getAttribute('aria-label') ?? ''))!.click(); });
    await act(async () => { buttons.find((button) => /px cancel/.test(button.getAttribute('aria-label') ?? ''))!.click(); });
    assert.equal(page.calls.length, 1);
    assert.match(page.mount.querySelector('[role="status"]')?.textContent ?? '', /already running/i);
    resolveRequest!(new Response(JSON.stringify(commandResult()), { headers: { 'content-type': 'application/json' } }));
  } finally { await page.close(); }
});

test('drag start and drop on a pending mission give feedback without dispatching (TASK-2657)', async () => {
  let resolveRequest: ((response: Response) => void) | undefined;
  const page = await renderBoard({ respond: () => new Promise<Response>((resolve) => { resolveRequest = resolve; }) });
  try {
    const card = page.mount.querySelector<DomHtmlElement>('[data-board-card="task-2436-interaction"]')!;
    const drag = () => {
      const event = new page.window.Event('dragstart', { bubbles: true });
      Object.defineProperty(event, 'dataTransfer', { value: { setData() {}, setDragImage() {}, effectAllowed: '' } });
      return event;
    };
    await act(async () => { card.dispatchEvent(drag()); });
    await act(async () => { page.mount.querySelector<DomButton>('button[aria-label^="px "][aria-label*=" — enabled"]')!.click(); });
    await act(async () => { card.dispatchEvent(drag()); page.mount.querySelector<DomHtmlElement>('section[aria-label="review stage"] > div:last-child')!.dispatchEvent(new page.window.Event('drop', { bubbles: true })); });
    assert.equal(page.calls.length, 1);
    assert.match(page.mount.querySelector('[role="status"]')?.textContent ?? '', /Drop unavailable.*command is running/i);
    resolveRequest!(new Response(JSON.stringify(commandResult()), { headers: { 'content-type': 'application/json' } }));
  } finally { await page.close(); }
});

test('cancel pointer activation opens its confirmation from intake and flight cards', async () => {
  for (const lane of ['refined', 'active'] as const) {
    const card = makeCard({ id: missionId(`task-2553-${lane}`), status: lane, lane, commands: [cancel] });
    const page = await renderBoard({ board: toWebBoardSnapshot(makeProjection({ [lane]: [card] })) });
    try {
      const button = page.mount.querySelector<DomButton>('button[aria-label^="px cancel"]')!;
      const pointerDown = new page.window.MouseEvent('mousedown', { bubbles: true, cancelable: true });
      await act(async () => { button.dispatchEvent(pointerDown); button.click(); });
      assert.equal(pointerDown.defaultPrevented, true, `${lane} cancel must not focus and rerender its draggable card first`);
      assert.ok(page.mount.querySelector(`[aria-label="Confirm cancelling task-2553-${lane}"]`));
      assert.equal(page.calls.length, 0);
    } finally { await page.close(); }
  }
});

test('cancellation confirmation stays open when the refreshed projection removes its action (TASK-2657)', async () => {
  const card = makeCard({ id: missionId('task-2657-confirm'), status: 'active', lane: 'active', commands: [cancel] });
  const page = await renderBoard({ board: snapshot([card]) });
  try {
    await act(async () => { page.mount.querySelector<DomButton>('button[aria-label^="px cancel"]')!.click(); });
    await page.rerender(snapshot([makeCard({ ...card, commands: [] })]));
    await act(async () => { [...page.mount.querySelectorAll<DomButton>('button')].find((button) => /delete task-2657-confirm/.test(button.textContent ?? ''))!.click(); });
    assert.equal(page.calls.length, 0);
    assert.ok(page.mount.querySelector('[aria-label="Confirm cancelling task-2657-confirm"]'));
    assert.match(page.mount.querySelector('[role="status"]')?.textContent ?? '', /Cancellation was not sent.*no longer available/i);
  } finally { await page.close(); }
});

test('checkpoint evidence opens from the label and closes from its dialog (TASK-2660, TASK-2745)', async () => {
  const card = makeCard({
    id: missionId('task-2660-detail'),
    status: 'review',
    lane: 'review',
    checkpoint: 'CP-2.md',
    checkpointDescription: 'CP-2: components extracted',
    checkpointEvidence: [
      { name: 'CP-2', description: 'CP-2: components extracted', goalCheck: [{ criterion: 'runs the gate', evidence: 'npm test' }] },
    ],
  });
  const page = await renderBoard({ board: toWebBoardSnapshot(makeProjection({ review: [card] })) });
  try {
    const label = page.mount.querySelector<DomHtmlElement>('button[aria-label^="View checkpoint evidence for"]')!;
    assert.equal(page.window.document.querySelector('[role="dialog"]'), null, 'no panel before the first click');
    await act(async () => { label.dispatchEvent(new page.window.MouseEvent('click', { bubbles: true, detail: 0 })); });
    const dialog = page.window.document.querySelector('[role="dialog"]');
    assert.ok(dialog !== null, 'the panel opens on click');
    assert.match(dialog?.textContent ?? '', /CP-2: components extracted/, 'the panel renders the checkpoint description');
    assert.match(dialog?.textContent ?? '', /runs the gate/, 'the panel renders the Goal Check evidence row');
    await act(async () => { page.window.document.querySelector<DomButton>('[role="dialog"] button')!.click(); });
    assert.equal(page.window.document.querySelector('[role="dialog"]'), null, 'the dialog close control closes the panel');
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
  const page = await renderBoard({ board: toWebBoardSnapshot(makeProjection({ review: [card] })) });
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
  const page = await renderBoard({ board: toWebBoardSnapshot(makeProjection({ review: [card] })) });
  try {
    const label = page.mount.querySelector<DomHtmlElement>('button[aria-label^="View checkpoint evidence for"]')!;
    await act(async () => { label.dispatchEvent(new page.window.MouseEvent('click', { bubbles: true, detail: 0 })); });
    const dialog = page.window.document.querySelector('[role="dialog"]');
    assert.ok(dialog !== null, 'the panel opens on click');
    assert.match(dialog?.textContent ?? '', /CP-1: plan/, 'the panel opens on the first active checkpoint');
    // The CP-2 selector button click bubbles up to the backdrop; only a direct
    // backdrop click dismisses the panel, so selecting a checkpoint keeps it open.
    const selectors = page.window.document.querySelectorAll('nav[aria-label="Checkpoints"] button');
    const cp2 = [...selectors].find((button) => (button.textContent ?? '').trim() === 'CP-2');
    assert.ok(cp2, 'the CP-2 selector button is present');
    await act(async () => { cp2.dispatchEvent(new page.window.MouseEvent('click', { bubbles: true, detail: 0 })); });
    assert.ok(page.window.document.querySelector('[role="dialog"]'), 'selecting a checkpoint keeps the dialog open');
    const reopened = page.window.document.querySelector('[role="dialog"]');
    assert.match(reopened?.textContent ?? '', /CP-2: components extracted/, 'the dialog shows the selected checkpoint description');
    assert.match(reopened?.textContent ?? '', /second gate/, 'the dialog shows the selected checkpoint evidence rows');
    assert.doesNotMatch(reopened?.textContent ?? '', /first gate/, 'the dialog dropped the previous checkpoint rows');
  } finally { await page.close(); }
});

test('board unavailable action is visibly disabled and ignores pointer and keyboard activation', async () => {
  const page = await renderBoard({ board: snapshot([makeCard({ id: missionId('task-2436-interaction'), status: 'active', lane: 'active', commands: [{ ...action, enabled: false, reason: 'not eligible' }] })]) });
  try {
    const unavailable = page.mount.querySelector<DomButton>('button[aria-disabled="true"]')!;
    assert.match(unavailable.getAttribute('aria-label') ?? '', /not eligible/);
    await act(async () => {
      unavailable.dispatchEvent(new page.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      unavailable.click();
    });
    assert.equal(page.calls.length, 0);
  } finally { await page.close(); }
});

test('board conflict refreshes without retry and preserves the typed outcome', async () => {
  let refreshed = 0;
  const page = await renderBoard({ result: commandResult('failed', { kind: 'conflict', message: 'stale action' }), refresh: async () => { refreshed += 1; } });
  try {
    await act(async () => { page.mount.querySelector<DomButton>('button[aria-label^="px "][aria-label*=" — enabled"]')!.click(); });
    assert.equal(page.calls.length, 1);
    assert.equal(refreshed, 1);
    assert.match(page.mount.querySelector('[role="status"]')?.textContent ?? '', /stale action.*refreshed action/i);
  } finally { await page.close(); }
});

test('a thrown send and rejected refresh release only their own pending ownership without resend (TASK-2657)', async () => {
  const first = makeCard({ id: missionId('task-2657-throw'), status: 'active', lane: 'active', commands: [action] });
  const second = makeCard({ id: missionId('task-2657-refresh'), status: 'active', lane: 'active', commands: [action] });
  let calls = 0;
  const page = await renderBoard({
    board: toWebBoardSnapshot(makeProjection({ active: [first, second] })),
    respond: async () => {
      calls += 1;
      if (calls === 1) { throw new Error('network lost'); }
      return new Response(JSON.stringify(commandResult()), { headers: { 'content-type': 'application/json' } });
    },
    refresh: async () => { if (calls === 2) { throw new Error('refresh lost'); } },
  });
  try {
    const buttons = [...page.mount.querySelectorAll<DomButton>('button[aria-label^="px "][aria-label*=" — enabled"]')];
    await act(async () => { buttons[0].click(); await new Promise<void>((resolve) => queueMicrotask(resolve)); });
    assert.match(buttons[0].getAttribute('aria-label') ?? '', /enabled/, 'the thrown request must release its mission');
    await act(async () => { buttons[1].click(); await new Promise<void>((resolve) => queueMicrotask(resolve)); });
    assert.equal(page.calls.length, 2, 'a refresh failure must not resend the completed command');
    assert.match(buttons[1].getAttribute('aria-label') ?? '', /enabled/, 'the refresh failure must release only its mission');
  } finally { await page.close(); }
});

test('outcomes replace per mission and survive unavailable cards and refresh (TASK-2773.07)', async () => {
  let attempt = 0;
  const card = makeCard({ id: missionId('task-2657-outcome'), status: 'active', lane: 'active', commands: [action] });
  const page = await renderBoard({
    board: snapshot([card]),
    result: undefined,
    respond: async () => new Response(JSON.stringify(commandResult('failed', { kind: 'execution', message: `failure ${++attempt}` })), { headers: { 'content-type': 'application/json' } }),
  });
  try {
    const button = page.mount.querySelector<DomButton>('button[aria-label^="px "][aria-label*=" — enabled"]')!;
    await act(async () => { button.click(); await new Promise<void>((resolve) => queueMicrotask(resolve)); });
    await act(async () => { button.click(); await new Promise<void>((resolve) => queueMicrotask(resolve)); });
    assert.equal(page.mount.querySelectorAll('[role="status"]').length, 1);
    assert.match(page.mount.querySelector('[role="status"]')?.textContent ?? '', /failure 2/);
    await page.rerender(snapshot([]));
    const fallback = page.mount.querySelector('[data-command-fallback]')!;
    assert.match(fallback.textContent ?? '', /task-2657-outcome.*failure 2/);
    await page.rerender(snapshot([]));
    assert.match(page.mount.querySelector('[data-command-fallback]')?.textContent ?? '', /failure 2/);
    await page.rerender(snapshot([card]));
    assert.equal(page.mount.querySelector('[data-command-fallback]'), null);
    assert.match(page.mount.querySelector('[data-board-card] footer [role="status"]')?.textContent ?? '', /failure 2/);
  } finally { await page.close(); }
});

test('unmounting a request and completing an older request cannot restore stale focus (TASK-2657)', async () => {
  let resolveFirst: ((response: Response) => void) | undefined;
  let resolveSecond: ((response: Response) => void) | undefined;
  let ordinal = 0;
  const deferred: () => Promise<Response> = () => new Promise<Response>((resolve) => {
    ordinal += 1;
    if (ordinal === 1) { resolveFirst = resolve; } else { resolveSecond = resolve; }
  });
  const first = makeCard({ id: missionId('task-2657-focus-a'), status: 'active', lane: 'active', commands: [action] });
  const second = makeCard({ id: missionId('task-2657-focus-b'), status: 'active', lane: 'active', commands: [action] });
  const page = await renderBoard({ board: toWebBoardSnapshot(makeProjection({ active: [first, second] })), respond: deferred });
  let closed = false;
  try {
    const buttons = [...page.mount.querySelectorAll<DomButton>('button[aria-label^="px "][aria-label*=" — enabled"]')];
    await act(async () => { buttons[0].click(); buttons[1].focus(); buttons[1].click(); });
    resolveFirst!(new Response(JSON.stringify(commandResult()), { headers: { 'content-type': 'application/json' } }));
    await act(async () => { await new Promise<void>((resolve) => queueMicrotask(resolve)); });
    assert.equal(isSameNode(page.window.document.activeElement, buttons[1]), true, 'an older request must not steal focus');
    await page.close();
    closed = true;
    resolveSecond!(new Response(JSON.stringify(commandResult()), { headers: { 'content-type': 'application/json' } }));
    await new Promise<void>((resolve) => queueMicrotask(resolve));
  } finally {
    if (!closed) { await page.close(); }
  }
});

test('board failure leaves the card in its received lane and restores initiating focus', async () => {
  const page = await renderBoard({ result: commandResult('failed', { kind: 'execution', message: 'handoff failed' }) });
  try {
    const button = page.mount.querySelector<DomButton>('button[aria-label^="px "][aria-label*=" — enabled"]')!;
    await act(async () => { button.click(); await new Promise<void>((resolve) => queueMicrotask(resolve)); });
    assert.equal(page.calls.length, 1);
    assert.equal(page.mount.querySelector('[aria-label="active stage"] [data-board-card]')?.getAttribute('data-board-card'), 'task-2436-interaction');
    assert.match(page.mount.querySelector('[role="status"]')?.textContent ?? '', /handoff failed/);
    assert.equal(isSameNode(page.window.document.activeElement, button), true);
  } finally { await page.close(); }
});

test('board drag dispatches the projected target action and rejects other targets', async () => {
  const page = await renderBoard();
  try {
    const card = page.mount.querySelector<DomHtmlElement>('[data-board-card="task-2436-interaction"]')!;
    const drag = new page.window.Event('dragstart', { bubbles: true });
    Object.defineProperty(drag, 'dataTransfer', { value: { setData() {}, setDragImage() {}, effectAllowed: '' } });
    await act(async () => { card.dispatchEvent(drag); });
    await act(async () => { page.mount.querySelector<DomHtmlElement>('section[aria-label="review stage"] > div:last-child')!.dispatchEvent(new page.window.Event('drop', { bubbles: true })); });
    assert.equal(page.calls.length, 1);
    assert.equal(typeof payload(page.calls).requestKey, 'string');
    assert.deepEqual({ ...payload(page.calls), requestKey: undefined }, { ...request, requestKey: undefined });

    await act(async () => { card.dispatchEvent(drag); });
    await act(async () => { page.mount.querySelector<DomHtmlElement>('section[aria-label="integration stage"] > div:last-child')!.dispatchEvent(new page.window.Event('drop', { bubbles: true })); });
    assert.equal(page.calls.length, 1);
    assert.match(page.mount.querySelector('[role="status"]')?.textContent ?? '', /Drop unavailable/);
  } finally { await page.close(); }
});

test('an empty-to-populated snapshot expands the lane and a populated-to-empty snapshot compacts it without resetting selection or a running command (TASK-2773.06)', async () => {
  let resolveRequest: ((response: Response) => void) | undefined;
  const survivor = makeCard({ id: missionId('task-2773-06-survivor'), status: 'active', lane: 'active', commands: [action] });
  const emptyReview = toWebBoardSnapshot(makeProjection({ active: [survivor] }));
  const filledReview = toWebBoardSnapshot(makeProjection({
    active: [survivor],
    review: [makeCard({ id: missionId('task-2773-06-review'), status: 'review', lane: 'review' })],
  }));
  const page = await renderBoard({ board: emptyReview, respond: () => new Promise<Response>((resolve) => { resolveRequest = resolve; }) });
  try {
    assert.deepEqual(laneAllocation(page.mount, 'review'), COMPACT_ALLOCATION, 'the empty review lane starts compact');

    const card = page.mount.querySelector<DomHtmlElement>('[data-board-card="task-2773-06-survivor"]')!;
    await act(async () => { card.focus(); });
    assert.equal(card.getAttribute('aria-selected'), 'true', 'the mission is selected before the transitions');
    const button = page.mount.querySelector<DomButton>('button[aria-label^="px "][aria-label*=" — enabled"]')!;
    await act(async () => { button.click(); });
    assert.equal(page.calls.length, 1, 'one command is in flight across both transitions');
    assert.match(button.getAttribute('aria-label') ?? '', /starting/, 'the command is pending before the transitions');

    // Empty to populated: the lane takes the populated allocation.
    await page.rerender(filledReview);
    assert.deepEqual(laneAllocation(page.mount, 'review'), POPULATED_ALLOCATION, 'a populated review lane expands');
    assert.equal(page.mount.querySelector<DomHtmlElement>('[data-board-card="task-2773-06-survivor"]')?.getAttribute('aria-selected'), 'true', 'selection survives the expansion');
    assert.match(page.mount.querySelector<DomButton>('button[data-action-kind="handoff:record"]')?.getAttribute('aria-label') ?? '', /starting/, 'the pending command survives the expansion');
    assert.equal(page.calls.length, 1, 'the transition dispatches nothing of its own');

    // Populated to empty: the lane compacts back with the same state held.
    await page.rerender(emptyReview);
    assert.deepEqual(laneAllocation(page.mount, 'review'), COMPACT_ALLOCATION, 'an emptied review lane compacts');
    assert.equal(page.mount.querySelector<DomHtmlElement>('[data-board-card="task-2773-06-survivor"]')?.getAttribute('aria-selected'), 'true', 'selection survives the compaction');
    assert.match(page.mount.querySelector<DomButton>('button[data-action-kind="handoff:record"]')?.getAttribute('aria-label') ?? '', /starting/, 'the pending command survives the compaction');
    assert.equal(page.calls.length, 1, 'neither transition resends or drops the command');

    resolveRequest!(new Response(JSON.stringify(commandResult()), { headers: { 'content-type': 'application/json' } }));
    await act(async () => { await new Promise<void>((resolve) => queueMicrotask(resolve)); });
    assert.match(page.mount.querySelector<DomButton>('button[data-action-kind="handoff:record"]')?.getAttribute('aria-label') ?? '', / — enabled/, 'the command releases only its own pending state');
  } finally { await page.close(); }
});

test('a populated-to-empty snapshot that removes the selected mission keeps the existing selection semantics (TASK-2773.06)', async () => {
  const leaving = makeCard({ id: missionId('task-2773-06-leaving'), status: 'review', lane: 'review', commands: [action] });
  const page = await renderBoard({ board: toWebBoardSnapshot(makeProjection({ review: [leaving] })) });
  try {
    const card = page.mount.querySelector<DomHtmlElement>('[data-board-card="task-2773-06-leaving"]')!;
    await act(async () => { card.focus(); });
    assert.equal(card.getAttribute('aria-selected'), 'true');
    assert.deepEqual(laneAllocation(page.mount, 'review'), POPULATED_ALLOCATION, 'the lane is populated before the removal');
    await page.rerender(toWebBoardSnapshot(makeProjection({})));
    assert.deepEqual(laneAllocation(page.mount, 'review'), COMPACT_ALLOCATION, 'the lane that lost its only card compacts');
    assert.equal(page.mount.querySelectorAll('[aria-selected="true"]').length, 0, 'no other card takes over the removed mission selection');
    assert.equal(page.calls.length, 0, 'removal sends nothing on its own');
  } finally { await page.close(); }
});

test('a drop on a compact empty lane reaches its projected target action (TASK-2773.06)', async () => {
  const page = await renderBoard();
  try {
    const wrapper = laneWrapper(page.mount, 'review');
    assert.deepEqual(laneAllocation(page.mount, 'review'), COMPACT_ALLOCATION, 'the review lane is empty, so it renders compact');
    const card = page.mount.querySelector<DomHtmlElement>('[data-board-card="task-2436-interaction"]')!;
    const drag = new page.window.Event('dragstart', { bubbles: true });
    Object.defineProperty(drag, 'dataTransfer', { value: { setData() {}, setDragImage() {}, effectAllowed: '' } });
    await act(async () => { card.dispatchEvent(drag); });
    assert.equal(wrapper.getAttribute('aria-dropeffect'), 'move', 'the compact lane still advertises its drop target while dragging');
    const body = page.mount.querySelector<DomHtmlElement>('section[aria-label="review stage"] > div:last-child')!;
    const over = new page.window.Event('dragover', { bubbles: true, cancelable: true });
    await act(async () => { body.dispatchEvent(over); });
    assert.equal(over.defaultPrevented, true, 'the compact lane accepts the drag over');
    await act(async () => { body.dispatchEvent(new page.window.Event('drop', { bubbles: true })); });
    assert.equal(page.calls.length, 1);
    assert.deepEqual({ ...payload(page.calls), requestKey: undefined }, { ...request, requestKey: undefined }, 'compaction does not change what the drop dispatches');
  } finally { await page.close(); }
});

test('board focus fallback lands on the selected card after refresh removes the action', async () => {
  const window = new Window();
  const previous = globalThis.document;
  Object.assign(globalThis, { document: window.document });
  try {
    const root = document.createElement('div');
    root.tabIndex = -1;
    const card = document.createElement('article');
    card.dataset.boardCard = 'task-2436-interaction';
    card.setAttribute('aria-selected', 'true');
    card.tabIndex = 0;
    const button = document.createElement('button');
    root.append(card, button);
    document.body.append(root);
    button.remove();
    restoreActionFocus(button, root);
    await new Promise<void>((resolve) => queueMicrotask(resolve));
    assert.equal(isSameNode(window.document.activeElement, card), true);
  } finally {
    globalThis.document = previous;
    await window.happyDOM.close();
  }
});

// ---- Create new mission (TASK-2693) ----------------------------------------------------

function createBoard() {
  const cards = [
    makeCard({ id: missionId('task-open-one'), title: 'First open mission', status: 'active', lane: 'active' }),
    makeCard({ id: missionId('task-open-two'), title: 'Second open mission', status: 'backlog', lane: 'backlog' }),
    makeCard({ id: missionId('task-shipped'), title: 'Shipped mission', status: 'done', lane: 'done' }),
    makeCard({ id: missionId('task-closed'), title: 'Closed mission', status: 'review', lane: 'review', closed: true }),
  ];
  return toWebBoardSnapshot(makeProjection({ active: [cards[0]], backlog: [cards[1]], done: [cards[2]], review: [cards[3]] }));
}

/** The dialog's text fields are uncontrolled, so typing is assigning the DOM value. */
async function enter(_page: Awaited<ReturnType<typeof renderBoard>>, element: unknown, value: string) {
  assert.ok(element && typeof element === 'object' && 'value' in element);
  element.value = value;
}

const opener = (page: Awaited<ReturnType<typeof renderBoard>>) => [...page.mount.querySelectorAll<DomButton>('button')].find((button) => button.textContent?.includes('Create new mission'))!;
const dialogOf = (page: Awaited<ReturnType<typeof renderBoard>>) => page.mount.querySelector<DomHtmlElement>('[role="dialog"][aria-label], [role="dialog"][aria-labelledby]');
const fieldByLabel = (page: Awaited<ReturnType<typeof renderBoard>>, text: string) => {
  const label = [...page.mount.querySelectorAll('label')].find((candidate) => candidate.textContent?.startsWith(text))!;
  return page.mount.querySelector<DomHtmlElement & { value: string }>(`#${CSS_ESCAPE(label.getAttribute('for')!)}`)!;
};
const CSS_ESCAPE = (id: string) => id.replace(/[^a-zA-Z0-9_-]/g, '\\$&');
const submitButton = (page: Awaited<ReturnType<typeof renderBoard>>) => [...page.mount.querySelectorAll<DomButton>('button[type="submit"]')][0];
const createdResult = (id = 'px-0001') => ({ ...commandResult(), value: { missionId: id } });

test('Create new mission opens a labelled modal dialog focused on the title and Escape cancels without sending anything', async () => {
  const page = await renderBoard({ board: createBoard() });
  try {
    assert.equal(dialogOf(page), null);
    const trigger = opener(page);
    await act(async () => { trigger.focus(); trigger.click(); });
    const dialog = dialogOf(page)!;
    assert.equal(dialog.getAttribute('aria-modal'), 'true');
    assert.match(page.mount.querySelector(`#${CSS_ESCAPE(dialog.getAttribute('aria-labelledby')!)}`)?.textContent ?? '', /Create new mission/);
    assert.ok(isSameNode(page.window.document.activeElement, fieldByLabel(page, 'Title')));
    for (const label of ['Title', 'Description', 'Context', 'Labels', 'Success criterion']) { assert.ok(fieldByLabel(page, label), label); }
    await enter(page, fieldByLabel(page, 'Title'), 'Typed but abandoned');
    await act(async () => { dialog.dispatchEvent(new page.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); });
    assert.equal(dialogOf(page), null);
    await act(async () => { await new Promise<void>((resolve) => queueMicrotask(resolve)); });
    assert.ok(isSameNode(page.window.document.activeElement, trigger), 'focus returns to the opener');
    assert.equal(page.calls.length, 0);
  } finally { await page.close(); }
});

test('Create new mission Cancel and backdrop dismissal create no mission, and Tab stays inside the dialog', async () => {
  const page = await renderBoard({ board: createBoard() });
  try {
    await act(async () => { opener(page).click(); });
    const cancel = [...page.mount.querySelectorAll<DomButton>('button')].find((button) => button.textContent === 'Cancel')!;
    cancel.focus();
    const tab = new page.window.KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
    submitButton(page).focus();
    await act(async () => { submitButton(page).dispatchEvent(tab); });
    assert.equal(tab.defaultPrevented, true, 'Tab from the last control wraps');
    assert.ok(isSameNode(page.window.document.activeElement, fieldByLabel(page, 'Title') ?? null) || page.window.document.activeElement !== submitButton(page));
    await act(async () => { cancel.click(); });
    assert.equal(dialogOf(page), null);
    await act(async () => { opener(page).click(); });
    await act(async () => { page.mount.querySelector<DomHtmlElement>('[role="presentation"]')!.click(); });
    assert.equal(dialogOf(page), null);
    assert.equal(page.calls.length, 0);
  } finally { await page.close(); }
});

test('Create new mission rejects a blank title with actionable feedback and sends nothing', async () => {
  const page = await renderBoard({ board: createBoard() });
  try {
    await act(async () => { opener(page).click(); });
    await enter(page, fieldByLabel(page, 'Title'), '   ');
    await act(async () => { submitButton(page).click(); });
    assert.match(page.mount.querySelector('[role="alert"]')?.textContent ?? '', /Title is required/);
    assert.ok(isSameNode(page.window.document.activeElement, fieldByLabel(page, 'Title')));
    await enter(page, fieldByLabel(page, 'Title'), 'Titled');
    await enter(page, fieldByLabel(page, 'Context'), 'Only a context');
    await act(async () => { submitButton(page).click(); });
    assert.match(page.mount.querySelector('[role="alert"]')?.textContent ?? '', /context/i);
    assert.equal(page.calls.length, 0);
  } finally { await page.close(); }
});

test('Create new mission offers only unfinished missions as dependencies and sends every field once, then refreshes', async () => {
  let refreshed = 0;
  const page = await renderBoard({ board: createBoard(), result: createdResult(), refresh: async () => { refreshed += 1; } });
  try {
    await act(async () => { opener(page).click(); });
    await enter(page, fieldByLabel(page, 'Title'), '  Capture the idea  ');
    await enter(page, fieldByLabel(page, 'Description'), 'What we want');
    await enter(page, fieldByLabel(page, 'Context'), 'Why we want it');
    await enter(page, fieldByLabel(page, 'Labels'), 'UX, api,, ');
    await enter(page, fieldByLabel(page, 'Success criterion 1'), 'It works');
    await act(async () => { [...page.mount.querySelectorAll<DomButton>('button')].find(button => button.textContent === 'Add criterion')!.click(); });
    await enter(page, fieldByLabel(page, 'Success criterion 2'), ' It is documented ');
    const picker = [...page.mount.querySelectorAll<DomButton>('button')].find((button) => button.getAttribute('aria-haspopup') === 'true')!;
    await act(async () => { picker.click(); });
    const offered = [...page.mount.querySelectorAll('fieldset[aria-label="Unfinished missions"] label')].map((label) => label.textContent);
    assert.deepEqual(offered, ['task-open-twoSecond open mission', 'task-open-oneFirst open mission']);
    const boxes = [...page.mount.querySelectorAll<DomHtmlElement>('fieldset input[type="checkbox"]')];
    await act(async () => { boxes[0].click(); });
    await act(async () => { boxes[1].click(); });
    assert.match(picker.textContent ?? '', /2 selected: task-open-two, task-open-one/);
    await act(async () => { submitButton(page).click(); await new Promise<void>((resolve) => setTimeout(resolve, 0)); });
    assert.equal(page.calls.length, 1);
    const body = payload(page.calls);
    assert.match(body.requestKey, /\S/);
    assert.deepEqual({ ...body, requestKey: 'k' }, {
      kind: 'mission:create', requestKey: 'k', title: 'Capture the idea', description: 'What we want', context: 'Why we want it',
      labels: ['UX', 'api'], successCriteria: ['It works', 'It is documented'], dependencies: ['task-open-two', 'task-open-one'],
    });
    assert.equal(refreshed, 1);
    assert.equal(dialogOf(page), null);
    assert.match(page.mount.querySelector('[data-command-fallback][aria-live="polite"]')?.textContent ?? '', /px-0001.*Created px-0001 in backlog/);
    await page.rerender(toWebBoardSnapshot(makeProjection({ backlog: [makeCard({ id: missionId('px-0001'), lane: 'backlog', status: 'backlog' })] })));
    assert.equal(page.mount.querySelector('[data-command-fallback]'), null);
    assert.match(page.mount.querySelector('[data-board-card="px-0001"] footer [role="status"]')?.textContent ?? '', /Created px-0001/);
  } finally { await page.close(); }
});

test('Create new mission blocks duplicate submits while pending', async () => {
  let release: ((response: Response) => void) | undefined;
  const page = await renderBoard({ board: createBoard(), respond: () => new Promise<Response>((resolve) => { release = resolve; }) });
  try {
    await act(async () => { opener(page).click(); });
    await enter(page, fieldByLabel(page, 'Title'), 'Only once');
    await act(async () => { submitButton(page).click(); submitButton(page).click(); });
    await act(async () => { submitButton(page).click(); });
    assert.equal(page.calls.length, 1);
    assert.equal(submitButton(page).getAttribute('aria-disabled'), 'true');
    assert.match(submitButton(page).textContent ?? '', /Creating/);
    await act(async () => { page.mount.querySelector<DomHtmlElement>('[role="dialog"]')!.dispatchEvent(new page.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); });
    assert.notEqual(dialogOf(page), null, 'a pending creation cannot be dismissed out from under itself');
    await act(async () => { release!(new Response(JSON.stringify(createdResult()), { headers: { 'content-type': 'application/json' } })); await new Promise<void>((resolve) => setTimeout(resolve, 0)); });
    assert.equal(dialogOf(page), null);
  } finally { await page.close(); }
});

test('Create new mission keeps entries after a failure and retries with the same request key', async () => {
  const answers = [
    () => new Response(JSON.stringify(commandResult('failed', { kind: 'validation', message: 'dependency task-open-one is already finished and cannot be depended on' })), { headers: { 'content-type': 'application/json' } }),
    () => { throw new Error('connection reset'); },
    () => new Response(JSON.stringify(createdResult()), { headers: { 'content-type': 'application/json' } }),
  ];
  const page = await renderBoard({ board: createBoard(), respond: async () => answers.shift()!() });
  try {
    await act(async () => { opener(page).click(); });
    await enter(page, fieldByLabel(page, 'Title'), 'Keep me');
    await enter(page, fieldByLabel(page, 'Labels'), 'ux');
    const settle = async () => { await act(async () => { submitButton(page).click(); await new Promise<void>((resolve) => setTimeout(resolve, 0)); }); };
    await settle();
    assert.match(page.mount.querySelector('[role="alert"]')?.textContent ?? '', /already finished.*entries are kept/);
    assert.equal(fieldByLabel(page, 'Title').value, 'Keep me');
    assert.equal(fieldByLabel(page, 'Labels').value, 'ux');
    await settle();
    assert.match(page.mount.querySelector('[role="alert"]')?.textContent ?? '', /connection reset.*entries are kept/);
    assert.notEqual(dialogOf(page), null);
    await settle();
    assert.equal(page.calls.length, 3);
    assert.equal(new Set(page.calls.map((call) => JSON.parse(String(call.body)).requestKey)).size, 1, 'every retry reuses one request key');
    assert.equal(dialogOf(page), null);
  } finally { await page.close(); }
});

const editFields = { missionId: 'task-open-one', version: 7, title: 'Full title', description: 'Full description', context: 'Full context', labels: ['user_value', 'api'], successCriteria: ['works', 'documented'], successCriterionIds: ['sc-1', 'sc-2'], dependencies: ['task-open-two'] };
const editResult = (value = editFields) => ({ ...commandResult(), value });
const editOpener = (page: Awaited<ReturnType<typeof renderBoard>>) => page.mount.querySelector<DomButton>('[data-board-card="task-open-one"] button[aria-label="Edit — enabled"]')!;

test('Edit opens authoritative prefilled fields, traps keyboard focus and cancels without saving (TASK-2702)', async () => {
  const page = await renderBoard({ board: createBoard(), result: editResult() });
  try {
    const trigger = editOpener(page);
    await act(async () => { trigger.focus(); trigger.click(); });
    assert.deepEqual(payload(page.calls), { kind: 'mission:edit-read', missionId: 'task-open-one' });
    for (const [label, expected] of [['Title', 'Full title'], ['Description', 'Full description'], ['Context', 'Full context'], ['Labels', 'user_value, api']]) {
      assert.equal(fieldByLabel(page, label).value, expected);
    }
    assert.deepEqual([...page.mount.querySelectorAll<DomHtmlElement & { value: string }>('textarea[name="criteria"]')].map(field => field.value), ['works', 'documented']);
    assert.ok(isSameNode(page.window.document.activeElement, fieldByLabel(page, 'Title')));
    const dialog = dialogOf(page)!;
    await act(async () => { dialog.dispatchEvent(new page.window.KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true })); });
    assert.ok(isSameNode(page.window.document.activeElement, submitButton(page)));
    await enter(page, fieldByLabel(page, 'Title'), 'Discard this');
    await act(async () => { dialog.dispatchEvent(new page.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); });
    assert.equal(dialogOf(page), null); assert.equal(page.calls.length, 1);
    assert.ok(isSameNode(page.window.document.activeElement, trigger));
  } finally { await page.close(); }
});

test('Edit saves removals with the read version and refreshes the board (TASK-2702)', async () => {
  let refreshed = 0; let calls = 0;
  const page = await renderBoard({ board: createBoard(), respond: async () => new Response(JSON.stringify(++calls === 1 ? editResult() : createdResult('task-open-one'))), refresh: async () => { refreshed++; } });
  try {
    await act(async () => { editOpener(page).click(); });
    await enter(page, fieldByLabel(page, 'Title'), 'Revised');
    for (const label of ['Description', 'Context', 'Labels']) { await enter(page, fieldByLabel(page, label), ''); }
    while (page.mount.querySelector('button[aria-label="Remove criterion 1"]')) { await act(async () => { page.mount.querySelector<DomButton>('button[aria-label="Remove criterion 1"]')!.click(); }); }
    const picker = page.mount.querySelector<DomButton>('button[aria-haspopup="true"]')!;
    await act(async () => { picker.click(); });
    await act(async () => { const inputs = [...page.mount.querySelectorAll<DomHtmlElement & { checked: boolean }>('fieldset input')]; assert.equal(inputs.length, 1, page.mount.querySelector('fieldset')?.outerHTML ?? ''); inputs[0].click(); });
    await act(async () => { submitButton(page).click(); });
    assert.deepEqual(JSON.parse(String(page.calls[1].body)), { kind: 'mission:edit', missionId: 'task-open-one', expectedVersion: 7, title: 'Revised', description: '', context: '', labels: [], successCriteria: [], successCriterionIds: [], dependencies: [] });
    assert.equal(refreshed, 1); assert.equal(dialogOf(page), null);
  } finally { await page.close(); }
});

test('Edit retains entries on validation, conflict and transport failures and blocks pending duplicates (TASK-2702)', async () => {
  for (const kind of ['validation', 'conflict', 'transport']) {
    let calls = 0; let release: (() => void) | undefined;
    const page = await renderBoard({ board: createBoard(), respond: async () => {
      if (++calls === 1) { return new Response(JSON.stringify(editResult())); }
      await new Promise<void>(resolve => { release = resolve; });
      if (kind === 'transport') { throw new Error('offline'); }
      return new Response(JSON.stringify(commandResult('failed', { kind, message: 'Rejected save' })));
    } });
    try {
      await act(async () => { editOpener(page).click(); });
      await enter(page, fieldByLabel(page, 'Title'), 'Kept value');
      await enter(page, fieldByLabel(page, 'Success criterion 2'), 'Kept criterion');
      await act(async () => { submitButton(page).click(); submitButton(page).click(); });
      assert.equal(calls, 2);
      for (const control of page.mount.querySelectorAll<DomButton>('button[aria-label^="Remove criterion"], fieldset button')) { assert.ok(control.disabled, 'row actions are disabled while saving'); }
      await act(async () => { release!(); });
      assert.equal(fieldByLabel(page, 'Title').value, 'Kept value');
      assert.equal(fieldByLabel(page, 'Success criterion 2').value, 'Kept criterion');
      assert.ok(page.mount.querySelector('[role="alert"]')); assert.ok(dialogOf(page));
    } finally { release?.(); await page.close(); }
  }
});

test('Edit uses individual criterion rows with keyboard Add and Remove, preserving other rows and embedded newlines (TASK-2702)', async () => {
  let calls = 0;
  const page = await renderBoard({ board: createBoard(), respond: async () => new Response(JSON.stringify(++calls === 1 ? editResult() : createdResult('task-open-one'))) });
  try {
    await act(async () => { editOpener(page).click(); });
    const rows = () => [...page.mount.querySelectorAll<DomHtmlElement & { value: string }>('textarea[name="criteria"]')];
    assert.equal(rows().length, 2, 'one independently editable field per criterion');
    assert.deepEqual(rows().map(row => row.value), ['works', 'documented']);
    rows()[1].value = 'Kept second row';
    const add = [...page.mount.querySelectorAll<DomButton>('button')].find(button => button.textContent === 'Add criterion')!;
    await act(async () => { add.focus(); add.click(); });
    assert.equal(rows().length, 3);
    assert.ok(isSameNode(page.window.document.activeElement, rows()[2]), 'keyboard Add moves focus to the new field');
    rows()[2].value = 'First paragraph\nSecond paragraph';
    const remove = page.mount.querySelector<DomButton>('button[aria-label="Remove criterion 1"]')!;
    await act(async () => { remove.focus(); remove.click(); });
    assert.deepEqual(rows().map(row => row.value), ['Kept second row', 'First paragraph\nSecond paragraph'], 'removing a row preserves neighboring unsaved entries');
    assert.ok(isSameNode(page.window.document.activeElement, rows()[0]), 'removing a focused row moves focus to the next field');
    await act(async () => { submitButton(page).click(); });
    assert.deepEqual(JSON.parse(String(page.calls[1].body)).successCriteria, ['Kept second row', 'First paragraph\nSecond paragraph']);
  } finally { await page.close(); }
});

test('backlog Cancel pointer opens confirmation without selecting the card (TASK-2705)', async () => {
  const card = makeCard({ id: missionId('task-2705-backlog'), status: 'backlog', lane: 'backlog', commands: [action, { ...action, command: 'active' }, cancel] });
  const page = await renderBoard({ board: toWebBoardSnapshot(makeProjection({ backlog: [card] })) });
  try {
    const button = page.mount.querySelector<DomButton>('button[aria-label^="px cancel"]')!;
    await act(async () => {
      button.dispatchEvent(new page.window.MouseEvent('mousedown', { bubbles: true, cancelable: true }));
      button.click();
    });
    assert.ok(page.mount.querySelector('[aria-label="Confirm cancelling task-2705-backlog"]'));
    assert.equal(page.mount.querySelector('[data-board-card]')?.getAttribute('aria-selected'), 'false');
    assert.equal(page.calls.length, 0);
  } finally { await page.close(); }
});

test('backlog simultaneous projected actions have separate working controls (TASK-2705)', async () => {
  const card = makeCard({ id: missionId('task-2705-backlog'), status: 'backlog', lane: 'backlog', commands: [action, { ...action, command: 'active' }, cancel] });
  const page = await renderBoard({ board: toWebBoardSnapshot(makeProjection({ backlog: [card] })) });
  try {
    const buttons = [...page.mount.querySelectorAll<DomButton>('[data-board-card] button')].filter((button) => button.getAttribute('aria-label')?.startsWith('px ') && !button.getAttribute('aria-label')?.startsWith('px cancel'));
    assert.equal(buttons.length, 2);
    for (const name of ['px handoff', 'px active']) {
      await act(async () => {
        page.mount.querySelector<DomButton>(`[data-board-card] button[aria-label^="${name}"]`)!.click();
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
    }
    assert.deepEqual(page.calls.map((call) => JSON.parse(String(call.body)).kind), ['handoff:record', 'active:execute']);
    assert.equal(page.mount.querySelector('[data-board-card]')?.getAttribute('aria-selected'), 'false');
    assert.equal(page.mount.querySelector('[aria-label^="Mission progress"]'), null);
  } finally { await page.close(); }
});

test('a refreshed pointer control cannot dispatch its replacement or activate the card (TASK-2705)', async () => {
  const card = makeCard({ id: missionId('task-2705-refresh'), status: 'active', lane: 'active', commands: [action, cancel] });
  const page = await renderBoard({ board: snapshot([card]) });
  try {
    const cancelButton = page.mount.querySelector<DomButton>('button[aria-label^="px cancel"]')!;
    await act(async () => { cancelButton.dispatchEvent(new page.window.PointerEvent('pointerdown', { bubbles: true })); });
    await page.rerender(snapshot([makeCard({ ...card, commands: [action] })]));
    const replacement = page.mount.querySelector<DomButton>('[data-board-card] button')!;
    await act(async () => { replacement.dispatchEvent(new page.window.MouseEvent('click', { bubbles: true, detail: 1 })); });
    assert.equal(page.calls.length, 0);
    assert.equal(page.mount.querySelector('[data-board-card]')?.getAttribute('aria-selected'), 'false');
    assert.equal(page.mount.querySelector('[role="dialog"]'), null);
    assert.match(page.mount.querySelector('[role="status"]')?.textContent ?? '', /control changed during the press/);
    await act(async () => {
      replacement.dispatchEvent(new page.window.PointerEvent('pointerdown', { bubbles: true }));
      replacement.dispatchEvent(new page.window.MouseEvent('click', { bubbles: true, detail: 1 }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    assert.equal(page.calls.length, 1);
    assert.equal(payload(page.calls).kind, 'handoff:record');
  } finally { await page.close(); }
});

test('Edit sends retained criterion IDs and leaves new IDs to the backend (TASK-2742)', async () => {
  let calls = 0;
  const page = await renderBoard({ board: createBoard(), respond: async () => new Response(JSON.stringify(++calls === 1 ? editResult() : createdResult('task-open-one'))) });
  try {
    await act(async () => { editOpener(page).click(); });
    await enter(page, fieldByLabel(page, 'Success criterion 1'), 'edited wording');
    await act(async () => { page.mount.querySelector<DomButton>('button[aria-label="Remove criterion 2"]')!.click(); });
    const add = [...page.mount.querySelectorAll<DomButton>('button')].find(button => button.textContent?.includes('Add criterion'))!;
    await act(async () => { add.click(); });
    await enter(page, fieldByLabel(page, 'Success criterion 2'), 'new criterion');
    await act(async () => { submitButton(page).click(); });
    const saved = JSON.parse(String(page.calls[1].body));
    assert.deepEqual(saved.successCriteria, ['edited wording', 'new criterion']);
    assert.deepEqual(saved.successCriterionIds, ['sc-1', null]);
  } finally { await page.close(); }
});

test('accepted command waits for authoritative preparing snapshot and exposes server-owned stop after reload (TASK-2750)', async () => {
  const { projectWorkflowBoard } = await import('../../../../src/application/projections/workflow-board.js');
  const { workflowOperation } = await import('../../../../src/domain/workflow-operation.js');
  const card = makeCard({ id: missionId('task-2436-interaction'), status: 'refined', lane: 'refined', commands: [{ command: 'active', enabled: true, reason: null }] });
  const initial = toWebBoardSnapshot(makeProjection({ refined: [card] }));
  const page = await renderBoard({ board: initial, result: { ...commandResult('accepted'), value: { operationId: 'durable-operation', phase: 'accepted', statusUrl: '/api/operations/durable-operation' } } });
  try {
    await act(async () => { page.mount.querySelector<DomButton>('[data-action-kind="active:execute"]')!.click(); });
    assert.match(page.mount.textContent ?? '', /accepted; follow server progress/);
    assert.doesNotMatch(page.mount.textContent ?? '', /preparing workflow/);
    const operation = workflowOperation({ id: 'durable-operation', repositoryId: card.repositoryId, missionId: card.id, command: 'active:execute', requestKey: 'delivery',
      generation: 0, phase: 'accepted', providerStarted: false, agent: 'codex', reviewer: null, originalStatus: 'refined', previousAssignee: null, owner: null,
      createdAt: '2026-10-15T00:00:00Z', updatedAt: '2026-10-15T00:00:00Z', reason: null });
    const server = toWebBoardSnapshot(projectWorkflowBoard(makeProjection({ active: [{ ...card, status: 'active', lane: 'active' }] }), [operation]));
    await page.rerender(server);
    assert.match(page.mount.textContent ?? '', /preparing workflow/);
    const stop = page.mount.querySelector<DomButton>('[data-action-kind="workflow:stop"]');
    assert.ok(stop); assert.equal(stop.getAttribute('aria-disabled'), 'false');
    assert.equal(page.mount.querySelector('[data-action-kind="active:execute"]'), null);
    assert.equal(page.calls.length, 1);
  } finally { await page.close(); }
});

test('settled workflow retries show their terminal result without restarting (TASK-2750)', async () => {
  for (const status of ['completed', 'failed', 'cancelled']) {
    const card = makeCard({ id: missionId('task-2436-interaction'), status: 'refined', lane: 'refined', commands: [{ command: 'active', enabled: true, reason: null }] });
    const page = await renderBoard({ board: toWebBoardSnapshot(makeProjection({ refined: [card] })), result: {
      ...commandResult(status, status === 'completed' ? null : { kind: status === 'cancelled' ? 'cancelled' : 'execution', message: 'Retained terminal result' }),
      value: status === 'completed' ? { operationId: 'retained', phase: 'completed' } : null,
    } });
    try {
      await act(async () => { page.mount.querySelector<DomButton>('[data-action-kind="active:execute"]')!.click(); });
      assert.match(page.mount.textContent ?? '', status === 'completed' ? /completed\./ : /Retained terminal result/);
      assert.doesNotMatch(page.mount.textContent ?? '', /accepted; follow server progress/);
      assert.equal(page.calls.length, 1);
    } finally { await page.close(); }
  }
});

test('mounted header and card execution transition together while workflow fans persist (TASK-2769)', async () => {
  const { projectProviderExecution } = await import('../../../../src/application/projections/provider-execution.js');
  const card = makeCard({ currentWork: { operationId: 'held-workflow', phase: 'execute', summary: 'workflow active',
    agent: agentFamily('codex'), updatedAt: new Date().toISOString(), freshness: 'live' } });
  const board = makeProjection({ active: [card] });
  const availability = ['codex', 'claude'].map(family => ({ family: agentFamily(family), available: true, blockedForMs: 0 }));
  const observation = (family: string | null, complete = true) => toWebBoardSnapshot(projectProviderExecution(
    { ...board, metrics: { ...board.metrics, agentAvailability: availability } }, {
      observe: () => ({ observedAt: new Date().toISOString(), complete, limitations: complete ? [] : ['probe unavailable'],
        invocations: family ? [{ runId: `execute-${family}-a1-test`, operationId: 'held-workflow', family: agentFamily(family) }] : [] }),
    }));
  const page = await renderBoard({ board: observation(null) });
  try {
    for (const [family, complete] of [[null, true], ['codex', true],
      ['claude', false], [null, false], [null, true]] as const) {
      await page.rerender(observation(family, complete));
      const article = page.mount.querySelector('[data-board-card]')!;
      // px-0013: execution observations must never add a row above the established header.
      assert.equal(article.querySelector('[data-provider-execution]') !== null, false);
      assert.ok(article.firstElementChild?.querySelector('.fan'));
      assert.ok(article.firstElementChild?.textContent?.includes(card.id));
      assert.ok(article.firstElementChild?.textContent?.includes(card.title));
      assert.doesNotMatch(article.textContent ?? '', /executing|execution unknown/);
      assert.equal(article.querySelectorAll('.fan.spin').length, 2);
      const header = page.mount.querySelector('[aria-label="Agent availability"]')!;
      if (family) {
        assert.ok(header.textContent?.includes(`${family}1${complete ? '' : '+'}`));
        assert.equal(article.querySelector('[title*="active worker"]')?.textContent, family);
      } else {
        assert.equal(article.querySelector('[title*="active worker"]'), null);
        assert.ok(header.textContent?.includes(complete ? 'codex0' : 'codexunknown'));
      }
    }
    await page.rerender(toWebBoardSnapshot(board));
    const absent = page.mount.querySelector('[data-board-card]')!;
    assert.equal(absent.querySelector('[data-provider-execution]') !== null, false);
    assert.ok(absent.firstElementChild?.querySelector('.fan'));
    assert.ok(absent.firstElementChild?.textContent?.includes(card.id));
    assert.ok(absent.firstElementChild?.textContent?.includes(card.title));
    assert.doesNotMatch(absent.textContent ?? '', /executing|execution unknown/);
  } finally { await page.close(); }
});

for (const result of [commandResult(), commandResult('failed', { kind: 'execution', message: 'fixture failure' }), commandResult('failed', { kind: 'conflict', message: 'stale action' })]) {
  test(`command ${result.error?.kind ?? 'success'} stays in visible footer across lanes and disclosures (TASK-2773.07)`, async () => {
    const card = makeCard({ id: missionId('task-outcome-routing'), lane: 'active', status: 'active', commands: [action] });
    const page = await renderBoard({ board: snapshot([card]), result });
    const expected = result.error?.message ?? 'started';
    const footer = () => page.mount.querySelector('footer [role="status"]');
    const fallback = () => page.mount.querySelector('[data-command-fallback]');
    try {
      await act(async () => { page.mount.querySelector<DomButton>('[data-action-kind="handoff:record"]')!.click(); });
      assert.match(footer()?.textContent ?? '', new RegExp(expected));
      assert.equal(footer()?.getAttribute('aria-live'), 'polite');
      assert.equal(fallback(), null);
      for (const lane of ['backlog', 'refined', 'review', 'integration'] as const) {
        await page.rerender(toWebBoardSnapshot(makeProjection({ [lane]: [makeCard({ ...card, lane, status: lane, commands: [] })] })));
        assert.match(footer()?.textContent ?? '', new RegExp(expected));
        assert.equal(fallback(), null);
      }
      const done = toWebBoardSnapshot(makeProjection({ done: [makeCard({ ...card, lane: 'done', status: 'done', commands: [] })] }));
      await page.rerender(done);
      assert.equal(footer(), null, 'collapsed rail must not contain an outcome');
      assert.match(fallback()?.textContent ?? '', /task-outcome-routing/);
      const toggle = async (label: string, open: boolean) => {
        await act(async () => {
          const details = page.mount.querySelector(`details[aria-label="${label}"]`)!;
          if (open) { details.setAttribute('open', ''); } else { details.removeAttribute('open'); }
          details.dispatchEvent(new page.window.Event('toggle', { bubbles: false }));
        });
      };
      await toggle('done stage', true);
      assert.match(footer()?.textContent ?? '', new RegExp(expected));
      assert.equal(fallback(), null);
      const stage = done.stages.find(stage => stage.lane === 'done')!;
      await page.rerender({ ...done, stages: done.stages.map(item => item === stage ? { ...item, cards: [], historyCards: stage.cards } : item) });
      assert.equal(footer(), null);
      assert.ok(fallback());
      await toggle('Other completed history', true);
      assert.match(footer()?.textContent ?? '', new RegExp(expected));
      assert.equal(fallback(), null);
      await toggle('done stage', false);
      assert.equal(footer(), null);
      assert.ok(fallback());
      await toggle('done stage', true);
      assert.match(footer()?.textContent ?? '', new RegExp(expected));
      assert.equal(fallback(), null);
    } finally { await page.close(); }
  });
}
