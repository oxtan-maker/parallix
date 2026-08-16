/**
 * Pre-review Gate Handling (ADR 0048 Control C1 / architecture migration)
 *
 * Owns pre-review verification-gate execution, failure classification, and the
 * bounded auto-bounce back to the implementer. Extracted from `review-loop.ts`
 * so the loop keeps orchestration only.
 */

import * as fmt from '../../application/presentation/cli-format.js';
import { elideBounceOutput } from '../../application/output-elision.js';
import { run } from '../git/git.js';
import { findMissionDir, findMissionArea } from '../filesystem/mission-utils.js';
import { formatVerificationCommand, resolveEffectiveArea } from '../verification/verification.js';
import { enforceTaskAssignee, transitionTask } from '../backlog/backlog.js';
import { readReviewState, writeReviewState, persistReviewStateOrThrow } from './review-state.js';
import type { MissionStore } from '../../application/domain-ports.js';
import { startAgent } from '../agents/agents.js';
import { delay } from './review-polling.js';
import { buildCompactActOnReviewPrompt } from './review-prompts.js';
import * as repairHandoffModule from '../cli/commands/repair-handoff.js';
import { applyAgentFallback } from './review-agent-fallback.js';

export const DEFAULT_MAX_ATTEMPTS = 5;
export const CONTINUE_SKIP_CHECK_TIMEOUT_MS = 10_000;

export function strictlyLaterIso(earlierIso: string, nowMs = Date.now()): string {
  const earlierMs = Date.parse(earlierIso);
  if (!Number.isFinite(earlierMs)) {
    return new Date(nowMs).toISOString();
  }
  return new Date(Math.max(nowMs, earlierMs + 1)).toISOString();
}

export function classifyGateFailure(output: string): { classification: string; action: string; isRelaunchable: boolean } {
  const { failureClass, dispatchAction } = repairHandoffModule.classifyError(output);
  return {
    classification: failureClass,
    action: dispatchAction,
    isRelaunchable: dispatchAction !== 'HumanOnly',
  };
}

export interface PreReviewGateResult {
  ok: boolean;
  area: string;
  command: string;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  error?: string;
}

export const NO_GATE_NOTICE_ALIAS = ': # no verification gate configured (set adapters.verification.command)';

/**
 * Run the verification gate with the mission area before a review round.
 * Captures stdout/stderr for use in auto-bounce fix prompts.
 */
export async function runPreReviewGate(
  slug: string,
  worktree: string,
  opts: {
    resolveEffectiveAreaFn?: typeof resolveEffectiveArea;
    findMissionAreaFn?: typeof findMissionArea;
    runFn?: typeof run;
    log?: (_msg: string) => void;
    error?: (_msg: string) => void;
  } = {}
): Promise<PreReviewGateResult> {
  const {
    resolveEffectiveAreaFn = resolveEffectiveArea,
    findMissionAreaFn,
    runFn: runFnOverride = run,
    log = fmt.log.plain,
    error = fmt.log.plainError,
  } = opts;

  const missionDir = findMissionDir(slug, worktree);
  // findMissionAreaFn remains injectable for existing callers/tests. Normal
  // runtime selection is diff-scoped through resolveEffectiveArea.
  const area = findMissionAreaFn && missionDir
    ? findMissionAreaFn(missionDir)
    : resolveEffectiveAreaFn(undefined, worktree, missionDir);
  const command = formatVerificationCommand(area, worktree, missionDir);

  if (command === NO_GATE_NOTICE_ALIAS) {
    log(fmt.status('INFO', `No verification gate configured for area ${area}; skipping pre-review gate check.`));
    return { ok: true, area, command, exitCode: 0, stdout: '', stderr: '' };
  }

  log(fmt.status('INFO', `Pre-review gate for area "${area}": ${fmt.command(command)}`));

  // Run with pipe mode to capture output for auto-bounce fix prompts.
  const result = runFnOverride('bash', ['-lc', command], {
    cwd: worktree,
    stdio: 'pipe',
    maxBuffer: 10 * 1024 * 1024, // 10MB buffer
  });

  const stdout = typeof result.stdout === 'string' ? result.stdout : '';
  const stderr = typeof result.stderr === 'string' ? result.stderr : '';

  if (result.status !== 0) {
    error(fmt.status('FAIL', `Pre-review gate failed for area "${area}" (exit ${result.status}).`));
    if (stderr) {
      error(`  stderr: ${stderr.split('\n').slice(0, 10).join('\n  ')}`);
    }
    return {
      ok: false,
      area,
      command,
      exitCode: result.status,
      stdout,
      stderr,
      error: `verification gate failed with exit code ${result.status}`,
    };
  }

  log(fmt.status('PASS', `Pre-review gate passed for area "${area}".`));
  return { ok: true, area, command, exitCode: 0, stdout, stderr };
}

/**
 * Handle a pre-review gate failure by auto-bouncing to the implementer.
 * Does NOT consume a reviewer cycle or transition the task out of review status.
 * Tracks retry count in review state metadata.
 * Returns true if bounced, false if retry limit exceeded (mission strands).
 */
export async function handleGateFailureAutoBounce(
  slug: string,
  worktree: string,
  gateResult: PreReviewGateResult,
  implementer: string,
  opts: {
    startAgentFn?: typeof startAgent;
    writeReviewStateFn?: typeof writeReviewState;
    readReviewStateFn?: typeof readReviewState;
    transitionTaskFn?: typeof transitionTask;
    applyAgentFallbackFn?: typeof applyAgentFallback;
    taskResolution?: { ok: boolean; taskFile?: string };
    enforceTaskAssigneeFn?: typeof enforceTaskAssignee;
    log?: (_msg: string) => void;
    error?: (_msg: string) => void;
    sleepFn?: typeof delay;
    buildCompactActOnReviewPromptFn?: typeof buildCompactActOnReviewPrompt;
    isForgejoReviewEnabledFn?: ((_rootDir?: string) => boolean) | null;
    isReviewProviderEnabledFn?: ((_rootDir?: string) => boolean) | null;
    legacyIsForgejoReviewEnabledFn?: ((_rootDir?: string) => boolean) | null;
    exit?: (_code: number) => never;
    missionStore?: MissionStore | null;
  } = {}
): Promise<{ bounced: boolean; stranded: boolean }> {
  const {
    startAgentFn = startAgent,
    writeReviewStateFn = writeReviewState,
    readReviewStateFn = readReviewState,
    transitionTaskFn = transitionTask,
    applyAgentFallbackFn = applyAgentFallback,
    taskResolution,
    enforceTaskAssigneeFn,
    log = fmt.log.plain,
    error = fmt.log.plainError,
    sleepFn: _sleepFn = delay,
    buildCompactActOnReviewPromptFn: _buildCompactActOnReviewPromptFn = buildCompactActOnReviewPrompt,
    isForgejoReviewEnabledFn: _isForgejoReviewEnabledFn,
    isReviewProviderEnabledFn: _isReviewProviderEnabledFn,
    legacyIsForgejoReviewEnabledFn: _legacyIsForgejoReviewEnabledFn,
    exit: _exit = process.exit,
    missionStore = null,
  } = opts;

  const MAX_GATE_RETRY = 2;
  const diagnosticOutput = [gateResult.stdout, gateResult.stderr, gateResult.error].filter(Boolean).join('\n');
  const isHookFailure = /pre-commit|pre-push|post-commit|hook.*(failed|failure|error)/i.test(diagnosticOutput);
  const retryMetadataKey = isHookFailure ? 'hookFailureRetryCount' : 'gateFailureRetryCount';
  const failureLabel = isHookFailure ? 'GIT HOOK FAILURE' : 'PRE-REVIEW GATE FAILURE';

  // Read persisted state to get current retry count
  const persisted = await Promise.resolve(readReviewStateFn(slug, worktree));
  const retryCount = persisted && persisted.metadata && typeof persisted.metadata === 'object'
    ? (Number((persisted.metadata as any)[retryMetadataKey]) || 0)
    : 0;

  if (retryCount >= MAX_GATE_RETRY) {
    error(fmt.status('FAIL', `${failureLabel}: max retries exceeded (${MAX_GATE_RETRY}). Mission stranded for ${slug}.`));
    error(fmt.status('FAIL', `${isHookFailure ? 'Git hook' : `Area "${gateResult.area}" verification`} failed ${retryCount} times. Human intervention required.`));
    error(fmt.status('FAIL', `Gate output:\n${gateResult.stdout || gateResult.stderr || '(no output)'}\n`));
    return { bounced: false, stranded: true };
  }

  // Classify the failure
  const diagnosticClassification = isHookFailure
    ? { classification: 'GitHookFailure', action: 'RelaunchImplementer', isRelaunchable: true }
    : classifyGateFailure(diagnosticOutput);
  // A non-zero gate exit is authoritative evidence of a genuine verification
  // failure. Arbitrary test/linter diagnostics have no classifier keyword and
  // default to InfraBlocker, which used to strand a repairable mission. Keep
  // the ADR's genuine human-only exceptions, however: a recognized provider,
  // network, authentication, or state-machine diagnostic must not be hidden
  // by the generic gate-failure marker.
  const hasExplicitHumanOnlyDiagnostic = diagnosticClassification.action === 'HumanOnly'
    && /state\s+violation|invalid\s+state|transition\s+not\s+allowed|cannot\s+(move|transition)\s+(from|to)\s+\w+\s+(to|from)|forgejo|infrastructure|authentication\s+failed|token\s+(expired|invalid|missing)|forbidden|unauthorized\s+(access|request)|rate\s+limit|connection\s+(refused|timed?\s*out)|network\s+error/i.test(diagnosticOutput);
  // A declared gate that has actually run and exited non-zero is a bounded
  // workflow blocker: retry its implementer repair through the AutoRepair
  // route. Keep explicit infrastructure and state-machine diagnostics human
  // only, because their remedy is outside the implementer's working tree.
  const classification = hasExplicitHumanOnlyDiagnostic
    ? diagnosticClassification
    : isHookFailure
      ? diagnosticClassification
      : { classification: 'GitBlockers', action: 'AutoRepair', isRelaunchable: true };

  log(fmt.status('WARN', `Pre-review gate failed for area "${gateResult.area}" (exit ${gateResult.exitCode}). Classification: ${classification.classification}.`));

  // ADR 0048 C6: InfraBlocker and StateMachineViolation are HumanOnly — do not
  // auto-bounce to implementer; surface for human intervention.
  if (!classification.isRelaunchable) {
    error(fmt.status('FAIL', `Pre-review gate failure: ${classification.classification} (${classification.action}). Human intervention required — not auto-bouncing.`));
    error(fmt.status('FAIL', `Gate output:\n${gateResult.stdout || gateResult.stderr || '(no output)'}\n`));
    return { bounced: false, stranded: true };
  }

  // Build fix prompt with captured gate output
  const fixPrompt = [
    `${failureLabel} — FIX REQUIRED`,
    ``,
    `Mission: ${slug}`,
    `Area: ${gateResult.area}`,
    `Gate command: ${gateResult.command}`,
    `Exit code: ${gateResult.exitCode}`,
    ``,
    `Gate output (use this to diagnose and fix):`,
    `---`,
    elideBounceOutput(gateResult.stdout || '(no stdout)'),
    `---`,
    elideBounceOutput(gateResult.stderr || '(no stderr)'),
    `---`,
    ``,
    `Classification: ${classification.classification} — ${classification.action}`,
    `Retry attempt: ${retryCount + 1}/${MAX_GATE_RETRY}`,
    ``,
    `Before repair work, compact the aborted working context. Reload the locked mission goal and scope; committed checkpoint or gate evidence when present; this exact gate diagnostic and classification; retry attempt ${retryCount + 1}/${MAX_GATE_RETRY}; current review round and disposition; unresolved findings and implementer resolutions; and the current branch revision.`,
    ``,
    isHookFailure
      ? `Fix the underlying issue so the Git hook passes when Parallix commits or rebases this mission.`
      : `Fix the underlying issue so the verification gate passes for area "${gateResult.area}".`,
    `After fixing, restart the review loop; it will re-run the rebase and gate before the next review round.`,
  ].join('\n');

  // Increment retry count in metadata
  const metadata = persisted && persisted.metadata && typeof persisted.metadata === 'object'
    ? { ...persisted.metadata }
    : {};
  metadata[retryMetadataKey] = retryCount + 1;

  // Update review state with incremented retry count
  if (persisted) {
    const updatedState = { ...persisted, metadata };
    await persistReviewStateOrThrow(writeReviewStateFn, slug, updatedState as any, worktree, missionStore);
  } else {
    await persistReviewStateOrThrow(writeReviewStateFn, slug, { metadata } as any, worktree, missionStore);
  }

  // Transition task back to active (implementer phase) without consuming reviewer cycle
  await transitionTaskFn(slug, 'active', { rootDir: worktree, log });
  log(fmt.status('INFO', `Auto-bouncing to implementer (${implementer}) with fix prompt. Retry ${retryCount + 1}/${MAX_GATE_RETRY}.`));

  // Launch implementer with the fix prompt
  try {
    const launchResult = await startAgentFn('act-on-review', {
      agent: implementer,
      prompt: (_actualImplementer: string) => fixPrompt,
      worktree,
      slug,
      role: 'implementer',
      exclude: [],
    });

    // Apply any agent fallback if needed
    implementer = await applyAgentFallbackFn({
      role: 'implementer',
      original: implementer,
      launchResult,
      state: persisted || {},
      slug,
      worktree,
      taskResolution,
      log,
      writeReviewStateFn,
      enforceTaskAssigneeFn,
      missionStore,
    });
  } catch (err: unknown) {
    error(fmt.status('FAIL', `Could not relaunch implementer (${implementer}) for gate failure auto-bounce: ${(err as Error).message}`));
    return { bounced: false, stranded: true };
  }

  log(fmt.status('INFO', `Implementer (${implementer}) relaunched with gate failure fix prompt.`));
  return { bounced: true, stranded: false };
}
