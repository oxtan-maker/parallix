import * as fmt from '../../application/presentation/cli-format.js';
import type { Capability } from '../../application/contracts.js';
import type { BoardCommandDispatcher } from '../../application/controller/board-command.js';
import type { MissionCancelResult } from '../../application/mission-cancel-service.js';

export interface CancelCliRequest {
  readonly slug: string;
  /** `--yes`: the CLI's explicit confirmation. Nothing is deleted without it. */
  readonly confirmed: boolean;
}

/** Parse public CLI flags without consulting filesystem or adapter state. */
export function parseCancelCliRequest(args: string[]): CancelCliRequest {
  const positional: string[] = [];
  let confirmed = false;
  for (const arg of args) {
    if (arg === '--yes') { confirmed = true; }
    else if (arg.startsWith('--')) { throw new Error(`Unknown cancel option: ${arg}`); }
    else { positional.push(arg); }
  }
  if (positional.length !== 1) {
    throw new Error('px cancel requires exactly one mission slug: px cancel <slug> --yes');
  }
  return { slug: positional[0].toLowerCase(), confirmed };
}

/**
 * `px cancel <slug> --yes` — the scriptable entry to the same `mission:cancel`
 * board command the TUI and the web board dispatch. Without `--yes` it prints
 * what cancellation destroys and exits non-zero, having touched nothing.
 */
export function createCancelCommand(
  dispatcher: BoardCommandDispatcher,
  logFn: (_message: string) => void = fmt.log.plain,
  exitFn: (_code: number) => void = (code) => { process.exitCode = code; },
) {
  return async (args: string[]) => {
    const request = parseCancelCliRequest(args);
    if (!request.confirmed) {
      logFn(fmt.status('FAIL', `Refusing to cancel ${fmt.slug(request.slug)} without confirmation.`));
      logFn(`Cancelling deletes this mission's lifecycle rows — lanes, checkpoints, review rounds, findings and session markers — and cannot be undone.`);
      logFn(`Recorded usage statistics are kept, and the git branch and worktree stay for you to remove.`);
      logFn(`Re-run with: px cancel ${request.slug} --yes`);
      exitFn(1);
      return 1;
    }
    const outcome = await dispatcher.dispatch<MissionCancelResult>({
      operationId: `cancel-${Date.now()}`,
      kind: 'mission:cancel',
      missionId: request.slug,
      capabilities: new Set(['mission:cancel' as Capability] as const),
    });
    if (outcome.status !== 'completed' || outcome.value === undefined) {
      logFn(fmt.status('FAIL', outcome.error?.message ?? `mission:cancel for ${request.slug} did not complete.`));
      exitFn(1);
      return 1;
    }
    logFn(fmt.status('PASS', `Cancelled ${fmt.slug(request.slug)}: its lifecycle rows are gone.`));
    logFn(outcome.value.taskArchived
      ? `Its task file is archived, so the card has left the board.`
      : `No task file resolved for ${request.slug}; nothing was archived.`);
    logFn(`Usage statistics for ${request.slug} are preserved.`);
    logFn(`Remove the git side yourself when you are ready:`);
    logFn(`  ${outcome.value.cleanupCommand}`);
    exitFn(0);
    return 0;
  };
}
