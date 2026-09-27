import type { MissionStore, SessionMarkerPort } from '../application/domain-ports.js';
import type { MissionLifecycleService } from '../application/mission-lifecycle-service.js';
import {
  backfillReviewFromLegacyState,
  reconcileInterruptedHandoff,
  readReviewRounds,
  readReviewState,
  resetReviewState,
  writeReviewState,
} from '../adapters/review/review-state.js';
import { createEvent, readAllEvents } from '../adapters/review/review-events.js';
import {
  consumeImplementerArtifacts,
  consumeReviewerArtifacts,
} from '../adapters/review/review-artifacts.js';
import { parseReviewFindings } from '../adapters/review/review-round.js';

/**
 * Bind every review-state operation to the Mission authority.
 *
 * `lifecycleService` (TASK-2376) is the approval boundary: when it is
 * supplied, a review persisted as `approved` fires the `review → integration`
 * transition at the boundary with `occurredAt = ReviewerDecision.decidedAt`,
 * instead of leaving the Mission in `review` until `px integrate` repairs it.
 * Every production approval path persists through the bound write function,
 * so one injection here covers all of them.
 */
export function bindReviewPersistence(store: MissionStore, lifecycleService?: MissionLifecycleService | null, sessionMarkerPort?: SessionMarkerPort | null) {
  const boundReadReviewState = (slug: string, rootDir?: string) => readReviewState(slug, rootDir, store);
  const boundCreateEvent = (
    slug: string,
    eventType: string,
    params: Parameters<typeof createEvent>[2],
    options: Parameters<typeof createEvent>[3] = {},
  ) => createEvent(slug, eventType, params, { ...options, missionStore: store });
  const boundWriteReviewState = (slug: string, state: Parameters<typeof writeReviewState>[1], rootDir?: string, _options?: Parameters<typeof writeReviewState>[3]) => {
    // The 4th argument is either a backward-compat positional MissionStore or
    // an options bag. Merge it (instead of dropping it) so a lifecycle
    // service supplied through the options is not silently discarded.
    const callerOptions: { missionStore?: MissionStore | null; lifecycleService?: MissionLifecycleService | null } =
      _options && typeof _options === 'object' && 'save' in _options
        ? { missionStore: _options as MissionStore }
        : ({ ...(_options ?? {}) } as { missionStore?: MissionStore | null; lifecycleService?: MissionLifecycleService | null });
    return writeReviewState(slug, state, rootDir, {
      ...callerOptions,
      missionStore: store,
      lifecycleService: callerOptions.lifecycleService ?? lifecycleService,
    });
  };
  return {
    readReviewState: boundReadReviewState,
    readReviewRounds: (slug: string, rootDir?: string) => readReviewRounds(slug, rootDir, store),
    writeReviewState: boundWriteReviewState,
    resetReviewState: (slug: string, rootDir?: string) => resetReviewState(slug, rootDir, store, sessionMarkerPort),
    backfillReview: (slug: string, rootDir?: string, options: { apply?: boolean } = {}) =>
      backfillReviewFromLegacyState(slug, rootDir, { ...options, missionStore: store }),
    reconcileInterruptedHandoff: (
      slug: string,
      inputs: Parameters<typeof reconcileInterruptedHandoff>[1],
      rootDir?: string,
    ) => reconcileInterruptedHandoff(slug, inputs, rootDir, { missionStore: store }),
    createEvent: boundCreateEvent,
    readAllEvents: (slug: string, options: Parameters<typeof readAllEvents>[1] = {}) =>
      readAllEvents(slug, { ...options, missionStore: store }),
    // The artifact consumers write review events and read the round they belong
    // to. Both reach the Mission aggregate, so both are bound here rather than
    // left on their unbound module defaults, which resolve no store at all.
    consumeReviewerArtifacts: (
      slug: string,
      reviewer: string,
      options: Parameters<typeof consumeReviewerArtifacts>[2] = {},
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
      options: Parameters<typeof consumeImplementerArtifacts>[2] = {},
    ) => consumeImplementerArtifacts(slug, implementer, {
      ...options,
      createEventFn: boundCreateEvent,
      readReviewStateFn: boundReadReviewState,
      writeReviewStateFn: boundWriteReviewState,
      // Records the round's resolution, which is what leaves the review
      // `ready-for-next-round` for the next handoff to advance.
      missionStore: store,
    }),
  };
}

/**
 * Every Mission-authority injection `startReviewLoop` needs, in one object.
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
    options: Parameters<typeof consumeReviewerArtifacts>[2] = {},
  ) => {
    const state = await persistence.readReviewState(slug, options.worktree);
    if (!state) { return { consumed: false }; }
    const events = await persistence.readAllEvents(slug, { rootDir: options.worktree });
    const outcome = [...events].reverse().find((event: any) =>
      event.event_type === 'reviewer_outcome' && event.round === state.round && event.actor === reviewer
      && Date.parse(event.timestamp) >= Date.parse(state.startedAt),
    ) as { verdict?: string; content?: string } | undefined;
    if (!outcome?.verdict) { return { consumed: false }; }
    const findings = [...events].reverse().find((event: any) =>
      event.event_type === 'reviewer_findings' && event.round === state.round && event.actor === reviewer
      && Date.parse(event.timestamp) >= Date.parse(state.startedAt),
    ) as { content?: string } | undefined;
    return {
      consumed: true,
      ok: true,
      reviewState: outcome.verdict.toUpperCase().replace('-', '_'),
      findingSummaries: parseReviewFindings(findings?.content ?? '').map((finding) => finding.summary),
    };
  };
  const implementerOutput = async (
    slug: string,
    implementer: string,
    options: Parameters<typeof consumeImplementerArtifacts>[2] = {},
  ) => {
    const state = await persistence.readReviewState(slug, options.worktree);
    if (!state) { return { consumed: false }; }
    const events = await persistence.readAllEvents(slug, { rootDir: options.worktree });
    const disposition = [...events].reverse().find((event: any) =>
      event.event_type === 'implementer_disposition' && event.round === state.round && event.actor === implementer
      && Date.parse(event.timestamp) >= Date.parse(state.startedAt),
    ) as { disposition?: string } | undefined;
    return disposition?.disposition
      ? { consumed: true, ok: true, disposition: disposition.disposition }
      : { consumed: false };
  };
  return {
    readReviewStateFn: persistence.readReviewState,
    writeReviewStateFn: persistence.writeReviewState,
    resetReviewStateFn: persistence.resetReviewState,
    consumeReviewerArtifactsFn: reviewerOutput,
    consumeImplementerArtifactsFn: implementerOutput,
    // TASK-2582: the round-open boundary needs the lifecycle service to move
    // an active Mission back to review at the boundary.
    lifecycleService: lifecycleService ?? null,
    missionStore: store,
  };
}
