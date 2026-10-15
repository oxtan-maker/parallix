import { resolveMissionStore, diagnosticFrom } from './review-state-store.js';

/** Explicit import and interrupted-handoff reconciliation for surviving review metadata. */

import * as fs from 'fs';

import * as path from 'path';

import { isDeepStrictEqual } from 'node:util';

import { findMissionDir, getPrimaryBranch } from '../filesystem/mission-utils.js';

import { missionId } from '../../domain/mission.js';

import { compareCodeUnits } from '../../domain/comparators.js';

import { agentFamily } from '../../domain/agents.js';

import { changeRevision, ConfiguredReviewerEligibility, startReview } from '../../domain/review.js';

import { applyReviewStateToReview } from './review-state-mapping.js';

import type { MissionStore } from '../../application/domain-ports.js';

import type { ReviewEventRecord, ReviewEventType, ReviewItemDisposition } from '../../domain/review.js';

/**
 * Return the mission directory for a slug, or null when it is not resolvable.
 *
 * The review loop reports the mission directory in its diagnostics, and the
 * event log still lives under it. Review state itself no longer has a file.
 *
 * @param {string} slug
 * @param {string} [rootDir]
 * @returns {string|null}
 */
export function reviewStateFile(slug: string, rootDir = process.cwd()): string | null {
  const missionDir = findMissionDir(slug, rootDir);
  if (!missionDir) { return null; }
  return path.join(missionDir, 'review-state.json');
}

export type ReviewBackfillResult =
  | { outcome: 'backfilled'; rounds: number; round: number; phase: string }
  | { outcome: 'would-backfill'; rounds: number; round: number; phase: string }
  | { outcome: 'events-backfilled'; events: number }
  | { outcome: 'would-backfill-events'; events: number }
  | { outcome: 'already-present' }
  | { outcome: 'no-legacy-state' }
  | { outcome: 'failed'; diagnostic: string };

/**
 * Parse one exported review-event Markdown file into a `ReviewEventRecord`.
 *
 * The exported file is a render of a database row (see `review-events.ts`), so
 * this reads the frontmatter the renderer wrote and takes everything after it
 * as the event content. Returns null for a file without frontmatter, which is
 * not an event export.
 */
function exportedEventIdentity(fields: ReadonlyMap<string, string>, filename: string): { eventType: ReviewEventType; createdAt: string } | null {
  const eventType = fields.get('event_type') ?? fields.get('event');
  const filenameTime = filename.match(/^(\d{4}-\d{2}-\d{2})T(\d{2})(\d{2})(\d{2})-/);
  const rawTime = fields.get('timestamp')
    ?? (filenameTime ? `${filenameTime[1]}T${filenameTime[2]}:${filenameTime[3]}:${filenameTime[4]}.000Z` : null);
  const compactTime = rawTime?.match(/^(\d{4}-\d{2}-\d{2})T(\d{2})(\d{2})(\d{2})Z$/);
  const createdAt = compactTime
    ? `${compactTime[1]}T${compactTime[2]}:${compactTime[3]}:${compactTime[4]}.000Z` : rawTime;
  if (!eventType || !/^(reviewer_findings|reviewer_outcome|implementer_round_summary|implementer_disposition|neutral_discussion|human_note|blocked_publication|parked_followup)$/.test(eventType)
    || !createdAt || Number.isNaN(Date.parse(createdAt))) { return null; }
  return { eventType: eventType as ReviewEventType, createdAt };
}

function parseExportedEvent(content: string, filename: string): Omit<ReviewEventRecord, 'position'> | null {
  const frontmatter = content.match(/^---\n([\s\S]*?)\n---/);
  if (!frontmatter) { return null; }

  const fields = new Map<string, string>();
  for (const line of frontmatter[1].split('\n')) {
    const separator = line.indexOf(':');
    if (separator > 0) {
      fields.set(line.slice(0, separator).trim(), line.slice(separator + 1).trim());
    }
  }

  const round = Number(fields.get('round'));
  const identity = exportedEventIdentity(fields, filename);
  if (!identity) { return null; }
  const { eventType, createdAt } = identity;
  const dispositions = fields.get('item_dispositions');
  let itemDispositions: readonly ReviewItemDisposition[] | null = null;
  if (dispositions) {
    try { itemDispositions = JSON.parse(dispositions) as ReviewItemDisposition[]; }
    catch { itemDispositions = null; }
  }

  return {
    eventType: eventType as ReviewEventType,
    roundNumber: Number.isInteger(round) ? round : null,
    phase: fields.get('phase') ?? null,
    actor: fields.get('actor') ?? fields.get('agent') ?? null,
    content: content.slice(frontmatter[0].length).trim(),
    disposition: fields.get('disposition') ?? null,
    verdict: fields.get('verdict') ?? null,
    itemDispositions,
    blockedReason: fields.get('blocked_reason') ?? null,
    followUpReference: fields.get('followup_reference') ?? null,
    createdAt,
  };
}

/**
 * Read the exported review-event Markdown files for a mission, in filename
 * order — which is timestamp order, because the export names files by
 * timestamp.
 *
 * This is a migration reader, not a production one. Only
 * `backfillReviewFromLegacyState` calls it: a mission whose rounds predate
 * event persistence has the conversation in these files and nowhere else, so
 * the one-shot restores it into the Review aggregate. Production readers go to
 * the database.
 */
export function readExportedReviewEvents(slug: string, rootDir = process.cwd()): readonly ReviewEventRecord[] {
  const missionDir = findMissionDir(slug, rootDir);
  if (!missionDir) { return []; }
  const eventsDir = path.join(missionDir, 'review-events');
  if (!fs.existsSync(eventsDir)) { return []; }

  const events: ReviewEventRecord[] = [];
  for (const file of fs.readdirSync(eventsDir).filter((name) => name.endsWith('.md')).sort(compareCodeUnits)) {
    let content: string;
    try { content = fs.readFileSync(path.join(eventsDir, file), 'utf8'); }
    catch { continue; }
    const parsed = parseExportedEvent(content, file);
    if (parsed) { events.push({ ...parsed, position: events.length }); }
  }
  return events;
}

/** The complete handoff record an operator must supply to repair an interrupted transition. */
export interface InterruptedHandoffInputs {
  readonly sourceBranch: string;
  readonly targetBranch: string;
  readonly reviewer: string;
  readonly implementer: string;
  readonly revision: string;
  readonly eligibleReviewers: readonly string[];
  /** The recovery invocation's durable round-one start time. */
  readonly startedAt: string;
}

export type InterruptedHandoffReconciliationResult =
  | { outcome: 'reconciled'; eligibleReviewers: readonly string[] }
  | { outcome: 'already-present'; eligibleReviewers: readonly string[] }
  | { outcome: 'failed'; diagnostic: string };

function hasValidReviewAggregate(review: unknown): boolean {
  if (!review || typeof review !== 'object') { return false; }
  const rounds = (review as { rounds?: unknown }).rounds;
  if (!Array.isArray(rounds) || rounds.length === 0) { return false; }
  return rounds.every((round) => {
    if (!round || typeof round !== 'object') { return false; }
    const candidate = round as { number?: unknown; reviewer?: unknown; implementer?: unknown; startedAt?: unknown; subject?: { change?: unknown; revision?: unknown } };
    return Number.isInteger(candidate.number)
      && typeof candidate.reviewer === 'string' && candidate.reviewer.trim() !== ''
      && typeof candidate.implementer === 'string' && candidate.implementer.trim() !== ''
      && typeof candidate.startedAt === 'string' && candidate.startedAt.trim() !== ''
      && Boolean(candidate.subject?.change)
      && typeof candidate.subject?.revision === 'string' && candidate.subject.revision.trim() !== '';
  });
}

function requiredReconciliationText(inputs: InterruptedHandoffInputs, field: keyof InterruptedHandoffInputs): string {
  const value = inputs[field];
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`Interrupted-handoff reconciliation requires canonical ${field}`);
  }
  return value.trim();
}

/**
 * Create the sole missing round-one Review aggregate for an interrupted handoff.
 *
 * This deliberately accepts only the handoff record, never loop state or
 * reviewer artifacts. Existing aggregates are left byte-for-byte untouched.
 */
export async function reconcileInterruptedHandoff(
  slug: string,
  inputs: InterruptedHandoffInputs,
  rootDir = process.cwd(),
  options: { missionStore?: MissionStore | null } = {},
): Promise<InterruptedHandoffReconciliationResult> {
  let store: Awaited<ReturnType<typeof resolveMissionStore>>;
  try {
    store = await resolveMissionStore(rootDir, options.missionStore);
  } catch (error) {
    return { outcome: 'failed', diagnostic: diagnosticFrom(error, 'Operator database unavailable') };
  }
  if (!store) { return { outcome: 'failed', diagnostic: `Operator database unavailable for ${slug}` }; }

  try {
    const sourceBranch = requiredReconciliationText(inputs, 'sourceBranch');
    const targetBranch = requiredReconciliationText(inputs, 'targetBranch');
    const reviewer = agentFamily(requiredReconciliationText(inputs, 'reviewer'));
    const implementer = agentFamily(requiredReconciliationText(inputs, 'implementer'));
    const revision = changeRevision(requiredReconciliationText(inputs, 'revision'));
    const startedAt = requiredReconciliationText(inputs, 'startedAt');
    if (!Array.isArray(inputs.eligibleReviewers) || inputs.eligibleReviewers.length === 0) {
      throw new Error('Interrupted-handoff reconciliation requires non-empty canonical eligibleReviewers');
    }
    const eligibleReviewers = inputs.eligibleReviewers.map((value) => agentFamily(String(value).trim()));
    const eligibility = ConfiguredReviewerEligibility.fromReviewStep({ eligible: eligibleReviewers, strategy: 'random' });

    const result = await store.load(missionId(slug));
    if (result.kind !== 'found') {
      return { outcome: 'failed', diagnostic: `Mission ${slug} is not in the operator database; restore it before reconciliation` };
    }
    if (result.mission.status !== 'review') {
      return { outcome: 'failed', diagnostic: `Mission ${slug} is ${result.mission.status}, not review; reconciliation only repairs an interrupted handoff` };
    }
    if (result.mission.review) {
      if (!hasValidReviewAggregate(result.mission.review)) {
        return { outcome: 'failed', diagnostic: `Mission ${slug} has malformed legacy Review data; repair it before reconciliation` };
      }
      return { outcome: 'already-present', eligibleReviewers };
    }

    const review = startReview({
      change: { kind: 'local-branch', sourceBranch, targetBranch },
      revision,
    }, reviewer, implementer, startedAt, eligibility);
    await store.save({ ...result.mission, review }, result.version);
    return { outcome: 'reconciled', eligibleReviewers };
  } catch (error) {
    return { outcome: 'failed', diagnostic: diagnosticFrom(error, 'Interrupted-handoff reconciliation failed') };
  }
}

/**
 * Seed a mission's Review aggregate from a surviving `review-state.json`.
 *
 * A mission handed off before the architecture migration cutover has review-loop state in
 * `missions/<slug>/review-state.json` but no Review in the operator database.
 * `save()` fails closed for those missions rather than inventing a Review, so
 * without a migration path the loop can never be resumed. This is that path:
 * an explicit, operator-invoked one-shot, not an implicit self-heal.
 *
 * The reviewed revision cannot be recovered from the legacy file — it never
 * recorded one — so the subject is reconstructed the way `px handoff` builds it
 * (the mission branch against the primary branch) with a revision marking the
 * change as backfilled. The historical reviewer is taken as eligible: this
 * replays a review that already happened rather than starting a new one.
 *
 * @param {string} slug
 * @param {string} [rootDir]
 * @param {{apply?: boolean}} [options]  `apply: false` reports without writing.
 * @returns {Promise<ReviewBackfillResult>}
 */
/**
 * Restore a mission's review conversation from its exported event files.
 *
 * A Review whose rounds predate event persistence holds the verdicts but not
 * what was said in them, so `px status` prints a round's disposition with
 * nothing under it. The exported Markdown is the only surviving copy, and this
 * is the one place production reads it — the read adapters stay
 * database-only.
 *
 * Returns null when there is nothing safe to restore: no Review, no exported
 * events, a complete import, or recorded events that are not an unchanged
 * ordered subset of the export.
 */
async function backfillExportedEvents(
  slug: string,
  rootDir: string,
  apply: boolean,
  missionStore?: MissionStore | null,
): Promise<ReviewBackfillResult | null> {
  let store: Awaited<ReturnType<typeof resolveMissionStore>>;
  try {
    store = await resolveMissionStore(rootDir, missionStore);
  } catch {
    return null;
  }
  if (!store) { return null; }

  const result = await store.load(missionId(slug));
  if (result.kind !== 'found' || !result.mission.review) { return null; }

  const exported = readExportedReviewEvents(slug, rootDir);
  if (exported.length === 0) { return null; }
  const existing = result.mission.review.reviewEvents;
  // A prior import retained compact source timestamps verbatim. Normalize
  // those values only when every other stored event field still matches.
  const normalized = existing.map(event => {
    const compact = event.createdAt.match(/^(\d{4}-\d{2}-\d{2})T(\d{2})(\d{2})(\d{2})Z$/);
    return compact ? { ...event, createdAt: `${compact[1]}T${compact[2]}:${compact[3]}:${compact[4]}.000Z` } : event;
  });
  let cursor = 0;
  for (const event of exported) {
    if (cursor < normalized.length
      && isDeepStrictEqual({ ...normalized[cursor], position: event.position }, event)) { cursor += 1; }
  }
  if (cursor !== existing.length || isDeepStrictEqual(existing, exported)) { return null; }
  if (!apply) { return { outcome: 'would-backfill-events', events: exported.length }; }

  await store.save(
    { ...result.mission, review: { ...result.mission.review, reviewEvents: exported } },
    result.version,
  );
  return { outcome: 'events-backfilled', events: exported.length };
}

function readLegacyReviewIdentity(statePath: string) {
  let legacy: Record<string, unknown>;
  try {
    legacy = JSON.parse(fs.readFileSync(statePath, 'utf8')) as Record<string, unknown>;
  } catch (error) {
    return { outcome: 'failed' as const, diagnostic: diagnosticFrom(error, `Could not parse ${statePath}`) };
  }
  if (!legacy || typeof legacy !== 'object') {
    return { outcome: 'failed' as const, diagnostic: `${statePath} is not a review-state object` };
  }

  const reviewer = typeof legacy.reviewer === 'string' ? legacy.reviewer.trim() : '';
  const implementer = typeof legacy.implementer === 'string' ? legacy.implementer.trim() : '';
  const startedAt = typeof legacy.startedAt === 'string' ? legacy.startedAt.trim() : '';
  if (!reviewer || !implementer || !startedAt) {
    return {
      outcome: 'failed' as const,
      diagnostic: `${statePath} is missing reviewer, implementer or startedAt; cannot reconstruct a review round`,
    };
  }

  return { outcome: 'parsed' as const, legacy, reviewer, implementer, startedAt };
}

export async function backfillReviewFromLegacyState(
  slug: string,
  rootDir = process.cwd(),
  options: { apply?: boolean; missionStore?: MissionStore | null } = {}
): Promise<ReviewBackfillResult> {
  const apply = options.apply !== false;

  const statePath = reviewStateFile(slug, rootDir);
  if (!statePath || !fs.existsSync(statePath)) {
    // A post-cutover mission has no `review-state.json` and needs no round
    // seeding, but its rounds can still predate event persistence — the review
    // conversation then exists only as exported Markdown. Restore it before
    // reporting that there is nothing to migrate.
    return await backfillExportedEvents(slug, rootDir, apply, options.missionStore)
      ?? { outcome: 'no-legacy-state' };
  }

  const parsed = readLegacyReviewIdentity(statePath);
  if (parsed.outcome === 'failed') { return parsed; }
  const { legacy, reviewer, implementer, startedAt } = parsed;

  let store: Awaited<ReturnType<typeof resolveMissionStore>>;
  try {
    store = await resolveMissionStore(rootDir, options.missionStore);
  } catch (error) {
    return { outcome: 'failed', diagnostic: diagnosticFrom(error, 'Operator database unavailable') };
  }
  if (!store) { return { outcome: 'failed', diagnostic: `Operator database unavailable for ${slug}` }; }

  try {
    const result = await store.load(missionId(slug));
    if (result.kind !== 'found') {
      return { outcome: 'failed', diagnostic: `Mission ${slug} is not in the operator database` };
    }
    if (result.mission.review) {
      return await backfillExportedEvents(slug, rootDir, apply, store) ?? { outcome: 'already-present' };
    }

    const { startReview, ConfiguredReviewerEligibility, changeRevision } = await import(
      '../../domain/review.js'
    );
    const { agentFamily } = await import('../../domain/agents.js');
    const reviewerFamily = agentFamily(reviewer);

    const targetBranch = legacyTargetBranch(rootDir);

    const seed = startReview(
      {
        change: {
          kind: 'local-branch' as const,
          sourceBranch: `mission/${slug}`,
          targetBranch,
        },
        revision: changeRevision(`backfill-${slug}`),
      },
      reviewerFamily,
      agentFamily(implementer),
      startedAt,
      // The historical reviewer is eligible by construction: this replays a
      // review that already ran, it does not select a reviewer for a new one.
      ConfiguredReviewerEligibility.fromReviewStep({
        eligible: [reviewerFamily],
        strategy: 'random',
      }),
    );

    const mapped = applyReviewStateToReview(seed, legacy as Parameters<typeof applyReviewStateToReview>[1]);
    // The same conversation restore as the already-present branch above: a
    // pre-cutover mission's events exist only as exported Markdown.
    const review = mapped.reviewEvents.length > 0
      ? mapped
      : { ...mapped, reviewEvents: readExportedReviewEvents(slug, rootDir) };
    const current = review.rounds[review.rounds.length - 1];
    const summary = { rounds: review.rounds.length, round: current.number, phase: current.phase };

    if (!apply) { return { outcome: 'would-backfill', ...summary }; }
    await store.save({ ...result.mission, review }, result.version);
    return { outcome: 'backfilled', ...summary };
  } catch (error) {
    return { outcome: 'failed', diagnostic: diagnosticFrom(error, 'Review backfill failed') };
  }
}
function legacyTargetBranch(rootDir: string): string {
    let targetBranch = 'main';
    try { targetBranch = getPrimaryBranch(rootDir) || 'main'; } catch { targetBranch = 'main'; }
  return targetBranch;
}
