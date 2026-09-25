import readline from 'node:readline';

export const MAX_GATE_OUTPUT_CHARS = 1_048_576;
const TRUNCATED = '[Earlier gate output truncated]\n';

export function retainGateOutput(current: string, chunk: string): string {
  const truncated = current.startsWith(TRUNCATED);
  const combined = (truncated ? current.slice(TRUNCATED.length) : current) + chunk;
  return truncated || combined.length > MAX_GATE_OUTPUT_CHARS
    ? TRUNCATED + combined.slice(-(MAX_GATE_OUTPUT_CHARS - TRUNCATED.length)) : combined;
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
  private scrollOffset = 0;
  private timer: NodeJS.Timeout;
  private start = Date.now();
  private readonly input = process.stdin;
  private readonly output = process.stdout;
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

  constructor(phase: string, keys: string[], cancel: () => void) {
    this.phase = phase;
    this.cancel = cancel;
    this.rows = keys.map(key => ({ key, state: 'waiting', output: '' }));
    this.wasRaw = Boolean(this.input.isRaw);
    this.wasPaused = this.input.isPaused();
    this.output.write('\u001b[?1049h\u001b[?25l');
    readline.emitKeypressEvents(this.input);
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
    clearInterval(this.timer);
    this.input.off('keypress', this.onKey);
    this.input.setRawMode(this.wasRaw);
    if (this.wasPaused) { this.input.pause(); }
    else { this.input.resume(); }
    this.output.write('\u001b[?25h\u001b[?1049l');
  }

  private draw(): void {
    const width = Math.max(20, this.output.columns || 80);
    const height = Math.max(8, this.output.rows || 24);
    const row = this.rows[this.selected];
    const detailLines = row?.output.replace(/\r/g, '').split('\n') ?? [];
    this.scrollOffset = Math.min(this.scrollOffset, Math.max(0, detailLines.length - (height - 3)));
    const lines = this.details && row
      ? [`${row.key} — ${row.state.toUpperCase()}    Esc back   PgUp/PgDn scroll   End follow`, '',
        ...detailLines.slice(0, Math.max(0, detailLines.length - this.scrollOffset)).slice(-(height - 3))]
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
    this.output.write('\u001b[H\u001b[2J' + lines.slice(0, height).map(line => line.slice(0, width)).join('\n'));
  }
}
