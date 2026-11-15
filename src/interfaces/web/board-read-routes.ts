import type { FastifyInstance } from 'fastify';
import { findBoardMission, type BoardProjection } from '../../application/projections/board.js';
import type { SharedProjectionRead } from './shared-build.js';
import {
  toWebBoardSnapshot,
  toWebBoardAnalytics,
  toWebMissionDetail,
  WEB_TRANSPORT_VERSION,
  type WebCommandError,
  type WebTransportVersion,
} from './transport.js';
import { errorMessage } from './host-support.js';

export const WEB_SNAPSHOT_PATH = '/api/board';
export const WEB_BOARD_ANALYTICS_PATH = '/api/board/analytics';
export const WEB_MISSION_DETAIL_PATH = '/api/board/:missionId/detail';

export interface WebBoardSnapshotError {
  readonly kind: 'board-snapshot-error';
  readonly transportVersion: WebTransportVersion;
  readonly error: WebCommandError;
}

export interface WebBoardProjectionSource {
  read(): Promise<SharedProjectionRead<BoardProjection>>;
}

function snapshotError(kind: WebCommandError['kind'], message: string): WebBoardSnapshotError {
  return { kind: 'board-snapshot-error', transportVersion: WEB_TRANSPORT_VERSION, error: { kind, message } };
}

/** Register the board reads exposed by the web host: one per data family. */
export function registerBoardReadRoutes(app: FastifyInstance, source: WebBoardProjectionSource | undefined): void {
  app.get(WEB_SNAPSHOT_PATH, async (_request, reply) => {
    if (source === undefined) {
      return reply.code(503).send(snapshotError('unavailable', 'board projection port is not wired'));
    }
    let read: SharedProjectionRead<BoardProjection>;
    try { read = await source.read(); }
    catch (error) { return reply.code(503).send(snapshotError('unavailable', errorMessage(error))); }
    try {
      // The current workflow family only; historical metrics ride their own read.
      return reply.type('application/json; charset=utf-8')
        .send(toWebBoardSnapshot(read.projection, read.families.workflow));
    }
    catch (error) { return reply.code(500).send(snapshotError('execution', errorMessage(error))); }
  });

  app.get(WEB_BOARD_ANALYTICS_PATH, async (_request, reply) => {
    if (source === undefined) {
      return reply.code(503).send(snapshotError('unavailable', 'board projection port is not wired'));
    }
    let read: SharedProjectionRead<BoardProjection>;
    try { read = await source.read(); }
    catch (error) { return reply.code(503).send(snapshotError('unavailable', errorMessage(error))); }
    try {
      // Bulky historical metrics on their own path with the analytics family's own
      // freshness: a deferred or failed historical refresh never touches the
      // current workflow family, and vice versa.
      return reply.type('application/json; charset=utf-8')
        .send(toWebBoardAnalytics(read.projection, read.families.analytics));
    }
    catch (error) { return reply.code(500).send(snapshotError('execution', errorMessage(error))); }
  });

  app.get(WEB_MISSION_DETAIL_PATH, async (request, reply) => {
    if (source === undefined) {
      return reply.code(503).send(snapshotError('unavailable', 'board projection port is not wired'));
    }
    const missionId = (request.params as { missionId?: unknown }).missionId;
    if (typeof missionId !== 'string' || missionId.length === 0) {
      return reply.code(400).send(snapshotError('execution', 'mission detail requires a mission id'));
    }
    let read: SharedProjectionRead<BoardProjection>;
    try { read = await source.read(); }
    catch (error) { return reply.code(503).send(snapshotError('unavailable', errorMessage(error))); }
    if (findBoardMission(read.projection, missionId) === undefined) {
      return reply.code(404).send(snapshotError('execution', `mission ${missionId} is not on the board`));
    }
    try {
      return reply.type('application/json; charset=utf-8')
        .send(toWebMissionDetail(read.projection, missionId, read.families.detail));
    } catch (error) {
      return reply.code(500).send(snapshotError('execution', errorMessage(error)));
    }
  });
}
