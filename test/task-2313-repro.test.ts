/**
 * TASK-2313 reproduction — `px ui` renders two overlapping board frames.
 *
 * Observed corruption: after the board has been running for a while (and the
 * terminal has been resized at least once) the screen shows a wide frame with
 * a second, narrower frame drawn below it. The wide frame never goes away.
 *
 * The board must own one terminal-dimension subscription: Ink contributes one
 * resize listener and BoardShell contributes one; BoardLayout must consume the
 * dimensions passed by BoardShell rather than subscribing a second time.
 */
import { EventEmitter } from 'node:events';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { makeCards, makeFullCard, makeProjection } from './fixtures/board-projection.js';

const LANE_HEADERS = ['BACKLOG', 'REFINED', 'ACTIVE', 'REVIEW', 'INTEGRATION', 'DONE'];

const ESC = String.fromCharCode(27);
const ANSI = new RegExp(`${ESC}\\[[0-9;?]*[ -/]*[@-~]`, 'g');

function plain(text: string): string {
  return text.replace(ANSI, '');
}

/** Minimal stand-in for a TTY write stream, with a settable size. */
class FakeStdout extends EventEmitter {
  public columns: number;
  public rows: number;
  public readonly isTTY = true;
  public readonly writes: string[] = [];

  constructor(columns: number, rows: number) {
    super();
    this.columns = columns;
    this.rows = rows;
  }

  write(data: string): boolean {
    this.writes.push(data);
    return true;
  }

  resizeTo(columns: number, rows: number): void {
    this.columns = columns;
    this.rows = rows;
    this.emit('resize');
  }
}

/** Minimal raw-mode-capable stand-in so `useInput` does not abort the render. */
class FakeStdin extends EventEmitter {
  public readonly isTTY = true;
  setRawMode(_enabled: boolean): void {}
  setEncoding(_encoding: string): void {}
  resume(): void {}
  pause(): void {}
  ref(): void {}
  unref(): void {}
  read(): string | null { return null; }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => { setTimeout(resolve, ms); });
}

/** Writes that carry board content, as opposed to cursor/synchronisation codes. */
function contentFrames(writes: readonly string[]): string[] {
  return writes.filter((write) => plain(write).trim().length > 0);
}

function headerOccurrences(frame: string, header: string): number {
  return frame.split('\n').filter((line) => line.includes(header)).length;
}

const projection = makeProjection({
  backlog: makeCards(3, 'backlog'),
  active: makeCards(2, 'active'),
  review: [makeFullCard()],
});

interface MountedBoard {
  readonly stdout: FakeStdout;
  readonly unmount: () => void;
}

async function mountBoard(columns: number, rows: number): Promise<MountedBoard> {
  const ink = await import('ink');
  const React = await import('react');
  const { BoardShell } = await import('../src/interfaces/tui/shell.js');

  const stdout = new FakeStdout(columns, rows);
  const instance = ink.render(
    React.createElement(BoardShell, { projection } as never),
    {
      stdin: new FakeStdin() as unknown as NodeJS.ReadStream,
      stdout: stdout as unknown as NodeJS.WriteStream,
      patchConsole: false,
      exitOnCtrlC: false,
    },
  );
  await delay(150);
  return { stdout, unmount: () => { instance.unmount(); } };
}

describe('task-2313 — px ui must not leave a stale board frame on screen', () => {
  it('writes exactly one board frame for the first render', async () => {
    const board = await mountBoard(160, 40);
    const frames = contentFrames(board.stdout.writes);
    board.unmount();
    await delay(20);

    assert.equal(
      frames.length,
      1,
      `Mounting the board on a stable terminal must write one frame, not a frame `
      + `plus an immediate redundant re-render. Got ${frames.length}.`,
    );
    for (const header of LANE_HEADERS) {
      assert.equal(
        headerOccurrences(plain(frames[0] ?? ''), header),
        1,
        `Lane header ${header} must appear once in the first frame. Got: ${plain(frames[0] ?? '')}`,
      );
    }
  });

  it('subscribes to terminal resize exactly once across the component tree', async () => {
    const board = await mountBoard(160, 40);
    const listeners = board.stdout.listenerCount('resize');
    board.unmount();
    await delay(20);

    // Ink's own renderer holds one subscription; the board contributes one more.
    // A second board subscription means two components track dimensions apart.
    assert.equal(
      listeners,
      2,
      `Expected Ink's subscription plus exactly one board subscription. Got ${listeners}: `
      + `BoardShell and BoardLayout are each calling useTerminalDimensions().`,
    );
    assert.equal(
      board.stdout.listenerCount('resize'),
      0,
      'Unmounting must remove every resize subscription the board added.',
    );
  });

  it('shows every lane header exactly once in the final frame after a resize', async () => {
    const board = await mountBoard(160, 40);
    board.stdout.resizeTo(90, 40);
    await delay(250);
    const frames = contentFrames(board.stdout.writes);
    const finalFrame = plain(frames[frames.length - 1] ?? '');
    board.unmount();
    await delay(20);

    for (const header of LANE_HEADERS) {
      assert.equal(
        headerOccurrences(finalFrame, header),
        1,
        `After a resize, ${header} must appear exactly once in the final frame. Got: ${finalFrame}`,
      );
    }
  });

  it('renders a single headless frame with no duplicated lane headers', async () => {
    const ink = await import('ink');
    const React = await import('react');
    const { BoardShell } = await import('../src/interfaces/tui/shell.js');

    /* 160 columns leaves every lane wide enough to print its full header;
     * narrower widths truncate INTEGRATION, which is separate behaviour
     * already covered by test/tui-responsive-layout.test.ts. */
    const output = plain(ink.renderToString(
      React.createElement(BoardShell, { projection, columns: 160 } as never),
      { columns: 160 },
    ));

    for (const header of LANE_HEADERS) {
      assert.equal(
        headerOccurrences(output, header),
        1,
        `Headless render must show ${header} exactly once. Got: ${output}`,
      );
    }
  });
});
