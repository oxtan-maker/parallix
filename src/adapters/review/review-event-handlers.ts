import type { ParallixConfiguration } from "../../application/ports/configuration.js";
/**
 * Review event and maintenance handlers: create events, import legacy
 * state, backfill reviews, and reconcile interrupted handoffs.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as fmt from '../../application/presentation/cli-format.js';
import { resolveWorktree } from '../filesystem/mission-utils.js';
import { resolveTaskFile, getTaskStatus } from '../backlog/backlog.js';
import { readReviewState, resolveReviewIdentity, backfillReviewFromLegacyState, reconcileInterruptedHandoff } from './review-state.js';
import type { MissionStore } from '../../application/domain-ports.js';
import { missionId } from '../../domain/mission.js';
import { type ReviewItemDisposition, type ReviewFindingId } from '../../domain/review.js';
import { createEvent, ALL_EVENT_TYPES, isValidEventType, shouldMirrorToProvider } from './review-events.js';
import { flagValue, repeatedFlagValues } from './review-cli-flags.js';

const EVENT_ITEM_LISTS: ReadonlyArray<readonly [RegExp, ReviewItemDisposition['kind']]> = [
  [/fixed_items:\s*(\[[^\]]*\])/i, 'fixed'],
  [/pushed_back_items:\s*(\[[^\]]*\])/i, 'pushed_back'],
  [/parked_items:\s*(\[[^\]]*\])/i, 'parked'],
];

/**
 * Lift the structured item dispositions and blocked reason out of an event body
 * onto `params`. A malformed list is skipped, never fatal: the event body is
 * agent-authored, and a half-parsed list must not lose the event itself.
 */
function applyStructuredEventFields(content: string, params: Record<string, unknown>): void {
  if (!content.includes('fixed_items:') && !content.includes('fixedItems:')) { return; }
  const itemDispositions: ReviewItemDisposition[] = [];
  for (const [pattern, kind] of EVENT_ITEM_LISTS) {
    try {
      const match = content.match(pattern);
      if (!match) { continue; }
      for (const id of JSON.parse(match[1]) as string[]) {
        itemDispositions.push({ kind, findingId: id as ReviewFindingId });
      }
    } catch (_) { /* a malformed list is skipped, not fatal */ }
  }
  const blocked = content.match(/blocked_reason:\s*"([^"]*)"/i);
  if (blocked) { params.blockedReason = blocked[1]; }
  if (itemDispositions.length > 0) { params.itemDispositions = itemDispositions; }
}

/**
 * Parse and validate the `--create-event` flags. Returns null once a diagnostic
 * has been reported and the exit code set, so the caller only has to return.
 */
function parseCreateEventArgs(
  args: string[],
  log: (_msg: string) => void,
  error: (_msg: string) => void,
  exit: (_code: number) => void,
): { eventType: string; actor: string | null; content: string; params: Record<string, unknown> } | null {
  const fail = (message: string) => { error(fmt.status('FAIL', message)); exit(1); return null; };
  const eventType = flagValue(args, '--type');
  if (!eventType) { return fail('--create-event requires --type <classification>'); }
  if (!isValidEventType(eventType)) {
    return fail(`Invalid event type "${eventType}". Valid: ${(ALL_EVENT_TYPES as unknown as string[]).join(', ')}`);
  }

  const inputFile = flagValue(args, '--input-file');
  let content = '';
  if (inputFile) {
    try {
      content = fs.readFileSync(inputFile, 'utf8');
      log(fmt.status('INFO', `Read event content from: ${inputFile}`));
    } catch (err) {
      return fail(`Failed to read input file: ${(err as Error).message}`);
    }
  }

  const roundRaw = flagValue(args, '--round');
  const round = roundRaw ? parseInt(roundRaw, 10) : undefined;
  if (roundRaw && Number.isNaN(round!)) { return fail(`--round must be a number, got "${roundRaw}"`); }

  const actor = flagValue(args, '--actor');
  const params: Record<string, unknown> = { content };
  if (round !== undefined) { params.round = round; }
  for (const [flag, key] of [['--phase', 'phase'], ['--actor', 'actor'], ['--disposition', 'disposition'], ['--verdict', 'verdict']] as const) {
    const value = flagValue(args, flag);
    if (value) { params[key] = value; }
  }
  return { eventType, actor, content, params };
}

export async function createEventHandler(
  slug: string,
  args: string[],
  options: {
    configuration?: ParallixConfiguration;
    log?: (_msg: string) => void;
    error?: (_msg: string) => void;
    exit?: (_code: number) => never;
    resolveWorktreeFn?: typeof resolveWorktree;
    readReviewStateFn?: typeof readReviewState;
  } = {}
): Promise<void> {
  const log = options.log || fmt.log.plain;
  const error = options.error || fmt.log.plainError;
  const exit = options.exit || process.exit;
  const resolveWorktreeFn = options.resolveWorktreeFn || resolveWorktree;

  const parsed = parseCreateEventArgs(args, log, error, exit);
  if (!parsed) { return; }
  const { eventType, actor, content, params } = parsed;

  const worktree = resolveWorktreeFn(slug) || process.cwd();

  const readReviewStateFn = options.readReviewStateFn || readReviewState;
  const { identityUser: stateReviewIdentity } = await resolveReviewIdentity(slug, worktree, {
    readReviewStateFn,
  });
  const reviewIdentity = actor || stateReviewIdentity;

  // SC 4: For mirrored event types, a provider identity is required before creating the event.
  if (shouldMirrorToProvider(eventType) && !reviewIdentity) {
    error(fmt.status('FAIL', `Cannot determine review identity for a mirrored event. Start the review with px review ${slug} --start, or use --actor.`));
    exit(1);
    return;
  }

  applyStructuredEventFields(content, params);

  // Create the event
  const createEventFn = (options as any).createEventFn || createEvent;
  const result = await createEventFn(slug, eventType, params as any, {
    worktree,
    skipGit: false,
    log,
    error
  });

  if (!result.ok) {
    error(fmt.status('FAIL', `Could not create event: ${result.error}`));
    exit(1);
    return;
  }

  log(fmt.status('PASS', `Created review event at: ${result.path}`));
}

export function importLegacyHandler(
  slug: string,
  args: string[],
  options: {
    configuration?: ParallixConfiguration;
    log?: (_msg: string) => void;
    error?: (_msg: string) => void;
    exit?: (_code: number) => never;
    resolveWorktreeFn?: typeof resolveWorktree;
  } = {}
): void {
  const log = options.log || fmt.log.plain;
  const _error = options.error || fmt.log.plainError;
  const _exit = options.exit || process.exit;
  const resolveWorktreeFn = options.resolveWorktreeFn || resolveWorktree;

  const _tmpDir = flagValue(args, '--tmp-dir') || options.configuration?.runtime.tmpDir || os.tmpdir();
  const _worktree = resolveWorktreeFn(slug) || process.cwd();

  // architecture migration: the legacy /tmp/ artifact import path is removed. Review
  // events remain file-backed under missions/<slug>/review-events/ until the
  // architecture migration cutover moves them onto the SQLite Review aggregate.
  log(fmt.status('INFO', `Legacy /tmp artifact import was removed by architecture migration.`));
  log(fmt.status('PASS', `Legacy import handler completed for ${slug} (no artifacts to migrate).`));
}

/**
 * `px review <slug> --backfill-review [--dry-run]`
 *
 * Seed the Review aggregate for a mission handed off before the architecture migration
 * cutover, so `px review --continue` can resume it. Reports and writes nothing
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
  const result = await (options.reconcileInterruptedHandoffFn || reconcileInterruptedHandoff)(slug, {
    sourceBranch: flagValue(args, '--branch') || '',
    targetBranch: flagValue(args, '--target') || '',
    reviewer: flagValue(args, '--reviewer') || '',
    implementer: flagValue(args, '--implementer') || '',
    revision: flagValue(args, '--revision') || '',
    eligibleReviewers: repeatedFlagValues(args, '--eligible-reviewer'),
    startedAt: new Date().toISOString(),
  }, worktree, { missionStore: options.missionStore });
  if (result.outcome === 'reconciled') {
    log(fmt.status('PASS', `Reconciled round-one review for ${slug}. Re-run px review ${slug} --start to launch the reviewer.`));
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
