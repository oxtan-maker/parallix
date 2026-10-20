import assert from 'node:assert/strict';
import { Window } from 'happy-dom';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import React from 'react';
import { Board } from '../../../../web/src/board.js';
import type { WebBoardSnapshot } from '../../../../src/interfaces/web/transport.js';

const reactGlobal: typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean } = globalThis;
export async function renderBoard(options: { readonly board: WebBoardSnapshot; readonly result?: unknown; readonly refresh?: () => Promise<void>; readonly respond?: () => Promise<Response> }) {
  const window = new Window();
  const previous = { window: globalThis.window, document: globalThis.document, fetch: globalThis.fetch, IS_REACT_ACT_ENVIRONMENT: reactGlobal.IS_REACT_ACT_ENVIRONMENT, requestAnimationFrame: globalThis.requestAnimationFrame };
  Object.assign(globalThis, { window, document: window.document });
  reactGlobal.IS_REACT_ACT_ENVIRONMENT = true;
  globalThis.requestAnimationFrame = (callback) => { callback(0); return 0; };
  const calls: RequestInit[] = [];
  globalThis.fetch = async (_url, init) => {
    calls.push(init!);
    if (options.respond !== undefined) { return options.respond(); }
    return new Response(JSON.stringify(options.result ?? { kind: 'command-result', transportVersion: 2, status: 'completed', value: null, error: null, durableEvidence: [] }), { headers: { 'content-type': 'application/json' } });
  };
  const mount = window.document.createElement('div');
  mount.id = 'react-test-root';
  window.document.body.append(mount);
  const reactMount = document.getElementById(mount.id);
  assert.ok(reactMount);
  const root = createRoot(reactMount);
  await act(async () => { root.render(React.createElement(Board, { snapshot: options.board, onRefresh: options.refresh ?? (async () => {}) })); });
  return {
    window, mount, reactMount, calls, root,
    async rerender(board: WebBoardSnapshot) {
      await act(async () => { root.render(React.createElement(Board, { snapshot: board, onRefresh: options.refresh ?? (async () => {}) })); });
    },
    async close() {
      await act(async () => { root.unmount(); });
      Object.assign(globalThis, previous);
      await window.happyDOM.close();
    },
  };
}

