/**
 * Recovery evidence: attributable, retrievable proof of a failed verification
 * command (ADR 0048, TASK-2642).
 *
 * A failed gate is only useful to the next agent while its output is still in
 * this process's memory. The terminal tail and a later passing-looking summary
 * hide the failure; a process restart drops it entirely. This module persists
 * the exact command, working directory, captured revision, exit/signal,
 * incident/attempt identity, and stdout/stderr attribution to a durable,
 * per-mission store *before* a repair agent launches, and exposes a bounded
 * retrieval interface so both resumed-targeted and fresh-context repairs can
 * read the original failure and later retries after a restart.
 *
 * Design constraints that shape every function below:
 *
 *  - **Durability over completeness.** Evidence is written to disk in the
 *    worktree, so it survives a process restart and is reachable by a
 *    fresh-context agent that never saw the failed command. It is not a
 *    transcript search: only failed verification commands are retained.
 *  - **Isolation by construction.** Evidence lives under the mission worktree
 *    (`.workflow/recovery-evidence/`), which is unique to one mission and one
 *    repository, so original and retry evidence cannot overwrite or be confused
 *    with another concurrent mission or repository. A per-failure incident
 *    fingerprint groups the original with its retries; an attempt number
 *    distinguishes them.
 *  - **Honest reporting.** A record states exactly what it captured and what it
 *    did not. Truncation, interruption, expiry, oversize, and access denial are
 *    each their own error kind with an actionable fallback; a bound on bytes and
 *    an age/retention cap keep storage finite. Credential redaction is applied
 *    by the caller's existing pipeline, never silently suppressed here.
 *  - **No process outcome is overridden.** The exit/signal is the process's,
 *    never a reporter's prose. Structured summaries may annotate but cannot
 *    rewrite a non-zero exit as a pass.
 *
 * Application layer: path resolution, fingerprinting, and the read/write
 * contract are pure; all filesystem work arrives through `node:fs`.
 */

import path from 'node:path';
import { createHash } from 'node:crypto';

// The pure type contract lives in recovery-evidence-types.ts; import it for use
// in this file and re-export so callers keep importing from the module root.
import {
  RECOVERY_EVIDENCE_VERSION,
  MAX_RECOVERY_EVIDENCE_BYTES,
  MAX_RECOVERY_EVIDENCE_INCIDENTS,
  RECOVERY_EVIDENCE_RETENTION_MS,
} from './recovery-evidence-types.js';
import type {
  RecoveryEvidenceErrorKind,
  RecoveryEvidenceRef,
  RecoveryEvidenceLookup,
  CaptureInput,
  RecoveryFileSystem,
  WriteResult,
} from './recovery-evidence-types.js';

export {
  RECOVERY_EVIDENCE_VERSION,
  MAX_RECOVERY_EVIDENCE_BYTES,
  MAX_RECOVERY_EVIDENCE_INCIDENTS,
  RECOVERY_EVIDENCE_RETENTION_MS,
} from './recovery-evidence-types.js';
export type {
  RecoveryEvidenceErrorKind,
  RecoveryEvidenceRef,
  RecoveryEvidenceLookup,
  CaptureInput,
  RecoveryFileSystem,
  WriteResult,
} from './recovery-evidence-types.js';

/**
 * The bound filesystem for the free capture/lookup/list functions below. The
 * application layer cannot import `node:fs`, so composition binds the
 * `filesystem` adapter once at startup; tests bind a fake or the real one.
 * A missing binding is a configuration error, not a silent no-op.
 */
let boundFileSystem: RecoveryFileSystem | null = null;

/** Bind the production filesystem adapter. Called once by composition. */
export function setRecoveryEvidenceFileSystem(fileSystem: RecoveryFileSystem): void {
  boundFileSystem = fileSystem;
}

function requireFileSystem(): RecoveryFileSystem {
  if (!boundFileSystem) {
    throw new Error('recovery-evidence filesystem is not bound; composition must call setRecoveryEvidenceFileSystem first');
  }
  return boundFileSystem;
}

/**
 * The directory name that isolates one mission's evidence from another. A
 * mission slug wins when known; otherwise the worktree basename is used. Both
 * are unique to one mission and one repository, so original and retry evidence
 * cannot overwrite or be confused with another concurrent mission.
 */
export function incidentDirName(missionId: string | undefined, cwd: string): string {
  const chosen = (missionId && missionId.trim()) ? missionId.trim() : path.basename(path.resolve(cwd));
  return chosen.replace(/[^\w.-]/g, '_') || '_';
}

/**
 * The store for one mission, inside its own worktree under the gitignored
 * `.workflow/` tree. Anchored to the worktree (never `process.cwd()`): a
 * fresh-context agent launched in the worktree sees exactly the store the
 * capture step wrote into, and another repository's evidence is elsewhere.
 */
function storeRoot(cwd: string, missionId: string | undefined): string {
  // Canonicalize the base so a capture that resolved the worktree and a lookup
  // that received it by a symlinked path (for example /tmp on macOS) write and
  // read the same store. A path that does not exist yet (a fixture path, a
  // worktree not yet checked out) is not a store: resolve it to a stable
  // location so capture and lookup still agree instead of throwing on `lstat`.
  return path.join(evidenceRoot(cwd), incidentDirName(missionId, cwd));
}

/** The worktree-wide evidence directory that holds every mission's store. */
function evidenceRoot(cwd: string): string {
  return path.join(tryRealpath(cwd), '.workflow', 'recovery-evidence');
}

/**
 * Keep the store out of `git status` even in a repository that does not ignore
 * `.workflow/`: retained evidence must never dirty the tree that the repair is
 * about to commit and the integration gate re-verifies. A `*` pattern ignores
 * the marker itself too, so the whole directory stays invisible to git.
 */
function ensureStoreIgnored(cwd: string, fsMod: RecoveryFileSystem): void {
  const root = evidenceRoot(cwd);
  fsMod.mkdirSync(root, { recursive: true });
  fsMod.writeFileSync(path.join(root, '.gitignore'), '*\n', { encoding: 'utf8' });
}

/** `fs.realpathSync` that returns the resolved path when the store is absent. */
function tryRealpath(cwd: string): string {
  try { return requireFileSystem().realpathSync(path.resolve(cwd)); } catch { return path.resolve(cwd); }
}

/**
 * A stable identity for one failing command occurrence — the failing gate
 * itself (which command, in which working directory). It is deliberately
 * invariant across the retries of a bounded repair loop, so the whole
 * original-plus-retries series lands in one incident instead of splitting.
 *
 * The identity omits the captured revision, the diagnostic text, and the exit
 * status. A bounded repair loop re-runs the same gate after each repair, so a
 * later attempt can legitimately succeed on a different revision, report a
 * different diagnostic, or fail with a different (or signalled) exit while
 * remaining the very same gate failing again. Grouping on any of those would
 * open a fresh incident on every relaunch and strand the recovery series behind
 * only the latest failure (TASK-2642). The attempt number, appended by the
 * caller, orders the series inside the incident; the gate identity keeps the
 * whole series together. Command plus working directory uniquely identifies the
 * gate, so exit is not needed to tell gates apart.
 */
export function failureIncidentFingerprint(input: Pick<CaptureInput, 'command' | 'cwd'>): string {
  const basis = [
    'gate',
    input.command,
    input.cwd,
  ].join('\u0000');
  return createHash('sha256').update(basis).digest('hex').slice(0, 64);
}

function incidentDir(cwd: string, missionId: string | undefined, incidentId: string): string {
  return path.join(storeRoot(cwd, missionId), incidentId);
}

function metadataPath(cwd: string, missionId: string | undefined, incidentId: string, attempt: number): string {
  return path.join(incidentDir(cwd, missionId, incidentId), `attempt-${attempt}.json`);
}

function redact(value: string): string {
  // Pass-through: the configured credential redactor, when one is supplied, is
  // applied to the streams at the capture site (captureRecoveryEvidence) before
  // they reach this write. It stays here so a future caller that writes raw
  // output still has a single, obvious point to wire redaction into.
  return value;
}

/**
 * Resolve the operator-configured credential redactor, if one is wired in.
 *
 * "Respects configured credential redaction" (mission success criterion) means
 * the production capture sites obtain a redactor from configuration and pass it
 * to `captureRecoveryEvidence`, rather than hard-coding no redaction. This is
 * the single, obvious place to read that configuration, so every capture site
 * honours it identically. The documented configuration source is the
 * `PARALLIX_CREDENTIAL_REDACTOR` environment variable; when it is set to a
 * truthy value a conservative, documented scrub of high-sensitivity token
 * patterns is returned, and the retained streams are scrubbed before write.
 * When no redactor is configured the result is `null`, the capture sites store
 * the streams as-is, and `redacted` stays `false` — an honest unredacted
 * claim, never a completeness claim for a scrubbed record.
 */
export function resolveConfiguredCredentialRedactor(configured?: string): ((_: string) => string) | null {
  if (configured && configured !== '0' && configured !== 'false') {
    return scrubCredentials;
  }
  return null;
}

/**
 * Conservative, documented credential scrub applied only when a redactor is
 * explicitly configured. Masks the patterns most likely to carry live secrets
 * so retained stdout/stderr do not ship raw credentials. Deliberately not run
 * by default: it only runs when an operator opts in, so it never scrubs output
 * the operator did not ask to be scrubbed.
 */
export function scrubCredentials(input: string): string {
  return input
    .replace(/(?:sk|rk)-[A-Za-z0-9]{20,}/g, '<redacted-key>')
    .replace(/(AWS_SECRET_ACCESS_KEY|aws_secret_access_key)=[A-Za-z0-9/+]{20,}/g, '$1=<redacted>')
    .replace(/((?:bearer|token))\s*[=:]+\s*[A-Za-z0-9._~-]{20,}/gi, '$1=<redacted>')
    .replace(/AKIA[0-9A-Z]{16}/g, '<redacted-aws-key-id>');
}

/**
 * Write `content` to `target` atomically: write a sibling temp file, then
 * `rename` it over the target. `rename` over an existing file is atomic on
 * POSIX, so a reader sees either the old file or the fully written new one, never
 * a partially written record. Returns the bytes written.
 */
function writeAtomic(fsMod: RecoveryFileSystem, target: string, content: string): number {
  const dir = path.dirname(target);
  fsMod.mkdirSync(dir, { recursive: true });
  const tmp = `${target}.${process.pid}.${Date.now()}.tmp`;
  fsMod.writeFileSync(tmp, content, { encoding: 'utf8' });
  fsMod.renameSync(tmp, target);
  return Buffer.byteLength(content);
}

function writeOutputFile(filePath: string, content: string, cap: number, fsMod: RecoveryFileSystem): { path: string; bytes: number; truncated: boolean } {
  const truncated = content.length > cap;
  const safe = truncated ? content.slice(content.length - cap) : content;
  writeAtomic(fsMod, filePath, redact(safe));
  return { path: filePath, bytes: Buffer.byteLength(safe), truncated };
}

/**
 * Persist one failed invocation to durable, per-mission storage.
 *
 * Called before a repair agent launches. The metadata and raw output are written
 * atomically (temp file + rename) so an interrupted write is never read as a
 * complete record; a record whose metadata exists but whose output is missing
 * is reported `interrupted`, never as a silent pass. Retention runs after the
 * write so the store stays finite.
 */
export function captureRecoveryEvidence(input: CaptureInput, options: { now?: () => Date; fs?: RecoveryFileSystem } = {}): WriteResult {
  const fsMod = options.fs ?? requireFileSystem();
  const now = options.now ?? (() => new Date());
  // A retry names its incident so the series stays together; otherwise open a
  // new incident from the fingerprint of this failure.
  const incidentId = input.incidentId ?? failureIncidentFingerprint(input);
  // Default to the original failure; a retry passes its attempt number through.
  const attempt = (input as { attempt?: number }).attempt ?? 1;
  // Apply the configured credential redactor to the retained streams before they
  // touch disk, and record that it ran. Absence of a redactor is an honest
  // unredacted claim, not a scrubbed one.
  const redactor = input.redactor ?? null;
  const redacted = Boolean(redactor) || (input.redacted ?? false);
  const stdoutValue = redactor ? redactor(input.stdout ?? '') : (input.stdout ?? '');
  const stderrValue = redactor ? redactor(input.stderr ?? '') : (input.stderr ?? '');
  const dir = incidentDir(input.cwd, input.missionId, incidentId);

  let stdoutPath: string;
  let stderrPath: string;
  let stdoutBytes = 0;
  let stderrBytes = 0;
  let captureComplete = true;
  let truncatedFrom: 'stdout' | 'stderr' | null = null;
  try {
    ensureStoreIgnored(input.cwd, fsMod);
    fsMod.mkdirSync(dir, { recursive: true });
    stdoutPath = path.join(dir, `attempt-${attempt}.stdout.txt`);
    stderrPath = path.join(dir, `attempt-${attempt}.stderr.txt`);
    const stdoutWrite = writeOutputFile(stdoutPath, stdoutValue, MAX_RECOVERY_EVIDENCE_BYTES, fsMod);
    stdoutBytes = stdoutWrite.bytes;
    const stderrWrite = writeOutputFile(stderrPath, stderrValue, MAX_RECOVERY_EVIDENCE_BYTES, fsMod);
    stderrBytes = stderrWrite.bytes;
    if (stdoutWrite.truncated || stderrWrite.truncated) {
      captureComplete = false;
      truncatedFrom = stdoutWrite.truncated ? 'stdout' : 'stderr';
    }
  } catch (error) {
    const code = accessCode(error);
    return { ok: false, error: code === 'access-denied' ? 'access-denied' : 'interrupted' };
  }

  const oversized = stdoutBytes >= MAX_RECOVERY_EVIDENCE_BYTES || stderrBytes >= MAX_RECOVERY_EVIDENCE_BYTES;
  const ref: RecoveryEvidenceRef = {
    version: RECOVERY_EVIDENCE_VERSION,
    incidentId,
    attempt,
    command: input.command,
    cwd: input.cwd,
    capturedRevision: input.capturedRevision,
    exitCode: input.exitCode,
    signal: input.signal,
    stdoutPath,
    stderrPath,
    stdoutBytes,
    stderrBytes,
    captureComplete: captureComplete && !oversized,
    truncatedFrom,
    redacted,
    capturedAt: now().toISOString(),
  };

  try {
    writeAtomic(fsMod, metadataPath(input.cwd, input.missionId, incidentId, attempt), JSON.stringify(ref, null, 2));
  } catch {
    return { ok: false, error: 'interrupted' };
  }

  retireOldIncidents(input.cwd, input.missionId, fsMod);
  return { ok: true, ref };
}

/**
 * Persist a retry of an already-recorded failure. Reuses the incident, advances
 * the attempt number, and reports the new record so the caller can attach its
 * reference to the retry's prompt. Returns `missing` when no prior record
 * exists so the caller can capture the original first.
 */
export function captureRecoveryEvidenceRetry(input: CaptureInput & { incidentId: string }, options?: Parameters<typeof captureRecoveryEvidence>[1]): WriteResult {
  const prior = readMetadata(input.cwd, input.missionId, input.incidentId, 1, options?.fs ?? requireFileSystem());
  if (!prior.ok) { return { ok: false, error: 'missing' }; }
  const attempt = prior.ref!.attempt + 1;
  const ref = { ...input, attempt } as CaptureInput & { attempt: number };
  const result = captureRecoveryEvidence(ref, options);
  // The nested capture already wrote attempt+1; normalize the returned ref's
  // attempt so the caller reads the value it asked for.
  if (result.ok && result.ref) { result.ref = { ...result.ref, attempt }; }
  return result;
}

function accessCode(error: unknown): RecoveryEvidenceErrorKind {
  const code = (error as NodeJS.ErrnoException)?.code;
  if (code === 'ENOENT') { return 'missing'; }
  if (code === 'EACCES' || code === 'EPERM' || code === 'EROFS') { return 'access-denied'; }
  return 'interrupted';
}

function listIncidentDirs(cwd: string, missionId: string | undefined, fsMod: RecoveryFileSystem): string[] {
  const root = storeRoot(cwd, missionId);
  let entries: string[];
  try {
    entries = fsMod.readdirSync(root, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => path.join(root, e.name));
  } catch {
    return [];
  }
  return entries.sort((a, b) => a.localeCompare(b));
}

function retireOldIncidents(cwd: string, missionId: string | undefined, fsMod: RecoveryFileSystem): void {
  const now = Date.now();
  const dirs = listIncidentDirs(cwd, missionId, fsMod);
  // Oldest first: directory names are incident fingerprints, so fall back to
  // mtime when the name carries no time. Age-based retirement is best-effort;
  // a failure here never fails the capture that just succeeded.
  const withAge: Array<{ dir: string; ageMs: number }> = dirs.map((dir) => {
    let mtime = now;
    try { mtime = fsMod.statSync(dir).mtimeMs; } catch { /* keep now */ }
    return { dir, ageMs: now - mtime };
  });
  withAge.sort((a, b) => a.ageMs - b.ageMs); // youngest first
  const expired = withAge.filter(({ ageMs }) => ageMs > RECOVERY_EVIDENCE_RETENTION_MS);
  // Keep the newest `MAX` (they lead the youngest-first list); prune the rest,
  // which are the oldest. `slice(MAX)`, not `slice(len - MAX)`: the latter is
  // `slice(0)` (the whole array) whenever the store is under budget and would
  // delete the incident we just wrote.
  const beyondCount = withAge.slice(MAX_RECOVERY_EVIDENCE_INCIDENTS);
  const toRemove = new Set([...expired, ...beyondCount].map((d) => d.dir));
  for (const dir of toRemove) {
    try { fsMod.rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ }
  }
}

/** Read one record's metadata, or report honestly why it is not available. */
function readMetadata(cwd: string, missionId: string | undefined, incidentId: string, attempt: number, fsMod: RecoveryFileSystem): { ok: boolean; error?: RecoveryEvidenceErrorKind; ref?: RecoveryEvidenceRef } {
  const file = metadataPath(cwd, missionId, incidentId, attempt);
  let raw: string;
  try {
    raw = fsMod.readFileSync(file, { encoding: 'utf8' });
  } catch (error) {
    return { ok: false, error: accessCode(error) };
  }
  let parsed: RecoveryEvidenceRef;
  try {
    parsed = JSON.parse(raw) as RecoveryEvidenceRef;
  } catch {
    return { ok: false, error: 'malformed' };
  }
  if (!parsed || parsed.version !== RECOVERY_EVIDENCE_VERSION || typeof parsed.incidentId !== 'string' || typeof parsed.attempt !== 'number') {
    return { ok: false, error: 'malformed' };
  }
  // A record whose metadata exists but whose output streams do not is an
  // interrupted write, never a complete record: report it so a caller never
  // trusts a reference it cannot open.
  if (!streamFilesExist(fsMod, parsed)) {
    return { ok: false, error: 'interrupted' };
  }
  return { ok: true, ref: parsed };
}

/** True only when both retained output streams are present on disk. */
function streamFilesExist(fsMod: RecoveryFileSystem, ref: RecoveryEvidenceRef): boolean {
  for (const file of [ref.stdoutPath, ref.stderrPath]) {
    try { fsMod.statSync(file); } catch { return false; }
  }
  return true;
}

/**
 * Bounded retrieval of retained evidence, usable by both resumed-targeted and
 * fresh-context repairs within their actual launch environment (the worktree).
 * A process restart does not invalidate references: the ref carries absolute
 * paths and an incident fingerprint, both stable across processes.
 */
export function lookupRecoveryEvidence(options: {
  missionId?: string;
  cwd: string;
  incidentId?: string;
  attempt?: number;
  now?: () => Date;
  fs?: RecoveryFileSystem;
}): RecoveryEvidenceLookup {
  const fsMod = options.fs ?? requireFileSystem();
  const now = options.now ?? (() => new Date());
  const attempt = options.attempt ?? 1;

  const recent = listRecentIncidents(options.cwd, options.missionId, fsMod);

  if (options.incidentId) {
    const prior = readMetadata(options.cwd, options.missionId, options.incidentId, attempt, fsMod);
    if (prior.ok && prior.ref) {
      if (Number(now()) - new Date(prior.ref.capturedAt).getTime() > RECOVERY_EVIDENCE_RETENTION_MS) {
        return { ok: false, error: 'expired', recent };
      }
      return { ok: true, evidence: prior.ref, recent };
    }
    if (prior.error && prior.error !== 'missing') {
      return { ok: false, error: prior.error, recent };
    }
    return { ok: false, error: 'missing', recent };
  }

  return { ok: false, error: 'missing', recent };
}

/** Bounded list of the most recent records across all incidents. */
export function listRecoveryEvidence(options: { missionId?: string; cwd: string; fs?: RecoveryFileSystem } = { cwd: process.cwd() }): RecoveryEvidenceRef[] {
  const fsMod = options.fs ?? requireFileSystem();
  const dirs = listIncidentDirs(options.cwd, options.missionId, fsMod);
  const refs: RecoveryEvidenceRef[] = [];
  for (const dir of dirs) {
    const files = safeReaddir(dir).filter((f) => /^attempt-\d+\.json$/.test(f));
    for (const file of files.sort((a, b) => a.localeCompare(b))) {
      const parsed = readOneMetadata(path.join(dir, file), fsMod);
      if (parsed) { refs.push(parsed); }
    }
  }
  // Newest first; bounded to the retention count.
  return refs
    .sort((a, b) => (b.capturedAt < a.capturedAt ? -1 : 1))
    .slice(0, MAX_RECOVERY_EVIDENCE_INCIDENTS);
}

function listRecentIncidents(cwd: string, missionId: string | undefined, fsMod: RecoveryFileSystem): RecoveryEvidenceRef[] {
  return listRecoveryEvidence({ cwd, missionId, fs: fsMod });
}

function safeReaddir(dir: string): string[] {
  try { return requireFileSystem().readdirSync(dir, { withFileTypes: true }).map((entry) => entry.name); } catch { return []; }
}

function readOneMetadata(file: string, fsMod: RecoveryFileSystem): RecoveryEvidenceRef | null {
  try {
    const parsed = JSON.parse(fsMod.readFileSync(file, { encoding: 'utf8' })) as RecoveryEvidenceRef;
    if (!parsed || parsed.version !== RECOVERY_EVIDENCE_VERSION) { return null; }
    return parsed;
  } catch { return null; }
}
