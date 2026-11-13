import { reviewerConsumeOutcome } from './review-reviewer-artifacts.js';
import type { MissionStore, SessionMarkerPort } from '../../application/domain-ports.js';
import type { MissionLifecycleService } from '../../application/mission-lifecycle-service.js';
import {
  readReviewRounds,
  readReviewState,
  resetReviewState,
  writeReviewState,
} from './review-state.js';
import { createEvent, readAllEvents } from './review-events.js';
import {
  consumeImplementerArtifacts,
  consumeReviewerArtifacts,
} from './review-artifacts.js';
import { parseReviewFindings } from './review-round.js';
import type { LiveMissionExecutionContext } from '../../application/ports/mission-execution-context.js';

/**
 * Bind every review-state operation to the Mission authority.
 *
 * Verdict recorders receive the lifecycle service. Loop bookkeeping writes
 * only update the existing Review projection; they cannot approve a Mission.
 */
export function bindReviewPersistence(store: MissionStore | null, lifecycleService?: Pick<MissionLifecycleService, 'transition'> | null, sessionMarkerPort?: SessionMarkerPort | null) {
  const boundReadReviewState = (slug: string, rootDir?: string) => readReviewState(slug, rootDir, store);
  const boundCreateEvent = (
    slug: string,
    eventType: string,
    params: Parameters<typeof createEvent>[2],
    options: Parameters<typeof createEvent>[3],
  ) => createEvent(slug, eventType, params, { ...options, missionStore: store });
  const boundWriteReviewState: typeof writeReviewState = (slug, state, rootDir) =>
    writeReviewState(slug, state, rootDir, { missionStore: store });
  return {
    readReviewState: boundReadReviewState,
    readReviewRounds: (slug: string, rootDir?: string) => readReviewRounds(slug, rootDir, store),
    writeReviewState: boundWriteReviewState,
    resetReviewState: (slug: string, executionContext: LiveMissionExecutionContext) => resetReviewState(slug, executionContext, store, sessionMarkerPort),
    createEvent: boundCreateEvent,
    readAllEvents: (slug: string, options: Parameters<typeof readAllEvents>[1] = {}) =>
      readAllEvents(slug, { ...options, missionStore: store }),
    // The artifact consumers write review events and read the round they belong
    // to. Both reach the Mission aggregate, so both are bound here rather than
    // left on their unbound module defaults, which resolve no store at all.
    consumeReviewerArtifacts: (
      slug: string,
      reviewer: string,
      options: Parameters<typeof consumeReviewerArtifacts>[2],
    ) => consumeReviewerArtifacts(slug, reviewer, {
      ...options,
      createEventFn: boundCreateEvent,
      readReviewStateFn: boundReadReviewState,
      writeReviewStateFn: boundWriteReviewState,
      // The request-changes boundary: the reviewer's decision is persisted on
      // the aggregate and moves the Mission `review → active`, mirroring the
      // approval boundary bound through `writeReviewState`.
      missionStore: store,
      lifecycleService: lifecycleService ?? null,
    }),
    consumeImplementerArtifacts: (
      slug: string,
      implementer: string,
      options: Parameters<typeof consumeImplementerArtifacts>[2],
    ) => consumeImplementerArtifacts(slug, implementer, {
      ...options,
      createEventFn: boundCreateEvent,
      readReviewStateFn: boundReadReviewState,
      writeReviewStateFn: boundWriteReviewState,
      // Records the round's resolution, which is what leaves the review
      // `ready-for-next-round` for the next review preparation to advance.
      missionStore: store,
    }),
  };
}

/**
 * Every Mission-authority binding the review-loop mechanisms need, in one object.
 *
 * A composition root that spreads this cannot forget one of them. Omitting a
 * single binding does not degrade gracefully: the adapter default resolves no
 * Mission store, so the loop reports the mission as having no Review and the
 * reviewer's findings are never persisted.
 */
export function reviewLoopBindings(store: MissionStore, lifecycleService?: MissionLifecycleService | null, sessionMarkerPort?: SessionMarkerPort | null) {
  const persistence = bindReviewPersistence(store, lifecycleService, sessionMarkerPort);
  // The loop's completion signal is the same persisted conversation written by
  // `px verdict`/`px resolve`; artifact files are not a production input here.
  const reviewerOutput = async (
    slug: string,
    reviewer: string,
    options: Parameters<typeof consumeReviewerArtifacts>[2],
  ) => {
    const worktree = options.executionContext.missionWorktree;
    const state = await persistence.readReviewState(slug, worktree);
    if (!state) { return { consumed: false }; }
    const events = await persistence.readAllEvents(slug, { rootDir: worktree });
    const outcome = [...events].reverse().find((event) =>
      event.event_type === 'reviewer_outcome' && event.round === state.round && event.actor === reviewer
      && Date.parse(event.timestamp) >= Date.parse(state.startedAt),
    );
    if (!outcome?.verdict) { return { consumed: false }; }
    const findings = [...events].reverse().find((event) =>
      event.event_type === 'reviewer_findings' && event.round === state.round && event.actor === reviewer
      && Date.parse(event.timestamp) >= Date.parse(state.startedAt),
    );
    return reviewerConsumeOutcome(outcome.verdict, parseReviewFindings(findings?.content ?? ''), reviewer, false, false, () => {});
  };
  const implementerOutput = async (
    slug: string,
    implementer: string,
    options: Parameters<typeof consumeImplementerArtifacts>[2],
  ) => {
    const worktree = options.executionContext.missionWorktree;
    const state = await persistence.readReviewState(slug, worktree);
    if (!state) { return { consumed: false }; }
    const events = await persistence.readAllEvents(slug, { rootDir: worktree });
    const disposition = [...events].reverse().find((event) =>
      event.event_type === 'implementer_disposition' && event.round === state.round && event.actor === implementer
      && Date.parse(event.timestamp) >= Date.parse(state.startedAt),
    );
    return disposition?.disposition
      ? { consumed: true, ok: true, disposition: disposition.disposition }
      : { consumed: false };
  };
  return {
    readReviewState: persistence.readReviewState,
    writeReviewState: persistence.writeReviewState,
    resetReviewState: persistence.resetReviewState,
    consumeReviewerArtifacts: reviewerOutput,
    consumeImplementerArtifacts: implementerOutput,
    missionStore: store,
    // The round-open boundary owns the `active → review` transition. Keep
    // this alongside the bound store so every loop composition receives both
    // parts of that authority.
    lifecycleService: lifecycleService ?? null,
  };
}
