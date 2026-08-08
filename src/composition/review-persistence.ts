import type { MissionStore } from '../application/domain-ports.js';
import {
  backfillReviewFromLegacyState,
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

export function bindReviewPersistence(store: MissionStore) {
  const boundReadReviewState = (slug: string, rootDir?: string) => readReviewState(slug, rootDir, store);
  const boundCreateEvent = (
    slug: string,
    eventType: string,
    params: Parameters<typeof createEvent>[2],
    options: Parameters<typeof createEvent>[3] = {},
  ) => createEvent(slug, eventType, params, { ...options, missionStore: store });
  const boundWriteReviewState = (slug: string, state: Parameters<typeof writeReviewState>[1], rootDir?: string, _missionStore?: MissionStore | null) =>
    writeReviewState(slug, state, rootDir, store);
  return {
    readReviewState: boundReadReviewState,
    readReviewRounds: (slug: string, rootDir?: string) => readReviewRounds(slug, rootDir, store),
    writeReviewState: boundWriteReviewState,
    resetReviewState: (slug: string, rootDir?: string) => resetReviewState(slug, rootDir, store),
    backfillReview: (slug: string, rootDir?: string, options: { apply?: boolean } = {}) =>
      backfillReviewFromLegacyState(slug, rootDir, { ...options, missionStore: store }),
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
export function reviewLoopBindings(store: MissionStore) {
  const persistence = bindReviewPersistence(store);
  return {
    readReviewStateFn: persistence.readReviewState,
    writeReviewStateFn: persistence.writeReviewState,
    resetReviewStateFn: persistence.resetReviewState,
    consumeReviewerArtifactsFn: persistence.consumeReviewerArtifacts,
    consumeImplementerArtifactsFn: persistence.consumeImplementerArtifacts,
    missionStore: store,
  };
}
