/**
 * Pre-review Gate Handling (ADR 0048 Control C1)
 *
 * Runs the pre-review verification gate and maps gate and Git-hook failures
 * onto the structured rebound-kernel reasons. Whether and how a failure is
 * repaired is decided by `src/application/review-loop/pre-review.ts`.
 */

import * as fmt from '../../application/presentation/cli-format.js';
import type { GateFailureReason, HookFailureReason } from '../../application/rebound-kernel.js';
import { classifyHookFailure } from '../../application/hook-failure-workflow.js';
import { run } from '../git/git.js';
import { findMissionDir, findMissionArea } from '../filesystem/mission-utils.js';
import { formatVerificationCommand, isTransientVerificationFailure, resolveEffectiveArea } from '../verification/verification.js';

/** How long a --continue skip-check waits for an existing disposition. */
export const CONTINUE_SKIP_CHECK_TIMEOUT_MS = 10_000;

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
    ...(isTransientVerificationFailure(gateResult) ? { transient: true } : {}),
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
