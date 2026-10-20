/**
 * Browser mission history view (TASK-2661, TASK-2749).
 *
 * Boundary: `web/src/mission-history.tsx` and its GET reads, rendered in
 * happy-dom with a URL-routed fetch double and captured poll timers. Real
 * scrolling and layout are exercised in the Chromium pointer suite.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { Window, HTMLElement as DomHtmlElement, HTMLButtonElement as DomButton } from 'happy-dom';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import React from 'react';
import { Board } from '../../../../web/src/board.js';
import { MissionHistory } from '../../../../web/src/mission-history.js';
import { C } from '../../../../web/src/palette.js';
import { toWebBoardSnapshot } from '../../../../src/interfaces/web/transport.js';
import { makeCard, makeProjection } from '../../../fixtures/board-projection.js';
import { missionId } from '../../../../src/domain/mission.js';

type Route = (_url: URL, _init?: RequestInit) => unknown;

const MISSION = 'task-2749.1';

function operation(runId: string, state: 'running' | 'exited' = 'exited', role = 'execute') {
  return { runId, role, family: 'codex', attempt: 1, state, terminalHost: 'tmux', startedAt: '2026-10-14T10:00:00.000Z', endedAt: null, exitCode: state === 'exited' ? 4 : null, signal: null, streams: { stdout: 100, stderr: 0 }, coverage: ['stdout: 100 of 100 bytes retained'] };
}

function overview(state: string, operations: unknown[], probe: Record<string, unknown> = { kind: 'absent' }) {
  return { missionId: MISSION, state, probe, operations, unattributed: [], notices: ['Retention: bounded.'] };
}

function page(from: number, to: number, text: string, extra: Record<string, unknown> = {}) {
  return { ok: true, runId: 'execute-codex-a1-x', stream: 'stdout', from, to, text, hasEarlier: false, atEnd: true, running: false, gaps: [], ...extra };
}

async function render(route: Route, context: import('node:test').TestContext, element?: (_close: () => void) => React.ReactElement) {
  const window = new Window();
  const reactGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
  const previous = { window: globalThis.window, document: globalThis.document, fetch: globalThis.fetch, IS_REACT_ACT_ENVIRONMENT: reactGlobal.IS_REACT_ACT_ENVIRONMENT };
  Object.assign(globalThis, { window, document: window.document });
  reactGlobal.IS_REACT_ACT_ENVIRONMENT = true;
  const reads: Array<{ path: string; init: RequestInit | undefined }> = [];
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input), 'http://board.test');
    reads.push({ path: `${url.pathname}${url.search}`, init });
    const body = await route(url, init);
    if (body instanceof Error) { throw body; }
    return new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });
  };
  const timers = new Map<number, () => void>();
  const cadences: number[] = [];
  let timerId = 0;
  (context.mock.method as (..._args: unknown[]) => unknown)(window, 'setInterval', (callback: () => void, ms: number) => { cadences.push(ms); timers.set(++timerId, callback); return timerId; });
  (context.mock.method as (..._args: unknown[]) => unknown)(window, 'clearInterval', (id: number) => { timers.delete(id); });
  let closed = 0;
  const mount = window.document.createElement('div');
  window.document.body.append(mount);
  const root = createRoot(mount as unknown as Element);
  let unmounted = false;
  const close = async () => {
    if (unmounted) { return; }
    unmounted = true;
    await act(async () => { root.unmount(); });
    Object.assign(globalThis, previous);
    await window.happyDOM.close();
  };
  context.after(close);
  await act(async () => { root.render(element ? element(() => { closed += 1; }) : React.createElement(MissionHistory, { missionId: MISSION, onClose: () => { closed += 1; } })); });
  const settle = async () => { for (let i = 0; i < 4; i += 1) { await act(async () => { await Promise.resolve(); }); } };
  await settle();
  return {
    window, mount, reads, settle, cadences,
    async mission(id: string) { await act(async () => { root.render(React.createElement(MissionHistory, { missionId: id, onClose: () => { closed += 1; } })); }); await settle(); },
    closed: () => closed,
    async click(target: string | RegExp) { await act(async () => { (typeof target === 'string' ? mount.querySelector<DomHtmlElement>(target) : this.button(target))!.click(); }); await settle(); },
    text: (label = 'Retained history') => mount.querySelector(`[aria-label="${label}"]`)?.textContent ?? '',
    dialog: () => mount.querySelector('[role="dialog"]')?.textContent ?? '',
    async poll() { await act(async () => { for (const tick of [...timers.values()]) { tick(); } }); await settle(); },
    button(label: RegExp) { return [...mount.querySelectorAll<DomButton>('button')].find(button => label.test(button.textContent ?? '')); },
    close,
  };
}

test('selecting a mission card opens retained mission history through GET reads only (TASK-2661, TASK-2749)', async context => {
  const board = toWebBoardSnapshot(makeProjection({ active: [makeCard({ id: missionId(MISSION), status: 'active', lane: 'active', commands: [] })] }));
  const view = await render(() => overview('missing', []), context, () => React.createElement(Board, { snapshot: board, onRefresh: async () => {} }));
  await view.click('[data-board-card]');
  assert.match(view.dialog(), /mission history/);
  assert.match(view.dialog(), /No terminal and no retained history for this mission/);
  assert.ok(view.reads.length > 0 && view.reads.every(read => read.init?.method === undefined), 'history reads never send a mutation method');
  assert.ok(view.reads.every(read => read.path.startsWith(`/api/terminal/${encodeURIComponent(MISSION)}`)), 'the browser passes only the canonical Mission ID');
  const dialog = view.mount.querySelector<DomHtmlElement>('[role="dialog"]');
  assert.ok(dialog);
  const style = dialog.getAttribute('style') ?? '';
  assert.ok(style.includes(`background: ${C.card}`), 'the dialog surface is the board card token, not a separate green palette');
  assert.ok(style.includes(`border: 1px solid ${C.cardEdge}`), 'the dialog edge is the board card edge token');
  assert.ok(!style.includes('#101c16') && !style.includes('#2f5a3f') && !style.includes('#cbd9cf'), 'the removed green modal palette stays removed');
  assert.match(style, /font-size: 12px/, 'history body text sits at the shared body step');
  assert.equal(dialog.className, 'modal-panel', 'bare history controls take the shared dialog control treatment');
  assert.ok(dialog.querySelector('[aria-label="Operation"]') && dialog.querySelector('[aria-label="Stream"]'), 'operation and stream selection remain');
  assert.ok(view.button(/close/), 'close remains');
});

test('the history view shows the retained tail and appends only output after it (TASK-2749)', async context => {
  let tail = true;
  const view = await render(url => {
    if (!url.pathname.endsWith('/history')) { return overview('live', [operation('execute-codex-a1-x', 'running')], { kind: 'live', operation: 'execute-codex-a1-x-s0-1' }); }
    if (tail) { tail = false; return page(0, 22, 'first line <b>bold</b>\n', { running: true }); }
    return url.searchParams.get('after') === '22' ? page(22, 34, 'second line\n', { running: true }) : page(34, 34, '', { running: true });
  }, context);
  assert.match(view.dialog(), /Live: operation execute-codex-a1-x-s0-1 is running/);
  assert.equal(view.text(), 'first line <b>bold</b>\n', 'history text is rendered as text, never markup');
  assert.equal(view.mount.querySelector('[aria-label="Retained history"] b'), null);
  await view.poll();
  assert.equal(view.text(), 'first line <b>bold</b>\nsecond line\n');
  const historyReads = view.reads.filter(read => read.path.includes('/history'));
  assert.deepEqual(historyReads.map(read => new URL(read.path, 'http://x').searchParams.get('after')), [null, '22'], 'each poll reads only bytes after what is shown');
  await view.poll();
  assert.equal(view.text(), 'first line <b>bold</b>\nsecond line\n', 'an empty page appends nothing');
});

test('earlier history loads page by page and marks dropped bytes (TASK-2749)', async context => {
  const view = await render(url => {
    if (!url.pathname.endsWith('/history')) { return overview('ended', [operation('execute-codex-a1-x')]); }
    return url.searchParams.get('before') === '100'
      ? page(0, 50, 'FIRST-LINE\n', { gaps: [{ from: 50, to: 100 }] })
      : page(100, 120, 'LAST-LINE\n', { hasEarlier: true, gaps: [{ from: 50, to: 100 }] });
  }, context);
  assert.equal(view.text(), 'LAST-LINE\n');
  await view.click(/load earlier history/);
  assert.equal(view.text(), 'FIRST-LINE\n\n[… 50 bytes not retained (retention limit or interrupted capture) …]\nLAST-LINE\n');
  assert.equal(view.button(/load earlier history/), undefined, 'paging stops at the first retained byte');
});

test('probe failures and failed reads keep displayed history and recover (TASK-2661, TASK-2749)', async context => {
  let mode: 'timeout' | 'throw' | 'ok' = 'timeout';
  let initialFailure = true;
  const view = await render(url => {
    if (mode === 'throw') { return new Error('network down'); }
    if (url.pathname.endsWith('/history')) {
      if (initialFailure) { initialFailure = false; return new Error('temporary'); }
      return page(0, 15, 'real progress\n');
    }
    return mode === 'timeout'
      ? overview('probe-timeout', [operation('execute-codex-a1-x')], { kind: 'unavailable', reason: 'timeout', detail: 'tmux did not answer within 1000 ms' })
      : overview('ended', [operation('execute-codex-a1-x')]);
  }, context);
  assert.match(view.dialog(), /did not answer in time.*Retained history is still shown/);
  assert.equal(view.text(), '');
  await view.poll();
  assert.equal(view.text(), 'real progress\n');
  assert.doesNotMatch(view.dialog(), /Refresh interrupted/);
  mode = 'throw';
  await view.poll();
  assert.equal(view.text(), 'real progress\n', 'a failed read never wipes displayed history');
  assert.match(view.dialog(), /Refresh interrupted \(Mission history is unavailable\.\)/);
  mode = 'ok';
  await view.poll();
  assert.doesNotMatch(view.dialog(), /Refresh interrupted/);
  assert.match(view.dialog(), /No operation is running\. Showing retained history\./);
});

test('follow output pauses while scrolled back and resumes on request (TASK-2749)', async context => {
  let newer = false;
  const view = await render(url => {
    if (!url.pathname.endsWith('/history')) { return overview('live', newer ? [operation('new'), operation('old', 'running')] : [operation('old', 'running')], { kind: 'live', operation: 'w' }); }
    if (url.searchParams.get('run') === 'new') { return page(0, 8, 'NEW-RUN'); }
    const after = Number(url.searchParams.get('after') ?? -1);
    if (after < 0) { return page(0, 10, 'line 0000\n', { running: true }); }
    return page(after, after + 10, `line ${String(after).padStart(4, '0')}\n`, { running: true });
  }, context);
  const pre = view.mount.querySelector<DomHtmlElement>('[aria-label="Retained history"]')!;
  let height = 1000;
  Object.defineProperty(pre, 'scrollHeight', { get: () => height });
  Object.defineProperty(pre, 'clientHeight', { get: () => 100 });
  await view.poll();
  assert.equal(pre.scrollTop, 1000, 'following keeps the newest output in view');
  await act(async () => { pre.scrollTop = 200; pre.dispatchEvent(new view.window.Event('scroll')); });
  assert.ok(view.button(/follow output/), 'scrolling back pauses follow and offers to resume');
  assert.equal(pre.getAttribute('aria-live'), 'off');
  height = 1400;
  await view.poll();
  assert.equal(pre.scrollTop, 200, 'arriving output does not move the operator away from earlier history');
  assert.match(view.text(), /line 0020\n$/, 'new output is still appended below');
  newer = true;
  await view.poll();
  assert.doesNotMatch(view.text(), /NEW-RUN/, 'a newer operation cannot replace the paused run');
  assert.equal(pre.scrollTop, 200);
  assert.ok(view.button(/follow output/));
  await view.click(/follow output/);
  assert.equal(view.text(), 'NEW-RUN');
  assert.equal(pre.scrollTop, 1400);
});

test('search jumps to a hit, copy copies the shown history, and the live pane is optional (TASK-2749)', async context => {
  const copied: string[] = [];
  context.after(() => { delete (globalThis.navigator as { clipboard?: unknown }).clipboard; });
  Object.defineProperty(globalThis.navigator, 'clipboard', { configurable: true, value: { writeText: async (text: string) => { copied.push(text); } } });
  const view = await render(url => {
    if (url.pathname.endsWith('/search')) { return { ok: true, hits: [{ ref: 'run:review-claude-a1-y:stdout@5000+4', runId: 'review-claude-a1-y', stream: 'stdout', offset: 5000, preview: 'E401 failed' }], totalHits: 1, searchedRuns: [], scanLimited: false, coverage: [], errors: [] }; }
    if (url.pathname.endsWith('/live')) { return { kind: 'live', operation: null, output: 'LIVE-PANE-TEXT' }; }
    if (url.pathname.endsWith('/history')) {
      return url.searchParams.get('run') === 'review-claude-a1-y' ? page(4000, 7048, 'context E401 failed\n', { runId: 'review-claude-a1-y', hasEarlier: true, atEnd: false }) : page(0, 6, 'tail\n');
    }
    return overview('ended', [operation('execute-codex-a1-x'), operation('review-claude-a1-y', 'exited', 'review')]);
  }, context);
  (view.mount.querySelector('[aria-label="Search retained history"]') as unknown as { value: string }).value = 'E401';
  await act(async () => { view.mount.querySelector('form')!.dispatchEvent(new view.window.Event('submit', { bubbles: true, cancelable: true })); });
  await view.settle();
  assert.match(view.mount.querySelector('[aria-label="Search results"]')?.textContent ?? '', /1 match\(es\).*review-claude-a1-y stdout@5000/s);
  assert.match(view.reads.find(read => read.path.includes('/search'))!.path, /\/search\?q=E401$/, 'search is literal text only');
  await view.click(/review-claude-a1-y stdout@5000/);
  const jump = view.reads.filter(read => read.path.includes('run=review-claude-a1-y')).at(-1)!.path;
  assert.match(jump, /before=7048/, 'the hit is loaded with context, not the whole transcript');
  assert.equal(view.text(), 'context E401 failed\n');
  await view.click(/^copy$/);
  assert.deepEqual(copied, ['context E401 failed\n']);
  await view.click('input[type="checkbox"]');
  assert.equal(view.mount.querySelector('[aria-label="Live pane"]')?.textContent, 'LIVE-PANE-TEXT');
  assert.equal(view.text(), 'context E401 failed\n', 'the live pane never replaces the history');
});

test('polling skips pending reads and closing cancels them (TASK-2661, TASK-2749)', async context => {
  let pending: AbortSignal | undefined;
  const view = await render((_url, init) => new Promise((_resolve, reject) => {
    pending = init!.signal!;
    pending.addEventListener('abort', () => reject(new Error('closed')), { once: true });
  }), context);
  const before = view.reads.length;
  await view.poll();
  await view.poll();
  assert.equal(view.reads.length, before, 'a slow overview read must not accumulate requests');
  assert.match(view.dialog(), /Loading mission history/);
  await act(async () => { view.button(/^close$/)!.click(); });
  assert.equal(view.closed(), 1);
  await view.close();
  assert.equal(pending?.aborted, true, 'unmounting cancels the outstanding read');
});

for (const stop of ['close', 'mission change', 'unmount'] as const) {
  test(`live polling serializes, recovers and cancels on ${stop} (TASK-2781)`, async context => {
    const pending: Array<{ resolve: (_body: unknown) => void; signal: AbortSignal; path: string }> = [];
    const view = await render((url, init) => url.pathname.endsWith('/live')
      ? new Promise(resolve => { pending.push({ resolve, signal: init!.signal!, path: url.pathname }); })
      : overview('missing', []), context);
    const complete = async (index: number, body: unknown) => { pending[index]!.resolve(body); await view.settle(); };
    const live = (output: string) => ({ kind: 'live', operation: null, output });
    context.after(() => { for (const request of pending) { request.resolve(live('cleanup')); } });
    await view.click('input[type="checkbox"]');
    assert.equal(pending.length, 1, 'opening starts immediately');
    await view.poll();
    await view.poll();
    assert.equal(pending.length, 1, 'multiple ticks must not overlap a pending live read');
    assert.ok(pending[0]!.signal instanceof AbortSignal);
    assert.equal(pending[0]!.signal.aborted, false);
    assert.ok(view.cadences.every(ms => ms === 1000));
    await complete(0, live('FIRST'));
    await view.poll();
    await complete(1, new Error('temporary network failure'));
    assert.equal(view.text('Live pane'), 'FIRST', 'failed refresh keeps displayed output');
    await view.poll();
    await complete(2, live('RECOVERED'));
    assert.equal(view.text('Live pane'), 'RECOVERED');
    await view.poll();
    await complete(3, { kind: 'not-live', probe: { kind: 'unavailable', detail: 'timeout' } });
    assert.equal(view.text('Live pane'), 'No live pane (unavailable: timeout).');
    await view.poll();
    if (stop === 'close') { await view.click('input[type="checkbox"]'); await view.click('input[type="checkbox"]'); }
    else if (stop === 'mission change') { await view.mission('task-2781-other'); }
    else { await view.close(); }
    assert.equal(pending[4]!.signal.aborted, true);
    if (stop !== 'unmount') {
      assert.equal(pending.length, 6, 'a new generation starts immediately');
      assert.equal(pending[5]!.signal.aborted, false);
      if (stop === 'mission change') { assert.match(pending[5]!.path, /task-2781-other/); }
      await complete(5, live('CURRENT'));
    }
    await complete(4, live('OBSOLETE'));
    assert.equal(view.text('Live pane'), stop === 'unmount' ? '' : 'CURRENT');
    assert.ok(view.reads.every(read => read.init?.method === undefined && read.init?.signal instanceof AbortSignal));
    if (stop !== 'unmount') { await view.poll(); assert.equal(pending.length, 7, 'obsolete interval was cleared'); }
  });
}
