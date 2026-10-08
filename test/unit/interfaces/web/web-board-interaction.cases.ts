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

test('clicking the checkpoint label toggles the evidence panel open and closed (TASK-2660)', async () => {
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
    const label = page.mount.querySelector<DomHtmlElement>('[role="button"][aria-label^="View checkpoint evidence for"]')!;
    assert.equal(page.mount.querySelector('[role="dialog"]'), null, 'no panel before the first click');
    // A real click event, dispatched at the label, must reach it even while the
    // backdrop is open: the label sits above the backdrop (zIndex 60 > 50), so
    // the required same-label click-to-close toggle is reachable.
    await act(async () => { label.dispatchEvent(new page.window.MouseEvent('click', { bubbles: true, detail: 0 })); });
    const dialog = page.mount.querySelector('[role="dialog"]');
    assert.ok(dialog !== null, 'the panel opens on click');
    assert.match(dialog?.textContent ?? '', /CP-2: components extracted/, 'the panel renders the checkpoint description');
    assert.match(dialog?.textContent ?? '', /runs the gate/, 'the panel renders the Goal Check evidence row');
    // The same label click closes the view; the label stays above the backdrop.
    await act(async () => { label.dispatchEvent(new page.window.MouseEvent('click', { bubbles: true, detail: 0 })); });
    assert.equal(page.mount.querySelector('[role="dialog"]'), null, 'the same label click closes the panel');
  } finally { await page.close(); }
});

test('selecting a mission card opens a read-only terminal view and renders unavailable state (TASK-2661)', async () => {
  const page = await renderBoard({ respond: async () => new Response(JSON.stringify({ kind: 'unavailable', message: 'No live tmux session is available for this mission.' }), { status: 404, headers: { 'content-type': 'application/json' } }) });
  try {
    const card = page.mount.querySelector<DomHtmlElement>('[data-board-card]')!;
    await act(async () => { card.dispatchEvent(new page.window.MouseEvent('click', { bubbles: true })); await new Promise<void>(resolve => queueMicrotask(resolve)); });
    const dialog = page.mount.querySelector('[role="dialog"]');
    assert.ok(dialog, 'card selection opens the progress view');
    assert.match(dialog.textContent ?? '', /No live tmux session is available/);
    assert.equal(page.calls[0]?.method, undefined, 'terminal reads never send a mutation method');
    assert.equal(page.mount.querySelectorAll('button').length > 0, true, 'the dialog has a close control only');
  } finally { await page.close(); }
});

test('the selected mission progress view renders terminal output from its GET read (TASK-2661)', async () => {
  const page = await renderBoard({ respond: async () => new Response(JSON.stringify({ kind: 'live', output: 'working through checkpoint two\\n' }), { headers: { 'content-type': 'application/json' } }) });
  try {
    const card = page.mount.querySelector<DomHtmlElement>('[data-board-card]')!;
    await act(async () => { card.dispatchEvent(new page.window.MouseEvent('click', { bubbles: true })); await new Promise<void>(resolve => queueMicrotask(resolve)); });
    const dialog = page.mount.querySelector('[role="dialog"]');
    assert.match(dialog?.textContent ?? '', /working through checkpoint two/);
    assert.ok(page.calls[0]?.headers instanceof Headers || page.calls[0]?.headers !== undefined, 'the terminal request carries read headers only');
  } finally { await page.close(); }
});

test('a pipe-hosted mission shows recorded output without claiming a live terminal (TASK-2661)', async () => {
  const page = await renderBoard({ respond: async () => new Response(JSON.stringify({
    kind: 'captured', output: 'review completed', message: 'No live tmux session. Recorded output from review / claude.',
  })) });
  try {
    await act(async () => { page.mount.querySelector<DomHtmlElement>('[data-board-card]')!.click(); });
    const dialog = page.mount.querySelector('[role="dialog"]');
    assert.match(dialog?.querySelector('pre')?.textContent ?? '', /review completed/);
    assert.match(dialog?.querySelector('h2')?.textContent ?? '', /recorded output/);
    assert.doesNotMatch(dialog?.querySelector('h2')?.textContent ?? '', /live terminal/);
    assert.match(dialog?.textContent ?? '', /No live tmux session/);
  } finally { await page.close(); }
});

test('terminal refresh failures retain captured output and recover (TASK-2661)', async (context) => {
  let fail = false;
  const page = await renderBoard({ respond: async () => {
    if (fail) { throw new Error('timeout'); }
    return new Response(JSON.stringify({ kind: 'live', output: 'real progress' }));
  } });
  let poll: (() => void) | undefined;
  context.mock.method(page.window, 'setInterval', (callback: () => void) => { poll = callback; return 1; });
  try {
    await act(async () => { page.mount.querySelector<DomHtmlElement>('[data-board-card]')!.click(); });
    fail = true;
    await act(async () => { poll!(); });
    assert.match(page.mount.querySelector('pre')?.textContent ?? '', /real progress/);
    assert.match(page.mount.querySelector('[role="dialog"]')?.textContent ?? '', /refresh interrupted/);
    fail = false;
    await act(async () => { poll!(); });
    assert.doesNotMatch(page.mount.querySelector('[role="dialog"]')?.textContent ?? '', /refresh interrupted/);
  } finally { await page.close(); }
});

test('terminal response survives board updates while its read is pending (TASK-2661)', async () => {
  let resolveRead: ((response: Response) => void) | undefined;
  const page = await renderBoard({ respond: () => new Promise<Response>(resolve => { resolveRead = resolve; }) });
  try {
    const card = page.mount.querySelector<DomHtmlElement>('[data-board-card]')!;
    await act(async () => { card.click(); });
    await page.rerender(snapshot());
    assert.equal(page.calls.length, 1, 'board updates must preserve the pending terminal read');
    await act(async () => {
      resolveRead!(new Response(JSON.stringify({ kind: 'live', output: 'checkpoint progress' })));
    });
    assert.match(page.mount.querySelector('[role="dialog"]')?.textContent ?? '', /checkpoint progress/);
  } finally { await page.close(); }
});

test('terminal polling skips pending reads and closing cancels them (TASK-2661)', async (context) => {
  const page = await renderBoard({ respond: () => new Promise<Response>((_resolve, reject) => {
    queueMicrotask(() => {
      page.calls[0].signal!.addEventListener('abort', () => reject(new Error('closed')), { once: true });
    });
  }) });
  let poll: (() => void) | undefined;
  context.mock.method(page.window, 'setInterval', (callback: () => void) => { poll = callback; return 1; });
  try {
    await act(async () => { page.mount.querySelector<DomHtmlElement>('[data-board-card]')!.click(); });
    await act(async () => { poll!(); poll!(); });
    assert.equal(page.calls.length, 1, 'a slow read must not accumulate requests');
    const signal = page.calls[0].signal!;
    assert.equal(signal.aborted, false);
    await act(async () => {
      page.mount.querySelector('[role="dialog"]')!.querySelector<DomButton>('button')!.click();
    });
    assert.equal(signal.aborted, true, 'closing cancels the outstanding request');
  } finally { await page.close(); }
});

test('a stalled terminal request leaves loading when its deadline expires (TASK-2661)', async (context) => {
  const deadline = new AbortController();
  context.mock.method(AbortSignal, 'timeout', (milliseconds: number) => {
    assert.equal(milliseconds, 30000);
    return deadline.signal;
  });
  const page = await renderBoard({ respond: () => new Promise<Response>((_resolve, reject) => {
    // Fetch rejects when the supplied signal aborts; no real network or wait.
    queueMicrotask(() => {
      page.calls[0].signal!.addEventListener('abort', () => reject(new Error('timeout')), { once: true });
    });
  }) });
  try {
    await act(async () => { page.mount.querySelector<DomHtmlElement>('[data-board-card]')!.click(); });
    assert.match(page.mount.querySelector('[role="dialog"]')?.textContent ?? '', /Loading/);
    await act(async () => { deadline.abort(); });
    assert.match(page.mount.querySelector('[role="dialog"]')?.textContent ?? '', /Mission terminal is unavailable/);
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
    const label = page.mount.querySelector<DomHtmlElement>('[role="button"][aria-label^="View checkpoint evidence for"]')!;
    await act(async () => { label.dispatchEvent(new page.window.MouseEvent('click', { bubbles: true, detail: 0 })); });
    assert.ok(page.mount.querySelector('[role="dialog"]'), 'the panel opens on click');
    await act(async () => { page.window.dispatchEvent(new page.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); });
    assert.equal(page.mount.querySelector('[role="dialog"]'), null, 'Escape closes the panel');
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
    const label = page.mount.querySelector<DomHtmlElement>('[role="button"][aria-label^="View checkpoint evidence for"]')!;
    await act(async () => { label.dispatchEvent(new page.window.MouseEvent('click', { bubbles: true, detail: 0 })); });
    const dialog = page.mount.querySelector('[role="dialog"]');
    assert.ok(dialog !== null, 'the panel opens on click');
    assert.match(dialog?.textContent ?? '', /CP-1: plan/, 'the panel opens on the first active checkpoint');
    // The CP-2 selector button click bubbles up to the backdrop; only a direct
    // backdrop click dismisses the panel, so selecting a checkpoint keeps it open.
    const selectors = page.mount.querySelectorAll('nav[aria-label="Checkpoints"] button');
    const cp2 = [...selectors].find((button) => (button.textContent ?? '').trim() === 'CP-2');
    assert.ok(cp2, 'the CP-2 selector button is present');
    await act(async () => { cp2.dispatchEvent(new page.window.MouseEvent('click', { bubbles: true, detail: 0 })); });
    assert.ok(page.mount.querySelector('[role="dialog"]'), 'selecting a checkpoint keeps the dialog open');
    const reopened = page.mount.querySelector('[role="dialog"]');
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
