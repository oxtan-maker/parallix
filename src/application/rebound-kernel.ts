import { classifyRecoveryReason as classifyReboundReason } from './rebound-classification.js';
import type { ReboundStartAgent } from './ports/repair-agent-launch.js';
export type { ReboundLaunchOptions, ReboundStartAgent } from './ports/repair-agent-launch.js';
import { prepareRepairPrompt, runCheckpointVerification } from './rebound-checkpoints.js';
import { elideBounceOutput } from './output-elision.js';
import { type RepairCheckpointPort } from './ports/repair-checkpoint.js';
import type { InvalidContractBlocker } from '../domain/rebound-policy.js';
import { DEFAULT_REBOUND_ATTEMPTS, reboundDiagnostic, transientRetryAllowed, reboundRequiresHuman, repairStrategy, differentGateVerification, repairVerificationRequiresHuman, launchRecoveryAction, repairBudgetAllows, reboundExhaustion, type ReboundReason, type ReboundClassification } from '../domain/rebound-policy.js';
export { classifyReboundReason, reboundDiagnostic, isTransientVerifierFailure } from '../domain/rebound-policy.js';
export type { ReboundReason, ReboundClassification, GateFailureReason, HookFailureReason, ArtifactIncompleteReason, AgentTimeoutReason, HandoffVerificationReason, DeclaredGateValidationReason } from '../domain/rebound-policy.js';
import { recoveryEvidenceRoute } from './rebound-prompts.js';
export { buildFreshDiagnosticRepairPrompt } from './rebound-prompts.js';
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
 * in-memory budget (default 2 attempts). Incident checkpoints persist repair
 * evidence, never a shared retry counter, so concurrent processes cannot
 * consume one attempt budget (the task-2369.13 split-brain bug).
 *
 */

import * as fmt from './presentation/cli-format.js';

import type { RecoveryEvidenceRef } from './recovery-evidence.js';
import { captureOriginalFailureEvidence, captureRetryEvidence } from './rebound-evidence.js';
import { recordReboundOutcome, recordReboundRepair, type ReboundRepairOutcome } from './rebound-telemetry.js';
import { launchStatus, type FixLaunch } from './rebound-launch-result.js';
import { describeLaunchFailure, type LaunchFailure } from '../domain/launch-failure.js';

/** Default per-occurrence attempt budget. */
export { DEFAULT_REBOUND_ATTEMPTS } from '../domain/rebound-policy.js';

/** Stable recovery strategy identifiers for telemetry and escalation evidence. */
export type RepairStrategy = 'targeted' | 'fresh-diagnostic';

// ── Reason: structured failure values, never a regex match on combined text ──

/** Result of re-running the failing check after a fix attempt. */
export interface VerifyResult {
  ok: boolean;
  /** Supplied only by an adapter that just executed this exact command successfully. */
  exactExecution?: { readonly command: string; readonly worktree: string; readonly exitCode: 0 };
  workflowBlock?: import('./review-verdict-readiness.js').VerdictBlock;
  /** Exact check identity supplied by the verification adapter. */
  command?: string;
  /** Fresh diagnostic from the re-run; empty when the check passed. */
  diagnostic?: string;
  /**
   * The check's actual failure, when its adapter has process evidence.  A
   * caller must not turn this into a wrapper string before handing it back to
   * the recovery policy.
   */
  reason?: ReboundReason;
}

export interface ReboundContext {
  /** Exact Git-completion instruction, certified by the stage verifier without a code-repair checkpoint. */
  repairPrompt?: string;
  /** Inspect artifacts even when a completed repair process exits unsuccessfully. */
  inspectFailedRepair?: boolean;
  repairCheckpoints?: RepairCheckpointPort;
  /** Resume the harness-created incident with its original retained evidence. */
  retainedFailure?: RecoveryEvidenceRef;
  repairIncidentId?: string;
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
  applyAgentFallback?: (_options: { launchResult: Awaited<ReturnType<ReboundStartAgent>>; original: string }) => Promise<string> | string;
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
  /** Spawn evidence of the last launch that did not report an exit status. */
  launchFailure?: LaunchFailure;
}
/** Process-local verification evidence; no durable identity or lifecycle. */
export interface RepairEvidence { strategy: RepairStrategy; agent: string; context: 'resumed' | 'fresh'; headBefore: string | null; headAfter: string | null; fingerprintBefore: string; fingerprintAfter: string; }

function refreshedReason(previous: ReboundReason, result: VerifyResult): ReboundReason {
  if (result.reason) { return result.reason; }
  if (previous.kind === 'gate-failure') {
    return { ...previous, failureReason: undefined, signal: undefined, stdout: result.diagnostic || previous.stdout, stderr: '', error: undefined };
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
  if (previous.kind === 'rebase-conflict') { return { ...previous, diagnostic: result.diagnostic || previous.diagnostic }; }
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
    case 'rebase-conflict': return `Resolve and stage the current conflicts in ${context.worktree}, then git rebase --continue; rerun px review ${context.slug} --submit after Git completes.`;
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

function recoveryDossier(reason: ReboundReason, context: ReboundContext, history: string[], diagnostic: string, why: string, attempts: readonly RepairEvidence[] = [], capturedEvidence?: RecoveryEvidenceRef | null, launchFailure?: LaunchFailure): string {
  const command = reason.kind === 'gate-failure' ? reason.command : reason.kind === 'hook-failure' ? reason.operation || 'Git hook operation' : 'stage recovery';
  const manualNextAction = recoveryManualNextAction(reason, context);
  const lines = [
    `Recovery dossier for ${context.slug}`,
    `Stage: ${reason.kind}`,
    `HEAD: ${context.head || 'not captured'}`,
    `Last action: ${command}`,
    `Failure history: ${history.join(' -> ') || failureFingerprint(reason)}`,
    ...attempts.map((attempt, index) => `Attempt ${index + 1}: ${attempt.strategy}; agent=${attempt.agent}; context=${attempt.context}; HEAD ${attempt.headBefore || 'not captured'} -> ${attempt.headAfter || 'not captured'}; fingerprint ${attempt.fingerprintBefore} -> ${attempt.fingerprintAfter}`),
    ...(launchFailure ? [`Launch failure: ${describeLaunchFailure(launchFailure)}`] : []),
    `Last diagnostic: ${elideBounceOutput(diagnostic || '(no output)')}`,
    reason.kind === 'gate-failure' ? 'Successful checks: none recorded before exhaustion' : 'Successful checks: see verification evidence; the last failure above is the current stop',
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
  const state: ReboundState = { implementer: context.implementer, reason, originalReason: reason, classification: classifyReboundReason(reason, log), diagnostic: firstDiagnostic, originalDiagnostic: firstDiagnostic, history: [failureFingerprint(reason)], launchFailures: 0, attempts: 0, attemptsDetail: [], occurrenceId: context.repairIncidentId ?? globalThis.crypto.randomUUID(), capturedEvidence: context.retainedFailure, slug };
  if (reboundRequiresHuman(state.reason, state.classification)) { return humanOnlyOutcome(state, context, error); }
  const transientOutcome = await retryTransientVerification(state, verify, maxTransientRetries, log);
  if (transientOutcome) { return transientOutcome; }
  // A transient verifier (agent-smoke) exhausted its single retry on an
  // unchanged tree without fixing. A persistent environment failure is not an
  // implementer repair: return it to the human with the exact diagnostic
  // instead of spending the repair budget (TASK-2620 AC4). The lane move and
  // approval withdrawal already happened before the kernel ran, so this only
  // skips the implementer launch. Other transient gates remain fixable and
  // still launch an implementer after their retry.
  if (reboundRequiresHuman(state.reason, state.classification, true)) { return humanOnlyOutcome(state, context, error); }
  const repairOutcome = await runRepairAttempts(state, { context, slug, worktree, startAgent, maxAttempts, maxLaunchRetries, transitionToImplementer, applyAgentFallback, log, error });
  if (repairOutcome) { return repairOutcome; }
  const exhaustion = reboundExhaustion(state.classification, state.attempts, maxAttempts);
  const why = exhaustion === 'human'
    ? 'the fresh structured failure requires human action'
    : exhaustion === 'repair-budget'
      ? `implementer repair budget (${maxAttempts}): attempt budget spent (${state.attempts})`
      : `launcher budget spent (${maxLaunchRetries} session retries; ${state.launchFailures} failed launches)`;
  const dossier = recoveryDossier(state.reason, context, state.history, state.diagnostic, why, state.attemptsDetail, state.capturedEvidence, state.launchFailure);
  error(fmt.status('FAIL', dossier));
  recordRepairTelemetry(context, { strategy: state.attemptsDetail.at(-1)?.strategy || 'fresh-diagnostic', outcome: 'escalate' });
  return { outcome: 'exhausted', attempts: state.attempts, diagnostic: state.diagnostic, classification: state.classification, implementer: state.implementer, dossier, ...outcomeEvidence(state) };
}

export async function rebound(reason: ReboundReason, context: ReboundContext): Promise<ReboundOutcome> {
  const outcome = await reboundImpl(reason, context);
  await recordReboundOutcome({ missionId: context.slug, outcome: outcome.outcome, attempts: outcome.attempts, diagnostic: outcome.diagnostic }, context.log);
  return outcome;
}

interface ReboundState { occurrenceId: string; slug: string; implementer: string; reason: ReboundReason; originalReason: ReboundReason; classification: ReboundClassification; diagnostic: string; originalDiagnostic: string; history: string[]; launchFailures: number; attempts: number; attemptsDetail: RepairEvidence[]; /** Retained evidence of the original failed command, persisted before the first repair launch. */ capturedEvidence?: RecoveryEvidenceRef | null; launchFailure?: LaunchFailure; }

function humanOnlyOutcome(state: ReboundState, context: ReboundContext, error: ReboundContext['error']): ReboundOutcome {
  error?.(fmt.status('FAIL', `${state.classification.label}: ${state.classification.failureClass} (${state.classification.dispatchAction}). Human intervention required — not bouncing.`));
  error?.(fmt.status('FAIL', `Failure output:\n${state.diagnostic || '(no output)'}\n`));
  const dossier = recoveryDossier(state.reason, context, state.history, state.diagnostic, 'the structured failure requires human action', state.attemptsDetail, undefined, state.launchFailure);
  error?.(fmt.status('FAIL', dossier));
  return { outcome: 'human-only', attempts: state.attempts, diagnostic: state.diagnostic, classification: state.classification, implementer: state.implementer, dossier, ...outcomeEvidence(state) };
}

/** Structured evidence every stopped outcome carries. */
function outcomeEvidence(state: ReboundState): Pick<ReboundOutcome, 'attemptsDetail' | 'launchFailure'> {
  return { attemptsDetail: state.attemptsDetail, ...(state.launchFailure ? { launchFailure: state.launchFailure } : {}) };
}

async function retryTransientVerification(state: ReboundState, verify: ReboundContext['verify'], retries: number, log: ReboundContext['log']): Promise<ReboundOutcome | null> {
  for (let attempt = 1;transientRetryAllowed(state.reason, attempt, retries);attempt++) {
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
  state.classification = classifyReboundReason(state.reason, log);
  const fingerprint = failureFingerprint(state.reason);
  state.history.push(fingerprint);
  if (fingerprint !== previous) { log?.(fmt.status('INFO', `Recovery incident changed; reclassified as ${state.classification.failureClass}.`)); }
}

type RepairOptions = Pick<ReboundContext, 'slug' | 'worktree' | 'startAgent' | 'transitionToImplementer' | 'applyAgentFallback'> & { context: ReboundContext; maxAttempts: number; maxLaunchRetries: number; log: NonNullable<ReboundContext['log']>; error: NonNullable<ReboundContext['error']> };

async function runRepairAttempts(state: ReboundState, options: RepairOptions): Promise<ReboundOutcome | null> {
  const { context, slug, worktree, startAgent, maxAttempts, maxLaunchRetries, transitionToImplementer, applyAgentFallback, log, error } = options;
  // Capture the original failure once, before launch, for fresh-context recovery.
  await captureOriginalFailureEvidence(state, worktree, context, log);
  for (let attempt = 1;repairBudgetAllows(attempt, maxAttempts);attempt++) {
    const strategy: RepairStrategy = repairStrategy(attempt);
    let prepared: Awaited<ReturnType<typeof prepareRepairPrompt>>;
    try { prepared = await prepareRepairPrompt(state, context, attempt, maxAttempts); }
    catch (cause) { return stopRepair(state, context, `Repair checkpoint persistence failed before launch: ${String(cause)}`); }
    const { fixPrompt, repairCheckpoint } = prepared;
    if (transitionToImplementer) { await transitionToImplementer(slug); }
    log(fmt.status('INFO', `Bouncing to ${context.role ?? 'implementer'} (${state.implementer}) with ${strategy} ${state.classification.failureClass} repair. Attempt ${attempt}/${maxAttempts}.`));
    const startedAt = Date.now();
    const headBefore = await currentHead(context);
    const fingerprintBefore = failureFingerprint(state.reason);
    const launch = await launchFixAttempt({ startAgent, applyAgentFallback, implementer: state.implementer, fixPrompt, slug, worktree, step: context.step, role: context.role, exclude: context.exclude, sessionPolicy: 'fresh-ephemeral' });
    state.implementer = launch.implementer;
    const blockerOutcome = await repairBlockerOutcome(state, context, prepared, launch);
    if (blockerOutcome) { return blockerOutcome; }
    const launchResult = handleLaunchResult(state, launch, maxLaunchRetries, error);
    if (launchResult === 'retry') { attempt--; continue; }
    if (launchResult === 'skip') { await recordSpentLaunch(state, context, [attempt, maxAttempts], { strategy, headBefore, fingerprintBefore }, startedAt, launch, log); continue; }
    if (launchResult === 'stop') { break; }
    let verified: VerifyResult;
    try {
      const verification = await runCheckpointVerification(context, prepared, attempt);
      verified = verification.verified;
      if (verified.workflowBlock) { return stopRepair(state, context, verified.workflowBlock.diagnostic); }
      const mismatch = differentGateVerification(state.reason, verified, Boolean(repairCheckpoint));
      if (mismatch) {
        return stopRepair(state, context, `Unrelated check ${verified.command} cannot certify ${mismatch.originalCommand}`);
      }
      // Contract escalation is immediate; other fresh human-only failures retain
      // the existing exhaustion path and its attempted-repair evidence.
      if (repairVerificationRequiresHuman(verified.reason)) {
        const detail: RepairEvidence = { strategy, agent: state.implementer, context: 'fresh', headBefore, headAfter: await currentHead(context), fingerprintBefore, fingerprintAfter: failureFingerprint(refreshedReason(state.reason, verified)) };
        state.attemptsDetail.push(detail);
        await recordAttemptTelemetry(state, context, [attempt, maxAttempts], detail, startedAt, launch, verified);
        refreshReboundState(state, verified, log);
        return humanOnlyOutcome(state, context, error);
      }
      await verification.certify();
    } catch (cause) { return stopRepair(state, context, String(cause)); }
    const outcome = await finishVerifiedRepair(state, options, attempt, { strategy, headBefore, fingerprintBefore, startedAt, launch }, verified);
    if (outcome === 'stop') { break; }
    if (outcome) { return outcome; }
  }
  return null;
}

async function recordAttemptTelemetry(state: ReboundState, context: ReboundContext, budget: readonly [attempt: number, maxAttempts: number], detail: RepairEvidence, startedAt: number, launch: { provider: string | null; model: string | null }, verified?: VerifyResult): Promise<void> {
  const [attempt, maxAttempts] = budget;
  const canRetry = attempt < maxAttempts && classifyReboundReason(verified ? refreshedReason(state.reason, verified) : state.reason).isRelaunchable;
  await recordReboundRepair({
    occurrenceId: state.occurrenceId, missionId: state.slug, reasonKind: state.reason.kind, area: reasonArea(state.reason),
    attempt, maxAttempts, role: context.role ?? 'implementer', ...detail, provider: launch.provider, model: launch.model,
    outcome: attemptOutcome(verified?.ok === true, detail.strategy, canRetry), durationMs: Date.now() - startedAt,
  }, context.log);
}

/** Inspect opted-in failed repairs before recording their spent-launch telemetry. */
async function recordSpentLaunch(state: ReboundState, context: ReboundContext, budget: readonly [attempt: number, maxAttempts: number], before: { strategy: RepairStrategy; headBefore: string | null; fingerprintBefore: string }, startedAt: number, launch: { provider: string | null; model: string | null }, log: ReboundContext['log']): Promise<void> {
  if (context.inspectFailedRepair) { refreshReboundState(state, await context.verify(budget[0]), log); }
  const detail: RepairEvidence = { ...before, agent: state.implementer, context: before.strategy === 'fresh-diagnostic' ? 'fresh' : 'resumed', headAfter: await currentHead(context), fingerprintAfter: before.fingerprintBefore };
  await recordAttemptTelemetry(state, context, budget, detail, startedAt, launch);
}

/** Outcome of one verified attempt: pass/rescue when fixed, else advance while budget and relaunchability remain, else escalate. */
function attemptOutcome(ok: boolean, strategy: RepairStrategy, canRetry: boolean): ReboundRepairOutcome {
  if (ok) { return strategy === 'targeted' ? 'pass' : 'rescue'; }
  return canRetry ? 'advance' : 'escalate';
}

/** Gate, hook or role the reason names, for telemetry. */
function reasonArea(reason: ReboundReason): string | null {
  switch (reason.kind) {
    case 'gate-failure': return reason.area;
    case 'hook-failure': return reason.hook;
    case 'artifact-incomplete':
    case 'agent-timeout': return reason.role;
    default: return null;
  }
}

async function currentHead(context: ReboundContext): Promise<string | null> { return await context.readHead?.() ?? context.head ?? null; }

function handleLaunchResult(state: ReboundState, launch: FixLaunch, maxRetries: number, error: ReboundContext['error']): 'verify' | 'retry' | 'skip' | 'stop' {
  if (launch.launchFailure) { state.launchFailure = launch.launchFailure; }
  const action = launchRecoveryAction(launch.ok, launch.repairAttempted, state.attempts, state.launchFailures, maxRetries, launch.deterministic);
  if (action === 'verify') { state.attempts++; return 'verify'; }
  error?.(fmt.status('FAIL', `${state.classification.label}: ${launch.diagnostic}`));
  state.diagnostic = launch.diagnostic;
  if (action === 'skip') { state.attempts++; return 'skip'; }
  state.launchFailures++;
  return action === 'retry' ? 'retry' : 'stop';
}

/** Provider and model the agent run reported, when it did. */
function stopRepair(state: ReboundState, context: ReboundContext, diagnostic: string): ReboundOutcome {
  state.diagnostic = diagnostic;
  state.classification = { ...state.classification, dispatchAction: 'HumanOnly', isRelaunchable: false };
  return humanOnlyOutcome(state, context, context.error);
}

async function repairBlockerOutcome(state: ReboundState, context: ReboundContext, prepared: Awaited<ReturnType<typeof prepareRepairPrompt>>, launch: Awaited<ReturnType<typeof launchFixAttempt>>): Promise<ReboundOutcome | null> {
  const { repairPort, repairCheckpoint } = prepared;
  const { slug } = context;
  let blocker: InvalidContractBlocker | undefined;
  try { blocker = launch.invalidContract ?? (repairCheckpoint ? await repairPort!.readBlocker(slug, repairCheckpoint.name) : undefined); }
  catch (cause) { return stopRepair(state, context, `Cannot read repair blocker: ${String(cause)}`); }
  if (blocker) {
    if (launch.repairAttempted) { state.attempts++; }
    return stopRepair(state, context, JSON.stringify(blocker));
  }
  return null;
}

async function finishVerifiedRepair(state: ReboundState, options: RepairOptions, attempt: number, before: { strategy: RepairStrategy; headBefore: string | null; fingerprintBefore: string; startedAt: number; launch: Awaited<ReturnType<typeof launchFixAttempt>> }, verified: VerifyResult): Promise<ReboundOutcome | 'stop' | null> {
  const { context, maxAttempts, worktree, log, error } = options;
  const { strategy, headBefore, fingerprintBefore, startedAt, launch } = before;
  const detail: RepairEvidence = { strategy, agent: state.implementer, context: 'fresh', headBefore, headAfter: await currentHead(context), fingerprintBefore, fingerprintAfter: verified.ok ? fingerprintBefore : failureFingerprint(refreshedReason(state.reason, verified)) };
  state.attemptsDetail.push(detail);
  await recordAttemptTelemetry(state, context, [attempt, maxAttempts], detail, startedAt, launch, verified);
  if (verified.ok) {
    log(fmt.status('PASS', `${state.classification.label} repaired: the failing check re-ran and passed (attempt ${attempt}/${maxAttempts}).`));
    recordRepairTelemetry(context, { strategy, outcome: 'rescue' });
    return { outcome: 'fixed', attempts: state.attempts, diagnostic: verified.diagnostic || '', classification: state.classification, implementer: state.implementer, attemptsDetail: state.attemptsDetail };
  }
  refreshReboundState(state, verified, log);
  // Persist this failed relaunch as the next attempt in the original incident
  // so the whole recovery series survives a restart, not just the first failure.
  // Do not overwrite state.capturedEvidence: the prompt must still name the
  // original failure, while the retry surfaces via the recent-incident route.
  await captureRetryEvidence(state, worktree, context);
  if (attempt < maxAttempts && state.classification.isRelaunchable) { recordRepairTelemetry(context, { strategy, outcome: 'advance' }); }
  if (reboundRequiresHuman(state.reason, state.classification)) { return 'stop'; }
  error(fmt.status('WARN', `${state.classification.label}: the check still fails after attempt ${attempt}/${maxAttempts}.`));
  return null;
}

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
}): Promise<FixLaunch> {
  const { startAgent, applyAgentFallback, fixPrompt, slug, worktree, step = 'act-on-review', role = 'implementer', exclude = [], sessionPolicy } = options;
  let implementer = options.implementer;
  const none = { provider: null, model: null };
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
    return { ok: false, implementer, diagnostic: `Could not launch ${role} (${implementer}): ${(err as Error).message}`, repairAttempted: false, ...none };
  }

  if (applyAgentFallback) {
    implementer = await applyAgentFallback({ launchResult, original: implementer }) || implementer;
  }

  return launchStatus(launchResult, implementer);
}
