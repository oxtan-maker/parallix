import { Socket } from 'node:net';

/** In-memory terminal streams exercise Ink without a real file descriptor. */
export class TerminalStream extends Socket {
    columns = 120;
    rows = 30;
    isTTY = true;
    isRaw = false;
    readonly writes: string[] = [];
    override _write(chunk: Buffer, _encoding: BufferEncoding, callback: (_error?: Error | null) => void): void { this.writes.push(String(chunk)); callback(); this.emit('write'); }
    setRawMode(enabled: boolean): this { this.isRaw = enabled; return this; }
    cursorTo(): boolean { return true; }
    moveCursor(): boolean { return true; }
    clearLine(): boolean { return true; }
    clearScreenDown(): boolean { return true; }
    getWindowSize(): [number, number] { return [this.columns, this.rows]; }
    getColorDepth(): number { return 1; }
    hasColors(): boolean { return false; }
    send(value: string): void { this.push(value); }
  }

