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
  write(value: string): boolean { this.writes.push(value); return true; }
  setRawMode(_enabled: boolean): void {}
  setEncoding(_encoding: string): void {}
  resume(): void {}
  ref(): void {}
  unref(): void {}
  read(): string | null { return this.input.shift() ?? null; }
  send(value: string): void { this.input.push(value); this.emit('readable'); }
}

async function renderFlow(controller: { dispatchWithStatus: (...args: any[]) => Promise<any> }, refreshProjection?: () => Promise<any>) {
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
  await new Promise((resolve) => setTimeout(resolve, 35));
  return { stdin, stdout, instance };
}

test('confirmation cancellation dispatches nothing and renders cancelled outcome', async () => {
  let calls = 0;
  const ui = await renderFlow({ async dispatchWithStatus() { calls += 1; return { status: 'completed', durableEvidence: [] }; } });
  ui.stdin.send('\r');
  await new Promise((resolve) => setTimeout(resolve, 35));
  ui.stdin.send('\u001b');
  await new Promise((resolve) => setTimeout(resolve, 35));
  ui.instance.unmount();
  assert.equal(calls, 0);
  assert.match(ui.stdout.writes.join(''), /CANCELLED: cancelled before dispatch/);
});

test('confirmed action dispatches through supplied controller and conflict refreshes before re-prompting', async () => {
  let calls = 0;
  let refreshes = 0;
  const ui = await renderFlow({ async dispatchWithStatus() {
    calls += 1;
    return { status: 'failed', error: { kind: 'conflict', message: 'stale mission' }, durableEvidence: [] };
  } }, async () => {
    refreshes += 1;
    return makeProjection({ refined: [makeCard({ id: 'task-flow' as never, lane: 'refined', status: 'refined', commands: [{ command: 'active', enabled: true, reason: null }] })] });
  });
  ui.stdin.send('\r');
  await new Promise((resolve) => setTimeout(resolve, 35));
  ui.stdin.send('\r');
  await new Promise((resolve) => setTimeout(resolve, 60));
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
      return { async dispatchWithStatus() { return { status: 'completed', durableEvidence: [] }; } };
    },
  } as never), { stdin: stdin as unknown as NodeJS.ReadStream, stdout: stdout as unknown as NodeJS.WriteStream, patchConsole: false, exitOnCtrlC: false });
  await new Promise((resolve) => setTimeout(resolve, 35));
  progress!({ operationId: 'op-progress', sequence: 2, phase: 'record', message: 'durable evidence recorded', timestamp: '2026-07-26T12:00:00.000Z' });
  await new Promise((resolve) => setTimeout(resolve, 35));
  instance.unmount();
  const output = stdout.writes.join('');
  assert.match(output, /record durable evidence recorded/);
  assert.match(output, /REFINED 1/);
  assert.doesNotMatch(output, /ACTIVE 1/);
});
