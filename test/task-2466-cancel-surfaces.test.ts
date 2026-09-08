/**
 * TASK-2466 — the three surfaces of `mission:cancel`.
 *
 * Every test drives a real surface: the CLI command, the Ink shell's keyboard
 * router, and the browser board rendered into happy-dom. What they assert is
 * what a dismissed confirmation must never produce — a dispatch.
 */

import { describe, it, test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';

import { Window, type HTMLButtonElement as DomButton } from 'happy-dom';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import React from 'react';

import { Board } from '../web/src/board.js';
import { toWebBoardSnapshot } from '../src/interfaces/web/transport.js';
import { createCancelCommand, parseCancelCliRequest } from '../src/interfaces/cli/cancel.js';
import { missionCleanupCommand } from '../src/composition/production-capabilities.js';
import { missionId } from '../src/domain/mission.js';
import { makeCard, makeProjection } from './fixtures/board-projection.js';

const SLUG = 'task-2466-surface';
const CANCEL_COMMAND = { command: 'cancel', enabled: true, reason: null, targetLane: null, label: 'cancel ✕' } as const;
const ESCAPE = '';

/** Records every request a surface dispatches, and answers with one outcome. */
function dispatcherSpy(outcome: unknown = { status: 'completed', value: { slug: SLUG, cleanupCommand: `git worktree remove /tmp/${SLUG} && git branch -D mission/${SLUG}` }, durableEvidence: [] }) {
  const requests: Array<Record<string, unknown>> = [];
  return {
    requests,
    canExecute: () => true,
    async dispatch(request: Record<string, unknown>) { requests.push(request); return outcome; },
  };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

describe('px cancel', () => {
  it('refuses to dispatch without the explicit --yes confirmation', async () => {
    const dispatcher = dispatcherSpy();
    const lines: string[] = [];
    const codes: number[] = [];
    const code = await createCancelCommand(dispatcher as never, (line) => lines.push(line), (value) => codes.push(value))([SLUG]);

    assert.equal(code, 1);
    assert.deepEqual(codes, [1]);
    assert.deepEqual(dispatcher.requests, []);
    assert.match(lines.join('\n'), /Re-run with: px cancel task-2466-surface --yes/);
  });

  it('dispatches mission:cancel carrying the mission id alone and prints the operator git cleanup', async () => {
    const dispatcher = dispatcherSpy();
    const lines: string[] = [];
    const code = await createCancelCommand(dispatcher as never, (line) => lines.push(line), () => {})([SLUG, '--yes']);

    assert.equal(code, 0);
    assert.equal(dispatcher.requests.length, 1);
    assert.equal(dispatcher.requests[0].kind, 'mission:cancel');
    assert.equal(dispatcher.requests[0].missionId, SLUG);
    assert.equal(dispatcher.requests[0].payload, undefined);
    assert.match(lines.join('\n'), /Usage statistics for task-2466-surface are preserved\./);
    assert.match(lines.join('\n'), /git worktree remove \/tmp\/task-2466-surface && git branch -D mission\/task-2466-surface/);
  });

  it('rejects an unknown flag and a missing slug', () => {
    assert.throws(() => parseCancelCliRequest([SLUG, '--force']), /Unknown cancel option: --force/);
    assert.throws(() => parseCancelCliRequest(['--yes']), /requires exactly one mission slug/);
  });
});

// ---------------------------------------------------------------------------
// Advisory git cleanup
// ---------------------------------------------------------------------------

test('the cleanup command is built with read-only git and mutates nothing', () => {
  const gitCalls: string[][] = [];
  const gitFn = (args: string[]) => {
    gitCalls.push(args);
    return { stdout: '', status: 0 };
  };
  const command = missionCleanupCommand(SLUG, '/fixture/parallix', gitFn);

  assert.match(command, /^git worktree remove .*task-2466-surface && git branch -D .*task-2466-surface$/);
  // The builder may only *read* git state; a mutating verb here would mean
  // cancellation touched the worktree it merely reports on.
  for (const call of gitCalls) {
    assert.deepEqual(call, ['worktree', 'list', '--porcelain']);
  }
});

// ---------------------------------------------------------------------------
// TUI
// ---------------------------------------------------------------------------

class Stream extends EventEmitter {
  public columns = 120;
  public rows = 30;
  public readonly isTTY = true;
  public readonly writes: string[] = [];
  private readonly input: string[] = [];
  write(value: string): boolean { this.writes.push(value); this.emit('write'); return true; }
  setRawMode(_enabled: boolean): void {}
  setEncoding(_encoding: string): void {}
  resume(): void {}
  ref(): void {}
  unref(): void {}
  read(): string | null { return this.input.shift() ?? null; }
  send(value: string): void { this.input.push(value); this.emit('readable'); }
}

async function waitFor(predicate: () => boolean, timeoutMs = 2_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (predicate()) { return true; }
    if (Date.now() >= deadline) { return false; }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

function waitForOutput(stream: Stream, pattern: RegExp, timeoutMs = 2_000): Promise<boolean> {
  return waitFor(() => pattern.test(stream.writes.join('')), timeoutMs);
}

async function renderCancelBoard(dispatcher: { dispatch: (..._args: any[]) => Promise<any> }, refreshProjection?: () => Promise<any>) {
  const ink = await import('ink');
  const { BoardShell } = await import('../src/interfaces/tui/shell.js');
  const stdin = new Stream();
  const stdout = new Stream();
  const card = makeCard({
    id: SLUG as never,
    lane: 'active', status: 'active', rawStatus: 'active',
    commands: [CANCEL_COMMAND],
  });
  const instance = ink.render(React.createElement(BoardShell, {
    projection: makeProjection({ active: [card] }),
    initialSelectedMissionId: SLUG,
    commandControllerFactory: () => ({ canExecute: (kind: string) => kind === 'mission:cancel', ...dispatcher }),
    refreshProjection,
  } as never), { stdin: stdin as unknown as NodeJS.ReadStream, stdout: stdout as unknown as NodeJS.WriteStream, patchConsole: false, exitOnCtrlC: false });
  await waitFor(() => stdout.writes.length > 0);
  return { stdin, stdout, instance };
}

describe('the TUI cancel confirmation', () => {
  it('ignores the Enter that confirms every other command and deletes only on a second Shift+X', async () => {
    const dispatcher = dispatcherSpy();
    const ui = await renderCancelBoard(dispatcher);
    try {
      ui.stdin.send('X');
      assert.ok(await waitForOutput(ui.stdout, /CONFIRM DESTRUCTIVE CANCELLATION/), 'Shift+X must open the destructive dialog');

      ui.stdin.send('\r');
      assert.equal(await waitFor(() => dispatcher.requests.length > 0, 300), false, 'Enter must not confirm a cancellation');

      ui.stdin.send('X');
      assert.ok(await waitFor(() => dispatcher.requests.length === 1), 'the second Shift+X must dispatch');
      assert.equal(dispatcher.requests[0].kind, 'mission:cancel');
      assert.equal(dispatcher.requests[0].missionId, SLUG);
    } finally { ui.instance.unmount(); }
  });

  it('dismissing with Escape deletes nothing', async () => {
    const dispatcher = dispatcherSpy();
    const ui = await renderCancelBoard(dispatcher);
    try {
      ui.stdin.send('X');
      assert.ok(await waitForOutput(ui.stdout, /CONFIRM DESTRUCTIVE CANCELLATION/));
      ui.stdin.send(ESCAPE);
      assert.ok(await waitForOutput(ui.stdout, /CANCELLED: cancelled before dispatch/));
      assert.deepEqual(dispatcher.requests, []);
    } finally { ui.instance.unmount(); }
  });

  it('drops the cancelled mission from the board without a restart', async () => {
    const dispatcher = dispatcherSpy();
    let refreshes = 0;
    const ui = await renderCancelBoard(dispatcher, async () => { refreshes += 1; return makeProjection({}); });
    try {
      ui.stdin.send('X');
      assert.ok(await waitForOutput(ui.stdout, /CONFIRM DESTRUCTIVE CANCELLATION/));
      ui.stdin.send('X');
      assert.ok(await waitFor(() => refreshes === 1), 'a completed cancel must rebuild the projection');
      assert.ok(await waitFor(() => !ui.stdout.writes.slice(-1).join('').includes(SLUG)), 'the cancelled card must leave the rendered board');
    } finally { ui.instance.unmount(); }
  });
});

// ---------------------------------------------------------------------------
// Web board
// ---------------------------------------------------------------------------

function webSnapshot() {
  return toWebBoardSnapshot(makeProjection({
    active: [makeCard({ id: missionId(SLUG), status: 'active', lane: 'active', commands: [CANCEL_COMMAND] })],
  }));
}

async function renderWebBoard() {
  const window = new Window();
  const previous = { window: globalThis.window, document: globalThis.document, fetch: globalThis.fetch, IS_REACT_ACT_ENVIRONMENT: globalThis.IS_REACT_ACT_ENVIRONMENT, requestAnimationFrame: globalThis.requestAnimationFrame };
  Object.assign(globalThis, { window, document: window.document });
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  globalThis.requestAnimationFrame = (callback) => { callback(0); return 0; };
  const calls: RequestInit[] = [];
  globalThis.fetch = async (_url, init) => {
    calls.push(init!);
    return new Response(
      JSON.stringify({ kind: 'command-result', transportVersion: 2, status: 'completed', value: { slug: SLUG, cleanupCommand: 'git worktree remove /tmp/x && git branch -D mission/x' }, error: null, durableEvidence: [] }),
      { headers: { 'content-type': 'application/json' } },
    );
  };
  let refreshes = 0;
  const mount = window.document.createElement('div');
  window.document.body.append(mount);
  const root = createRoot(mount);
  await act(async () => { root.render(React.createElement(Board, { snapshot: webSnapshot(), onRefresh: async () => { refreshes += 1; } })); });
  return {
    window, mount, calls, root,
    refreshCount: () => refreshes,
    async close() {
      await act(async () => { root.unmount(); });
      Object.assign(globalThis, previous);
      await window.happyDOM.close();
    },
  };
}

function cancelButton(page: { mount: any }): DomButton {
  return page.mount.querySelector('button[aria-label^="px cancel"]');
}

function buttonLabelled(page: { mount: any }, text: string): DomButton {
  return [...page.mount.querySelectorAll('button')].find((button: DomButton) => button.textContent?.includes(text));
}

describe('the web cancel confirmation', () => {
  it('asks before deleting: the card button alone sends no command', async () => {
    const page = await renderWebBoard();
    try {
      await act(async () => { cancelButton(page).click(); });
      assert.deepEqual(page.calls, []);
      assert.ok(page.mount.querySelector(`section[aria-label="Confirm cancelling ${SLUG}"]`), 'the destructive confirmation must be rendered');
    } finally { await page.close(); }
  });

  it('dismissing the confirmation deletes nothing', async () => {
    const page = await renderWebBoard();
    try {
      await act(async () => { cancelButton(page).click(); });
      await act(async () => { buttonLabelled(page, 'keep mission').click(); });
      assert.deepEqual(page.calls, []);
      assert.equal(page.mount.querySelector(`section[aria-label="Confirm cancelling ${SLUG}"]`), null);
    } finally { await page.close(); }
  });

  it('confirming sends one mission:cancel request and refreshes the board', async () => {
    const page = await renderWebBoard();
    try {
      await act(async () => { cancelButton(page).click(); });
      await act(async () => { buttonLabelled(page, `delete ${SLUG} lifecycle rows`).click(); });
      assert.equal(page.calls.length, 1);
      assert.deepEqual(JSON.parse(String(page.calls[0].body)), {
        missionId: SLUG,
        kind: 'mission:cancel',
        missionStatusAtRequest: 'active',
      });
      assert.equal(page.refreshCount(), 1);
    } finally { await page.close(); }
  });
});
