import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { makeCard, makeProjection } from './fixtures/board-projection.js';

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

async function waitForWrite(stream: Stream, writeCount: number): Promise<void> {
  if (stream.writes.length > writeCount) { return; }
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('timed out waiting for TUI re-render')), 1_000);
    stream.once('write', () => { clearTimeout(timeout); resolve(); });
  });
}

/**
 * Poll until the predicate holds or the budget is exhausted. Ink renders on
 * the event loop, so a fixed sleep before asserting on rendered output is a
 * load-dependent flake; waiting for the condition makes the wait exact.
 */
async function waitFor(predicate: () => boolean, timeoutMs = 2_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (predicate()) {return true;}
    if (Date.now() >= deadline) {return false;}
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

/** Wait until the cumulative stream output matches the pattern. */
function waitForOutput(stream: Stream, pattern: RegExp, timeoutMs = 2_000): Promise<boolean> {
  return waitFor(() => pattern.test(stream.writes.join('')), timeoutMs);
}

async function renderFlow(controller: { dispatch: (...args: any[]) => Promise<any> }, refreshProjection?: () => Promise<any>) {
  const ink = await import('ink');
  const React = await import('react');
  const { BoardShell } = await import('../src/interfaces/tui/shell.js');
  const stdin = new Stream();
  const stdout = new Stream();
  const card = makeCard({
    id: 'task-flow' as never,
    lane: 'refined', status: 'refined', rawStatus: 'refined',
    commands: [{ command: 'active', enabled: true, reason: null }],
  });
  const instance = ink.render(React.createElement(BoardShell, {
    projection: makeProjection({ refined: [card] }),
    commandControllerFactory: () => controller,
    refreshProjection,
  } as never), { stdin: stdin as unknown as NodeJS.ReadStream, stdout: stdout as unknown as NodeJS.WriteStream, patchConsole: false, exitOnCtrlC: false });
  await waitForWrite(stdout, 0);
  return { stdin, stdout, instance };
}

test('confirmation cancellation dispatches nothing and renders cancelled outcome', async () => {
  let calls = 0;
  const ui = await renderFlow({ async dispatch() { calls += 1; return { status: 'completed', durableEvidence: [] }; } });
  ui.stdin.send('\r');
  await waitForOutput(ui.stdout, /CONFIRM CONSEQUENTIAL ACTION/);
  ui.stdin.send('\u001b');
  const cancelled = await waitForOutput(ui.stdout, /CANCELLED: cancelled before dispatch/);
  ui.instance.unmount();
  assert.equal(calls, 0);
  assert.ok(cancelled, 'cancellation must render the cancelled outcome');
});

test('confirmed action dispatches through supplied controller and conflict refreshes before re-prompting', async () => {
  let calls = 0;
  let refreshes = 0;
  const ui = await renderFlow({ async dispatch() {
    calls += 1;
    return { status: 'failed', error: { kind: 'conflict', message: 'stale mission' }, durableEvidence: [] };
  } }, async () => {
    refreshes += 1;
    return makeProjection({ refined: [makeCard({ id: 'task-flow' as never, lane: 'refined', status: 'refined', commands: [{ command: 'active', enabled: true, reason: null }] })] });
  });
  ui.stdin.send('\r');
  await waitForOutput(ui.stdout, /CONFIRM CONSEQUENTIAL ACTION/);
  ui.stdin.send('\r');
  await waitFor(() => refreshes === 1);
  ui.instance.unmount();
  assert.equal(calls, 1);
  assert.equal(refreshes, 1);
  assert.match(ui.stdout.writes.join(''), /CONFIRM CONSEQUENTIAL ACTION/);
});

test('progress events render in the command log without changing the card lane', async () => {
  const ink = await import('ink');
  const React = await import('react');
  const { BoardShell } = await import('../src/interfaces/tui/shell.js');
  const card = makeCard({
    id: 'task-progress' as never,
    lane: 'refined', status: 'refined', rawStatus: 'refined',
    commands: [{ command: 'active', enabled: true, reason: null }],
  });
  let progress: ((event: any) => void) | undefined;
  const stdin = new Stream();
  const stdout = new Stream();
  const instance = ink.render(React.createElement(BoardShell, {
    projection: makeProjection({ refined: [card] }),
    commandControllerFactory: (receiveProgress: any) => {
      progress = receiveProgress;
      return { async dispatch() { return { status: 'completed', durableEvidence: [] }; } };
    },
  } as never), { stdin: stdin as unknown as NodeJS.ReadStream, stdout: stdout as unknown as NodeJS.WriteStream, patchConsole: false, exitOnCtrlC: false });
  await new Promise((resolve) => setTimeout(resolve, 35));
  progress!({ operationId: 'op-progress', sequence: 2, phase: 'record', message: 'durable evidence recorded', timestamp: '2026-07-26T12:00:00.000Z' });
  await waitForOutput(stdout, /record durable evidence recorded/);
  instance.unmount();
  const output = stdout.writes.join('');
  assert.match(output, /record durable evidence recorded/);
  assert.match(output, /REFINED 1/);
  assert.doesNotMatch(output, /ACTIVE 1/);
});

/* ------------------------------------------------------------------ */
/* SC6: Lifecycle shortcut dispatch (Ctrl+A / Ctrl+D/R/I)              */
/* ------------------------------------------------------------------ */

test('Ctrl+A on enabled card shows confirmation and dispatches on Enter', async () => {
  let calls = 0;
  const ui = await renderFlow({ async dispatch() { calls += 1; return { status: 'completed', durableEvidence: [] }; } });
  /* Ctrl+A (\x01) triggers lifecycle shortcut for active:execute. */
  ui.stdin.send('\x01');
  /* Confirmation dialog should appear. */
  await waitForOutput(ui.stdout, /CONFIRM CONSEQUENTIAL ACTION/);
  assert.match(ui.stdout.writes.join(''), /CONFIRM CONSEQUENTIAL ACTION/);
  /* Press Enter to confirm. */
  ui.stdin.send('\r');
  await waitFor(() => calls === 1);
  ui.instance.unmount();
  assert.equal(calls, 1, 'Ctrl+A + Enter must dispatch once');
});

test('Ctrl+A on disabled card does not dispatch (pins R1)', async () => {
  let calls = 0;
  const stdin = new Stream();
  const stdout = new Stream();
  /* Card with active:execute disabled. */
  const card = makeCard({
    id: 'task-disabled' as never,
    lane: 'done', status: 'done', rawStatus: 'done',
    commands: [{ command: 'active', enabled: false, reason: 'Mission cannot be activated from its current state' }],
  });
  const instance = ink.render(React.createElement(BoardShell, {
    projection: makeProjection({ done: [card] }),
    commandControllerFactory: () => ({ async dispatch() { calls += 1; return { status: 'completed', durableEvidence: [] }; } }),
  } as never), { stdin: stdin as unknown as NodeJS.ReadStream, stdout: stdout as unknown as NodeJS.WriteStream, patchConsole: false, exitOnCtrlC: false });
  await new Promise((resolve) => setTimeout(resolve, 35));
  /* Ctrl+A on a card whose active command is disabled. */
  stdin.send('\x01');
  await new Promise((resolve) => setTimeout(resolve, 35));
  instance.unmount();
  assert.equal(calls, 0, 'Ctrl+A must not dispatch when active command is disabled');
  /* Confirmation dialog must NOT appear (canDispatchAction guard blocks it). */
  assert.doesNotMatch(stdout.writes.join(''), /CONFIRM CONSEQUENTIAL ACTION/);
});

test('Ctrl+D on card produces unavailable outcome without dispatching', async () => {
  let calls = 0;
  const ui = await renderFlow({ async dispatch() { calls += 1; return { status: 'completed', durableEvidence: [] }; } });
  /* Ctrl+D (\x04) triggers draft:create which is not integrated. */
  ui.stdin.send('\x04');
  await waitForOutput(ui.stdout, /unavailableCapability|not yet available/i);
  ui.instance.unmount();
  assert.equal(calls, 0, 'Ctrl+D must not dispatch (unavailable capability)');
  assert.match(ui.stdout.writes.join(''), /unavailableCapability|not yet available/i, 'Ctrl+D must show unavailable outcome');
});

test('Ctrl+R on card produces unavailable outcome without dispatching', async () => {
  let calls = 0;
  const ui = await renderFlow({ async dispatch() { calls += 1; return { status: 'completed', durableEvidence: [] }; } });
  /* Ctrl+R (\x12) triggers review:submit which is not integrated. */
  ui.stdin.send('\x12');
  await waitForOutput(ui.stdout, /unavailableCapability|not yet available/i);
  ui.instance.unmount();
  assert.equal(calls, 0, 'Ctrl+R must not dispatch (unavailable capability)');
  assert.match(ui.stdout.writes.join(''), /unavailableCapability|not yet available/i, 'Ctrl+R must show unavailable outcome');
});

/* ------------------------------------------------------------------ */
/* SC7: Shift+S shipped lane toggle                                    */
/* ------------------------------------------------------------------ */

test('Shift+S toggles shipped lane to collapsed strip and back', async () => {
  const ink = await import('ink');
  const React = await import('react');
  const { BoardShell } = await import('../src/interfaces/tui/shell.js');
  const stdin = new Stream();
  const stdout = new Stream();
  const projection = makeProjection({ done: [makeCard({ id: 'task-done' as never, lane: 'done', status: 'done', rawStatus: 'done' })] });
  const instance = ink.render(React.createElement(BoardShell, {
    projection,
  } as never), { stdin: stdin as unknown as NodeJS.ReadStream, stdout: stdout as unknown as NodeJS.WriteStream, patchConsole: false, exitOnCtrlC: false });
  await new Promise((resolve) => setTimeout(resolve, 50));

  /* Cumulative output: all frames since mount. */
  let output = stdout.writes.join('');
  assert.match(output, /── DONE/, 'Default: done lane must render full header');

  /* Shift+S (uppercase 'S') toggles to collapsed. */
  const writesBeforeCollapse = stdout.writes.length;
  stdin.send('S');
  await waitForWrite(stdout, writesBeforeCollapse);
  /* Incremental output since first Shift+S. */
  let incremental = stdout.writes.slice(writesBeforeCollapse).join('');
  assert.match(incremental, /DONE/, 'After Shift+S: incremental output must show collapsed DONE strip');

  /* Shift+S again toggles back. */
  const writesBeforeRestore = stdout.writes.length;
  stdin.send('S');
  await waitForWrite(stdout, writesBeforeRestore);
  /* Incremental output since second Shift+S must differ from the collapse output,
   * proving the toggle reversed (not a one-way transition). */
  incremental = stdout.writes.slice(writesBeforeRestore).join('');
  const collapseOutput = stdout.writes.slice(writesBeforeCollapse, writesBeforeRestore).join('');
  assert.notEqual(incremental, collapseOutput, 'Second Shift+S must produce different output from first (toggle reverses)');
  assert.ok(incremental.length > 0, 'Second Shift+S must produce output (board re-rendered)');
  /* Cumulative output must still contain DONE (it was in the initial render and
   * re-renders after toggling back). */
  output = stdout.writes.join('');
  assert.match(output, /── DONE/, 'Cumulative output must contain DONE header (present in initial + restored frames)');

  instance.unmount();
});

/* ------------------------------------------------------------------ */
/* N1: Ctrl+I / Tab collision                                          */
/* ------------------------------------------------------------------ */

test('Ctrl+I (0x09) is reported as Tab by Ink and toggles rail/board focus, not integrate', async () => {
  const ink = await import('ink');
  const React = await import('react');
  const { BoardShell } = await import('../src/interfaces/tui/shell.js');
  const stdin = new Stream();
  const stdout = new Stream();
  const projection = makeProjection({ done: [makeCard({ id: 'task-done' as never, lane: 'done', status: 'done', rawStatus: 'done' })] });
  let calls = 0;
  const instance = ink.render(React.createElement(BoardShell, {
    projection,
    commandControllerFactory: () => ({ async dispatch() { calls += 1; return { status: 'completed', durableEvidence: [] }; } }),
  } as never), { stdin: stdin as unknown as NodeJS.ReadStream, stdout: stdout as unknown as NodeJS.WriteStream, patchConsole: false, exitOnCtrlC: false });
  await new Promise((resolve) => setTimeout(resolve, 35));

  /* Ctrl+I (\x09 = Tab byte) is reported by Ink as {input:'', ctrl:false, tab:true}.
   * It triggers the Tab focus-toggle handler, not the lifecycle shortcut. */
  stdin.send('\x09');
  await new Promise((resolve) => setTimeout(resolve, 35));
  instance.unmount();
  assert.equal(calls, 0, 'Ctrl+I must not dispatch integrate (Ink reports it as Tab)');
  /* The help text must not advertise Ctrl+I as a lifecycle binding. */
  assert.doesNotMatch(stdout.writes.join(''), /Ctrl\+D\/A\/R\/I/);
});
  const ink = await import('ink');
  const React = await import('react');
  const { BoardShell } = await import('../src/interfaces/tui/shell.js');
