import { EventEmitter } from 'node:events';
import assert from 'node:assert/strict';
import { makeProjection } from './fixtures/board-projection.js';

class Stream extends EventEmitter {
  public columns = 120;
  public rows = 30;
  public readonly isTTY = true;
  public readonly writes: string[] = [];

  write(value: string): boolean { this.writes.push(value); this.emit('write'); return true; }
  setRawMode(_enabled: boolean): void {}
  setEncoding(_encoding: string): void {}
  resume(): void {}
  pause(): void {}
  ref(): void {}
  unref(): void {}
  read(): string | null { return null; }
}

async function settle(): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, 35));
}

export async function run(): Promise<void> {
  const ink = await import('ink');
  const React = await import('react');
  const { BoardShell } = await import('../src/interfaces/tui/shell.js');
  const callbacks = new Set<(projection: ReturnType<typeof makeProjection>) => void>();
  const capturedCallbacks: Array<(projection: ReturnType<typeof makeProjection>) => void> = [];
  let unsubscribeCalls = 0;
  const stdout = new Stream();

  const subscribeProjection = (onChange: (projection: ReturnType<typeof makeProjection>) => void) => {
    callbacks.add(onChange);
    capturedCallbacks.push(onChange);
    let unsubscribed = false;
    return () => {
      assert.equal(unsubscribed, false, 'each subscription cleanup must run exactly once');
      unsubscribed = true;
      unsubscribeCalls += 1;
      callbacks.delete(onChange);
    };
  };

  const instance = ink.render(
    React.createElement(BoardShell, { projection: makeProjection(), subscribeProjection } as never),
    { stdin: new Stream() as unknown as NodeJS.ReadStream, stdout: stdout as unknown as NodeJS.WriteStream, patchConsole: false, exitOnCtrlC: false },
  );
  await settle();
  assert.equal(callbacks.size, 1, 'the mounted board must own one live projection subscription');

  for (let update = 0; update < 3; update += 1) {
    for (const callback of callbacks) { callback(makeProjection({}, `update-${update}`)); }
    await settle();
  }

  instance.unmount();
  await settle();
  assert.equal(unsubscribeCalls, 1, 'unmount must clean up the subscription exactly once');
  assert.equal(callbacks.size, 0, 'no projection update callback remains reachable after unmount');

  const writesAfterUnmount = stdout.writes.length;
  for (const callback of capturedCallbacks) { callback(makeProjection({}, 'post-unmount')); }
  await settle();
  assert.equal(stdout.writes.length, writesAfterUnmount, 'post-unmount projection callbacks cannot redraw the shell');
}
