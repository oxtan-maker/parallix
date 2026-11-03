import type { ParallixConfiguration } from '../../application/ports/configuration.js';
import fs from 'node:fs';
import path from 'node:path';
import type { Readable } from 'node:stream';
import { ensurePrivateDir, existingTerminalSocketRoots, terminalTranscriptRoot } from './terminal-state-root.js';

/**
 * Bounded private terminal transcripts (TASK-2816).
 *
 * The private, unredacted transcript only feeds the console's display of a
 * finished command; retained, redacted history is the run-history store.
 * Each operation writer writes numbered segments
 * into its Mission's transcript directory and drops its oldest segment as it
 * starts a new one, so continuous output never grows a capture file without
 * bound. Launches and writers apply the per-Mission, aggregate and age limits
 * and reclaim the unbounded `<socket>.log` transcripts of earlier releases.
 */

export interface TerminalTranscriptLimits {
  /** A writer starts a new segment after this many bytes. */
  readonly segmentBytes: number;
  /** Segments one writer keeps, including the one it is filling. */
  readonly segmentsPerWriter: number;
  /** Accounted bytes kept per Mission at each retention check. */
  readonly missionBytes: number;
  /** Accounted bytes kept across all Missions at each retention check. */
  readonly aggregateBytes: number;
  /** Segments untouched for longer than this expire. */
  readonly retentionMs: number;
}

const MiB = 1024 * 1024;

export const TERMINAL_TRANSCRIPT_LIMITS: TerminalTranscriptLimits = Object.freeze({
  segmentBytes: MiB,
  segmentsPerWriter: 4,
  missionBytes: 16 * MiB,
  aggregateBytes: 256 * MiB,
  retentionMs: 7 * 24 * 60 * 60 * 1000,
});

/** Reserve four filesystem blocks for file and root/repository/mission metadata. */
export const TRANSCRIPT_FILE_OVERHEAD_BYTES = 16 * 1024;
export const TRANSCRIPT_RETENTION_INTERVAL_MS = 1000;

const SEGMENT_NAME = /^[A-Za-z0-9_-][A-Za-z0-9_.-]*\.\d{12}$/;
const LEGACY_TRANSCRIPT = /\.sock\.log$/;

/**
 * Re-enter the pinned CLI, including native binaries, for bounded capture.
 * The worker lives only with an operation pipe; idle consoles have no writer.
 */
export function transcriptWriterScript(command = 'px', root = '', legacyRoots: readonly string[] = []): string {
  const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
  return `#!/bin/sh\n${quote(command)} --terminal-transcript-writer ${quote(root)} ${quote(JSON.stringify(legacyRoots))} "$1" "$2" || cat >/dev/null\n`;
}

/** Retention can remove an empty directory between mkdir and open. */
function openTranscriptSegment(dir: string, file: string): number {
  try { return fs.openSync(file, 'wx', 0o600); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') { throw error; }
    ensurePrivateDir(dir);
    return fs.openSync(file, 'wx', 0o600);
  }
}

/** Stream without buffering the transcript in memory; a storage failure drains input. */
export async function captureTerminalTranscript(input: {
  readonly stream: Readable; readonly root: string; readonly dir: string; readonly name: string;
  readonly legacyRoots?: readonly string[]; readonly limits?: TerminalTranscriptLimits;
}): Promise<void> {
  const { stream, root, dir, name } = input;
  const limits = input.limits ?? TERMINAL_TRANSCRIPT_LIMITS;
  if (!/^[A-Za-z0-9_-][A-Za-z0-9_.-]*$/.test(name)
    || path.dirname(path.dirname(path.resolve(dir))) !== path.resolve(root)) {
    throw new Error('Invalid private terminal transcript destination');
  }
  let fd: number | null = null;
  let number = 0;
  let size = 0;
  let allocated = false;
  const file = (n: number) => path.join(dir, `${name}.${String(n).padStart(12, '0')}`);
  const close = () => { if (fd !== null) { fs.closeSync(fd); fd = null; } };
  const enforce = () => {
    try {
      enforceTranscriptRetention({ root, legacyRoots: input.legacyRoots ?? [], nowMs: Date.now(), limits });
      // Retention can evict a live writer. Release its inode immediately;
      // consume the rest of that segment without recreating lost content.
      if (fd !== null && !fs.existsSync(file(number))) { close(); }
    } catch { /* Capture must never break the live terminal. */ }
  };
  const timer = setInterval(enforce, TRANSCRIPT_RETENTION_INTERVAL_MS);
  try {
    for await (const chunk of stream) {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      let offset = 0;
      while (offset < bytes.length) {
        const length = Math.min(bytes.length - offset, limits.segmentBytes - size);
        try {
          if (size === 0) {
            ensurePrivateDir(path.dirname(dir));
            ensurePrivateDir(dir);
            if (number >= limits.segmentsPerWriter) { fs.rmSync(file(number - limits.segmentsPerWriter), { force: true }); }
            fd = openTranscriptSegment(dir, file(number));
            allocated = true;
            // Reserve the entire segment before writing, so growth between
            // checks cannot consume unaccounted space.
            enforce();
          }
          if (fd !== null) {
            let written = 0;
            while (written < length) { written += fs.writeSync(fd, bytes, offset + written, length - written); }
          }
        } catch {
          close();
          if (allocated) { try { fs.rmSync(file(number), { force: true }); } catch { /* best effort */ } }
          allocated = false; // Drop only this segment; retry at the next boundary.
        }
        offset += length;
        size += length;
        if (size === limits.segmentBytes) { close(); number++; size = 0; allocated = false; enforce(); }
      }
    }
  } finally { clearInterval(timer); close(); enforce(); }
}

/**
 * Console replay: `sh replay <dir> <name> <exit code>` prints the last 50
 * retained lines of one operation, saying explicitly when earlier output was
 * rotated out or the whole transcript is no longer retained.
 */
export function transcriptReplayScript(): string {
  return ['#!/bin/sh',
    'dir=$1', 'name=$2', 'status=$3',
    'set -- "$dir/$name".' + '[0-9]'.repeat(12),
    'if [ ! -e "$1" ]; then',
    "  printf '[mission terminal: the transcript of this operation is no longer retained (expired or removed by the retention limit)]\\n'",
    'else',
    "  case \"$1\" in *.000000000000) ;; *) printf '[mission terminal: earlier output of this operation was rotated out of the transcript; showing the retained tail]\\n' ;; esac",
    '  expected=',
    '  for segment do',
    '    current=$((1${segment##*.} - 1000000000000))',
    '    if [ -n "$expected" ] && [ "$current" -ne "$expected" ]; then',
    "      printf '[mission terminal: some output between retained segments was not retained]\\n'",
    '      break',
    '    fi',
    '    expected=$((current + 1))',
    '  done',
    '  cat "$@" 2>/dev/null | tail -n 50',
    'fi',
    "printf '\\n[mission terminal command exit code: %s]\\n' \"$status\"", ''].join('\n');
}

/** Replace a script atomically: a running shell keeps reading the previous inode. */
function writeTranscriptScript(file: string, content: string): void {
  const temporary = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, content, { mode: 0o700 });
  fs.renameSync(temporary, file);
}

interface Segment { readonly file: string; readonly mission: string; readonly accounted: number; readonly mtimeMs: number }

export interface TranscriptRetentionReport {
  readonly removedSegments: number;
  readonly freedBytes: number;
  readonly legacyRemoved: number;
  readonly legacyTruncated: number;
}

function ownedEntries(dir: string): fs.Dirent[] {
  try { return fs.readdirSync(dir, { withFileTypes: true }); } catch { return []; }
}

function segmentsOf(root: string, segmentBytes: number): Segment[] {
  const uid = typeof process.getuid === 'function' ? process.getuid() : null;
  const found: Segment[] = [];
  for (const repository of ownedEntries(root).filter(entry => entry.isDirectory())) {
    for (const mission of ownedEntries(path.join(root, repository.name)).filter(entry => entry.isDirectory())) {
      const dir = path.join(root, repository.name, mission.name);
      for (const entry of ownedEntries(dir)) {
        if (!entry.isFile() || !SEGMENT_NAME.test(entry.name)) { continue; }
        try {
          const stat = fs.lstatSync(path.join(dir, entry.name));
          if (uid !== null && stat.uid !== uid) { continue; }
          found.push({ file: path.join(dir, entry.name), mission: dir, mtimeMs: stat.mtimeMs,
            accounted: Math.max(segmentBytes, stat.size, stat.blocks * 512) + TRANSCRIPT_FILE_OVERHEAD_BYTES });
        } catch { /* removed concurrently */ }
      }
    }
  }
  return found;
}

/** Newest first; within one writer the higher segment number is newer. */
function newestFirst(a: Segment, b: Segment): number {
  return b.mtimeMs - a.mtimeMs || b.file.localeCompare(a.file);
}

/** Keep the newest segments within `budget` accounted bytes; return the rest. */
function overBudget(segments: readonly Segment[], budget: number): Segment[] {
  let kept = 0;
  return [...segments].sort(newestFirst).filter(segment => {
    kept += segment.accounted;
    return kept > budget;
  });
}

function reclaimLegacy(roots: readonly string[], report: { legacyRemoved: number; legacyTruncated: number; freedBytes: number }): void {
  const uid = typeof process.getuid === 'function' ? process.getuid() : null;
  const visit = (dir: string, depth: number) => {
    for (const entry of ownedEntries(dir)) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory() && depth > 0) { visit(full, depth - 1); continue; }
      if (!entry.isFile() || !LEGACY_TRANSCRIPT.test(entry.name)) { continue; }
      try {
        const stat = fs.lstatSync(full);
        if (uid !== null && stat.uid !== uid) { continue; }
        // A live earlier-release server may still append: truncating frees the
        // space without leaving an unlinked file that keeps growing.
        if (fs.existsSync(full.slice(0, -'.log'.length))) { fs.truncateSync(full, 0); report.legacyTruncated++; }
        else { fs.rmSync(full, { force: true }); report.legacyRemoved++; }
        report.freedBytes += stat.size;
      } catch { /* raced or not ours */ }
    }
  };
  for (const root of roots) { visit(root, 1); }
}

/**
 * Apply age, per-Mission and aggregate limits to the transcript root and
 * reclaim earlier releases' unbounded transcripts from the socket roots.
 * Only owner-owned segment files with the writer's naming are considered.
 */
export function enforceTranscriptRetention(input: { readonly root: string; readonly legacyRoots: readonly string[]; readonly nowMs: number; readonly limits?: TerminalTranscriptLimits }): TranscriptRetentionReport {
  const limits = input.limits ?? TERMINAL_TRANSCRIPT_LIMITS;
  const report = { removedSegments: 0, freedBytes: 0, legacyRemoved: 0, legacyTruncated: 0 };
  const all = segmentsOf(input.root, limits.segmentBytes);
  const expired = all.filter(segment => input.nowMs - segment.mtimeMs > limits.retentionMs);
  const remaining = all.filter(segment => !expired.includes(segment));
  const missions = [...new Set(remaining.map(segment => segment.mission))];
  const perMission = missions.flatMap(mission => overBudget(remaining.filter(segment => segment.mission === mission), limits.missionBytes));
  const aggregate = overBudget(remaining.filter(segment => !perMission.includes(segment)), limits.aggregateBytes);
  for (const segment of [...expired, ...perMission, ...aggregate]) {
    try { fs.rmSync(segment.file, { force: true }); report.removedSegments++; report.freedBytes += segment.accounted; } catch { /* raced */ }
  }
  // Also remove empty launch directories whose writer never received bytes.
  // rmdir refuses anything containing data and never follows a symlink.
  for (const repository of ownedEntries(input.root).filter(entry => entry.isDirectory())) {
    const repositoryDir = path.join(input.root, repository.name);
    for (const mission of ownedEntries(repositoryDir).filter(entry => entry.isDirectory())) {
      try { fs.rmdirSync(path.join(repositoryDir, mission.name)); } catch { /* still in use */ }
    }
    try { fs.rmdirSync(repositoryDir); } catch { /* still in use */ }
  }
  reclaimLegacy(input.legacyRoots.filter(root => path.resolve(root) !== path.resolve(input.root)), report);
  return report;
}

/** Where one launch writes and replays its Mission transcript. */
export interface MissionTranscript {
  /** The Mission's private transcript directory. */
  readonly dir: string;
  readonly writer: string;
  readonly replay: string;
}

/**
 * Prepare a launch's transcript: choose the disk-backed root (or fail with an
 * actionable error), enforce retention, and install the writer and replay
 * scripts beside the session's private launch transport.
 */
export function prepareMissionTranscript(input: { readonly configuration: ParallixConfiguration; readonly repositoryKey: string; readonly sessionName: string; readonly sessionDir: string; readonly nowMs: number }): MissionTranscript {
  const root = terminalTranscriptRoot(input.configuration);
  ensurePrivateDir(root);
  enforceTranscriptRetention({ root, legacyRoots: existingTerminalSocketRoots(input.configuration), nowMs: input.nowMs });
  const dir = path.join(root, input.repositoryKey, input.sessionName);
  ensurePrivateDir(path.dirname(dir));
  ensurePrivateDir(dir);
  ensurePrivateDir(input.sessionDir);
  const writer = path.join(input.sessionDir, 'transcript-writer.sh');
  const replay = path.join(input.sessionDir, 'transcript-replay.sh');
  writeTranscriptScript(writer, transcriptWriterScript(input.configuration.agents.cliCommand, root, existingTerminalSocketRoots(input.configuration)));
  writeTranscriptScript(replay, transcriptReplayScript());
  return { dir, writer, replay };
}
