import test from 'node:test';
import assert from 'node:assert/strict';
import { Window, HTMLButtonElement as DomButton, HTMLElement as DomHtmlElement } from 'happy-dom';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import React from 'react';
import { Board, restoreActionFocus } from '../web/src/board.js';
import { toWebBoardSnapshot } from '../src/interfaces/web/transport.js';
import { makeCard, makeProjection } from './fixtures/board-projection.js';
import { missionId } from '../src/domain/mission.js';

const action = { command: 'handoff', enabled: true, reason: null, targetLane: 'review' } as const;
const request = { missionId: 'task-2436-interaction', kind: 'handoff:record', missionStatusAtRequest: 'active' };
const commandResult = (status = 'completed', error: { readonly kind: string; readonly message: string } | null = null) => ({ kind: 'command-result', transportVersion: 2, status, value: null, error, durableEvidence: [] });

function snapshot(cards = [makeCard({ id: missionId('task-2436-interaction'), status: 'active', lane: 'active', commands: [action] })]) {
  return toWebBoardSnapshot(makeProjection({ active: cards }));
}

async function renderBoard(options: { readonly board?: ReturnType<typeof snapshot>; readonly result?: unknown; readonly refresh?: () => Promise<void> } = {}) {
  const window = new Window();
  const previous = { window: globalThis.window, document: globalThis.document, fetch: globalThis.fetch, IS_REACT_ACT_ENVIRONMENT: globalThis.IS_REACT_ACT_ENVIRONMENT, requestAnimationFrame: globalThis.requestAnimationFrame };
  Object.assign(globalThis, { window, document: window.document });
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  globalThis.requestAnimationFrame = (callback) => { callback(0); return 0; };
  const calls: RequestInit[] = [];
  globalThis.fetch = async (_url, init) => {
    calls.push(init!);
    return new Response(JSON.stringify(options.result ?? commandResult()), { headers: { 'content-type': 'application/json' } });
  };
  const mount = window.document.createElement('div');
  window.document.body.append(mount);
  const root = createRoot(mount);
  await act(async () => { root.render(React.createElement(Board, { snapshot: options.board ?? snapshot(), onRefresh: options.refresh ?? (async () => {}) })); });
  return {
    window, mount, calls, root,
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

test('board unavailable action ignores pointer and keyboard activation', async () => {
  const page = await renderBoard({ board: snapshot([makeCard({ id: missionId('task-2436-interaction'), status: 'active', lane: 'active', commands: [{ ...action, enabled: false, reason: 'not eligible' }] })]) });
  try {
    // primaryAction() renders only enabled actions, so a card whose sole action
    // is unavailable renders no action control at all. There is therefore no
    // control to activate: activation is ignored by construction. This is the
    // same guard the render suite asserts (web-board-render omits disabled
    // controls); here we assert the interaction consequence — nothing to click,
    // so no request is ever dispatched.
    assert.equal(page.mount.querySelector('button[aria-label*=" — enabled"]') === null, true);
    assert.equal(page.mount.querySelector<DomButton>('button[aria-disabled="true"]') === null, true);
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
