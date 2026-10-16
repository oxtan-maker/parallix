import fs from 'node:fs';
import path from 'node:path';
import { StringDecoder } from 'node:string_decoder';
import { incidentDirName } from '../../application/recovery-evidence.js';
import { attributeRunRecord, legacyMissionTokens } from '../../application/mission-terminal-compat.js';
import { missionId } from '../../domain/mission.js';
import { resolveCanonicalRepositoryId } from '../git/repository-identity.js';
import { missionRepositoryKey } from './mission-repository-key.js';
import { resolveCanonicalRepositoryRoot } from '../config/product-config.js';
import {
  isRunHistoryId,
  runCaptureKind,
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
import type { MissionHistoryStorePort } from '../../application/ports/mission-terminal.js';

/**
 * Durable agent-run capture (TASK-2643): the writer half of the run-history
 * store. Every output chunk is appended to segment files as it arrives, so the
 * history survives scrollback limits, process exit and a harness crash. A run
 * is never held only in memory: a crash leaves the bytes written so far and a
 * `running` record the reader reports as interrupted.
 *
 * Layout: `<repository>/.workflow/run-history/<mission>/<runId>/` with
 * `run.json`, `stdout/<offset>.log` and `stderr/<offset>.log` segments, and
 * `provider/` for retained provider-native transcripts. `<repository>` is the
 * canonical repository root, never a Mission worktree (TASK-2749): history is
 * discovered by repository and Mission and survives worktree removal and host
 * restart. Earlier releases wrote into the Mission worktree; those stores are
 * read in place and moved here before the worktree is removed.
 */

/** Pending text kept back for line-wise redaction before it is forced out. */
const MAX_PENDING_REDACTION_CHARS = 64 * 1024;

export interface OpenRunCaptureInput {
  /** Any checkout of the repository; history goes to its canonical root. */
  readonly worktree: string;
  readonly identity: Pick<RunRecord, 'missionId' | 'repositoryId' | 'role' | 'family' | 'attempt'>;
  readonly captureKind?: 'agent' | 'coordinator';
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
  setTerminalHost?(_host: RunTerminalHost, _socket: string | null): void;
  readonly dir: string;
  readonly runId: string;
  correlateOperation(_operationId: string): void;
  observeExecution(_pid: number, _processIdentity: string | null): void;
  write(_stream: RunStreamName, _chunk: Buffer): void;
  addTmuxSession(_name: string): void;
  /** Copy a provider-native transcript into the run, capped; returns its store-relative path. */
  retainProviderFile(_source: string, _name: string): { path: string; complete: boolean } | null;
  finish(_input: FinishRunInput): RunRecord;
}

/** The run-history root inside one checkout (`<checkout>/.workflow/run-history`). */
export function runHistoryRoot(checkout: string): string {
  let base = path.resolve(checkout);
  try { base = fs.realpathSync(base); } catch { /* not created yet: keep the resolved path */ }
  return path.join(base, '.workflow', RUN_HISTORY_DIR);
}

/** The canonical repository root that owns the history of any of its checkouts. */
export function historyRepositoryRoot(checkout: string): string {
  return resolveCanonicalRepositoryRoot(checkout);
}

/** One Mission's run directory under a repository root; the canonical ID is kept, dots included. */
export function missionRunsDir(repositoryRoot: string, missionId: string): string {
  return path.join(runHistoryRoot(repositoryRoot), incidentDirName(missionId, repositoryRoot));
}

/** Every directory that may hold this Mission's runs: the canonical store first, then legacy names and the worktree store. */
export function missionHistoryLocations(repositoryRoot: string, missionId: string, worktree: string | null): Array<{ runsDir: string; legacy: boolean }> {
  const roots = [repositoryRoot, ...(worktree ? [worktree] : [])];
  const names = [missionId, ...legacyMissionTokens(missionId)];
  const seen = new Set<string>();
  const locations: Array<{ runsDir: string; legacy: boolean }> = [];
  roots.forEach((root, rootIndex) => names.forEach((name, nameIndex) => {
    const runsDir = path.join(runHistoryRoot(root), incidentDirName(name, root));
    if (seen.has(runsDir)) { return; }
    seen.add(runsDir);
    locations.push({ runsDir, legacy: rootIndex > 0 || nameIndex > 0 });
  }));
  return locations;
}

/**
 * Move a Mission's worktree-local runs into the repository store before the
 * worktree is removed (TASK-2749). Only runs the compatibility resolver
 * attributes to this repository and Mission move; a run already present in
 * the repository store is left in place. Returns
 * the run ids moved. Anything not moved is removed with the worktree, exactly
 * as before; callers report a failure instead of blocking cleanup.
 */
export function preserveWorktreeRunHistory(worktree: string, repositoryRoot: string, owner: { readonly repositoryKey: string; readonly missionId: string }): string[] {
  if (runHistoryRoot(worktree) === runHistoryRoot(repositoryRoot)) { return []; }
  const identity = { repositoryId: resolveCanonicalRepositoryId(repositoryRoot), missionId: missionId(owner.missionId) };
  const target = missionRunsDir(repositoryRoot, identity.missionId);
  const moved: string[] = [];
  for (const { runsDir } of missionHistoryLocations(worktree, identity.missionId, null)) {
    for (const runId of runHistoryFileSystem.listDirs(runsDir)) {
      const raw = runHistoryFileSystem.readText(path.join(runsDir, runId, RUN_RECORD_FILE));
      let record: Partial<RunRecord> | null = null;
      try { record = raw ? JSON.parse(raw) as Partial<RunRecord> : null; } catch { record = null; }
      if (!record || record.runId !== runId || attributeRunRecord(identity, record, { legacy: true }, owner.repositoryKey).kind !== 'attributed') { continue; }
      const destination = path.join(target, runId);
      if (fs.existsSync(destination)) { continue; }
      ensureHistoryRoot(repositoryRoot);
      fs.mkdirSync(target, { recursive: true });
      try { fs.renameSync(path.join(runsDir, runId), destination); }
      catch { fs.cpSync(path.join(runsDir, runId), destination, { recursive: true }); }
      moved.push(runId);
    }
  }
  return moved;
}

/** Create the history root and keep it out of `git status`. */
function ensureHistoryRoot(repositoryRoot: string): string {
  const root = runHistoryRoot(repositoryRoot);
  fs.mkdirSync(root, { recursive: true });
  // Retained history must never dirty the tree a repair commits.
  fs.writeFileSync(path.join(root, '.gitignore'), '*\n', { encoding: 'utf8' });
  return root;
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

function retainProviderTranscript(dir: string, source: string, name: string, maxBytes: number, redactor: ((_: string) => string) | null): { path: string; complete: boolean } | null {
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
}

function captureOperationId(file: string): string | null {
  try { return (JSON.parse(fs.readFileSync(file, 'utf8')) as RunRecord).operationId ?? null; } catch { return null; }
}

/** Open durable capture for one run; writes the `running` record immediately. */
export function openRunCapture(input: OpenRunCaptureInput): RunCapture {
  if (!isRunHistoryId(input.runId)) { throw new Error('Invalid retained capture id'); }
  const now = input.now ?? (() => new Date());
  const repositoryRoot = historyRepositoryRoot(input.worktree);
  ensureHistoryRoot(repositoryRoot);
  const runsDir = missionRunsDir(repositoryRoot, input.identity.missionId);
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
  let operationId: string | null = null;
  let terminalHost = input.terminalHost;
  let tmuxSocketPath = input.tmuxSocketPath ?? null;
  let execution: RunRecord['execution'] = null;
  // A hosted child's CurrentWork publisher may correlate this supervisor-owned capture.
  const correlation = () => captureOperationId(recordPath) ?? operationId;
  const record = (patch: Partial<RunRecord>): RunRecord => ({
    ...captureIdentity(input),
    operationId: correlation(),
    execution,
    terminalHost,
    tmux: tmuxSocketPath ? { socketPath: tmuxSocketPath, sessions: [...sessions] } : null,
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
    setTerminalHost(host, socket) {
      terminalHost = host; tmuxSocketPath = socket;
      writeAtomic(recordPath, JSON.stringify(record({}), null, 2));
    },
    correlateOperation(id) {
      if (finished || correlation()) { return; }
      operationId = id;
      writeAtomic(recordPath, JSON.stringify(record({ operationId: id }), null, 2));
    },
    observeExecution(pid, processIdentity) {
      if (finished) { return; }
      execution = { pid, processIdentity };
      writeAtomic(recordPath, JSON.stringify(record({}), null, 2));
    },
    write(stream, chunk) {
      if (finished) { return; }
      streams[stream].write(chunk);
    },
    addTmuxSession(name) {
      sessions.push(name);
      writeAtomic(recordPath, JSON.stringify(record({}), null, 2));
    },
    retainProviderFile: (source, name) => retainProviderTranscript(dir, source, name, maxBytes, redactor),
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

function supervisorAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch (err) { return (err as NodeJS.ErrnoException).code === 'EPERM'; }
}

/**
 * The application's history store port over one repository (TASK-2749): the
 * canonical repository store first, then legacy names and, while it exists,
 * the Mission worktree's pre-TASK-2749 store.
 */
export function createRunHistoryStore(options: { readonly repositoryRoot: string; readonly repositoryKey?: string; readonly executionAlive?: MissionHistoryStorePort['executionAlive']; readonly resolveWorktree?: (_missionId: string) => string | null }): MissionHistoryStorePort {
  return {
    fs: runHistoryFileSystem,
    locations: identity => missionHistoryLocations(options.repositoryRoot, identity.missionId, options.resolveWorktree?.(identity.missionId) ?? null),
    isAlive: supervisorAlive,
    executionAlive: options.executionAlive,
    attribute: (identity, record, location) => attributeRunRecord(identity, record, location, options.repositoryKey ?? missionRepositoryKey(options.repositoryRoot)),
  };
}

/** Correlate a supervisor-owned capture without creating a second work authority. */
export function correlateRunOperation(checkout: string, mission: string, runId: string, operationId: string): void {
  if (!isRunHistoryId(runId)) { return; }
  const file = path.join(missionRunsDir(historyRepositoryRoot(checkout), mission), runId, RUN_RECORD_FILE);
  try {
    const record = JSON.parse(fs.readFileSync(file, 'utf8')) as RunRecord;
    if (record.runId !== runId || record.missionId !== mission || runCaptureKind(record) !== 'coordinator') { return; }
    if (record.operationId === null || record.operationId === undefined) { writeAtomic(file, JSON.stringify({ ...record, operationId }, null, 2)); }
  } catch { /* Correlation cannot block workflow publication. */ }
}

/** Immutable attribution shared by every snapshot of one capture. */
function captureIdentity(input: OpenRunCaptureInput) {
  return {
    version: RUN_HISTORY_VERSION,
    runId: input.runId,
    missionId: input.identity.missionId,
    repositoryId: input.identity.repositoryId,
    captureKind: input.captureKind ?? 'agent',
    role: input.identity.role,
    family: input.identity.family,
    attempt: input.identity.attempt,
    hostFallbackReason: input.hostFallbackReason ?? null,
    supervisorPid: input.supervisorPid ?? process.pid,
  } as const;
}
