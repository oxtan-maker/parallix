import readline from 'node:readline';

export const MAX_GATE_OUTPUT_CHARS = 1_048_576;
const TRUNCATED = '[Earlier gate output truncated]\n';

export function retainGateOutput(current: string, chunk: string): string {
  const truncated = current.startsWith(TRUNCATED);
  const combined = (truncated ? current.slice(TRUNCATED.length) : current) + chunk;
  return truncated || combined.length > MAX_GATE_OUTPUT_CHARS
    ? TRUNCATED + combined.slice(-(MAX_GATE_OUTPUT_CHARS - TRUNCATED.length)) : combined;
}

export type GateTerminal = {
  input: Pick<NodeJS.ReadStream, 'isRaw' | 'isPaused' | 'setRawMode' | 'on' | 'off' | 'pause' | 'resume'>;
  output: Pick<NodeJS.WriteStream, 'write' | 'columns' | 'rows'>;
};

const GRAPHEMES = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
const WIDE = /[\u1100-\u115f\u2329\u232a\u2e80-\u303e\u3041-\u33ff\u3400-\u4dbf\u4e00-\ua4cf\uac00-\ud7a3\uf900-\ufaff\ufe10-\ufe19\ufe30-\ufe6f\uff00-\uff60\uffe0-\uffe6\u{16fe0}-\u{1b2ff}\u{1f200}-\u{1f2ff}\u{20000}-\u{3fffd}]|\p{Emoji_Presentation}/u;
const ZERO_WIDTH = /^[\p{M}\u200b-\u200f\ufe0f]+$/u;
// Gate output may carry escape sequences that must not reach the terminal. Built from code points, not control characters in a literal.
const ESC = String.fromCharCode(0x1b);
const CONTROL = new RegExp(`${ESC}\\[[0-9;?]*[ -/]*[@-~]|[${String.fromCharCode(0)}-${String.fromCharCode(8)}${String.fromCharCode(0x0b)}-${String.fromCharCode(0x1f)}${String.fromCharCode(0x7f)}]`, 'g');

function clusterPartCells(part: string): number {
  if (ZERO_WIDTH.test(part)) { return 0; }
  return WIDE.test(part) || part.includes('\u20e3') || (part.includes('\ufe0f') && /\p{Extended_Pictographic}/u.test(part)) ? 2 : 1;
}

/** Terminals draw each joined emoji of a ZWJ sequence separately, so the parts add up. */
function graphemeCells(grapheme: string): number {
  return grapheme.split('\u200d').reduce((sum, part) => sum + clusterPartCells(part), 0);
}

/** Truncates to at most `cells` terminal columns; wide glyphs count 2 and escape/control bytes are dropped. */
export function clipToCells(text: string, cells: number): string {
  let used = 0;
  let out = '';
  for (const { segment } of GRAPHEMES.segment(text.replace(/[\t\n]/g, ' ').replace(CONTROL, ''))) {
    const width = graphemeCells(segment);
    if (used + width > cells) { break; }
    out += segment;
    used += width;
  }
  return out;
}

type State = 'waiting' | 'running' | 'passed' | 'failed' | 'cancelled';
type Row = { key: string; state: State; started?: number; duration?: number; output: string };

/** One terminal owner for a phase's configured gates; never lets child streams render directly. */
export class GateDashboard {
  private readonly phase: string;
  private readonly cancel: () => void;
  private rows: Row[];
  private selected = 0;
  private details = false;
  private closed = false;
  private scrollOffset = 0;
  private timer: NodeJS.Timeout;
  private start = Date.now();
  private readonly input: GateTerminal['input'];
  private readonly output: GateTerminal['output'];
  private readonly wasRaw: boolean;
  private readonly wasPaused: boolean;
  private readonly onKey = (_text: string, key: { name?: string; ctrl?: boolean }) => {
    if (key.ctrl && key.name === 'c') { this.cancel(); return; }
    if (key.name === 'q' && !this.details) { this.cancel(); return; }
    if (key.name === 'escape' || key.name === 'q') { this.details = false; }
    else if (key.name === 'pageup') { this.scrollOffset += Math.max(1, (this.output.rows || 24) - 5); }
    else if (key.name === 'pagedown') { this.scrollOffset = Math.max(0, this.scrollOffset - Math.max(1, (this.output.rows || 24) - 5)); }
    else if (key.name === 'end') { this.scrollOffset = 0; }
    else if (key.name === 'up') { this.selected = Math.max(0, this.selected - 1); }
    else if (key.name === 'down') { this.selected = Math.min(this.rows.length - 1, this.selected + 1); }
    else if (key.name === 'return') { this.details = true; this.scrollOffset = 0; }
    this.draw();
  };

  constructor(phase: string, keys: string[], cancel: () => void, terminal: GateTerminal = { input: process.stdin, output: process.stdout }) {
    this.input = terminal.input;
    this.output = terminal.output;
    this.phase = phase;
    this.cancel = cancel;
    this.rows = keys.map(key => ({ key, state: 'waiting', output: '' }));
    this.wasRaw = Boolean(this.input.isRaw);
    this.wasPaused = this.input.isPaused();
    this.output.write('\u001b[?1049h\u001b[?25l\u001b[?7l');
    readline.emitKeypressEvents(this.input as NodeJS.ReadStream);
    this.input.setRawMode(true);
    this.input.on('keypress', this.onKey);
    this.timer = setInterval(() => this.draw(), 250);
    this.draw();
  }

  startGate(key: string): void {
    const row = this.rows.find(item => item.key === key)!;
    row.state = 'running';
    row.started = Date.now();
    this.draw();
  }

  append(key: string, chunk: string): void {
    const row = this.rows.find(item => item.key === key)!;
    row.output = retainGateOutput(row.output, chunk);
    if (this.details && this.rows[this.selected]?.key === key) { this.draw(); }
  }

  finishGate(key: string, exitCode: number | null, output: string, duration: number, cancelled = false): void {
    const row = this.rows.find(item => item.key === key)!;
    row.state = cancelled ? 'cancelled' : exitCode === 0 ? 'passed' : 'failed';
    row.duration = duration;
    row.output = retainGateOutput('', output);
    this.draw();
  }

  close(): void {
    if (this.closed) { return; }
    this.closed = true;
    clearInterval(this.timer);
    this.input.off('keypress', this.onKey);
    this.input.setRawMode(this.wasRaw);
    if (this.wasPaused) { this.input.pause(); }
    else { this.input.resume(); }
    this.output.write('\u001b[?7h\u001b[?25h\u001b[?1049l');
  }

  private draw(): void {
    // Clip to the real screen; a frame taller or wider than the terminal wraps or scrolls into history.
    // One column is held back (when there is more than one) because erasing at a pending-wrap cell would drop the last glyph.
    const width = Math.max(1, (this.output.columns || 80) - 1);
    const height = Math.max(1, this.output.rows || 24);
    const detailRows = Math.max(1, height - 3);
    const row = this.rows[this.selected];
    const detailLines = row?.output.replace(/\r/g, '').split('\n') ?? [];
    this.scrollOffset = Math.min(this.scrollOffset, Math.max(0, detailLines.length - detailRows));
    const lines = this.details && row
      ? [`${row.key} — ${row.state.toUpperCase()}    Esc back   PgUp/PgDn scroll   End follow`, '',
        ...detailLines.slice(0, Math.max(0, detailLines.length - this.scrollOffset)).slice(-detailRows)]
      : [
        `${this.phase} validation`, '',
        ...this.rows.map((item, index) => {
          const mark = item.state === 'passed' ? '✓' : item.state === 'failed' ? '✗' : item.state === 'cancelled' ? '×' : item.state === 'running' ? '◉' : '·';
          const elapsed = item.started ? ((item.duration ?? Date.now() - item.started) / 1000).toFixed(1) + 's' : '';
          return `${index === this.selected ? '>' : ' '} ${mark} ${item.key.padEnd(26)} ${item.state.padEnd(8)} ${elapsed}`;
        }),
        '',
        `Running ${this.rows.filter(item => item.state === 'running').length}/${this.rows.length}   Passed ${this.rows.filter(item => item.state === 'passed').length}   Failed ${this.rows.filter(item => item.state === 'failed').length}   ${((Date.now() - this.start) / 1000).toFixed(1)}s`,
        '', '↑↓ select   Enter details   q cancel',
      ];
    // Overwrite in place: address each row, erase its tail, then erase below. A full-screen clear
    // (ESC[2J) pushes every frame into scrollback when the terminal has no alternate screen.
    // Autowrap is off while open (ESC[?7l), so a line the width estimate got wrong is cut by the terminal
    // instead of wrapping or scrolling; rows are addressed absolutely, with no line feeds.
    this.output.write(lines.slice(0, height).map((line, index) => `\u001b[${index + 1};1H${clipToCells(line, width)}\u001b[K`).join('') + '\u001b[J');
  }
}
