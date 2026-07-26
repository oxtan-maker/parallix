/**
 * SC3/SC4/SC7 — responsive board layout and terminal-resize behaviour.
 *
 * Layout selection is asserted from rendered text geometry (are the six lane
 * headers on one line, or on successive lines?) rather than from a mode label,
 * so the assertions fail if the arrangement regresses.
 *
 * The resize test drives a real Ink render against a fake output stream and
 * emits the stream's `resize` event, which is the same signal a terminal sends.
 */
import { EventEmitter } from 'node:events';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { makeCards, makeFullCard, makeProjection } from './fixtures/board-projection.js';

const LANE_HEADERS = ['BACKLOG', 'REFINED', 'ACTIVE', 'REVIEW', 'INTEGRATION', 'DONE'];

/** Strip ANSI escape sequences so assertions see plain text. */
const ESC = String.fromCharCode(27);
const ANSI = new RegExp(`${ESC}\\[[0-9;?]*[ -/]*[@-~]`, 'g');

function plain(text: string): string {
  return text.replace(ANSI, '');
}

async function renderLayout(props: Record<string, unknown>, columns: number): Promise<string> {
  const ink = await import('ink');
  const React = await import('react');
  const { BoardLayout } = await import('../src/interfaces/tui/board-layout.js');
  return plain(ink.renderToString(React.createElement(BoardLayout, props as never), { columns }));
}

/** Lines that carry at least one lane header, in render order. */
function headerLines(output: string): { index: number; line: string; headers: string[] }[] {
  return output.split('\n')
    .map((line, index) => ({
      index,
      line,
      headers: LANE_HEADERS.filter((header) => line.includes(header)),
    }))
    .filter((entry) => entry.headers.length > 0);
}

function headerOccurrences(output: string, header: string): number {
  return output.split('\n').filter((line) => line.includes(header)).length;
}

/** Width of the attention rail in BoardShell. */
const SHELL_RAIL_WIDTH = 34;
/** Gutter columns BoardShell reserves around the board area. */
const SHELL_BOARD_GUTTER = 2;
/** BoardShell uses the raw terminal width for the wide-layout contract (≥ 100). */
const SHELL_WIDE_BREAKPOINT = 100;

/**
 * At narrow widths (e.g. 100 total → 64 board area) lane headers truncate in Ink
 * output. This map provides the shortest reliable prefix for each header so the
 * BoardShell breakpoint test can still detect a side-by-side layout.
 */
const HEADER_PREFIXES: Record<string, string> = {
  BACKLOG: 'BACKLO',
  REFINED: 'REFINE',
  ACTIVE: 'ACTIV',
  REVIEW: 'REVIE',
  INTEGRATION: 'INTEGR',
  DONE: 'DONE',
};

/** Lines that carry at least one lane header (using prefix match for truncated output). */
function shellHeaderLines(output: string): { index: number; line: string; headers: string[] }[] {
  return output.split('\n')
    .map((line, index) => ({
      index,
      line,
      headers: LANE_HEADERS.filter((header) => line.includes(HEADER_PREFIXES[header])),
    }))
    .filter((entry) => entry.headers.length > 0);
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

  /** Change the reported size and emit the event a real terminal emits. */
  resizeTo(columns: number, rows: number): void {
    this.columns = columns;
    this.rows = rows;
    this.emit('resize');
  }

  /** Plain text of the most recent non-empty frame written. */
  lastFrame(): string {
    for (let index = this.writes.length - 1; index >= 0; index -= 1) {
      const text = plain(this.writes[index] ?? '');
      if (text.trim().length > 0) {
        return text;
      }
    }
    return '';
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => { setTimeout(resolve, ms); });
}

const projection = makeProjection({
  backlog: makeCards(3, 'backlog'),
  active: makeCards(2, 'active'),
  review: [makeFullCard()],
});

describe('board layout selects an arrangement from terminal width', () => {
  it('selects wide at and above the breakpoint and narrow below it', async () => {
    const { selectLayoutMode, WIDE_LAYOUT_MIN_COLUMNS } = await import('../src/interfaces/tui/board-layout.js');

    assert.equal(WIDE_LAYOUT_MIN_COLUMNS, 100);
    assert.equal(selectLayoutMode(200), 'wide');
    assert.equal(selectLayoutMode(120), 'wide');
    assert.equal(selectLayoutMode(100), 'wide');
    assert.equal(selectLayoutMode(99), 'narrow');
    assert.equal(selectLayoutMode(60), 'narrow');
    assert.equal(selectLayoutMode(20), 'narrow');
  });

  it('renders all six lane headers side by side at width 120', async () => {
    const output = await renderLayout({ projection, columns: 120, rows: 40 }, 120);
    const lines = headerLines(output);

    assert.equal(lines.length, 1, `All six headers must share one line at width 120. Got: ${output}`);
    assert.deepEqual(
      lines[0]?.headers,
      LANE_HEADERS,
      `The single header line must carry all six lanes in board order. Got: ${output}`,
    );
  });

  it('renders lanes in vertical sequence at width 60', async () => {
    const output = await renderLayout({ projection, columns: 60, rows: 40 }, 60);
    const lines = headerLines(output);

    assert.equal(lines.length, 6, `Each lane must own a line at width 60. Got: ${output}`);
    assert.deepEqual(
      lines.map((entry) => entry.headers[0]),
      LANE_HEADERS,
      `Stacked lanes must appear in board order. Got: ${output}`,
    );
    const indices = lines.map((entry) => entry.index);
    assert.deepEqual(
      indices,
      [...indices].sort((left, right) => left - right),
      `Stacked lane headers must be strictly increasing down the output. Got: ${output}`,
    );
  });

  it('selects the stacked layout at the exact breakpoint width 99', async () => {
    const output = await renderLayout({ projection, columns: 99, rows: 40 }, 99);
    const lines = headerLines(output);

    assert.equal(lines.length, 6, `Width 99 is below the breakpoint and must stack. Got: ${output}`);
  });

  it('keeps the six columns side by side at the breakpoint width 100', async () => {
    const output = await renderLayout({ projection, columns: 100, rows: 40 }, 100);
    const lines = headerLines(output);

    assert.equal(lines.length, 1, `Width 100 is the wide breakpoint and must not stack. Got: ${output}`);
  });

  it('renders every lane header exactly once in each layout', async () => {
    for (const width of [120, 99, 60]) {
      const output = await renderLayout({ projection, columns: width, rows: 40 }, width);
      for (const header of LANE_HEADERS) {
        assert.equal(
          headerOccurrences(output, header),
          1,
          `Lane header ${header} must appear exactly once at width ${width}. Got: ${output}`,
        );
      }
    }
  });

  it('renders card slugs and lane counts in both layouts', async () => {
    for (const width of [120, 60]) {
      const output = await renderLayout({ projection, columns: width, rows: 40 }, width);
      assert.ok(output.includes('BACKLOG 3'), `Width ${width} must show the backlog count. Got: ${output}`);
      assert.ok(output.includes('ACTIVE 2'), `Width ${width} must show the active count. Got: ${output}`);
      assert.ok(output.includes('task-1234'), `Width ${width} must render the review card slug. Got: ${output}`);
      assert.ok(output.includes('nothing in done'), `Width ${width} must render the empty message. Got: ${output}`);
    }
  });

  it('keeps a lane column within its share of a wide terminal', async () => {
    const { laneWidth } = await import('../src/interfaces/tui/board-layout.js');

    assert.ok(laneWidth('wide', 120) * 6 <= 120, 'Six wide columns must fit the terminal width');
    assert.equal(laneWidth('narrow', 60), 58, 'A stacked lane uses the full width less its gutter');
  });
});

describe('board layout re-lays out on terminal resize', () => {
  it('re-renders at the new width with no duplicated lane headers', async () => {
    const ink = await import('ink');
    const React = await import('react');
    const { BoardLayout } = await import('../src/interfaces/tui/board-layout.js');

    const stdout = new FakeStdout(120, 40);
    const instance = ink.render(
      React.createElement(BoardLayout, { projection } as never),
      { stdout: stdout as unknown as NodeJS.WriteStream, patchConsole: false, exitOnCtrlC: false },
    );

    await delay(80);
    const wideFrame = stdout.lastFrame();
    assert.equal(
      headerLines(wideFrame).length,
      1,
      `Live render at 120 columns must be side by side. Got: ${wideFrame}`,
    );

    stdout.resizeTo(60, 40);
    await delay(150);
    const narrowFrame = stdout.lastFrame();
    instance.unmount();
    await delay(20);

    // No duplicated frame: every lane header appears exactly once after resize.
    for (const header of LANE_HEADERS) {
      assert.equal(
        headerOccurrences(narrowFrame, header),
        1,
        `After resize, ${header} must appear exactly once. Got: ${narrowFrame}`,
      );
    }
    assert.equal(
      headerLines(narrowFrame).length,
      6,
      `After resize to 60 columns the lanes must be stacked. Got: ${narrowFrame}`,
    );

    // No truncated frame: the resized output matches a fresh narrow render.
    const baseline = await renderLayout({ projection, columns: 60, rows: 40 }, 60);
    const ratio = narrowFrame.trimEnd().length / baseline.trimEnd().length;
    assert.ok(
      ratio > 0.9 && ratio < 1.1,
      `Resized frame length must be within 10% of the narrow baseline (ratio ${ratio.toFixed(3)}). `
      + `Got ${narrowFrame.trimEnd().length} vs ${baseline.trimEnd().length}`,
    );
  });

  it('reports the live terminal size and updates it on resize', async () => {
    const ink = await import('ink');
    const React = await import('react');
    const { useTerminalDimensions } = await import('../src/interfaces/tui/board-layout.js');

    const seen: { columns: number; rows: number }[] = [];
    function Probe(): React.ReactElement {
      const dimensions = useTerminalDimensions();
      seen.push(dimensions);
      return React.createElement('ink-text', {}, `${dimensions.columns}x${dimensions.rows}`) as React.ReactElement;
    }

    const stdout = new FakeStdout(120, 40);
    const instance = ink.render(
      React.createElement(Probe),
      { stdout: stdout as unknown as NodeJS.WriteStream, patchConsole: false, exitOnCtrlC: false },
    );

    await delay(60);
    assert.deepEqual(seen[0], { columns: 120, rows: 40 }, 'Hook must report the stream size on first render');

    stdout.resizeTo(60, 24);
    await delay(120);
    instance.unmount();
    await delay(20);

    assert.deepEqual(
      seen[seen.length - 1],
      { columns: 60, rows: 24 },
      `Hook must report the new size after a resize event. Saw: ${JSON.stringify(seen)}`,
    );
  });
});

describe('BoardShell responsive layout accounts for the attention rail', () => {
  /** Render BoardShell and strip ANSI codes. */
  async function renderShell(columns: number): Promise<string> {
    const ink = await import('ink');
    const React = await import('react');
    const { BoardShell } = await import('../src/interfaces/tui/shell.js');
    return plain(ink.renderToString(
      React.createElement(BoardShell, { projection, columns } as never),
      { columns },
    ));
  }

  it('renders six lane headers side by side at the wide breakpoint (100)', async () => {
    const output = await renderShell(SHELL_WIDE_BREAKPOINT);
    // At 100 the rail moves above the board, giving full width to six lanes.
    // Full header text must be present (not truncated prefixes).
    const lines = headerLines(output);

    assert.equal(
      lines.length, 1,
      `BoardShell at ${SHELL_WIDE_BREAKPOINT} columns must show six headers on one line. Got: ${output}`,
    );
    assert.deepEqual(
      lines[0]?.headers,
      LANE_HEADERS,
      `The single header line must carry all six lanes in board order. Got: ${output}`,
    );
  });

  it('renders six lane headers side by side at 120 total columns', async () => {
    const output = await renderShell(120);
    const lines = headerLines(output);

    assert.equal(
      lines.length, 1,
      `BoardShell at 120 columns must show six headers on one line (wide layout). Got: ${output}`,
    );
  });

  it('selects stacked at the breakpoint minus one (99 total)', async () => {
    const output = await renderShell(SHELL_WIDE_BREAKPOINT - 1);
    const lines = headerLines(output);

    assert.equal(
      lines.length, 6,
      `BoardShell at ${SHELL_WIDE_BREAKPOINT - 1} columns must stack. Got: ${output}`,
    );
  });

  it('renders stacked lanes at 60 total columns', async () => {
    const output = await renderShell(60);
    const lines = headerLines(output);

    assert.equal(
      lines.length, 6,
      `BoardShell at 60 columns must stack the lanes. Got: ${output}`,
    );
  });

  it('every lane header appears exactly once at the wide breakpoint (no overlap)', async () => {
    const output = await renderShell(SHELL_WIDE_BREAKPOINT);
    for (const header of LANE_HEADERS) {
      assert.equal(
        headerOccurrences(output, header),
        1,
        `${header} must appear exactly once at width ${SHELL_WIDE_BREAKPOINT}. Got: ${output}`,
      );
    }
  });

  it('every lane header appears exactly once at 60 total columns (no duplication in narrow)', async () => {
    const output = await renderShell(60);
    for (const header of LANE_HEADERS) {
      assert.equal(
        headerOccurrences(output, header),
        1,
        `${header} must appear exactly once at width 60. Got: ${output}`,
      );
    }
  });
});
