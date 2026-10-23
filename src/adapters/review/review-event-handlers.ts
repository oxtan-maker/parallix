import type { ParallixConfiguration } from "../../application/ports/configuration.js";
/**
 * Review event and maintenance handlers: create events, import legacy
 * state, backfill reviews, and reconcile interrupted handoffs.
 */

import * as fmt from '../../application/presentation/cli-format.js';
import { resolveWorktree } from '../filesystem/mission-utils.js';
import { resolveTaskFile, getTaskStatus } from '../backlog/backlog.js';
import { backfillReviewFromLegacyState, reconcileInterruptedHandoff } from './review-state.js';
import type { MissionStore } from '../../application/domain-ports.js';
import { missionId } from '../../domain/mission.js';
import { flagValue, repeatedFlagValues } from './review-cli-flags.js';

/**
 * `px review <slug> --backfill-review [--dry-run]`
 *
 * Seed the Review aggregate for a mission handed off before the architecture migration
 * cutover, so `px review` can resume it. Reports and writes nothing
 * when the mission already has a Review or has no legacy state to migrate.
 */
export async function backfillReviewHandler(
  slug: string,
  args: string[],
  options: {
    configuration?: ParallixConfiguration;
    log?: (_msg: string) => void;
    error?: (_msg: string) => void;
    exit?: (_code: number) => never;
    resolveWorktreeFn?: typeof resolveWorktree;
    backfillReviewFn?: typeof backfillReviewFromLegacyState;
  } = {}
): Promise<void> {
  const log = options.log || fmt.log.plain;
  const error = options.error || fmt.log.plainError;
  const exit = options.exit || process.exit;
  const resolveWorktreeFn = options.resolveWorktreeFn || resolveWorktree;
  const backfillReviewFn = options.backfillReviewFn || backfillReviewFromLegacyState;

  const apply = !args.includes('--dry-run');
  const worktree = resolveWorktreeFn(slug) || process.cwd();
  const result = await backfillReviewFn(slug, worktree, { apply });

  switch (result.outcome) {
    case 'backfilled':
      log(fmt.status('PASS', `Backfilled review for ${slug}: ${result.rounds} round(s), now at round ${result.round} (${result.phase}).`));
      return;
    case 'would-backfill':
      log(fmt.status('INFO', `Would backfill review for ${slug}: ${result.rounds} round(s), resuming at round ${result.round} (${result.phase}).`));
      log(fmt.status('INFO', 'Dry run — re-run without --dry-run to write.'));
      return;
    case 'events-backfilled':
      log(fmt.status('PASS', `Backfilled ${result.events} review event(s) for ${slug} from its exported review-events files.`));
      return;
    case 'would-backfill-events':
      log(fmt.status('INFO', `Would backfill ${result.events} review event(s) for ${slug} from its exported review-events files.`));
      log(fmt.status('INFO', 'Dry run — re-run without --dry-run to write.'));
      return;
    case 'already-present':
      log(fmt.status('INFO', `Mission ${slug} already has a review; nothing to backfill.`));
      return;
    case 'no-legacy-state':
      log(fmt.status('INFO', `Mission ${slug} has no review-state.json to migrate.`));
      return;
    case 'failed':
      error(fmt.status('FAIL', `Could not backfill review for ${slug}: ${result.diagnostic}`));
      exit(1);
      return;
  }
}

/** Rebuild a missing round-one aggregate from an operator-supplied handoff record. */
export async function reconcileInterruptedHandoffHandler(
  slug: string,
  args: string[],
  options: {
    configuration?: ParallixConfiguration;
    log?: (_msg: string) => void;
    error?: (_msg: string) => void;
    exit?: (_code: number) => never;
    resolveWorktreeFn?: typeof resolveWorktree;
    resolveTaskFileFn?: typeof resolveTaskFile;
    getTaskStatusFn?: typeof getTaskStatus;
    reconcileInterruptedHandoffFn?: typeof reconcileInterruptedHandoff;
    missionStore?: MissionStore | null;
  } = {},
): Promise<void> {
  const log = options.log || fmt.log.plain;
  const error = options.error || fmt.log.plainError;
  const exit = options.exit || process.exit;
  const worktree = (options.resolveWorktreeFn || resolveWorktree)(slug) || process.cwd();
  // The Mission status is the sole authority for reconciliation: a completed
  // native Mission carries no Backlog task file marked review, so the retired
  // task-file check is replaced by the operator-database lane status. The
  // recovery command rebuilds the missing round-one Review in the store without
  // recreating any legacy file.
  const reconcilable = await isReconcilableMission(slug, options.missionStore);
  if (!reconcilable) {
    error(fmt.status('FAIL', `Cannot reconcile ${slug}: no Mission in the operator database is in the review lane. Restore the Mission to review, then retry.`));
    exit(1);
    return;
  }
  const result = await (options.reconcileInterruptedHandoffFn || reconcileInterruptedHandoff)(slug, reconciliationInputs(args), worktree, { missionStore: options.missionStore });
  if (result.outcome === 'reconciled') {
    log(fmt.status('PASS', `Reconciled round-one review for ${slug}. Re-run px review ${slug} to launch the reviewer.`));
    return;
  }
  if (result.outcome === 'already-present') {
    log(fmt.status('INFO', `Mission ${slug} already has a valid Review aggregate; nothing to reconcile.`));
    return;
  }
  error(fmt.status('FAIL', `Cannot reconcile ${slug}: ${result.diagnostic}`));
  exit(1);
}

/**
 * Whether a slug is reconcilable.
 *
 * The operator database holding the Mission in the `review` lane is the only
 * authority `--reconcile-review` accepts. This replaces the retired Backlog
 * task-file check so a completed native Mission with no task file can be
 * recovered. A store read failure is not reconcilable: the loop keeps failing
 * closed rather than inventing a round-one Review behind the operator's back.
 *
 * @param {string} slug
 * @param {MissionStore|null|undefined} store
 */
async function isReconcilableMission(slug: string, store: MissionStore | null | undefined): Promise<boolean> {
  if (!store) { return false; }
  try {
    const loaded = await store.load(missionId(slug));
    return loaded.kind === 'found' && loaded.mission.status === 'review';
  } catch {
    return false;
  }
}

function reconciliationInputs(args: string[]) {
  return {
    sourceBranch: flagValue(args, '--branch') || '',
    targetBranch: flagValue(args, '--target') || '',
    reviewer: flagValue(args, '--reviewer') || '',
    implementer: flagValue(args, '--implementer') || '',
    revision: flagValue(args, '--revision') || '',
    eligibleReviewers: repeatedFlagValues(args, '--eligible-reviewer'),
    startedAt: new Date().toISOString(),
  };
}
