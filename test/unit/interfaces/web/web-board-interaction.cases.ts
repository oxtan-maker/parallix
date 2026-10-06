import test from 'node:test';
import assert from 'node:assert/strict';
import { Window, HTMLButtonElement as DomButton, HTMLElement as DomHtmlElement } from 'happy-dom';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import React from 'react';
import { Board, restoreActionFocus } from '../../../../web/src/board.js';
import { toWebBoardSnapshot } from '../../../../src/interfaces/web/transport.js';
import { makeCard, makeProjection } from '../../../fixtures/board-projection.js';
import { missionId } from '../../../../src/domain/mission.js';

const action = { command: 'handoff', enabled: true, reason: null, targetLane: 'review' } as const;
const cancel = { command: 'cancel', enabled: true, reason: null, targetLane: null, label: 'cancel ✕' } as const;
const request = { missionId: 'task-2436-interaction', kind: 'handoff:record', missionStatusAtRequest: 'active' };
const commandResult = (status = 'completed', error: { readonly kind: string; readonly message: string } | null = null) => ({ kind: 'command-result', transportVersion: 2, status, value: null, error, durableEvidence: [] });

function snapshot(cards = [makeCard({ id: missionId('task-2436-interaction'), status: 'active', lane: 'active', commands: [action] })]) {
  return toWebBoardSnapshot(makeProjection({ active: cards }));
}

async function renderBoard(options: { readonly board?: ReturnType<typeof snapshot>; readonly result?: unknown; readonly refresh?: () => Promise<void>; readonly respond?: () => Promise<Response> } = {}) {
  const window = new Window();
  const previous = { window: globalThis.window, document: globalThis.document, fetch: globalThis.fetch, IS_REACT_ACT_ENVIRONMENT: globalThis.IS_REACT_ACT_ENVIRONMENT, requestAnimationFrame: globalThis.requestAnimationFrame };
  Object.assign(globalThis, { window, document: window.document });
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  globalThis.requestAnimationFrame = (callback) => { callback(0); return 0; };
  const calls: RequestInit[] = [];
  globalThis.fetch = async (_url, init) => {
    calls.push(init!);
    if (options.respond !== undefined) { return options.respond(); }
    return new Response(JSON.stringify(options.result ?? commandResult()), { headers: { 'content-type': 'application/json' } });
  };
  const mount = window.document.createElement('div');
  window.document.body.append(mount);
  const root = createRoot(mount);
  await act(async () => { root.render(React.createElement(Board, { snapshot: options.board ?? snapshot(), onRefresh: options.refresh ?? (async () => {}) })); });
  return {
    window, mount, calls, root,
    async rerender(board: ReturnType<typeof snapshot>) {
      await act(async () => { root.render(React.createElement(Board, { snapshot: board, onRefresh: options.refresh ?? (async () => {}) })); });
    },
    async close() {
      await act(async () => { root.unmount(); });
      Object.assign(globalThis, previous);
      await window.happyDOM.close();
    },
  };
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

test('board click and keyboard activation send one projected typed request', async () => {
  const page = await renderBoard();
  try {
    const button = page.mount.querySelector<DomButton>('button[aria-label*=" — enabled"]')!;
    await act(async () => { button.click(); });
    assert.equal(page.calls.length, 1);
    assert.deepEqual(payload(page.calls), request);
  } finally {
    await page.close();
  }
});

test('board keyboard activation sends the same projected typed request', async () => {
  const page = await renderBoard();
  try {
    const button = page.mount.querySelector<DomButton>('button[aria-label*=" — enabled"]')!;
    await act(async () => {
      button.dispatchEvent(new page.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      button.dispatchEvent(new page.window.MouseEvent('click', { bubbles: true, detail: 0 }));
    });
    assert.equal(page.calls.length, 1);
    assert.deepEqual(payload(page.calls), request);
  } finally { await page.close(); }
});

test('independent missions dispatch concurrently and retain separate pending state (TASK-2657)', async () => {
  let resolveFirst: ((response: Response) => void) | undefined;
  let resolveSecond: ((response: Response) => void) | undefined;
  let requestNumber = 0;
  const deferred = () => new Promise<Response>((resolve) => {
    requestNumber += 1;
    if (requestNumber === 1) { resolveFirst = resolve; } else { resolveSecond = resolve; }
  });
  const first = makeCard({ id: missionId('task-2657-a'), status: 'active', lane: 'active', commands: [action] });
  const second = makeCard({ id: missionId('task-2657-b'), status: 'active', lane: 'active', commands: [action] });
  const page = await renderBoard({ board: toWebBoardSnapshot(makeProjection({ active: [first, second] })), respond: deferred });
  try {
    const buttons = [...page.mount.querySelectorAll<DomButton>('button[aria-label*=" — enabled"]')];
    await act(async () => { buttons[0].click(); });
    await act(async () => { buttons[1].click(); });
    assert.equal(page.calls.length, 2, 'B must cross the sendCommand boundary while A is unresolved');
    assert.match(buttons[0].getAttribute('aria-label') ?? '', /starting/);
    assert.match(buttons[1].getAttribute('aria-label') ?? '', /starting/);
    resolveFirst!(new Response(JSON.stringify(commandResult()), { headers: { 'content-type': 'application/json' } }));
    await act(async () => { await new Promise<void>((resolve) => queueMicrotask(resolve)); });
    assert.match(buttons[1].getAttribute('aria-label') ?? '', /starting/, 'A completion must not clear B pending state');
    resolveSecond!(new Response(JSON.stringify(commandResult()), { headers: { 'content-type': 'application/json' } }));
  } finally { await page.close(); }
});

test('rapid repeated activation synchronously sends one request (TASK-2657)', async () => {
  let resolveRequest: ((response: Response) => void) | undefined;
  const page = await renderBoard({ respond: () => new Promise<Response>((resolve) => { resolveRequest = resolve; }) });
  try {
    const button = page.mount.querySelector<DomButton>('button[aria-label*=" — enabled"]')!;
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
    await act(async () => { page.mount.querySelector<DomButton>('button[aria-label*=" — enabled"]')!.click(); });
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
    await act(async () => { page.mount.querySelector<DomButton>('button[aria-label*=" — enabled"]')!.click(); });
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
    const buttons = [...page.mount.querySelectorAll<DomButton>('button[aria-label*=" — enabled"]')];
    await act(async () => { buttons[0].click(); await new Promise<void>((resolve) => queueMicrotask(resolve)); });
    assert.match(buttons[0].getAttribute('aria-label') ?? '', /enabled/, 'the thrown request must release its mission');
    await act(async () => { buttons[1].click(); await new Promise<void>((resolve) => queueMicrotask(resolve)); });
    assert.equal(page.calls.length, 2, 'a refresh failure must not resend the completed command');
    assert.match(buttons[1].getAttribute('aria-label') ?? '', /enabled/, 'the refresh failure must release only its mission');
  } finally { await page.close(); }
});

test('outcomes replace per mission and are pruned when its card leaves the snapshot (TASK-2657)', async () => {
  let attempt = 0;
  const card = makeCard({ id: missionId('task-2657-outcome'), status: 'active', lane: 'active', commands: [action] });
  const page = await renderBoard({
    board: snapshot([card]),
    result: undefined,
    respond: async () => new Response(JSON.stringify(commandResult('failed', { kind: 'execution', message: `failure ${++attempt}` })), { headers: { 'content-type': 'application/json' } }),
  });
  try {
    const button = page.mount.querySelector<DomButton>('button[aria-label*=" — enabled"]')!;
    await act(async () => { button.click(); await new Promise<void>((resolve) => queueMicrotask(resolve)); });
    await act(async () => { button.click(); await new Promise<void>((resolve) => queueMicrotask(resolve)); });
    assert.equal(page.mount.querySelectorAll('[role="status"]').length, 1);
    assert.match(page.mount.querySelector('[role="status"]')?.textContent ?? '', /failure 2/);
    await page.rerender(snapshot([]));
    assert.equal(page.mount.querySelectorAll('[role="status"]').length, 0);
  } finally { await page.close(); }
});

test('unmounting a request and completing an older request cannot restore stale focus (TASK-2657)', async () => {
  let resolveFirst: ((response: Response) => void) | undefined;
  let resolveSecond: ((response: Response) => void) | undefined;
  let ordinal = 0;
  const deferred = () => new Promise<Response>((resolve) => {
    ordinal += 1;
    if (ordinal === 1) { resolveFirst = resolve; } else { resolveSecond = resolve; }
  });
  const first = makeCard({ id: missionId('task-2657-focus-a'), status: 'active', lane: 'active', commands: [action] });
  const second = makeCard({ id: missionId('task-2657-focus-b'), status: 'active', lane: 'active', commands: [action] });
  const page = await renderBoard({ board: toWebBoardSnapshot(makeProjection({ active: [first, second] })), respond: deferred });
  let closed = false;
  try {
    const buttons = [...page.mount.querySelectorAll<DomButton>('button[aria-label*=" — enabled"]')];
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
    const button = page.mount.querySelector<DomButton>('button[aria-label*=" — enabled"]')!;
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
    assert.deepEqual(payload(page.calls), request);

    await act(async () => { card.dispatchEvent(drag); });
    await act(async () => { page.mount.querySelector<DomHtmlElement>('section[aria-label="integration stage"] > div:last-child')!.dispatchEvent(new page.window.Event('drop', { bubbles: true })); });
    assert.equal(page.calls.length, 1);
    assert.match(page.mount.querySelector('[role="status"]')?.textContent ?? '', /Drop unavailable/);
  } finally { await page.close(); }
});

test('board focus fallback lands on the selected card after refresh removes the action', async () => {
  const window = new Window();
  const previous = globalThis.document;
  globalThis.document = window.document as unknown as Document;
  try {
    const root = window.document.createElement('div');
    root.tabIndex = -1;
    const card = window.document.createElement('article');
    card.dataset.boardCard = 'task-2436-interaction';
    card.setAttribute('aria-selected', 'true');
    card.tabIndex = 0;
    const button = window.document.createElement('button');
    root.append(card, button);
    window.document.body.append(root);
    button.remove();
    restoreActionFocus(button as unknown as HTMLButtonElement, root as unknown as HTMLDivElement);
    await new Promise<void>((resolve) => queueMicrotask(resolve));
    assert.equal(isSameNode(window.document.activeElement, card), true);
  } finally {
    globalThis.document = previous;
    await window.happyDOM.close();
  }
});
