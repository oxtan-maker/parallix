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
  /** Declared by the verification adapter; the kernel never infers this from prose. */
  transient?: boolean;
  /**
   * Declared coverage fact about the failing command, printed as a prompt fact
   * rather than mixed into the diagnostic: an integration-only gate must say so
   * explicitly, because a green ordinary verification command is then no
   * evidence the failure is fixed (TASK-2492). The classifier never reads it.
   */
  coverageNote?: string;
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

function recoveryDossier(reason: ReboundReason, context: ReboundContext, history: string[], diagnostic: string, why: string): string {
  const command = reason.kind === 'gate-failure' ? reason.command : reason.kind === 'hook-failure' ? reason.operation || 'Git hook operation' : 'stage recovery';
  const manualNextAction = reason.kind === 'gate-failure'
    ? `Repair the reported failure, then rerun ${reason.command} from ${context.worktree}.`
    : reason.kind === 'hook-failure'
      ? `Repair the reported ${reason.hook} hook failure, then rerun ${reason.operation || 'the failed Git operation'}${reason.operation?.includes('rebase') ? '; if the rebase cannot be resumed safely, run git rebase --abort' : ''}.`
      : reason.kind === 'artifact-incomplete'
        ? `Create the missing artifacts named above, then rerun px review ${context.slug} --continue.`
        : reason.kind === 'agent-timeout'
          ? `Produce the required ${reason.role} output named above, then rerun px review ${context.slug} --continue.`
          : `Repair the retained handoff failure, then rerun px review ${context.slug} --start.`;
  return [
    `Recovery dossier for ${context.slug}`,
    `Stage: ${reason.kind}`,
    `HEAD: ${context.head || 'not captured'}`,
    `Last action: ${command}`,
    `Failure history: ${history.join(' -> ') || failureFingerprint(reason)}`,
    `Last diagnostic: ${elideBounceOutput(diagnostic || '(no output)')}`,
    `Successful checks: none recorded before exhaustion`,
    `Stopped because: ${why}`,
    `Manual next action: ${manualNextAction}`,
  ].join('\n');
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
    `Before repair work, compact the aborted working context. Reload the locked mission goal and scope; committed checkpoint or gate evidence when present; this exact gate diagnostic and classification; retry attempt ${attempt}/${maxAttempts}; current review round and disposition; unresolved findings and implementer resolutions; and the current branch revision.`,
    ``,
    remedy,
    `Perform this stage-specific repair now; do not only describe or plan it. Verify the required result and report any remaining exact failure.`,
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
          ...(reason.coverageNote ? [['Coverage', reason.coverageNote] as [string, string]] : []),
        ],
        remedy: `Start with the listed gate command in the listed worktree and the captured failure output. Repair the specific failing test or code path named there, including making a slow unit test hermetic when its budget is exceeded. Do not substitute a broader verification command or integration suite to rediscover the failure. Parallix reruns this exact gate after the repair.`,
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
        facts: [['Role', reason.role], ...(reason.expectedOutput ? [['Required output', reason.expectedOutput] as [string, string]] : [])],
        remedy: `Produce ${reason.expectedOutput || `the missing ${reason.role} output`} and report it through the normal review artifact or provider path.`,
      };
    case 'handoff-verification':
      return {
        area: 'handoff',
        facts: [['Handoff error', reason.error]],
        remedy: `Fix the underlying issue so handoff verification passes.`,
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
export async function rebound(reason: ReboundReason, context: ReboundContext): Promise<ReboundOutcome> {
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

  let implementer = context.implementer;
  let currentReason = reason;
  let classification = classifyReboundReason(currentReason);
  let diagnostic = reboundDiagnostic(currentReason);
  const originalDiagnostic = diagnostic;
  const history = [failureFingerprint(currentReason)];

  if (!classification.isRelaunchable) {
    error(fmt.status('FAIL', `${classification.label}: ${classification.failureClass} (${classification.dispatchAction}). Human intervention required — not bouncing.`));
    error(fmt.status('FAIL', `Failure output:\n${diagnostic || '(no output)'}\n`));
    const dossier = recoveryDossier(currentReason, context, history, diagnostic, 'the structured failure requires human action');
    error(fmt.status('FAIL', dossier));
    return { outcome: 'human-only', attempts: 0, diagnostic, classification, implementer, dossier };
  }

  // Environmental gate evidence gets a bounded rerun before an implementer is
  // disturbed.  This is evidence-based, never a pass-by-timeout.
  for (let transientAttempt = 1; isTransientVerifierFailure(currentReason) && transientAttempt <= maxTransientRetries; transientAttempt++) {
    log(fmt.status('WARN', `Transient verifier outcome; rerunning unchanged check (${transientAttempt}/${maxTransientRetries}) before launching an implementer.`));
    const rerun = await verify(0);
    if (rerun.ok) {
      return { outcome: 'fixed', attempts: 0, diagnostic: rerun.diagnostic || '', classification, implementer };
    }
    currentReason = refreshedReason(currentReason, rerun);
    diagnostic = reboundDiagnostic(currentReason);
    classification = classifyReboundReason(currentReason);
    history.push(failureFingerprint(currentReason));
  }

  let launchFailures = 0;
  let completedRepairAttempts = 0;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const slots = promptSlotsFor(currentReason);
    const fixPrompt = buildReboundFixPrompt({
      label: classification.label,
      slug,
      worktree,
      diagnostic,
      originalDiagnostic,
      classification,
      attempt,
      maxAttempts,
      ...slots,
    });

    if (transitionToImplementer) {
      await transitionToImplementer(slug);
    }
    log(fmt.status('INFO', `Bouncing to implementer (${implementer}) with a ${classification.failureClass} fix prompt. Attempt ${attempt}/${maxAttempts}.`));

    const launch = await launchFixAttempt({ startAgent, applyAgentFallback, implementer, fixPrompt, slug, worktree, step: context.step, role: context.role, exclude: context.exclude });
    implementer = launch.implementer;
    if (!launch.ok) {
      // A launcher/session outage is not evidence that the implementer failed
      // to repair code, so it has its own small budget.
      error(fmt.status('FAIL', `${classification.label}: ${launch.diagnostic}`));
      diagnostic = launch.diagnostic;
      // A non-zero agent exit means it did start and used a repair turn.  A
      // throw/null status means no trustworthy repair session started.
      if (launch.repairAttempted) {
        completedRepairAttempts++;
        continue;
      }
      launchFailures++;
      // Recover a launch/session failure only before an agent has completed a
      // repair turn. Afterwards it is a separate incident, not permission to
      // multiply the code-repair budget.
      if (completedRepairAttempts > 0 || launchFailures > maxLaunchRetries) { break; }
      attempt--;
      continue;
    }
    completedRepairAttempts++;

    const verifyResult = await verify(attempt);
    if (verifyResult.ok) {
      log(fmt.status('PASS', `${classification.label} repaired: the failing check re-ran and passed (attempt ${attempt}/${maxAttempts}).`));
      return { outcome: 'fixed', attempts: completedRepairAttempts, diagnostic: verifyResult.diagnostic || '', classification, implementer };
    }

    currentReason = refreshedReason(currentReason, verifyResult);
    diagnostic = reboundDiagnostic(currentReason);
    const previousFingerprint = history[history.length - 1];
    classification = classifyReboundReason(currentReason);
    const fingerprint = failureFingerprint(currentReason);
    history.push(fingerprint);
    if (fingerprint !== previousFingerprint) {
      log(fmt.status('INFO', `Recovery incident changed; reclassified as ${classification.failureClass}.`));
    }
    if (!classification.isRelaunchable) { break; }
    error(fmt.status('WARN', `${classification.label}: the check still fails after attempt ${attempt}/${maxAttempts}.`));
  }

  const why = !classification.isRelaunchable
    ? 'the fresh structured failure requires human action'
    : completedRepairAttempts >= maxAttempts
      ? `implementer repair budget (${maxAttempts}): attempt budget spent (${completedRepairAttempts})`
      : `launcher budget spent (${maxLaunchRetries} session retries; ${launchFailures} failed launches)`;
  const dossier = recoveryDossier(currentReason, context, history, diagnostic, why);
  error(fmt.status('FAIL', dossier));
  return { outcome: 'exhausted', attempts: completedRepairAttempts, diagnostic, classification, implementer, dossier };
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
}): Promise<{ ok: boolean; implementer: string; diagnostic: string; repairAttempted: boolean }> {
  const { startAgent, applyAgentFallback, fixPrompt, slug, worktree, step = 'act-on-review', role = 'implementer', exclude = [] } = options;
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
