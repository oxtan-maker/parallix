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
import { loadOverview, loadLive, loadPage, searchHistory } from '../../../../web/src/mission-history-data.js';
import { C } from '../../../../web/src/palette.js';
import { toWebBoardSnapshot } from '../../../../src/interfaces/web/transport.js';
import { makeCard, makeProjection } from '../../../fixtures/board-projection.js';
import { agentFamily } from '../../../../src/domain/agents.js';
import { missionId } from '../../../../src/domain/mission.js';

type Route = (_url: URL, _init?: RequestInit) => unknown;

const MISSION = 'task-2749.1';

function operation(runId: string, state: 'running' | 'exited' = 'exited', role = 'execute') {
  return { captureKind: 'agent', operationId: null, execution: 'stopped', legacy: false, redacted: false, runId, role, family: agentFamily('codex'), attempt: 1, state, terminalHost: 'tmux', startedAt: '2026-10-14T10:00:00.000Z', endedAt: null, exitCode: state === 'exited' ? 4 : null, signal: null, streams: { stdout: 100, stderr: 0 }, coverage: ['stdout: 100 of 100 bytes retained'] };
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
  let mode: 'timeout' | 'throw' | 'malformed' | 'ok' = 'timeout';
  let initialFailure = true;
  const view = await render(url => {
    if (mode === 'throw') { return new Error('network down'); }
    if (url.pathname.endsWith('/history')) {
      if (initialFailure) { initialFailure = false; return new Error('temporary'); }
      return page(0, 15, 'real progress\n');
    }
    if (mode === 'malformed') { return { ...overview('ended', [operation('execute-codex-a1-x')]), notices: undefined }; }
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
  mode = 'malformed';
  await view.poll();
  assert.equal(view.text(), 'real progress\n', 'a malformed overview keeps useful history (TASK-2786)');
  assert.match(view.dialog(), /Refresh interrupted.*unexpected shape/);
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
    await complete(3, { kind: 'not-live', probe: { kind: 'unavailable', reason: 'timeout', detail: 'timeout' } });
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

test('nested card interactions do not open mission progress (TASK-2773.09)', async () => {
  const { renderBoard } = await import('./web-board-harness.fixture.js');
  const card = makeCard({ gate: 'failed', blockingReason: 'Fixture blocked', commands: [{ command: 'handoff', enabled: true, reason: null, targetLane: 'review' }] });
  const page = await renderBoard({ board: toWebBoardSnapshot(makeProjection({ active: [card] })) });
  try {
    const article = page.mount.querySelector<DomHtmlElement>('[data-board-card]')!;
    await act(async () => { article.focus(); });
    assert.equal(article.style.borderTopColor, C.red);
    const link = page.window.document.createElement('a');
    link.href = '#fixture'; link.textContent = 'fixture link'; article.append(link);
    for (const nested of article.querySelectorAll<DomHtmlElement>('a,summary,button')) {
      await act(async () => { nested.click(); });
      assert.equal(page.mount.querySelector('[aria-label^="Mission progress for"]'), null);
    }
    assert.deepEqual(page.calls.filter(call => call.method === 'POST').map(call => JSON.parse(String(call.body)).kind), ['handoff:record', 'mission:edit-read']);
    await act(async () => {
      const drag = new page.window.Event('dragstart', { bubbles: true });
      Object.defineProperty(drag, 'dataTransfer', { value: { setData() {}, setDragImage() {}, effectAllowed: '' } });
      article.dispatchEvent(drag);
      article.dispatchEvent(new page.window.Event('dragend', { bubbles: true }));
    });
    assert.equal(page.mount.querySelector('[aria-label^="Mission progress for"]'), null);
  } finally { await page.close(); }
});

test('history reads reject incomplete and nested malformed wire payloads (TASK-2786)', async context => {
  const original = globalThis.fetch;
  context.after(() => { globalThis.fetch = original; });
  const validOverview = overview('ended', [operation('run')]);
  const missingNotices = { ...validOverview, notices: undefined };
  const cases: Array<[() => Promise<{ ok: boolean }>, unknown]> = [
    [() => loadOverview(MISSION), missingNotices],
    [() => loadLive(MISSION), { kind: 'not-live' }],
    [() => loadOverview(MISSION), { ...validOverview, operations: [{ ...operation('run'), startedAt: 42 }] }],
    [() => loadOverview(MISSION), { ...validOverview, probe: { kind: 'live' } }],
    [() => loadPage(MISSION, { runId: 'run', stream: 'stdout' }), page(0, 1, 'x', { gaps: [{ from: -1, to: 1 }] })],
    [() => searchHistory(MISSION, 'x'), { hits: [{ runId: 'run', stream: 'stdin', offset: 0, preview: 'x' }], totalHits: 1, scanLimited: false }],
  ];
  for (const [load, body] of cases) {
    globalThis.fetch = async () => new Response(JSON.stringify(body));
    assert.equal((await load()).ok, false, JSON.stringify(body));
  }
});

test('application history payloads survive JSON browser reads (TASK-2786)', async context => {
  const original = globalThis.fetch;
  context.after(() => { globalThis.fetch = original; });
  const payload: import('../../../../src/application/ports/mission-terminal.js').MissionHistoryOverview = {
    missionId: MISSION, state: 'ended', probe: { kind: 'live', operation: 'execute', runId: null, execution: null },
    operations: [{ ...operation('run'), captureKind: 'agent', operationId: null, execution: 'unknown', legacy: false, redacted: false, state: 'exited', terminalHost: 'tmux' }],
    notices: [], unattributed: [],
  };
  for (const probe of [payload.probe, { kind: 'starting', operation: 'execute' }, { kind: 'absent' }] as const) {
    globalThis.fetch = async () => new Response(JSON.stringify({ ...payload, probe }));
    assert.equal((await loadOverview(MISSION)).ok, true);
  }
});

test('history wire validators check every required field and numeric range (TASK-2786)', async () => {
  const { validateHistoryOverview, validateHistoryPage, validateHistorySearch, validateHistoryLive } = await import('../../../../src/interfaces/web/history-transport.js');
  const validOperation = operation('run');
  const validOverview = overview('ended', [validOperation]);
  const validPage = page(0, 10, 'text');
  const hit = { ref: 'run:run:stdout@0+4', runId: 'run', stream: 'stdout', offset: 0, preview: 'text' };
  const validSearch = { hits: [hit], totalHits: 1, searchedRuns: ['run'], scanLimited: false, coverage: [], errors: [] };
  const invalid = (check: (_body: unknown) => unknown, body: Record<string, unknown>, keys: string[]) => {
    assert.ok(check(JSON.parse(JSON.stringify(body))));
    for (const key of keys) {
      const missing = { ...body }; delete missing[key];
      assert.equal(check(missing), null, 'missing ' + key);
      assert.equal(check({ ...body, [key]: {} }), null, 'mistyped ' + key);
    }
  };
  invalid(validateHistoryOverview, validOverview, Object.keys(validOverview));
  invalid(body => validateHistoryOverview({ ...validOverview, operations: [body] }), validOperation, Object.keys(validOperation));
  invalid(validateHistoryPage, validPage, Object.keys(validPage).filter(key => key !== 'ok'));
  invalid(validateHistorySearch, validSearch, Object.keys(validSearch));
  invalid(body => validateHistorySearch({ ...validSearch, hits: [body] }), hit, Object.keys(hit));
  invalid(validateHistoryLive, { kind: 'live', operation: null, output: '' }, ['kind', 'operation', 'output']);
  invalid(validateHistoryLive, { kind: 'not-live', probe: { kind: 'absent' } }, ['kind', 'probe']);
  for (const probe of [
    { kind: 'absent' }, { kind: 'idle' }, { kind: 'starting', operation: 'execute' },
    { kind: 'live', operation: 'execute', runId: null, execution: null },
    { kind: 'ambiguous', sessions: ['other'], detail: 'ambiguous' },
    ...['host-missing', 'failed', 'timeout'].map(reason => ({ kind: 'unavailable', reason, detail: reason })),
  ]) {
    invalid(body => validateHistoryLive({ kind: 'not-live', probe: body }), probe, Object.keys(probe).filter(key => key !== 'runId' && key !== 'execution'));
  }
  for (const bad of [NaN, Infinity, -Infinity, -1, 0.5, Number.MAX_SAFE_INTEGER + 1]) {
    assert.equal(validateHistoryPage({ ...validPage, from: bad }), null);
    assert.equal(validateHistoryPage({ ...validPage, gaps: [{ from: 0, to: bad }] }), null);
    assert.equal(validateHistoryOverview({ ...validOverview, operations: [{ ...validOperation, streams: { stdout: bad, stderr: 0 } }] }), null);
    assert.equal(validateHistorySearch({ ...validSearch, totalHits: bad }), null);
    assert.equal(validateHistorySearch({ ...validSearch, hits: [{ ...hit, offset: bad }] }), null);
    assert.equal(validateHistoryOverview({ ...validOverview, operations: [{ ...validOperation, attempt: bad }] }), null);
  }
  assert.equal(validateHistoryPage({ ...validPage, from: 11 }), null);
  assert.equal(validateHistorySearch({ ...validSearch, totalHits: 0 }), null);
  assert.equal(validateHistoryOverview({ ...validOverview, operations: [{ ...validOperation, attempt: 0 }] }), null);
  assert.equal(validateHistoryOverview({ ...validOverview, operations: [{ ...validOperation, exitCode: Infinity }] }), null);
  for (const probe of [
    { kind: 'starting', operation: 'execute', runId: undefined },
    { kind: 'live', operation: 'execute', execution: 'yes' },
    { kind: 'live', operation: null }, { kind: 'unavailable', reason: 'unknown', detail: '' },
  ]) { assert.equal(validateHistoryLive({ kind: 'not-live', probe }), null); }
  for (const state of ['starting', 'live', 'ended', 'capture-only', 'missing', 'probe-failed', 'probe-timeout', 'ambiguous']) {
    assert.ok(validateHistoryOverview({ ...validOverview, state }));
  }
});

test('terminal route JSON projects application history into browser validated reads (TASK-2786)', async context => {
  const { default: Fastify } = await import('fastify');
  const { registerTerminalRoute } = await import('../../../../src/interfaces/web/terminal-route.js');
  const app = Fastify();
  const original = globalThis.fetch;
  context.after(async () => { globalThis.fetch = original; await app.close(); });
  const model: import('../../../../src/application/ports/mission-terminal.js').MissionHistoryOverview = {
    missionId: MISSION, state: 'ended', probe: { kind: 'starting', operation: 'execute' },
    operations: [{ ...operation('run'), captureKind: 'coordinator', family: null, attempt: null, operationId: null, execution: 'unknown', legacy: false, redacted: true, state: 'exited', terminalHost: 'pipe' }],
    notices: ['bounded'], unattributed: ['legacy record'],
  };
  registerTerminalRoute(app, {
    buildProjection: async () => makeProjection({ active: [makeCard({ id: missionId(MISSION) })] }),
    missionTerminal: () => ({
      overview: () => model,
      page: () => ({ ok: true, runId: 'run', stream: 'stdout', from: 2, to: 5, text: 'abc', hasEarlier: true, atEnd: false, running: true, gaps: [{ from: 0, to: 2 }] }),
      search: () => ({ ok: true, hits: [{ ref: 'run:run:stdout@2+3', runId: 'run', stream: 'stdout', offset: 2, preview: 'abc' }], totalHits: 1, searchedRuns: ['run'], scanLimited: true, coverage: ['limited'], errors: [] }),
      live: () => ({ kind: 'not-live', probe: { kind: 'live', operation: 'execute', runId: null, execution: null } }),
    }),
  });
  globalThis.fetch = async input => {
    const response = await app.inject({ method: 'GET', url: String(input) });
    assert.equal(response.statusCode, 200);
    return new Response(response.body);
  };
  const result = await loadOverview(MISSION);
  assert.deepEqual(result, { ok: true, value: model });
  assert.ok(result.ok && !('runId' in result.value.probe), 'optional omission stays omitted');
  const live = await loadLive(MISSION);
  assert.deepEqual(live, { ok: true, value: { kind: 'not-live', probe: { kind: 'live', operation: 'execute', runId: null, execution: null } } });
  assert.equal((await loadPage(MISSION, { runId: 'run', stream: 'stdout' })).ok, true);
  assert.equal((await searchHistory(MISSION, 'abc')).ok, true);
});

for (const [state, probe, description] of [
  ['starting', { kind: 'starting', operation: 'execute' }, /Starting:/],
  ['live', { kind: 'live', operation: 'execute', execution: null }, /Live: operation execute/],
  ['ended', { kind: 'idle' }, /No operation is running/],
  ['capture-only', { kind: 'absent' }, /without a terminal/],
  ['missing', { kind: 'absent' }, /No terminal and no retained history/],
  ['probe-failed', { kind: 'unavailable', reason: 'failed', detail: 'failed' }, /could not be inspected/],
  ['probe-timeout', { kind: 'unavailable', reason: 'timeout', detail: 'timeout' }, /did not answer in time/],
  ['ambiguous', { kind: 'ambiguous', sessions: ['other'], detail: 'ambiguous' }, /could not be attributed/],
] as const) {
  test('validated history renders ' + state + ' (TASK-2786)', async context => {
    const view = await render(() => overview(state, [], probe), context);
    assert.match(view.dialog(), description);
    assert.doesNotMatch(view.dialog(), /Refresh interrupted/);
  });
}
