/**
 * Recovery evidence type contract (TASK-2642).
 *
 * The pure, importable shape of the recovery store: the filesystem port it reads
 * through, the retention constants, and the record/lookup/input types. Kept in a
 * dedicated module so the caller-facing contract can be imported without pulling
 * in the file-system wiring, and so the application-layer source file stays
 * under the 500-line production cap.
 */

/**
 * The host-filesystem surface the recovery store needs. The application layer
 * declares this port and never imports `node:fs` itself (ADR 0051): production
 * binds the `filesystem` adapter's `recoveryEvidenceFileSystem`, and tests bind
 * a fake or the real one. Keeping the shape here, not on `typeof fs`, is what
 * keeps the forbidden `node:fs` import out of the application layer.
 */
export interface RecoveryFileSystem {
  // Params are named with a leading underscore so the shape stays self-documenting
  // for adapters while satisfying the unused-args lint rule. The options objects
  // mirror the `node:fs` call shapes the store uses so adapters stay near-zero.
  realpathSync: (_target: string) => string;
  mkdirSync: (_target: string, _options: { recursive: boolean }) => void;
  writeFileSync: (_target: string, _data: string, _options: { encoding: 'utf8' }) => void;
  readFileSync: (_target: string, _options: { encoding: 'utf8' }) => string;
  readdirSync: (_target: string, _options: { withFileTypes: true }) => Array<{ name: string; isDirectory(): boolean }>;
  statSync: (_target: string) => { mtimeMs: number };
  rmSync: (_target: string, _options: { recursive: boolean; force: boolean }) => void;
  renameSync: (_target: string, _replacement: string) => void;
}

/** Schema version for a persisted evidence record. Bump on structural change. */
export const RECOVERY_EVIDENCE_VERSION = 1;

/**
 * Per-record soft cap on retained raw output. Output beyond this is truncated
 * and reported as truncated, never silently dropped. A verifier's diagnostic
 * is far smaller than this; the cap exists so one runaway command cannot fill
 * the store.
 */
export const MAX_RECOVERY_EVIDENCE_BYTES = 5 * 1024 * 1024;

/**
 * How many incident directories the store keeps per mission before the oldest
 * is retired. Retention is by capture time, so a stale incident is the first
 * to go; a fresh failure always has room.
 */
export const MAX_RECOVERY_EVIDENCE_INCIDENTS = 50;

/** Incidents older than this are retired on the next write. */
export const RECOVERY_EVIDENCE_RETENTION_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

/** Error kinds a retrieval reports honestly, each with a fallback. */
export type RecoveryEvidenceErrorKind =
  | 'missing'       // no record for this incident/attempt
  | 'interrupted'   // metadata written but output truncated mid-write
  | 'truncated'     // output exceeded the retention cap
  | 'expired'       // older than the retention window
  | 'oversized'     // a single record exceeded the byte cap
  | 'access-denied' // the store or a file could not be read/written
  | 'malformed';    // a record exists but is not valid evidence

/** One retained failed-command invocation. */
export interface RecoveryEvidenceRef {
  readonly version: typeof RECOVERY_EVIDENCE_VERSION;
  /** Groups the original failure with its retries; distinct per failing command. */
  readonly incidentId: string;
  /** `1` is the original failure; `2`+ are retries of the same failure. */
  readonly attempt: number;
  readonly command: string;
  readonly cwd: string;
  /** The revision the command ran against, when resolvable. */
  readonly capturedRevision: string | null;
  /** The process exit code. `0` is the only passing value; never inferred. */
  readonly exitCode: number | null;
  readonly signal: string | null;
  /** Absolute paths to the retained raw output. Absolute so a fresh agent in
   *  the worktree can open them regardless of its own cwd. */
  readonly stdoutPath: string;
  readonly stderrPath: string;
  readonly stdoutBytes: number;
  readonly stderrBytes: number;
  /**
   * True only when the retained output is the command's complete output for that
   * stream. False when either stream was truncated by the byte cap, so a caller
   * never reads a truncated buffer and believes it is whole.
   */
  readonly captureComplete: boolean;
  readonly truncatedFrom: 'stdout' | 'stderr' | null;
  /** When credential redaction was applied to the retained streams. */
  readonly redacted: boolean;
  readonly capturedAt: string;
}

/** A bounded, honest view of a retrieval, never a claim of completeness. */
export interface RecoveryEvidenceLookup {
  ok: boolean;
  /** Present and non-empty exactly when `ok` is false. */
  error?: RecoveryEvidenceErrorKind;
  /** The requested record when present and complete. */
  evidence?: RecoveryEvidenceRef;
  /**
   * Related incidents when the requested record is missing, truncated, expired,
   * or access-denied — the actionable fallback so the next agent still has
   * something to act on. Bounded to `MAX_RECOVERY_EVIDENCE_INCIDENTS`.
   */
  recent?: readonly RecoveryEvidenceRef[];
}

/** Inputs persisted for one failed invocation. */
export interface CaptureInput {
  /** The exact command line that ran. */
  readonly command: string;
  /** Working directory the command ran in. */
  readonly cwd: string;
  /** The revision the command executed against, when resolvable. */
  readonly capturedRevision: string | null;
  /** Process exit code. `0` passes; anything else fails. */
  readonly exitCode: number | null;
  /** Process signal, when the process was signalled. */
  readonly signal: string | null;
  /** Complete captured stdout, before any presentation truncation. */
  readonly stdout: string;
  /** Complete captured stderr, before any presentation truncation. */
  readonly stderr: string;
  /** The diagnostic the failure produced, for the incident fingerprint. */
  readonly diagnostic?: string;
  /** Mission identity for isolation; falls back to the worktree when absent. */
  readonly missionId?: string;
  /**
   * Optional configured credential redactor. When provided it is applied to the
   * retained stdout/stderr before they are written, so the stored streams never
   * carry raw credentials. Its presence is what "respect configured credential
   * redaction" means for the recovery evidence: the contract is to honour a
   * redactor the operator wires in, not to invent a new scrubbing policy. When
   * no redactor is configured the streams are stored as-is and `redacted` stays
   * false, which is an honest unredacted claim, never a completeness claim for a
   * scrubbed record.
   */
  readonly redactor?: (_: string) => string;
  /** True when the caller already applied configured credential redaction. */
  readonly redacted?: boolean;
  /**
   * When set, this invocation is a retry of an already-recorded failure and is
   * written into that incident rather than opening a new one. The retry knows
   * its incident from the record it appended to, so a changed `capturedRevision`
   * (which would otherwise move the fingerprint) cannot split the series.
   */
  readonly incidentId?: string;
}

export interface WriteResult {
  ok: boolean;
  error?: RecoveryEvidenceErrorKind;
  ref?: RecoveryEvidenceRef;
}
