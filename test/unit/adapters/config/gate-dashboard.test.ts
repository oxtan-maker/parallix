import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { GateDashboard, clipToCells, type GateTerminal } from '../../../../src/adapters/config/gate-dashboard.js';

test.afterEach(() => { mock.timers.reset(); mock.restoreAll(); });

/** Minimal terminal without an alternate screen: tracks visible rows and what scrolls or clears into history. */
class FakeTerminal {
  readonly input = Object.assign(new EventEmitter(), {
    isRaw: false, paused: true, raw: [] as boolean[],
    isPaused() { return this.paused; },
    setRawMode(mode: boolean) { this.raw.push(mode); this.isRaw = mode; return this; },
    pause() { this.paused = true; return this; },
    resume() { this.paused = false; return this; },
  });
  readonly writes: string[] = [];
  readonly scrollback: string[] = [];
  /** One entry per terminal cell; a double-width glyph occupies its cell plus an empty continuation cell. */
  screen: string[][] = [[]];
  row = 0;
  col = 0;
  autowrap = true;
  /** Test seam: widths the dashboard's own estimator does not know, to prove the frame stays bounded anyway. */
  surprise = '';
  readonly output = {
    columns: 80, rows: 12,
    write: (text: string) => { this.writes.push(text); this.apply(text); return true; },
  };
  get terminal(): GateTerminal { return { input: this.input as unknown as GateTerminal['input'], output: this.output }; }
  lineText(cells: string[]): string { return cells.join('').trimEnd(); }
  visible(): string[] { return this.screen.map(cells => this.lineText(cells)).filter(Boolean); }
  private put(char: string): void {
    // Variation selector and enclosing keycap extend the previous cell; the keycap makes it two cells wide.
    if (char === '\ufe0f' || char === '\u20e3' || char === '\u200d') {
      const cells = this.screen[this.row];
      cells[this.col - 1] += char;
      if (char === '\u200d') { return; }
      if (char === '\u20e3' && cells[this.col] === undefined) {
        if (this.col + 1 > this.output.columns) { this.newline(); }
        cells[this.col] = '';
        this.col += 1;
      }
      return;
    }
    const width = /[\u1100-\u115f\u2e80-\ua4cf\uac00-\ud7a3\uff00-\uff60\u{1f300}-\u{1faff}\u2705\u274c\u2329\u232a]/u.test(char) || (this.surprise && this.surprise.includes(char)) ? 2 : 1;
    if (this.col + width > this.output.columns) {
      if (!this.autowrap) { return; }
      this.newline();
    }
    const cells = this.screen[this.row];
    while (cells.length < this.col) { cells.push(' '); }
    cells[this.col] = char;
    if (width === 2) { cells[this.col + 1] = ''; }
    this.col += width;
  }
  private newline(): void {
    this.col = 0;
    this.row += 1;
    if (this.row >= this.output.rows) { this.scrollback.push(this.lineText(this.screen.shift()!)); this.row -= 1; }
    this.screen[this.row] ??= [];
  }
  private apply(text: string): void {
    for (let i = 0; i < text.length;) {
      const csi = /^\u001b\[(\??[0-9;]*)([A-Za-z])/.exec(text.slice(i));
      if (csi) {
        i += csi[0].length;
        const [, arg, code] = csi;
        if (code === 'H') {
          const [row, col] = arg.split(';').map(part => Number(part) || 1);
          this.row = (row ?? 1) - 1; this.col = (col ?? 1) - 1;
          while (this.screen.length <= this.row) { this.screen.push([]); }
        }
        else if (code === 'l' && arg === '?7') { this.autowrap = false; }
        else if (code === 'h' && arg === '?7') { this.autowrap = true; }
        else if (code === 'K') { this.screen[this.row].length = Math.min(this.screen[this.row].length, this.col); }
        else if (code === 'J' && arg === '2') { this.scrollback.push(...this.screen.map(cells => this.lineText(cells)).filter(Boolean)); this.screen = [[]]; }
        else if (code === 'J') { this.screen = this.screen.slice(0, this.row + 1); this.screen[this.row].length = Math.min(this.screen[this.row].length, this.col); }
        continue;
      }
      const char = String.fromCodePoint(text.codePointAt(i)!);
      i += char.length;
      if (char === '\n') { this.newline(); } else { this.put(char); }
    }
  }
}

function openDashboard(keys = ['unit', 'lint', 'build'], cancel = () => {}, prior = { raw: false, paused: true }) {
  mock.timers.enable({ apis: ['setInterval', 'Date'], now: 1_000_000 });
  const fake = new FakeTerminal();
  fake.input.isRaw = prior.raw;
  fake.input.paused = prior.paused;
  const dashboard = new GateDashboard('verify', keys, cancel, fake.terminal);
  return { fake, dashboard };
}

test('timer ticks refresh one row per gate in place without growing output or history (TASK-0071)', () => {
  const { fake, dashboard } = openDashboard();
  dashboard.startGate('unit');
  const rowsAfterStart = fake.visible().length;
  const elapsed: string[] = [];
  for (let tick = 0; tick < 20; tick += 1) {
    mock.timers.tick(250);
    assert.equal(fake.visible().length, rowsAfterStart, `visible rows stable at tick ${tick}`);
    assert.equal(fake.visible().filter(line => line.includes(' unit ')).length, 1);
    elapsed.push(fake.visible().find(line => line.includes(' unit '))!.trim().split(/\s+/).pop()!);
  }
  assert.deepEqual(fake.scrollback, []);
  assert.equal(elapsed[0], '0.3s');
  assert.equal(elapsed.at(-1), '5.0s');
  assert.ok(fake.writes.every(frame => !frame.includes('\u001b[2J')), 'no full-screen clear per frame');
  dashboard.close();
});

test('renders every gate state with aggregate counts and clips to terminal size (TASK-0071)', () => {
  const { fake, dashboard } = openDashboard(['a-pass', 'b-fail', 'c-cancel', 'd-run', 'e-wait']);
  for (const key of ['a-pass', 'b-fail', 'c-cancel', 'd-run']) { dashboard.startGate(key); }
  dashboard.finishGate('a-pass', 0, 'ok', 1200);
  dashboard.finishGate('b-fail', 1, 'boom', 800);
  dashboard.finishGate('c-cancel', null, '', 100, true);
  const screen = fake.visible().join('\n');
  assert.match(screen, /✓ a-pass\s+passed\s+1\.2s/);
  assert.match(screen, /✗ b-fail\s+failed\s+0\.8s/);
  assert.match(screen, /× c-cancel\s+cancelled/);
  assert.match(screen, /◉ d-run\s+running/);
  assert.match(screen, /· e-wait\s+waiting/);
  assert.match(screen, /Running 1\/5\s+Passed 1\s+Failed 1/);
  fake.output.columns = 20;
  fake.output.rows = 8;
  mock.timers.tick(250);
  assert.ok(fake.screen.every(cells => cells.length <= 20), 'lines clipped to width');
  assert.ok(fake.visible().length <= 8, 'frame clipped to height');
  assert.deepEqual(fake.scrollback, []);
  dashboard.close();
});

test('clips to terminal sizes below the former 20x8 floor without wrapping or scrolling (TASK-0071)', () => {
  for (const [columns, rows] of [[10, 5], [6, 3], [30, 1]]) {
    const { fake, dashboard } = openDashboard(['unit-gate', 'lint-gate']);
    fake.output.columns = columns;
    fake.output.rows = rows;
    dashboard.startGate('unit-gate');
    dashboard.append('unit-gate', 'one\ntwo\nthree\nfour\nfive');
    for (const details of [false, true]) {
      if (details) { fake.input.emit('keypress', '', { name: 'return' }); }
      for (let tick = 0; tick < 10; tick += 1) {
        mock.timers.tick(250);
        assert.ok(fake.screen.length <= rows, `${columns}x${rows} rows ${fake.screen.length}`);
        assert.ok(fake.screen.every(cells => cells.length <= columns), `${columns}x${rows} width`);
      }
    }
    assert.deepEqual(fake.scrollback, [], `${columns}x${rows}`);
    dashboard.close();
    mock.timers.reset();
  }
});

test('clips wide, combining and escape-bearing text by terminal cells (TASK-0071)', () => {
  assert.equal(clipToCells('漢漢漢漢漢', 5), '漢漢');
  assert.equal(clipToCells('e\u0301e\u0301', 1), 'e\u0301');
  assert.equal(clipToCells('\u001b[31mred\u001b[0m\tx', 5), 'red x');
  assert.equal(clipToCells('✓ ◉ ·', 5), '✓ ◉ ·');
  assert.equal(clipToCells('🚀🚀🚀', 5), '🚀🚀');
  assert.equal(clipToCells('✅❌x', 4), '✅❌');
  assert.equal(clipToCells('🇸🇪🇸🇪', 3), '🇸🇪');
  assert.equal(clipToCells('a\nb', 5), 'a b');
  assert.equal(clipToCells('#\ufe0f\u20e3#\ufe0f\u20e3', 3), '#\ufe0f\u20e3');
  for (const [columns, rows] of [[10, 3], [9, 4], [7, 3]]) {
    const { fake, dashboard } = openDashboard(['漢漢漢漢漢', '日本語のゲート', '🚀🚀', '#\ufe0f\u20e3#\ufe0f\u20e3', 'multi\nline']);
    fake.output.columns = columns;
    fake.output.rows = rows;
    dashboard.startGate('漢漢漢漢漢');
    dashboard.append('漢漢漢漢漢', '漢字漢字漢字漢字\n\u001b[2Jwide 漢字 line');
    for (const details of [false, true]) {
      if (details) { fake.input.emit('keypress', '', { name: 'return' }); }
      for (let tick = 0; tick < 10; tick += 1) {
        mock.timers.tick(250);
        assert.ok(fake.screen.length <= rows && fake.screen.every(cells => cells.length <= columns), `${columns}x${rows}`);
      }
    }
    assert.deepEqual(fake.scrollback, [], `${columns}x${rows}`);
    dashboard.close();
    mock.timers.reset();
  }
});

test('clips East Asian wide brackets and ZWJ emoji sequences by their rendered cells (TASK-0071)', () => {
  assert.equal(clipToCells('〈〈〈', 4), '〈〈');
  assert.equal(clipToCells('👨\u200d👩\u200d👧x', 6), '👨\u200d👩\u200d👧');
  assert.equal(clipToCells('👨\u200d👩\u200d👧x', 5), '', 'a joined sequence is never split');
  const { fake, dashboard } = openDashboard(['〈〈', '👨\u200d👩\u200d👧']);
  fake.output.columns = 7;
  fake.output.rows = 3;
  dashboard.startGate('〈〈');
  dashboard.append('〈〈', '👨\u200d👩\u200d👧 family 👨\u200d👩\u200d👧 line\n〈〈〈〈〈〈');
  for (const details of [false, true]) {
    if (details) { fake.input.emit('keypress', '', { name: 'return' }); }
    for (let tick = 0; tick < 10; tick += 1) { mock.timers.tick(250); }
  }
  assert.deepEqual(fake.scrollback, []);
  assert.ok(fake.screen.length <= 3 && fake.screen.every(cells => cells.length <= 7));
  dashboard.close();
});

test('autowrap is off while open, so a width the estimator gets wrong cannot wrap or scroll (TASK-0071)', () => {
  const { fake, dashboard } = openDashboard(['กกกกก', 'lint']);
  fake.surprise = 'ก';
  fake.output.columns = 7;
  fake.output.rows = 3;
  dashboard.startGate('กกกกก');
  dashboard.append('กกกกก', 'กกกกกกกกกกกกกก\nกกกกกกกกกกกกก');
  assert.equal(fake.autowrap, false);
  for (const details of [false, true]) {
    if (details) { fake.input.emit('keypress', '', { name: 'return' }); }
    for (let tick = 0; tick < 10; tick += 1) { mock.timers.tick(250); }
  }
  assert.deepEqual(fake.scrollback, []);
  assert.ok(fake.screen.length <= 3 && fake.screen.every(cells => cells.length <= 7));
  assert.ok(fake.writes.every(frame => !frame.includes('\n')), 'rows are addressed absolutely, without line feeds');
  dashboard.close();
});

test('selection and details navigation redraw in place and Esc returns (TASK-0071)', () => {
  const { fake, dashboard } = openDashboard(['unit', 'lint']);
  dashboard.startGate('lint');
  dashboard.append('lint', 'line one\nline two');
  fake.input.emit('keypress', '', { name: 'down' });
  assert.ok(fake.visible().some(line => line.startsWith('> ') && line.includes('lint')));
  fake.input.emit('keypress', '', { name: 'return' });
  assert.ok(fake.visible()[0].startsWith('lint — RUNNING'));
  dashboard.append('lint', '\nline three');
  assert.ok(fake.visible().includes('line three'));
  fake.input.emit('keypress', '', { name: 'escape' });
  assert.ok(fake.visible()[0].startsWith('verify validation'));
  assert.deepEqual(fake.scrollback, []);
  dashboard.close();
});

test('q and Ctrl-C cancel without changing the dashboard owner state (TASK-0071)', () => {
  let cancels = 0;
  const { fake, dashboard } = openDashboard(['unit'], () => { cancels += 1; });
  fake.input.emit('keypress', 'q', { name: 'q' });
  fake.input.emit('keypress', '', { name: 'c', ctrl: true });
  assert.equal(cancels, 2);
  dashboard.close();
});

test('close stops refresh, restores terminal and input state, and emits no further frame (TASK-0071)', () => {
  for (const finish of ['passed', 'failed', 'cancelled'] as const) {
    const { fake, dashboard } = openDashboard(['unit'], () => {}, { raw: true, paused: false });
    dashboard.startGate('unit');
    dashboard.finishGate('unit', finish === 'passed' ? 0 : 1, '', 10, finish === 'cancelled');
    const before = fake.writes.length;
    dashboard.close();
    const closing = fake.writes.slice(before);
    assert.equal(closing.length, 1, finish);
    assert.equal(closing[0], '\u001b[?7h\u001b[?25h\u001b[?1049l');
    assert.equal(fake.autowrap, true, 'autowrap restored');
    mock.timers.tick(2_000);
    assert.equal(fake.writes.length, before + 1, 'no frame after close');
    assert.equal(fake.input.raw.at(-1), true, 'prior raw state restored');
    assert.equal(fake.input.paused, false, 'prior resumed state restored');
    assert.equal(fake.input.listenerCount('keypress'), 0);
    mock.timers.reset();
  }
});

test('close is idempotent so the summary can leave the screen before the final cleanup (TASK-0071)', () => {
  const { fake, dashboard } = openDashboard(['unit']);
  dashboard.close();
  const writes = fake.writes.length;
  dashboard.close();
  assert.equal(fake.writes.length, writes);
  assert.equal(fake.input.raw.length, 2);
});

test('close restores a paused, non-raw input', () => {
  const { fake, dashboard } = openDashboard(['unit']);
  dashboard.close();
  assert.equal(fake.input.raw.at(-1), false);
  assert.equal(fake.input.paused, true);
});
