import type { MissionStore } from '../application/domain-ports.js';
import {
  backfillReviewFromLegacyState,
  readReviewRounds,
  readReviewState,
  resetReviewState,
  writeReviewState,
} from '../adapters/review/review-state.js';
import { createEvent, readAllEvents } from '../adapters/review/review-events.js';

export function bindReviewPersistence(store: MissionStore) {
  return {
    readReviewState: (slug: string, rootDir?: string) => readReviewState(slug, rootDir, store),
    readReviewRounds: (slug: string, rootDir?: string) => readReviewRounds(slug, rootDir, store),
    writeReviewState: (slug: string, state: Parameters<typeof writeReviewState>[1], rootDir?: string) =>
      writeReviewState(slug, state, rootDir, store),
    resetReviewState: (slug: string, rootDir?: string) => resetReviewState(slug, rootDir, store),
    backfillReview: (slug: string, rootDir?: string, options: { apply?: boolean } = {}) =>
      backfillReviewFromLegacyState(slug, rootDir, { ...options, missionStore: store }),
    createEvent: (
      slug: string,
      eventType: string,
      params: Parameters<typeof createEvent>[2],
      options: Parameters<typeof createEvent>[3] = {},
    ) => createEvent(slug, eventType, params, { ...options, missionStore: store }),
    readAllEvents: (slug: string, options: Parameters<typeof readAllEvents>[1] = {}) =>
      readAllEvents(slug, { ...options, missionStore: store }),
  };
}
