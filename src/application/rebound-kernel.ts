import { isIncompleteSuccessCriteriaFailure, buildSuccessCriteriaRecoveryAdvice } from './typed-mission-recovery-advice.js';
/**
 * Rebound kernel (TASK-2377.03).
 *
 * The single code path for "an agent-fixable check failed: bounce the mission
 * back to the implementer". Every failure-mode improvement reuses this kernel
 * instead of re-inventing classification, prompt, launch, and retry logic at
 * each call site.
 *
 * The kernel owns, once:
 *
 * 1. **Classification** — the single ADR 0048 dispatch table
 *    (`src/application/failure-classification.ts`). The human-only rule is a
 *    named rule of that classifier, not a per-site override regex.
 * 2. **Fix prompt** — one slot-based builder; the context-compaction
 *    boilerplate exists in exactly one location.
 * 3. **Launch** — through the injected `startAgent` port. An ambiguous null
 *    exit status is reclassified as launch failure: a null-exit "fix" is no
 *    evidence of a fix.
 * 4. **The verify loop** — launch → `verify()` → pass: `fixed`; fail with
 *    budget left: relaunch with the fresh diagnostic; budget spent:
 *    `exhausted`. A bounce is reported `fixed` **only** when the failing check
 *    re-runs and passes.
 *
 * Budget is per local failure: every `rebound()` invocation starts a fresh
 * in-memory budget (default 2 attempts). Nothing is persisted — no review-state
 * metadata, no SQLite retry columns, no cross-process shared counter — so two
 * processes can never consume one counter (the task-2369.13 split-brain bug).
 *
 * Application layer: imports `cli-format`, `output-elision`, and
 * `failure-classification` only; all I/O arrives through the context callbacks.
 */

import * as fmt from './presentation/cli-format.js';
import { elideBounceOutput } from './output-elision.js';
import {
  classifyError,
  hasExplicitHumanOnlyDiagnostic,
  DispatchAction,
  FailureClass,
  type DispatchActionType,
  type FailureClassType,
} from './failure-classification.js';
import {
  captureRecoveryEvidence,
  failureIncidentFingerprint,
  listRecoveryEvidence,
  resolveConfiguredCredentialRedactor,
  type RecoveryEvidenceRef,
} from './recovery-evidence.js';

/** Default per-occurrence attempt budget. */
export const DEFAULT_REBOUND_ATTEMPTS = 2;

/** Stable recovery strategy identifiers for telemetry and escalation evidence. */
export type RepairStrategy = 'targeted' | 'fresh-diagnostic';

// ── Reason: structured failure values, never a regex match on combined text ──

/** A declared verification gate ran and exited non-zero. */
export interface GateFailureReason {
  kind: 'gate-failure';
  area: string;
  command: string;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  error?: string;
  /** Declared by the verification adapter; the kernel never infers this from prose. */
  transient?: boolean;
  /**
   * Declared for a gate that is an environment/infrastructure failure, not an
   * implementer repair (TASK-2620 AC4). It does not affect the initial
   * classification, so the gate still retries once; after that single retry
   * fails, the kernel returns it to the human instead of launching an
   * implementer. Only agent-smoke sets this today.
   */
  environment?: boolean;
  coverageNote?: string;
  /**
   * The revision the withdrawn approval was given to (TASK-2620 AC3). The
   * implementer fix prompt names it so the repair is understood as a change to
   * previously-approved code, not an independent fix. The classifier never
   * reads it; only the prompt facts print it.
   */
  approvedRevision?: string | null;
}

/** A Git hook rejected a workflow-owned Git operation. */
export interface HookFailureReason {
  kind: 'hook-failure';
  /** Hook identity derived from Git state (`pre-commit`, `pre-push`, …). */
  hook: string | null;
  /** The Git operation the hook rejected, for the fix prompt. */
  operation?: string;
  output: string;
}

/** An agent finished without leaving the artifacts its role must produce. */
export interface ArtifactIncompleteReason {
  kind: 'artifact-incomplete';
  role: string;
  diagnostic: string;
}

/** An agent did not respond within its stage timeout. */
export interface AgentTimeoutReason {
  kind: 'agent-timeout';
  role: string;
  diagnostic?: string;
  /** The concrete artifact or response the role must produce to finish. */
  expectedOutput?: string;
}

/** A handoff verification check rejected the mission. */
export interface HandoffVerificationReason {
  kind: 'handoff-verification';
  error: string;
  gateOutput?: string;
}

/** A declared gate was rejected before process execution. */
export interface DeclaredGateValidationReason {
  kind: 'declared-gate-validation';
  command: string;
  diagnostic: string;
}

/**
 * Every failure kind the kernel can bounce. `gate-failure` and `hook-failure`
 * are wired to the pre-review incident path; the remaining three are part of
 * the contract and are migrated to real consumers by TASK-2377.04/.05.
 */
export type ReboundReason =
  | GateFailureReason
  | HookFailureReason
  | ArtifactIncompleteReason
  | AgentTimeoutReason
  | HandoffVerificationReason
  | DeclaredGateValidationReason;

/** Result of re-running the failing check after a fix attempt. */
export interface VerifyResult {
  ok: boolean;
  /** Fresh diagnostic from the re-run; empty when the check passed. */
  diagnostic?: string;
  /**
   * The check's actual failure, when its adapter has process evidence.  A
   * caller must not turn this into a wrapper string before handing it back to
   * the recovery policy.
   */
  reason?: ReboundReason;
}

/** Minimal launch port: the kernel never imports the agents adapter. */
export type ReboundStartAgent = (
  _step: string,
  _options: Record<string, unknown>,
) => Promise<{ agent?: string | null; result?: { status?: number | null } | null } | null | undefined>;

export interface ReboundContext {
  slug: string;
  worktree: string;
  implementer: string;
  /** Re-runs the failing check and returns pass/fail with a fresh diagnostic. */
  verify: (_attempt: number) => Promise<VerifyResult> | VerifyResult;
  /** Launch port (the agents adapter's `startAgent`, injected). */
  startAgent: ReboundStartAgent;
  /** Per-occurrence attempt budget; defaults to `DEFAULT_REBOUND_ATTEMPTS`. */
  maxAttempts?: number;
  /** Bounded no-agent retries for a declared environmental verifier outcome. */
  maxTransientRetries?: number;
  /** Launch/session retries are deliberately a different currency. */
  maxLaunchRetries?: number;
  /** Revision already known by the stage adapter, for an actionable prompt. */
  head?: string;
  /** Reads the mission revision around each repair; absent callers retain `head`. */
  readHead?: () => Promise<string | null> | string | null;
  /** Best-effort observer for stable recovery-strategy telemetry. */
  onRepairTelemetry?: (_event: { strategy: RepairStrategy; outcome: 'pass' | 'advance' | 'rescue' | 'escalate' }) => void;
  /** Stage adapter chooses the existing launcher step; policy stays here. */
  step?: string;
  role?: string;
  /** Agent identities that fallback selection must not use for this role. */
  exclude?: string[];
  /** Moves the task back to the implementer phase before a launch. */
  transitionToImplementer?: (_slug: string) => Promise<unknown> | unknown;
  /** Resolves the agent actually launched (fallback selection). */
  applyAgentFallback?: (_options: { launchResult: unknown; original: string }) => Promise<string> | string;
  log?: (_msg: string) => void;
  error?: (_msg: string) => void;
}

function recordRepairTelemetry(context: ReboundContext, event: { strategy: RepairStrategy; outcome: 'pass' | 'advance' | 'rescue' | 'escalate' }) {
  // Logs are the recovery event sink shared by every rebound consumer. Keep the
  // identifiers structured and stable so operators can aggregate outcomes
  // without parsing prompt prose.
  context.log?.(fmt.status('INFO', `RECOVERY_TELEMETRY strategy=${event.strategy} outcome=${event.outcome}`));
  context.onRepairTelemetry?.(event);
}

export type ReboundOutcomeKind = 'fixed' | 'exhausted' | 'human-only';

export interface ReboundOutcome {
  outcome: ReboundOutcomeKind;
  /** Completed repair attempts consumed by this occurrence. */
  attempts: number;
  /** Last diagnostic observed: the verify re-run's, or the original failure's. */
  diagnostic: string;
  classification: ReboundClassification;
  /** Agent that ran the final attempt (fallback-resolved). */
  implementer: string;
  /** Short, bounded record for an operator when automatic recovery stops. */
  dossier?: string;
  attemptsDetail?: readonly RepairEvidence[];
}
/** Process-local verification evidence; no durable identity or lifecycle. */
export interface RepairEvidence { strategy: RepairStrategy; agent: string; context: 'resumed' | 'fresh'; headBefore: string | null; headAfter: string | null; fingerprintBefore: string; fingerprintAfter: string; }

export interface ReboundClassification {
  failureClass: FailureClassType;
  dispatchAction: DispatchActionType;
  /** False when the table says no agent relaunch can fix this. */
  isRelaunchable: boolean;
  /** Human-readable failure banner used by the fix prompt and logs. */
  label: string;
}

// ── Classification ───────────────────────────────────────────────────────────

/** Flatten a structured reason into the diagnostic text the classifier reads. */
export function reboundDiagnostic(reason: ReboundReason): string {
  switch (reason.kind) {
    case 'gate-failure':
      return [reason.stdout, reason.stderr, reason.error].filter(Boolean).join('\n');
    case 'hook-failure':
      return reason.output || '';
    case 'artifact-incomplete':
      return reason.diagnostic || '';
    case 'agent-timeout':
      return reason.diagnostic || `${reason.role} did not respond before its stage timeout`;
    case 'handoff-verification':
      return [reason.error, reason.gateOutput].filter(Boolean).join('\n');
    case 'declared-gate-validation':
      return reason.diagnostic;
  }
}

/** Failure banner per reason kind. */
function reasonLabel(reason: ReboundReason): string {
  switch (reason.kind) {
    case 'gate-failure': return 'PRE-REVIEW GATE FAILURE';
    case 'hook-failure': return 'GIT HOOK FAILURE';
    case 'artifact-incomplete': return 'INCOMPLETE ARTIFACTS';
    case 'agent-timeout': return 'AGENT TIMEOUT';
    case 'handoff-verification': return 'HANDOFF VERIFICATION FAILURE';
    case 'declared-gate-validation': return 'DECLARED GATE VALIDATION FAILURE';
  }
}

/**
 * Classify a structured reason through the single ADR 0048 table.
 *
 * Structured facts decide the class; the diagnostic text only decides whether a
 * recognized human-only blocker (ADR 0048 classes 7 and 8) is present:
 *
 * - `gate-failure`: a declared gate that ran and exited non-zero is a
 *   GateFailure (class 6) — never remapped to a Git blocker.
 * - `hook-failure`: a Git hook rejecting a workflow Git operation is a
 *   mechanical Git blocker (class 5, AutoRepair).
 * - `artifact-incomplete`: incomplete evidence (class 4).
 * - `agent-timeout`: no agent output to act on — infrastructure (class 7).
 * - `handoff-verification`: classified from its own error text, which is the
 *   handoff path's existing evidence.
 *
 * An explicit infrastructure or state-machine diagnostic wins over the
 * structured default for the two incident-path kinds, because its remedy is
 * outside the implementer's working tree.
 */
export function classifyReboundReason(reason: ReboundReason): ReboundClassification {
  const diagnostic = reboundDiagnostic(reason);
  const label = reasonLabel(reason);
  const classified = (failureClass: FailureClassType, dispatchAction: DispatchActionType): ReboundClassification => ({
    failureClass,
    dispatchAction,
    isRelaunchable: dispatchAction !== DispatchAction.HumanOnly,
    label,
  });

  if (reason.kind === 'gate-failure' || reason.kind === 'hook-failure') {
    if (hasExplicitHumanOnlyDiagnostic(diagnostic)) {
      const { failureClass, dispatchAction } = classifyError(diagnostic);
      return classified(failureClass, dispatchAction);
    }
    return reason.kind === 'hook-failure'
      ? classified(FailureClass.GitBlockers, DispatchAction.AutoRepair)
      : classified(FailureClass.GateFailure, DispatchAction.AutoSendBack);
  }

  if (reason.kind === 'artifact-incomplete') {
    if (hasExplicitHumanOnlyDiagnostic(diagnostic)) {
      const { failureClass, dispatchAction } = classifyError(diagnostic);
      return classified(failureClass, dispatchAction);
    }
    return classified(FailureClass.IncompleteEvidence, DispatchAction.AutoSendBack);
  }

  if (reason.kind === 'agent-timeout') {
    if (hasExplicitHumanOnlyDiagnostic(diagnostic)) {
      const { failureClass, dispatchAction } = classifyError(diagnostic);
      return classified(failureClass, dispatchAction);
    }
    return classified(FailureClass.IncompleteEvidence, DispatchAction.AutoSendBack);
  }

  if (reason.kind === 'declared-gate-validation') {
    return classified(FailureClass.MalformedGates, DispatchAction.AutoRepair);
  }

  const { failureClass, dispatchAction } = classifyError(diagnostic);
  return classified(failureClass, dispatchAction);
}

/** Known verifier outcomes which are safe to retry once on an unchanged tree. */
export function isTransientVerifierFailure(reason: ReboundReason): boolean {
  return reason.kind === 'gate-failure' && reason.transient === true;
}

function refreshedReason(previous: ReboundReason, result: VerifyResult): ReboundReason {
  if (result.reason) { return result.reason; }
  if (previous.kind === 'gate-failure') {
    return { ...previous, stdout: result.diagnostic || previous.stdout, stderr: '', error: undefined };
  }
  if (previous.kind === 'handoff-verification') {
    return { ...previous, gateOutput: result.diagnostic || previous.gateOutput };
  }
  if (previous.kind === 'declared-gate-validation') {
    return { ...previous, diagnostic: result.diagnostic || previous.diagnostic };
  }
  if (previous.kind === 'artifact-incomplete') {
    return { ...previous, diagnostic: result.diagnostic || previous.diagnostic };
  }
  if (previous.kind === 'agent-timeout') {
    return { ...previous, diagnostic: result.diagnostic || previous.diagnostic };
  }
  return { ...previous, output: result.diagnostic || previous.output };
}

function failureFingerprint(reason: ReboundReason): string {
  switch (reason.kind) {
    case 'gate-failure': return `${reason.kind}:${reason.area}:${reason.command}:${reason.exitCode}:${reboundDiagnostic(reason)}`;
    case 'declared-gate-validation': return `${reason.kind}:${reason.command}:${reboundDiagnostic(reason)}`;
    case 'hook-failure': return `${reason.kind}:${reason.hook}:${reason.operation || ''}:${reason.output}`;
    default: return `${reason.kind}:${reboundDiagnostic(reason)}`;
  }
}

function recoveryManualNextAction(reason: ReboundReason, context: ReboundContext): string {
  switch (reason.kind) {
    case 'gate-failure': return `Repair the reported failure, then rerun ${reason.command} from ${context.worktree}.`;
    case 'hook-failure': return hookRecoveryAction(reason);
    case 'artifact-incomplete': return `Create the missing artifacts named above, then rerun px review ${context.slug} --continue.`;
    case 'agent-timeout': return `Produce the required ${reason.role} output named above, then rerun px review ${context.slug} --continue.`;
    default: return `Repair the retained handoff failure, then rerun px review ${context.slug} --start.`;
  }
}

function hookRecoveryAction(reason: Extract<ReboundReason, { kind: 'hook-failure' }>): string {
  const operation = reason.operation || 'the failed Git operation';
  const abortAdvice = reason.operation?.includes('rebase') ? '; if the rebase cannot be resumed safely, run git rebase --abort' : '';
  return `Repair the reported ${reason.hook} hook failure, then rerun ${operation}${abortAdvice}.`;
}

function recoveryDossier(reason: ReboundReason, context: ReboundContext, history: string[], diagnostic: string, why: string, attempts: readonly RepairEvidence[] = [], capturedEvidence?: RecoveryEvidenceRef | null): string {
  const command = reason.kind === 'gate-failure' ? reason.command : reason.kind === 'hook-failure' ? reason.operation || 'Git hook operation' : 'stage recovery';
  const manualNextAction = recoveryManualNextAction(reason, context);
  const lines = [
    `Recovery dossier for ${context.slug}`,
    `Stage: ${reason.kind}`,
    `HEAD: ${context.head || 'not captured'}`,
    `Last action: ${command}`,
    `Failure history: ${history.join(' -> ') || failureFingerprint(reason)}`,
    ...attempts.map((attempt, index) => `Attempt ${index + 1}: ${attempt.strategy}; agent=${attempt.agent}; context=${attempt.context}; HEAD ${attempt.headBefore || 'not captured'} -> ${attempt.headAfter || 'not captured'}; fingerprint ${attempt.fingerprintBefore} -> ${attempt.fingerprintAfter}`),
    `Last diagnostic: ${elideBounceOutput(diagnostic || '(no output)')}`,
    `Successful checks: none recorded before exhaustion`,
    `Stopped because: ${why}`,
    `Manual next action: ${manualNextAction}`,
  ];
  // Even after budget exhaustion, the failed command evidence is retained and
  // retrievable; report it so the human or a resumed agent still has the
  // attributable output instead of only the exhausted-attempts ledger.
  if (capturedEvidence) {
    lines.push(...recoveryEvidenceRoute({ recoveryEvidence: capturedEvidence, recoveryEvidenceRecent: null, recoveryEvidenceError: null }));
  }
  return lines.join('\n');
}

// ── Fix prompt ───────────────────────────────────────────────────────────────

export interface FixPromptSlots {
  /** Failure banner (`PRE-REVIEW GATE FAILURE`, …). */
  label: string;
  slug: string;
  worktree?: string;
  /** Verification area, hook identity, or agent role — whatever names the failure. */
  area: string;
  /** Structured facts printed above the diagnostic. */
  facts: Array<[string, string]>;
  diagnostic: string;
  /** First diagnostic for this recovery occurrence, retained across retries. */
  originalDiagnostic?: string;
  classification: ReboundClassification;
  attempt: number;
  maxAttempts: number;
  /** What passing looks like, in the implementer's terms. */
  remedy: string;
  /**
   * Retained evidence of the original failed command, when present. Attached so
   * the prompt names what was captured rather than restating a truncated inline
   * diagnostic. The current failure's own record is included when already on
   * disk; prior original/retry records are the actionable fallback.
   */
  recoveryEvidence?: RecoveryEvidenceRef | null;
  /** Related retained incidents when the requested record is unavailable. */
  recoveryEvidenceRecent?: readonly RecoveryEvidenceRef[] | null;
  /** Honest reason the current failure is not itself retrievable yet. */
  recoveryEvidenceError?: string | null;
}

/**
 * The one fix-prompt builder. Every rebound prompt — gate, hook, and the kinds
 * TASK-2377.04/.05 migrate — is built here, so the context-compaction
 * boilerplate and the automatic re-verify statement exist in one location.
 */
export function buildReboundFixPrompt(slots: FixPromptSlots): string {
  const { label, slug, worktree, facts, diagnostic, originalDiagnostic, classification, attempt, maxAttempts, remedy } = slots;
  return [
    `${label} — FIX REQUIRED`,
    ``,
    `Mission: ${slug}`,
    ...(worktree ? [`Working directory: ${worktree}`] : []),
    ...facts.map(([name, value]) => `${name}: ${value}`),
    ``,
    `Failure output (use this to diagnose and fix):`,
    `---`,
    elideBounceOutput(diagnostic || '(no output)'),
    `---`,
    ...(originalDiagnostic && originalDiagnostic !== diagnostic ? [
      `Original failure output (retain this evidence while repairing the later failure):`,
      `---`,
      elideBounceOutput(originalDiagnostic),
      `---`,
    ] : []),
    ``,
    `Classification: ${classification.failureClass} — ${classification.dispatchAction}`,
    `Retry attempt: ${attempt}/${maxAttempts}`,
    ``,
    ...recoveryEvidenceRoute(slots),
    ``,
    `Before repair work, compact the aborted working context. Reload the locked mission goal and scope; committed checkpoint or gate evidence when present; this exact gate diagnostic and classification; retry attempt ${attempt}/${maxAttempts}; current review round and disposition; unresolved findings and implementer resolutions; and the current branch revision.`,
    ``,
    remedy,
    `Perform this stage-specific repair now; do not only describe or plan it. Verify the required result and report any remaining exact failure.`,
    `The failing check re-runs automatically after your fix; this bounce is only reported as fixed when that re-run passes.`,
  ].join('\n');
}

/**
 * Repair authority for a gate or hook rebound (TASK-2575). The failed check and
 * its logs are evidence, not a verdict: the prompt names no cause, repair
 * location, or commit, so an implementer who traces the failure to the
 * environment or runner configuration repairs it there, and one who finds an
 * external blocker reports it instead of spending the budget on guesses.
 */
const REPAIR_AUTHORITY = 'Diagnose the actual cause from the failed check and its logs; do not assume it is a test or code path inside the original mission scope. Repair the cause wherever it lies within your authority (repository code, tests, configuration, the local environment, or runner configuration) and fix the mission without breaking the repository: preserve the mission deliverables and safety boundaries, and never weaken, skip, or delete a check to make it pass. If the repair changes tracked files, commit it before the automatic re-verification: the re-run verifies the committed mission tree, so an uncommitted repair cannot be verified and is reported as still failing. A repair outside the repository needs no commit. If the cause is external and you cannot repair it (for example a model service or network dependency that is down), make no speculative changes: report the exact blocker with its evidence and stop, because another repair attempt cannot fix it.';

function missionOutcomeFact(slug: string): [string, string] {
  return ['Mission outcome', `the locked goal and success criteria of ${slug} (px status ${slug}), delivered with this check passing`];
}

/**
 * The second and final repair gets a fresh context rather than another version
 * of the targeted prompt.  The failure output is evidence, not a diagnosis:
 * the worker must be free to investigate the actual cause in the worktree.
 */
export function buildFreshDiagnosticRepairPrompt(slots: FixPromptSlots): string {
  const { label, slug, worktree, facts, diagnostic, originalDiagnostic, classification, attempt, maxAttempts, remedy } = slots;
  return [
    `${label} — FRESH-CONTEXT DIAGNOSTIC REPAIR REQUIRED`,
    '',
    `Mission: ${slug}`,
    ...(worktree ? [`Working directory: ${worktree}`] : []),
    ...facts.map(([name, value]) => `${name}: ${value}`),
    '',
    'Original failure evidence (this is not necessarily the root cause):',
    '---',
    elideBounceOutput(originalDiagnostic || '(no output)'),
    '---',
    'Latest failure evidence (this is not necessarily the root cause):',
    '---',
    elideBounceOutput(diagnostic || '(no output)'),
    '---',
    '',
    `Classification: ${classification.failureClass} — ${classification.dispatchAction}`,
    `Recovery strategy: fresh-diagnostic (${attempt}/${maxAttempts})`,
    `Retry attempt: ${attempt}/${maxAttempts}`,
    '',
    ...recoveryEvidenceRoute(slots),
    '',
    'You have a fresh context. Re-diagnose the failure from the repository and exact evidence; do not assume either diagnostic identifies the root cause.',
    'The locked mission goal and scope remain binding. Preserve all gate and test invariants: do not weaken, bypass, replace, or claim to satisfy any check.',
    remedy,
    'Perform the repair, preserve valid committed work already in the mission worktree, and commit your repair. Only the harness rerunning this exact failing check can establish success.',
  ].join('\n');
}

/**
 * A bounded, honest retrieval route for retained command evidence.
 *
 * The retained output is unabridged on disk (only the inline diagnostic is
 * truncated), so the omitted middle is retrievable. A fresh-context agent
 * receives evidence references — absolute paths in the mission worktree — not
 * the previous model's assumptions, and a process restart does not invalidate
 * them: the paths and incident fingerprint are stable across processes. When a
 * record is missing, truncated, expired, or access-denied, the route states it
 * and points at related incidents rather than claiming completeness.
 */
function recoveryEvidenceRoute(slots: Pick<FixPromptSlots, 'recoveryEvidence' | 'recoveryEvidenceRecent' | 'recoveryEvidenceError'>): string[] {
  if (slots.recoveryEvidence) {
    const e = slots.recoveryEvidence;
    const route = [
      `Retained evidence for this failure (unabridged; retrieve the omitted middle from these):`,
      `  command: ${e.command}`,
      `  worked from: ${e.cwd}`,
      `  captured revision: ${e.capturedRevision ?? 'not resolved'}`,
      `  exit code: ${e.exitCode ?? 'none'}${e.signal ? ` (signal ${e.signal})` : ''}`,
      `  attempt ${e.attempt} of the retained series; incident ${e.incidentId.slice(0, 12)}…`,
      `  stdout: ${e.stdoutPath}${e.truncatedFrom === 'stdout' ? ' (truncated — see capture-completeness note)' : ''}`,
      `  stderr: ${e.stderrPath}${e.truncatedFrom === 'stderr' ? ' (truncated — see capture-completeness note)' : ''}`,
      `  capture complete: ${e.captureComplete ? 'yes' : 'no'}${e.redacted ? '; redacted per configured credential redaction' : ''}`,
      `Retrieve or search more retained output for this mission with: listRecoveryEvidence({ cwd }) or lookupRecoveryEvidence({ cwd, incidentId: "${e.incidentId}" }).`,
    ];
    return ['', ...route, ''];
  }
  const lines: string[] = ['', 'No retained evidence for this failure is available yet', ''];
  if (slots.recoveryEvidenceError) { lines.push(`Reason: ${slots.recoveryEvidenceError}.`); }
  if (slots.recoveryEvidenceRecent && slots.recoveryEvidenceRecent.length > 0) {
    lines.push('Related retained failures (act on these):');
    for (const r of slots.recoveryEvidenceRecent) {
      lines.push(`  incident ${r.incidentId.slice(0, 12)}… attempt ${r.attempt}: ${r.command} (exit ${r.exitCode ?? 'none'})`);
    }
  }
  return lines;
}

/**
 * Attach a retrieval route to a repair prompt from evidence already on disk.
 *
 * The current failure's own record is captured by the caller before the kernel
 * runs; here we read what is durable at prompt-build time (the original and any
 * prior retries) so a fresh-context or restarted agent still sees the series. */
function recoveryEvidenceForPrompt(worktree: string): Pick<FixPromptSlots, 'recoveryEvidence' | 'recoveryEvidenceRecent' | 'recoveryEvidenceError'> {
  // Key by the worktree (not the slug) so the route resolves to exactly the
  // store the capture step wrote into, regardless of which identity each side
  // happened to know. The worktree is unique to one mission and one repository.
  const recent = listRecoveryEvidence({ cwd: worktree });
  return {
    recoveryEvidence: recent[0] ?? null,
    recoveryEvidenceRecent: recent.length > 1 ? recent.slice(1) : null,
    recoveryEvidenceError: recent.length === 0 ? 'no retained evidence for this mission' : null,
  };
}

/**
 * Persist attributable, retrievable evidence of the original failed gate before
 * any repair launches. Some repair paths (notably the handoff gate path, which
 * runs the gate through `runVerificationGateFn` and never calls
 * `captureVerifiedTreeProof`) reach the kernel without having written evidence;
 * capturing here makes evidence delivery uniform across every launch path. Only
 * a verification gate is captured: a `gate-failure` reason names the exact
 * command, working directory, exit/signal, and captured stdout/stderr that the
 * process produced. The record is written to the worktree store, so a
 * fresh-context or restarted agent can read it even though it never saw the
 * failed command. A write failure reports `undefined` rather than hiding the
 * failure or inventing a complete-evidence claim.
 */
async function captureGateFailureEvidence(
  reason: ReboundReason,
  worktree: string,
  context: ReboundContext,
): Promise<RecoveryEvidenceRef | undefined> {
  if (reason.kind !== 'gate-failure') { return undefined; }
  const capturedRevision = context.readHead ? (await context.readHead()) : context.head ?? null;
  // Obtain and pass the operator-configured credential redactor so the retained
  // streams are scrubbed before write when one is configured, and `redacted`
  // honestly reflects whether it ran (mission success criterion).
  const redactor = resolveConfiguredCredentialRedactor();
  const result = captureRecoveryEvidence({
    command: reason.command,
    cwd: worktree,
    capturedRevision,
    exitCode: reason.exitCode,
    signal: null,
    stdout: reason.stdout ?? '',
    stderr: reason.stderr ?? '',
    diagnostic: reason.error ?? reboundDiagnostic(reason),
    missionId: context.slug,
    ...(redactor ? { redactor } : {}),
  });
  return result.ok ? result.ref : undefined;
}

/**
 * Persist a failed repair retry as the next evidence attempt in the same
 * incident as the original failure, so a restarted agent can see the whole
 * recovery series (original plus every relaunch) rather than only the latest.
 *
 * The kernel captures the original failure once up front; each subsequent
 * `verify()` failure reaches this point. The fingerprint is the failing gate's
 * identity (command, working directory, exit) and is stable across the repair
 * loop: the implementer commits between relaunches, so the revision moves and
 * the diagnostic text changes, but the gate still fails. Grouping on the gate
 * identity keeps every relaunch in the original incident instead of opening a
 * new incident per relaunch and stranding the series behind only the latest
 * failure. The attempt number advances within the incident so each failure
 * keeps its own record instead of overwriting the original.
 */
async function captureRetryEvidence(
  state: ReboundState,
  worktree: string,
  context: ReboundContext,
): Promise<RecoveryEvidenceRef | undefined> {
  if (!worktree || state.reason.kind !== 'gate-failure') { return undefined; }
  const reason = state.reason;
  const capturedRevision = context.readHead ? (await context.readHead()) : context.head ?? null;
  const diagnostic = reason.error ?? reboundDiagnostic(reason);
  // Fingerprint omits exit status (F7): the same gate legitimately fails with a
  // different or signalled exit on a retry, and grouping on it would split the
  // recovery series. Command plus cwd uniquely identify the gate.
  const fingerprint = failureIncidentFingerprint({
    command: reason.command,
    cwd: worktree,
  });
  // `lookupRecoveryEvidence` resolves only a named incident; without an id it
  // returns `{ ok: false }`. Match the retry to its incident by fingerprint.
  // Among the matching records, advance from the highest attempt, not the most
  // recently captured: two captures in the same millisecond share a
  // `capturedAt`, so ordering by recency is unreliable and selecting the newest
  // would re-advance from the oldest record and overwrite the prior attempt.
  const sameIncidentRef = listRecoveryEvidence({ cwd: worktree, missionId: context.slug })
    .filter((record) => record.incidentId === fingerprint)
    .reduce<RecoveryEvidenceRef | undefined>((best, record) =>
      best === undefined || record.attempt > best.attempt ? record : best, undefined);
  const sameIncident = sameIncidentRef !== undefined;
  const attempt = sameIncident ? sameIncidentRef.attempt + 1 : 1;
  // Re-resolve the configured redactor for this attempt too: a retry is a fresh
  // capture of the same gate, so it honours the same credential-redaction
  // policy. The resolver is a pure function of configuration, so it returns the
  // same redactor (or `null`) as the original capture, keeping the series
  // consistent. `redacted` then honestly reflects redaction across the series.
  const redactor = resolveConfiguredCredentialRedactor();
  const result = captureRecoveryEvidence({
    command: reason.command,
    cwd: worktree,
    capturedRevision,
    exitCode: reason.exitCode,
    signal: null,
    stdout: reason.stdout ?? '',
    stderr: reason.stderr ?? '',
    diagnostic,
    missionId: context.slug,
    ...(sameIncident ? { incidentId: fingerprint } : {}),
    ...(attempt > 1 ? { attempt } : {}),
    ...(redactor ? { redactor } : {}),
  });
  return result.ok ? result.ref : undefined;
}

/** Prompt slots derived from a structured reason. */
function promptSlotsFor(reason: ReboundReason, slug: string): Pick<FixPromptSlots, 'area' | 'facts' | 'remedy'> {
  switch (reason.kind) {
    case 'gate-failure':
      return {
        area: reason.area,
        facts: [
          ['Area', reason.area],
          ['Gate command', reason.command],
          missionOutcomeFact(slug),
          ['Exit code', String(reason.exitCode)],
          ...(reason.approvedRevision
            ? [['Approved revision', reason.approvedRevision] as [string, string]]
            : []),
          ['Cause', 'The integration gate (not the review gate) failed: the mission was reviewed and approved, then a red pre-integration gate rejected the finalized tree on the way to a human integration. Repair the integration failure, not a review finding.'],
          ...(reason.coverageNote ? [['Coverage', reason.coverageNote] as [string, string]] : []),
        ],
        remedy: `Start with the listed gate command in the listed worktree and the captured failure output. Do not substitute a broader verification command or integration suite to rediscover the failure. ${REPAIR_AUTHORITY}`,
      };
    case 'hook-failure':
      return {
        area: reason.hook || 'hook',
        facts: [
          ['Hook type', reason.hook || 'unknown'],
          ...(reason.operation ? [['Git operation', reason.operation] as [string, string]] : []),
          ['Failed check', `${reason.hook || 'Git'} hook on ${reason.operation || 'a workflow Git operation'}`],
          missionOutcomeFact(slug),
        ],
        remedy: `Make the Git hook pass when Parallix commits or rebases this mission. ${REPAIR_AUTHORITY}`,
      };
    case 'artifact-incomplete':
      return {
        area: reason.role,
        facts: [['Role', reason.role]],
        remedy: `Produce the complete ${reason.role} artifacts the workflow requires.`,
      };
    case 'agent-timeout':
      return {
        area: reason.role,
        facts: [['Role', reason.role], ...(reason.expectedOutput ? [['Required output', reason.expectedOutput] as [string, string]] : [])],
        remedy: `Produce ${reason.expectedOutput || `the missing ${reason.role} output`} and report it through the normal review artifact or provider path.`,
      };
    case 'handoff-verification':
      return {
        area: 'handoff',
        facts: [['Handoff error', reason.error]],
        remedy: isIncompleteSuccessCriteriaFailure(reason.error)
          ? buildSuccessCriteriaRecoveryAdvice(slug)
          : `Fix the underlying issue so handoff verification passes.`,
      };
    case 'declared-gate-validation':
      return {
        area: 'declared gate',
        facts: [['Gate command', reason.command]],
        remedy: 'Replace the declaration with the exact runnable command and move outcome prose to Success Criteria or checkpoint documentation.',
      };
  }
  // Unreachable for the closed union; kept out of the switch for exhaustiveness.
}

// ── Kernel ───────────────────────────────────────────────────────────────────

/**
 * Bounce one failing occurrence back to the implementer and verify the fix.
 *
 * Returns `fixed` only after `verify()` passes, `exhausted` when the
 * per-occurrence budget is spent (carrying the last diagnostic; the caller
 * strands the mission), or `human-only` when the ADR 0048 table says no agent
 * relaunch can fix the failure.
 */
async function reboundImpl(reason: ReboundReason, context: ReboundContext): Promise<ReboundOutcome> {
  const {
    slug,
    worktree,
    verify,
    startAgent,
    maxAttempts = DEFAULT_REBOUND_ATTEMPTS,
    maxTransientRetries = 1,
    maxLaunchRetries = 1,
    transitionToImplementer,
    applyAgentFallback,
    log = fmt.log.plain,
    error = fmt.log.plainError,
  } = context;

  // `originalDiagnostic` is the failure the mission started from. It is captured
  // here, before the transient-verifier loop can refresh `diagnostic`, so the fix
  // prompt can still show what originally failed alongside the latest output.
  const firstDiagnostic = reboundDiagnostic(reason);
  const state: ReboundState = { implementer: context.implementer, reason, classification: classifyReboundReason(reason), diagnostic: firstDiagnostic, originalDiagnostic: firstDiagnostic, history: [failureFingerprint(reason)], launchFailures: 0, attempts: 0, attemptsDetail: [] };
  if (!state.classification.isRelaunchable) { return humanOnlyOutcome(state, context, error); }
  const transientOutcome = await retryTransientVerification(state, verify, maxTransientRetries, log);
  if (transientOutcome) { return transientOutcome; }
  // A transient verifier (agent-smoke) exhausted its single retry on an
  // unchanged tree without fixing. A persistent environment failure is not an
  // implementer repair: return it to the human with the exact diagnostic
  // instead of spending the repair budget (TASK-2620 AC4). The lane move and
  // approval withdrawal already happened before the kernel ran, so this only
  // skips the implementer launch. Other transient gates remain fixable and
  // still launch an implementer after their retry.
  if (isTransientVerifierFailure(state.reason) && (state.reason as GateFailureReason).environment === true) { return humanOnlyOutcome(state, context, error); }
  const repairOutcome = await runRepairAttempts(state, { context, slug, worktree, verify, startAgent, maxAttempts, maxLaunchRetries, transitionToImplementer, applyAgentFallback, log, error });
  if (repairOutcome) { return repairOutcome; }
  const why = !state.classification.isRelaunchable
    ? 'the fresh structured failure requires human action'
    : state.attempts >= maxAttempts
      ? `implementer repair budget (${maxAttempts}): attempt budget spent (${state.attempts})`
      : `launcher budget spent (${maxLaunchRetries} session retries; ${state.launchFailures} failed launches)`;
  const dossier = recoveryDossier(state.reason, context, state.history, state.diagnostic, why, state.attemptsDetail, state.capturedEvidence);
  error(fmt.status('FAIL', dossier));
  recordRepairTelemetry(context, { strategy: state.attemptsDetail.at(-1)?.strategy || 'targeted', outcome: 'escalate' });
  return { outcome: 'exhausted', attempts: state.attempts, diagnostic: state.diagnostic, classification: state.classification, implementer: state.implementer, dossier, attemptsDetail: state.attemptsDetail };
}

export async function rebound(reason: ReboundReason, context: ReboundContext): Promise<ReboundOutcome> {
  return await reboundImpl(reason, context);
}

interface ReboundState { implementer: string; reason: ReboundReason; classification: ReboundClassification; diagnostic: string; originalDiagnostic: string; history: string[]; launchFailures: number; attempts: number; attemptsDetail: RepairEvidence[]; /** Retained evidence of the original failed command, persisted before the first repair launch. */ capturedEvidence?: RecoveryEvidenceRef | null; }

function humanOnlyOutcome(state: ReboundState, context: ReboundContext, error: ReboundContext['error']): ReboundOutcome {
  error?.(fmt.status('FAIL', `${state.classification.label}: ${state.classification.failureClass} (${state.classification.dispatchAction}). Human intervention required — not bouncing.`));
  error?.(fmt.status('FAIL', `Failure output:\n${state.diagnostic || '(no output)'}\n`));
  const dossier = recoveryDossier(state.reason, context, state.history, state.diagnostic, 'the structured failure requires human action', state.attemptsDetail);
  error?.(fmt.status('FAIL', dossier));
  return { outcome: 'human-only', attempts: 0, diagnostic: state.diagnostic, classification: state.classification, implementer: state.implementer, dossier, attemptsDetail: state.attemptsDetail };
}

async function retryTransientVerification(state: ReboundState, verify: ReboundContext['verify'], retries: number, log: ReboundContext['log']): Promise<ReboundOutcome | null> {
  for (let attempt = 1; isTransientVerifierFailure(state.reason) && attempt <= retries; attempt++) {
    log?.(fmt.status('WARN', `Transient verifier outcome; rerunning unchanged check (${attempt}/${retries}) before launching an implementer.`));
    const result = await verify(0);
    if (result.ok) { return { outcome: 'fixed', attempts: 0, diagnostic: result.diagnostic || '', classification: state.classification, implementer: state.implementer }; }
    refreshReboundState(state, result, log);
  }
  return null;
}

function refreshReboundState(state: ReboundState, result: VerifyResult, log: ReboundContext['log']) {
  const previous = state.history[state.history.length - 1];
  state.reason = refreshedReason(state.reason, result);
  state.diagnostic = reboundDiagnostic(state.reason);
  state.classification = classifyReboundReason(state.reason);
  const fingerprint = failureFingerprint(state.reason);
  state.history.push(fingerprint);
  if (fingerprint !== previous) { log?.(fmt.status('INFO', `Recovery incident changed; reclassified as ${state.classification.failureClass}.`)); }
}

async function runRepairAttempts(state: ReboundState, options: any): Promise<ReboundOutcome | null> {
  const { context, slug, worktree, verify, startAgent, maxAttempts, maxLaunchRetries, transitionToImplementer, applyAgentFallback, log, error } = options;
  const originalDiagnostic = state.originalDiagnostic;
  // Persist evidence of the original failed command before the first repair
  // launches, so a fresh-context or restarted agent can retrieve it even when
  // the launch path never ran captureVerifiedTreeProof. Captured once, from the
  // original failure, so the prompt names what originally failed rather than a
  // later retry's output.
  if (!state.capturedEvidence && worktree) {
    state.capturedEvidence = await captureGateFailureEvidence(state.reason, worktree, context);
  }
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const strategy: RepairStrategy = attempt === 1 ? 'targeted' : 'fresh-diagnostic';
    const promptSlots = { label: state.classification.label, slug, worktree, diagnostic: state.diagnostic, originalDiagnostic, classification: state.classification, attempt, maxAttempts, ...promptSlotsFor(state.reason, slug) };
    // Prefer the record this kernel just captured; fall back to any other
    // evidence already on disk so a related prior failure still surfaces.
    const lookup = worktree ? recoveryEvidenceForPrompt(worktree) : {};
    const recovery = { ...lookup, recoveryEvidence: state.capturedEvidence ?? lookup.recoveryEvidence };
    const fixPrompt = strategy === 'targeted'
      ? buildReboundFixPrompt({ ...promptSlots, ...recovery })
      : buildFreshDiagnosticRepairPrompt({ ...promptSlots, ...recovery });
    if (transitionToImplementer) { await transitionToImplementer(slug); }
    log(fmt.status('INFO', `Bouncing to implementer (${state.implementer}) with ${strategy} ${state.classification.failureClass} repair. Attempt ${attempt}/${maxAttempts}.`));
    const headBefore = await currentHead(context);
    const fingerprintBefore = failureFingerprint(state.reason);
    const launch = await launchFixAttempt({ startAgent, applyAgentFallback, implementer: state.implementer, fixPrompt, slug, worktree, step: context.step, role: context.role, exclude: context.exclude, sessionPolicy: strategy === 'fresh-diagnostic' ? 'fresh-ephemeral' : 'resume' });
    state.implementer = launch.implementer;
    const launchResult = handleLaunchResult(state, launch, maxLaunchRetries, error);
    if (launchResult === 'retry') { attempt--; continue; }
    if (launchResult === 'skip') { continue; }
    if (launchResult === 'stop') { break; }
    const verified = await verify(attempt);
    const detail: RepairEvidence = { strategy, agent: state.implementer, context: strategy === 'fresh-diagnostic' ? 'fresh' : 'resumed', headBefore, headAfter: await currentHead(context), fingerprintBefore, fingerprintAfter: verified.ok ? fingerprintBefore : failureFingerprint(refreshedReason(state.reason, verified)) };
    state.attemptsDetail.push(detail);
    if (verified.ok) {
      log(fmt.status('PASS', `${state.classification.label} repaired: the failing check re-ran and passed (attempt ${attempt}/${maxAttempts}).`));
      recordRepairTelemetry(context, { strategy, outcome: strategy === 'targeted' ? 'pass' : 'rescue' });
      return { outcome: 'fixed', attempts: state.attempts, diagnostic: verified.diagnostic || '', classification: state.classification, implementer: state.implementer, attemptsDetail: state.attemptsDetail };
    }
    refreshReboundState(state, verified, log);
    // Persist this failed relaunch as the next attempt in the original incident
    // so the whole recovery series survives a restart, not just the first failure.
    // Do not overwrite state.capturedEvidence: the prompt must still name the
    // original failure, while the retry surfaces via the recent-incident route.
    await captureRetryEvidence(state, worktree, context);
    if (strategy === 'targeted') { recordRepairTelemetry(context, { strategy, outcome: 'advance' }); }
    if (!state.classification.isRelaunchable) { break; }
    error(fmt.status('WARN', `${state.classification.label}: the check still fails after attempt ${attempt}/${maxAttempts}.`));
  }
  return null;
}

async function currentHead(context: ReboundContext): Promise<string | null> { return await context.readHead?.() ?? context.head ?? null; }

function handleLaunchResult(state: ReboundState, launch: Awaited<ReturnType<typeof launchFixAttempt>>, maxRetries: number, error: ReboundContext['error']): 'verify' | 'retry' | 'skip' | 'stop' {
  if (launch.ok) { state.attempts++; return 'verify'; }
  error?.(fmt.status('FAIL', `${state.classification.label}: ${launch.diagnostic}`));
  state.diagnostic = launch.diagnostic;
  if (launch.repairAttempted) { state.attempts++; return 'skip'; }
  state.launchFailures++;
  return state.attempts > 0 || state.launchFailures > maxRetries ? 'stop' : 'retry';
}

/** One launch attempt; a null/ambiguous exit status is a launch failure. */
async function launchFixAttempt(options: {
  startAgent: ReboundStartAgent;
  applyAgentFallback?: ReboundContext['applyAgentFallback'];
  implementer: string;
  fixPrompt: string;
  slug: string;
  worktree: string;
  step?: string;
  role?: string;
  exclude?: string[];
  sessionPolicy: 'resume' | 'fresh-ephemeral';
}): Promise<{ ok: boolean; implementer: string; diagnostic: string; repairAttempted: boolean }> {
  const { startAgent, applyAgentFallback, fixPrompt, slug, worktree, step = 'act-on-review', role = 'implementer', exclude = [], sessionPolicy } = options;
  let implementer = options.implementer;
  let launchResult: Awaited<ReturnType<ReboundStartAgent>>;
  try {
    launchResult = await startAgent(step, {
      agent: implementer,
      prompt: (_actualImplementer: string) => fixPrompt,
      worktree,
      slug,
      role,
      exclude,
      sessionPolicy,
    });
  } catch (err: unknown) {
    return { ok: false, implementer, diagnostic: `Could not launch implementer (${implementer}): ${(err as Error).message}`, repairAttempted: false };
  }

  if (applyAgentFallback) {
    implementer = await applyAgentFallback({ launchResult, original: implementer }) || implementer;
  }

  const status = launchResult?.result?.status;
  if (status === null || status === undefined) {
    return {
      ok: false,
      implementer,
      diagnostic: `Implementer (${implementer}) returned an ambiguous exit status (null); treating the launch as failed — a null-exit fix is no evidence of a fix.`, repairAttempted: false,
    };
  }
  if (status !== 0) {
    return { ok: false, implementer, diagnostic: `Implementer (${implementer}) exited with status ${status}.`, repairAttempted: true };
  }
  return { ok: true, implementer, diagnostic: '', repairAttempted: true };
}
