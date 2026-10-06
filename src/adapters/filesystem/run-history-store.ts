import fs from 'node:fs';
import path from 'node:path';
import { StringDecoder } from 'node:string_decoder';
import type { AgentRunIdentity } from '../../domain/agent-run.js';
import { incidentDirName } from '../../application/recovery-evidence.js';
import {
  MAX_RUN_STREAM_BYTES,
  MAX_RUNS_PER_MISSION,
  RUN_HISTORY_DIR,
  RUN_HISTORY_RETENTION_MS,
  RUN_HISTORY_VERSION,
  RUN_RECORD_FILE,
  RUN_SEGMENT_BYTES,
  runSegmentName,
} from '../../application/run-history-types.js';
import type { RunHistoryFileSystem, RunRecord, RunSource, RunStreamName, RunTerminalHost } from '../../application/run-history-types.js';

/**
 * Durable agent-run capture (TASK-2643): the writer half of the run-history
 * store. Every output chunk is appended to segment files as it arrives, so the
 * history survives scrollback limits, process exit and a harness crash. A run
 * is never held only in memory: a crash leaves the bytes written so far and a
 * `running` record the reader reports as interrupted.
 *
 * Layout: `<worktree>/.workflow/run-history/<mission>/<runId>/` with
 * `run.json`, `stdout/<offset>.log` and `stderr/<offset>.log` segments, and
 * `provider/` for retained provider-native transcripts.
 */

/** Pending text kept back for line-wise redaction before it is forced out. */
const MAX_PENDING_REDACTION_CHARS = 64 * 1024;

export interface OpenRunCaptureInput {
  readonly worktree: string;
  readonly identity: AgentRunIdentity;
  readonly runId: string;
  readonly terminalHost: RunTerminalHost;
  readonly hostFallbackReason?: string | null;
  readonly tmuxSocketPath?: string | null;
  /** Configured credential redactor (TASK-2642 `resolveConfiguredCredentialRedactor`). */
  readonly redactor?: ((_: string) => string) | null;
  readonly supervisorPid?: number;
  readonly now?: () => Date;
  readonly segmentBytes?: number;
  readonly maxStreamBytes?: number;
}

export interface FinishRunInput {
  readonly exitCode: number | null;
  readonly signal: string | null;
  readonly providerSessionId?: string | null;
  readonly sources?: readonly RunSource[];
  readonly omissions?: readonly string[];
}

export interface RunCapture {
  readonly dir: string;
  readonly runId: string;
  write(_stream: RunStreamName, _chunk: Buffer): void;
  addTmuxSession(_name: string): void;
  /** Copy a provider-native transcript into the run, capped; returns its store-relative path. */
  retainProviderFile(_source: string, _name: string): { path: string; complete: boolean } | null;
  finish(_input: FinishRunInput): RunRecord;
}

/** The worktree-wide run-history root, next to the TASK-2642 recovery store. */
export function runHistoryRoot(worktree: string): string {
  let base = path.resolve(worktree);
  try { base = fs.realpathSync(base); } catch { /* not created yet: keep the resolved path */ }
  return path.join(base, '.workflow', RUN_HISTORY_DIR);
}

/** One Mission's run directory, named exactly like its recovery-evidence store. */
export function missionRunsDir(worktree: string, missionId: string): string {
  return path.join(runHistoryRoot(worktree), incidentDirName(missionId, worktree));
}

function writeAtomic(target: string, content: string): void {
  const tmp = `${target}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, content, { encoding: 'utf8' });
  fs.renameSync(tmp, target);
}

/** Retire expired runs and keep at most `MAX_RUNS_PER_MISSION`, oldest first. */
export function retireOldRuns(runsDir: string, nowMs: number, keep: number = MAX_RUNS_PER_MISSION): void {
  let names: string[];
  try { names = fs.readdirSync(runsDir, { withFileTypes: true }).filter(e => e.isDirectory()).map(e => e.name); } catch { return; }
  const aged = names.map(name => {
    let mtimeMs = nowMs;
    try { mtimeMs = fs.statSync(path.join(runsDir, name)).mtimeMs; } catch { /* keep now */ }
    return { name, mtimeMs };
  }).sort((a, b) => b.mtimeMs - a.mtimeMs || b.name.localeCompare(a.name));
  aged.forEach((entry, index) => {
    if (index >= keep || nowMs - entry.mtimeMs > RUN_HISTORY_RETENTION_MS) {
      try { fs.rmSync(path.join(runsDir, entry.name), { recursive: true, force: true }); } catch { /* best effort */ }
    }
  });
}

class StreamWriter {
  bytes = 0;
  retained = 0;
  readonly omitted: Array<{ from: number; to: number }> = [];
  private readonly segments: Array<{ start: number; size: number }> = [];
  private fd: number | null = null;
  private pending = '';
  private readonly decoder = new StringDecoder('utf8');

  private readonly dir: string;
  private readonly segmentBytes: number;
  private readonly maxBytes: number;
  private readonly redactor: ((_: string) => string) | null;
  private readonly onSegment: () => void;

  constructor(dir: string, segmentBytes: number, maxBytes: number, redactor: ((_: string) => string) | null, onSegment: () => void) {
    this.dir = dir;
    this.segmentBytes = segmentBytes;
    this.maxBytes = maxBytes;
    this.redactor = redactor;
    this.onSegment = onSegment;
  }

  write(chunk: Buffer): void {
    if (!this.redactor) { this.append(chunk); return; }
    // Redact whole lines so a credential split across two chunks is still seen.
    this.pending += this.decoder.write(chunk);
    const cut = this.pending.lastIndexOf('\n');
    if (cut >= 0) {
      this.append(Buffer.from(this.redactor(this.pending.slice(0, cut + 1)), 'utf8'));
      this.pending = this.pending.slice(cut + 1);
    }
    if (this.pending.length > MAX_PENDING_REDACTION_CHARS) { this.flushPending(); }
  }

  close(): void {
    if (this.redactor) {
      this.pending += this.decoder.end();
      this.flushPending();
    }
    if (this.fd !== null) { fs.closeSync(this.fd); this.fd = null; }
  }

  private flushPending(): void {
    if (this.pending && this.redactor) { this.append(Buffer.from(this.redactor(this.pending), 'utf8')); }
    this.pending = '';
  }

  private append(data: Buffer): void {
    let cursor = 0;
    while (cursor < data.length) {
      let current = this.segments[this.segments.length - 1];
      if (!current || current.size >= this.segmentBytes || this.fd === null) {
        if (this.fd !== null) { fs.closeSync(this.fd); }
        fs.mkdirSync(this.dir, { recursive: true });
        current = { start: this.bytes, size: 0 };
        this.segments.push(current);
        this.fd = fs.openSync(path.join(this.dir, runSegmentName(current.start)), 'a');
        this.enforceCap();
        this.onSegment();
      }
      const take = Math.min(data.length - cursor, this.segmentBytes - current.size);
      fs.writeSync(this.fd, data, cursor, take);
      cursor += take;
      current.size += take;
      this.bytes += take;
      this.retained += take;
    }
  }

  /** Keep the first segment (how the run began) and the newest ones; drop the middle. */
  private enforceCap(): void {
    while (this.retained + this.segmentBytes > this.maxBytes && this.segments.length > 2) {
      const [dropped] = this.segments.splice(1, 1);
      try { fs.rmSync(path.join(this.dir, runSegmentName(dropped.start)), { force: true }); } catch { /* reported as omitted either way */ }
      this.retained -= dropped.size;
      const last = this.omitted[this.omitted.length - 1];
      if (last && last.to === dropped.start) { last.to = dropped.start + dropped.size; }
      else { this.omitted.push({ from: dropped.start, to: dropped.start + dropped.size }); }
    }
  }
}

/** Open durable capture for one run; writes the `running` record immediately. */
export function openRunCapture(input: OpenRunCaptureInput): RunCapture {
  const now = input.now ?? (() => new Date());
  const root = runHistoryRoot(input.worktree);
  fs.mkdirSync(root, { recursive: true });
  // Retained history must never dirty the tree a repair commits.
  fs.writeFileSync(path.join(root, '.gitignore'), '*\n', { encoding: 'utf8' });
  const runsDir = missionRunsDir(input.worktree, input.identity.missionId);
  retireOldRuns(runsDir, now().getTime(), MAX_RUNS_PER_MISSION - 1);
  const dir = path.join(runsDir, input.runId);
  fs.mkdirSync(dir, { recursive: true });
  const segmentBytes = input.segmentBytes ?? RUN_SEGMENT_BYTES;
  const maxBytes = Math.max(input.maxStreamBytes ?? MAX_RUN_STREAM_BYTES, segmentBytes * 2);
  const redactor = input.redactor ?? null;
  // A new segment refreshes the record, so a live or interrupted run reports
  // current byte counts and omissions without a write per chunk.
  const refresh = () => { if (!finished) { writeAtomic(recordPath, JSON.stringify(record({}), null, 2)); } };
  const streams = {
    stdout: new StreamWriter(path.join(dir, 'stdout'), segmentBytes, maxBytes, redactor, refresh),
    stderr: new StreamWriter(path.join(dir, 'stderr'), segmentBytes, maxBytes, redactor, refresh),
  };
  const recordPath = path.join(dir, RUN_RECORD_FILE);
  let finished: RunRecord | null = null;
  const sessions: string[] = [];
  const startedAt = now().toISOString();
  const record = (patch: Partial<RunRecord>): RunRecord => ({
    version: RUN_HISTORY_VERSION,
    runId: input.runId,
    missionId: input.identity.missionId,
    repositoryKey: input.identity.repositoryKey,
    role: input.identity.role,
    family: input.identity.family,
    attempt: input.identity.attempt,
    terminalHost: input.terminalHost,
    hostFallbackReason: input.hostFallbackReason ?? null,
    tmux: input.tmuxSocketPath ? { socketPath: input.tmuxSocketPath, sessions: [...sessions] } : null,
    supervisorPid: input.supervisorPid ?? process.pid,
    state: 'running',
    startedAt,
    endedAt: null,
    exitCode: null,
    signal: null,
    providerSessionId: null,
    redacted: redactor !== null,
    streams: {
      stdout: { bytes: streams.stdout.bytes, retainedBytes: streams.stdout.retained, omitted: [...streams.stdout.omitted] },
      stderr: { bytes: streams.stderr.bytes, retainedBytes: streams.stderr.retained, omitted: [...streams.stderr.omitted] },
    },
    sources: [],
    omissions: [],
    ...patch,
  });
  writeAtomic(recordPath, JSON.stringify(record({}), null, 2));
  return {
    dir,
    runId: input.runId,
    write(stream, chunk) {
      if (finished) { return; }
      streams[stream].write(chunk);
    },
    addTmuxSession(name) {
      sessions.push(name);
      writeAtomic(recordPath, JSON.stringify(record({}), null, 2));
    },
    retainProviderFile(source, name) {
      try {
        const size = fs.statSync(source).size;
        const target = path.join(dir, 'provider', path.basename(name));
        fs.mkdirSync(path.dirname(target), { recursive: true });
        const fd = fs.openSync(source, 'r');
        try {
          const length = Math.min(size, maxBytes);
          const buffer = Buffer.alloc(length);
          fs.readSync(fd, buffer, 0, length, 0);
          fs.writeFileSync(target, redactor ? redactor(buffer.toString('utf8')) : buffer);
        } finally { fs.closeSync(fd); }
        return { path: path.relative(dir, target), complete: size <= maxBytes };
      } catch { return null; }
    },
    finish(result) {
      if (finished) { return finished; }
      streams.stdout.close();
      streams.stderr.close();
      finished = record({
        state: 'exited',
        endedAt: now().toISOString(),
        exitCode: result.exitCode,
        signal: result.signal,
        providerSessionId: result.providerSessionId ?? null,
        sources: [...(result.sources ?? [])],
        omissions: [...(result.omissions ?? [])],
      });
      writeAtomic(recordPath, JSON.stringify(finished, null, 2));
      return finished;
    },
  };
}

/** The `node:fs` surface the application-side run-history reader needs. */
export const runHistoryFileSystem: RunHistoryFileSystem = {
  readText: (target) => { try { return fs.readFileSync(target, 'utf8'); } catch { return null; } },
  readBytes: (target, offset, length) => {
    try {
      const fd = fs.openSync(target, 'r');
      try {
        const buffer = Buffer.alloc(Math.max(0, length));
        const read = fs.readSync(fd, buffer, 0, buffer.length, offset);
        return buffer.subarray(0, read);
      } finally { fs.closeSync(fd); }
    } catch { return null; }
  },
  size: (target) => { try { return fs.statSync(target).size; } catch { return null; } },
  listDirs: (target) => { try { return fs.readdirSync(target, { withFileTypes: true }).filter(e => e.isDirectory()).map(e => e.name); } catch { return []; } },
  listFiles: (target) => { try { return fs.readdirSync(target, { withFileTypes: true }).filter(e => e.isFile()).map(e => e.name); } catch { return []; } },
};
