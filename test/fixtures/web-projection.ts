import { createHash } from 'node:crypto';
import type { BoardProjection } from '../../src/application/projections/board.js';
import { boardFingerprint } from '../../src/application/projections/board-subscription.js';
import type { ProjectionFamilies, ProjectionFreshness, SharedProjectionRead } from '../../src/interfaces/web/shared-build.js';
import {
  toWebBoardAnalytics,
  toWebBoardSnapshot,
  toWebMissionDetail,
  type WebBoardAnalytics,
} from '../../src/interfaces/web/transport.js';
import { analyticsFamilyFreshness } from '../../src/interfaces/web/host-support.js';

/** Deterministic coordinated freshness for test projections; distinct board states get distinct revisions. */
export function webFreshness(projection: BoardProjection): ProjectionFreshness {
  const revision = createHash('sha256')
    .update(boardFingerprint(projection, { deferredDetails: true }))
    .digest('hex');
  return { state: 'fresh', revision, refreshedAt: '2026-11-12T00:00:00.000Z', reason: null };
}

export function webSnapshot(projection: BoardProjection) {
  return toWebBoardSnapshot(projection, webFreshness(projection));
}

export function webMissionDetail(projection: BoardProjection, missionId: string) {
  return toWebMissionDetail(projection, missionId, webFreshness(projection));
}

/** The historical analytics family as its own read delivers it (TASK-2854.04). */
export function webAnalytics(projection: BoardProjection): WebBoardAnalytics {
  return toWebBoardAnalytics(projection, analyticsFamilyFreshness(projection));
}

/** Every family freshness a host read reports for this projection. */
export function webFamilies(projection: BoardProjection): ProjectionFamilies {
  const workflow = webFreshness(projection);
  return { workflow, detail: workflow, analytics: analyticsFamilyFreshness(projection) };
}

/** The whole coordinated read a host would hand a route (TASK-2854.04). */
export function webRead(projection: BoardProjection): SharedProjectionRead<BoardProjection> {
  return { projection, freshness: webFreshness(projection), families: webFamilies(projection) };
}

export const webProjection = {
  snapshot: webSnapshot, analytics: webAnalytics, detail: webMissionDetail, freshness: webFreshness,
  families: webFamilies, read: webRead,
} as const;
