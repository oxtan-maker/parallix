import { createHash } from 'node:crypto';
import type { BoardProjection } from '../../src/application/projections/board.js';
import { boardFingerprint } from '../../src/application/projections/board-subscription.js';
import type { ProjectionFreshness } from '../../src/interfaces/web/shared-build.js';
import {
  toWebBoardSnapshot,
  toWebMissionDetail,
} from '../../src/interfaces/web/transport.js';

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

export const webProjection = { snapshot: webSnapshot, detail: webMissionDetail } as const;
