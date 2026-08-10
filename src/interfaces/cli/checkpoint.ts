import * as fmt from '../../application/presentation/cli-format.js';
import type { CheckpointResult } from '../../application/checkpoint-command-use-case.js';

/** Parse public CLI flags for the checkpoint command. */
export interface CheckpointCliRequest {
  /** Explicit slug argument, or undefined for inferred slug. */
  readonly explicitSlug?: string;
  /** Checkpoint name (e.g. CP-1.md). */
  readonly cpName: string;
  /** Next action description. */
  readonly nextAction: string;
}

/** Parse checkpoint CLI args without consulting filesystem or adapter state.
 * Accepts 2 or 3 positional args: [<slug>] <cp-name> "<next-action>".
 * When 2 args provided, slug is left to the use case to infer from context. */
export function parseCheckpointCliRequest(args: string[]): CheckpointCliRequest {
  const positional = args.filter(a => !a.startsWith('--'));

  if (positional.length < 2 || positional.length > 3) {
    throw new Error('Usage: node parallix checkpoint [<slug>] <cp-name> "<next-action>"');
  }

  if (positional.length === 3) {
    return { explicitSlug: positional[0], cpName: positional[1], nextAction: positional[2] };
  }
  // 2 args: slug inferred by use case from context
  return { explicitSlug: undefined, cpName: positional[0], nextAction: positional[1] };
}

/** Render checkpoint result and return exit code. */
export function renderCheckpoint(result: CheckpointResult, _slug: string, log: (_msg: string) => void): number {
  // Narrow on the `reason` discriminant: unlike `result.ok`, it narrows the
  // union under the test tsconfig, which does not enable strictNullChecks.
  if (!('reason' in result)) {
    log(fmt.status('PASS', 'Checkpoint complete (local-only — branch not pushed to origin).'));
    return 0;
  }

  switch (result.reason) {
    case 'verification-failure':
      log(fmt.status('FAIL', `Verification gate failed for area: ${fmt.bold(result.area)}. Fix errors and retry ${fmt.command(result.command)}.`));
      return 1;
    case 'ignored-files':
      log(fmt.status('FAIL', `Checkpoint refused: source files are ignored and would be absent from the commit: ${result.ignoredFiles.join(', ')}. Fix .gitignore or add the intended files explicitly, then retry.`));
      return 1;
    case 'commit-failure':
      log(fmt.status('FAIL', 'Commit failed.'));
      return 1;
    case 'mission-not-found':
      log(fmt.status('FAIL', `Mission directory not found for slug: ${fmt.slug(result.slug)}`));
      return 1;
    case 'lifecycle-rejection':
      log(fmt.status('FAIL', `Checkpoint rejected: ${result.rejectionReason}`));
      return 1;
  }
}

/** Render checkpoint progress line for a given step. */
export function renderCheckpointProgress(step: number, label: string, log: (_msg: string) => void): void {
  log(fmt.status('INFO', `Step ${step}: ${label}`));
}

export interface CheckpointCommandOptions {
  readonly exitFn?: (_code?: number) => never;
  readonly logFn?: (_msg: string) => void;
  readonly errorFn?: (_msg: string) => void;
}

/** Create the checkpoint CLI command that delegates to the use case. */
export function createCheckpointCommand(useCase: { execute: (_request: { explicitSlug: string | null; cpName: string; nextAction: string }, _onProgress?: (_event: any) => void) => Promise<CheckpointResult> }) {
  return async (args: string[], options: CheckpointCommandOptions = {}) => {
    const errorFn = options.errorFn || fmt.log.plainError;
    const exitFn = options.exitFn || process.exit;
    const logFn = options.logFn || fmt.log.plain;

    let parsed: CheckpointCliRequest;
    try {
      parsed = parseCheckpointCliRequest(args);
    } catch (error) {
      errorFn(fmt.status('FAIL', (error as Error).message));
      exitFn(1);
      return;
    }

    // Pass structured request to use case (not raw argv — SC3)
    const request = {
      explicitSlug: parsed.explicitSlug ?? null,
      cpName: parsed.cpName,
      nextAction: parsed.nextAction,
    };

    // Execute use case with progress callback for CLI rendering
    const result = await useCase.execute(request, (event) => {
      if (event.type === 'start') {
        // Render start line with resolved slug (not '(inferred)')
        logFn(fmt.status('INFO', `Running checkpoint for mission: ${fmt.slug(event.slug || parsed.explicitSlug || '(inferred)')}, checkpoint: ${fmt.bold(event.checkpointName || parsed.cpName)}`));
      } else if (event.type === 'verification-pass') {
        logFn(fmt.status('PASS', event.label));
      } else {
        renderCheckpointProgress(event.step, event.label, logFn);
      }
    });

    // Render result (includes PASS/FAIL line)
    const exitCode = renderCheckpoint(result, parsed.explicitSlug || '', logFn);
    exitFn(exitCode);
  };
}
