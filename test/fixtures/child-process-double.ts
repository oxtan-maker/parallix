import { EventEmitter } from 'node:events';

/**
 * A case-owned stand-in for a spawned child process (TASK-2622.04). It emits
 * nothing by itself: the test drives `stdout`/`stderr` data and `close`/`exit`
 * events, and observes `kill()` through `killed` and `killSignals`.
 */
export interface ChildProcessDouble extends EventEmitter {
  readonly stdout: EventEmitter;
  readonly stderr: EventEmitter;
  readonly pid: number;
  killed: boolean;
  readonly killSignals: Array<NodeJS.Signals | number | undefined>;
  kill(_signal?: NodeJS.Signals | number): boolean;
}

export function childProcessDouble(options: { pid?: number } = {}): ChildProcessDouble {
  const killSignals: Array<NodeJS.Signals | number | undefined> = [];
  const child = Object.assign(new EventEmitter(), {
    stdout: new EventEmitter(),
    stderr: new EventEmitter(),
    pid: options.pid ?? 4321,
    killed: false,
    killSignals,
    kill(signal?: NodeJS.Signals | number) {
      killSignals.push(signal);
      child.killed = true;
      return true;
    },
  });
  return child;
}
