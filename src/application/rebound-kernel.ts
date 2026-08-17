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

/** Default per-occurrence attempt budget. */
export const DEFAULT_REBOUND_ATTEMPTS = 2;

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
}

/** A handoff verification check rejected the mission. */
export interface HandoffVerificationReason {
  kind: 'handoff-verification';
  error: string;
  gateOutput?: string;
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
  | HandoffVerificationReason;

/** Result of re-running the failing check after a fix attempt. */
export interface VerifyResult {
  ok: boolean;
  /** Fresh diagnostic from the re-run; empty when the check passed. */
  diagnostic?: string;
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
  /** Moves the task back to the implementer phase before a launch. */
  transitionToImplementer?: (_slug: string) => Promise<unknown> | unknown;
  /** Resolves the agent actually launched (fallback selection). */
  applyAgentFallback?: (_options: { launchResult: unknown; original: string }) => Promise<string> | string;
  log?: (_msg: string) => void;
  error?: (_msg: string) => void;
}

export type ReboundOutcomeKind = 'fixed' | 'exhausted' | 'human-only';

export interface ReboundOutcome {
  outcome: ReboundOutcomeKind;
  /** Launch attempts consumed by this occurrence. */
  attempts: number;
  /** Last diagnostic observed: the verify re-run's, or the original failure's. */
  diagnostic: string;
  classification: ReboundClassification;
  /** Agent that ran the final attempt (fallback-resolved). */
  implementer: string;
}

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
    return classified(FailureClass.InfraBlocker, DispatchAction.HumanOnly);
  }

  const { failureClass, dispatchAction } = classifyError(diagnostic);
  return classified(failureClass, dispatchAction);
}

// ── Fix prompt ───────────────────────────────────────────────────────────────

export interface FixPromptSlots {
  /** Failure banner (`PRE-REVIEW GATE FAILURE`, …). */
  label: string;
  slug: string;
  /** Verification area, hook identity, or agent role — whatever names the failure. */
  area: string;
  /** Structured facts printed above the diagnostic. */
  facts: Array<[string, string]>;
  diagnostic: string;
  classification: ReboundClassification;
  attempt: number;
  maxAttempts: number;
  /** What passing looks like, in the implementer's terms. */
  remedy: string;
}

/**
 * The one fix-prompt builder. Every rebound prompt — gate, hook, and the kinds
 * TASK-2377.04/.05 migrate — is built here, so the context-compaction
 * boilerplate and the automatic re-verify statement exist in one location.
 */
export function buildReboundFixPrompt(slots: FixPromptSlots): string {
  const { label, slug, facts, diagnostic, classification, attempt, maxAttempts, remedy } = slots;
  return [
    `${label} — FIX REQUIRED`,
    ``,
    `Mission: ${slug}`,
    ...facts.map(([name, value]) => `${name}: ${value}`),
    ``,
    `Failure output (use this to diagnose and fix):`,
    `---`,
    elideBounceOutput(diagnostic || '(no output)'),
    `---`,
    ``,
    `Classification: ${classification.failureClass} — ${classification.dispatchAction}`,
    `Retry attempt: ${attempt}/${maxAttempts}`,
    ``,
    `Before repair work, compact the aborted working context. Reload the locked mission goal and scope; committed checkpoint or gate evidence when present; this exact gate diagnostic and classification; retry attempt ${attempt}/${maxAttempts}; current review round and disposition; unresolved findings and implementer resolutions; and the current branch revision.`,
    ``,
    remedy,
    `The failing check re-runs automatically after your fix; this bounce is only reported as fixed when that re-run passes.`,
  ].join('\n');
}

/** Prompt slots derived from a structured reason. */
function promptSlotsFor(reason: ReboundReason): Pick<FixPromptSlots, 'area' | 'facts' | 'remedy'> {
  switch (reason.kind) {
    case 'gate-failure':
      return {
        area: reason.area,
        facts: [
          ['Area', reason.area],
          ['Gate command', reason.command],
          ['Exit code', String(reason.exitCode)],
        ],
        remedy: `Fix the underlying issue so the verification gate passes for area "${reason.area}".`,
      };
    case 'hook-failure':
      return {
        area: reason.hook || 'hook',
        facts: [
          ['Hook type', reason.hook || 'unknown'],
          ...(reason.operation ? [['Git operation', reason.operation] as [string, string]] : []),
        ],
        remedy: `Fix the underlying issue so the Git hook passes when Parallix commits or rebases this mission.`,
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
        facts: [['Role', reason.role]],
        remedy: `Complete the ${reason.role} step.`,
      };
    case 'handoff-verification':
      return {
        area: 'handoff',
        facts: [['Handoff error', reason.error]],
        remedy: `Fix the underlying issue so handoff verification passes.`,
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
export async function rebound(reason: ReboundReason, context: ReboundContext): Promise<ReboundOutcome> {
  const {
    slug,
    worktree,
    verify,
    startAgent,
    maxAttempts = DEFAULT_REBOUND_ATTEMPTS,
    transitionToImplementer,
    applyAgentFallback,
    log = fmt.log.plain,
    error = fmt.log.plainError,
  } = context;

  let implementer = context.implementer;
  const classification = classifyReboundReason(reason);
  let diagnostic = reboundDiagnostic(reason);

  if (!classification.isRelaunchable) {
    error(fmt.status('FAIL', `${classification.label}: ${classification.failureClass} (${classification.dispatchAction}). Human intervention required — not bouncing.`));
    error(fmt.status('FAIL', `Failure output:\n${diagnostic || '(no output)'}\n`));
    return { outcome: 'human-only', attempts: 0, diagnostic, classification, implementer };
  }

  const slots = promptSlotsFor(reason);

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const fixPrompt = buildReboundFixPrompt({
      label: classification.label,
      slug,
      diagnostic,
      classification,
      attempt,
      maxAttempts,
      ...slots,
    });

    if (transitionToImplementer) {
      await transitionToImplementer(slug);
    }
    log(fmt.status('INFO', `Bouncing to implementer (${implementer}) with a ${classification.failureClass} fix prompt. Attempt ${attempt}/${maxAttempts}.`));

    const launch = await launchFixAttempt({ startAgent, applyAgentFallback, implementer, fixPrompt, slug, worktree });
    implementer = launch.implementer;
    if (!launch.ok) {
      // Launch failure — including an ambiguous null exit status, which is no
      // evidence of a fix. It consumes the attempt like any failed try.
      error(fmt.status('FAIL', `${classification.label}: ${launch.diagnostic}`));
      diagnostic = launch.diagnostic;
      continue;
    }

    const verifyResult = await verify(attempt);
    if (verifyResult.ok) {
      log(fmt.status('PASS', `${classification.label} repaired: the failing check re-ran and passed (attempt ${attempt}/${maxAttempts}).`));
      return { outcome: 'fixed', attempts: attempt, diagnostic: verifyResult.diagnostic || '', classification, implementer };
    }

    diagnostic = verifyResult.diagnostic || diagnostic;
    error(fmt.status('WARN', `${classification.label}: the check still fails after attempt ${attempt}/${maxAttempts}.`));
  }

  error(fmt.status('FAIL', `${classification.label}: attempt budget spent (${maxAttempts}). Mission stranded for ${slug}.`));
  error(fmt.status('FAIL', `Last diagnostic:\n${diagnostic || '(no output)'}\n`));
  return { outcome: 'exhausted', attempts: maxAttempts, diagnostic, classification, implementer };
}

/** One launch attempt; a null/ambiguous exit status is a launch failure. */
async function launchFixAttempt(options: {
  startAgent: ReboundStartAgent;
  applyAgentFallback?: ReboundContext['applyAgentFallback'];
  implementer: string;
  fixPrompt: string;
  slug: string;
  worktree: string;
}): Promise<{ ok: boolean; implementer: string; diagnostic: string }> {
  const { startAgent, applyAgentFallback, fixPrompt, slug, worktree } = options;
  let implementer = options.implementer;
  let launchResult: Awaited<ReturnType<ReboundStartAgent>>;
  try {
    launchResult = await startAgent('act-on-review', {
      agent: implementer,
      prompt: (_actualImplementer: string) => fixPrompt,
      worktree,
      slug,
      role: 'implementer',
      exclude: [],
    });
  } catch (err: unknown) {
    return { ok: false, implementer, diagnostic: `Could not launch implementer (${implementer}): ${(err as Error).message}` };
  }

  if (applyAgentFallback) {
    implementer = await applyAgentFallback({ launchResult, original: implementer }) || implementer;
  }

  const status = launchResult?.result?.status;
  if (status === null || status === undefined) {
    return {
      ok: false,
      implementer,
      diagnostic: `Implementer (${implementer}) returned an ambiguous exit status (null); treating the launch as failed — a null-exit fix is no evidence of a fix.`,
    };
  }
  if (status !== 0) {
    return { ok: false, implementer, diagnostic: `Implementer (${implementer}) exited with status ${status}.` };
  }
  return { ok: true, implementer, diagnostic: '' };
}
