/**
 * Pre-review Gate Handling (ADR 0048 Control C1 / architecture migration)
 *
 * Owns pre-review verification-gate execution and the mapping of a pre-review
 * failure onto the rebound kernel. Classification, fix prompt, launch, verify
 * loop, and attempt budget all live in `src/application/rebound-kernel.ts`
 * (TASK-2377.03); this module contributes structured reasons and collaborators
 * only, so the review loop keeps orchestration.
 */

import * as fmt from '../../application/presentation/cli-format.js';
import {
  rebound,
  type GateFailureReason,
  type HookFailureReason,
  type ReboundContext,
  type ReboundOutcome,
  type VerifyResult,
} from '../../application/rebound-kernel.js';
import { classifyHookFailure } from '../../application/hook-failure-workflow.js';
import { run } from '../git/git.js';
import { findMissionDir, findMissionArea } from '../filesystem/mission-utils.js';
import { formatVerificationCommand, resolveEffectiveArea } from '../verification/verification.js';
import { enforceTaskAssignee, transitionTask } from '../backlog/backlog.js';
import { readReviewState, writeReviewState } from './review-state.js';
import type { MissionStore } from '../../application/domain-ports.js';
import { startAgent } from '../agents/agents.js';
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


/** Structured gate-failure reason for the rebound kernel. */
export function gateFailureReason(gateResult: PreReviewGateResult): GateFailureReason {
  return {
    kind: 'gate-failure',
    area: gateResult.area,
    command: gateResult.command,
    exitCode: gateResult.exitCode,
    stdout: gateResult.stdout,
    stderr: gateResult.stderr,
    error: gateResult.error,
  };
}

/**
 * Structured hook-failure reason for the rebound kernel.
 *
 * The hook identity is resolved from the rejected Git operation's output.
 * TASK-2377.02 (in-process pre-review rebase with typed hook evidence) is not
 * on this branch's base, so the pre-review rebase still returns text output;
 * the kernel's own classification never re-derives the failure kind from it.
 */
export function hookFailureReason(hookOutput: string, operation: string): HookFailureReason {
  return {
    kind: 'hook-failure',
    hook: classifyHookFailure(hookOutput).hookType,
    operation,
    output: hookOutput,
  };
}

export interface ReboundPreReviewOptions {
  /** Re-runs the failing check; a bounce is `fixed` only when this passes. */
  verifyFn: (_attempt: number) => Promise<VerifyResult> | VerifyResult;
  startAgentFn?: typeof startAgent;
  writeReviewStateFn?: typeof writeReviewState;
  readReviewStateFn?: typeof readReviewState;
  transitionTaskFn?: typeof transitionTask;
  applyAgentFallbackFn?: typeof applyAgentFallback;
  taskResolution?: { ok: boolean; taskFile?: string };
  enforceTaskAssigneeFn?: typeof enforceTaskAssignee;
  log?: (_msg: string) => void;
  error?: (_msg: string) => void;
  maxAttempts?: number;
  missionStore?: MissionStore | null;
}

export interface ReboundPreReviewResult {
  /** True when the kernel verified a fix: the failing check re-ran and passed. */
  bounced: boolean;
  /** True when the occurrence exhausted its budget or is human-only. */
  stranded: boolean;
  outcome: ReboundOutcome['outcome'];
  /** Launch attempts consumed by this occurrence (the per-round cap counts them). */
  attempts: number;
  diagnostic: string;
  implementer: string;
}

/**
 * Route a pre-review failure through the rebound kernel.
 *
 * This adapter owns no classification, no prompt text, and no launch: it maps
 * the review loop's collaborators onto the kernel context and maps the kernel
 * outcome back onto the loop's bounced/stranded decision. The per-occurrence
 * budget lives in the kernel, so no retry counter is read or written here.
 */
export async function reboundPreReviewFailure(
  slug: string,
  worktree: string,
  reason: GateFailureReason | HookFailureReason,
  implementer: string,
  opts: ReboundPreReviewOptions,
): Promise<ReboundPreReviewResult> {
  const {
    verifyFn,
    startAgentFn = startAgent,
    writeReviewStateFn = writeReviewState,
    readReviewStateFn = readReviewState,
    transitionTaskFn = transitionTask,
    applyAgentFallbackFn = applyAgentFallback,
    taskResolution,
    enforceTaskAssigneeFn,
    log = fmt.log.plain,
    error = fmt.log.plainError,
    maxAttempts,
    missionStore = null,
  } = opts;

  if (typeof verifyFn !== 'function') {
    throw new Error('reboundPreReviewFailure requires a verify callback: a bounce may only be reported fixed when the failing check re-runs and passes.');
  }

  const persisted = await Promise.resolve(readReviewStateFn(slug, worktree));

  const outcome = await rebound(reason, {
    slug,
    worktree,
    implementer,
    maxAttempts,
    verify: verifyFn,
    startAgent: startAgentFn as unknown as ReboundContext['startAgent'],
    transitionToImplementer: async (missionSlug: string) => {
      await transitionTaskFn(missionSlug, 'active', { rootDir: worktree, log });
    },
    applyAgentFallback: async ({ launchResult, original }) => await applyAgentFallbackFn({
      role: 'implementer',
      original,
      launchResult: launchResult as any,
      state: (persisted || {}) as any,
      slug,
      worktree,
      taskResolution,
      log,
      writeReviewStateFn,
      enforceTaskAssigneeFn,
      missionStore,
    }),
    log,
    error,
  });

  return {
    bounced: outcome.outcome === 'fixed',
    stranded: outcome.outcome !== 'fixed',
    outcome: outcome.outcome,
    attempts: outcome.attempts,
    diagnostic: outcome.diagnostic,
    implementer: outcome.implementer,
  };
}
