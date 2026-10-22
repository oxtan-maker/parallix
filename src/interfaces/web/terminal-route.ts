/**
 * GET-only routes that project a board card's retained mission history and,
 * optionally, its live terminal (TASK-2661, TASK-2749).
 *
 * The web adapter passes the card's canonical Mission ID and typed, validated
 * query values to the application's mission terminal capability. It accepts no
 * path, socket, session or shell input, and only Missions on the displayed board
 * are readable. Every read is bounded by the capability.
 */
import type { FastifyInstance, FastifyReply } from 'fastify';
import type { BoardProjection } from '../../application/projections/board.js';
import type { MissionHistoryError, MissionHistoryPageRequest, MissionTerminalCapability } from '../../application/ports/mission-terminal.js';

import { toHistoryOverview, toHistoryPage, toHistorySearch, toHistoryLive } from './history-transport-projection.js';

export const WEB_TERMINAL_PATH = '/api/terminal/:missionId';
export const WEB_TERMINAL_HISTORY_PATH = '/api/terminal/:missionId/history';
export const WEB_TERMINAL_SEARCH_PATH = '/api/terminal/:missionId/search';
export const WEB_TERMINAL_LIVE_PATH = '/api/terminal/:missionId/live';

/** The read-only part of the capability the web host uses; composition supplies it. */
type TerminalReads = Pick<MissionTerminalCapability, 'overview' | 'page' | 'search' | 'live'>;
export type WebMissionTerminal = { [K in keyof TerminalReads]: (..._args: Parameters<TerminalReads[K]>) => ReturnType<TerminalReads[K]> | Promise<ReturnType<TerminalReads[K]>> };

const RUN_ID = /^[a-z0-9_-]{1,128}$/;
const OFFSET = /^(?:0|[1-9][0-9]{0,14})$/;
const MAX_QUERY_CHARS = 200;

type Query = Record<string, unknown>;

function unavailable(reply: FastifyReply, detail = 'Mission history is unavailable.'): FastifyReply {
  return reply.code(503).type('application/json; charset=utf-8').send({ ok: false, error: 'unavailable', detail });
}

function invalid(reply: FastifyReply, detail: string): FastifyReply {
  return reply.code(400).type('application/json; charset=utf-8').send({ ok: false, error: 'invalid', detail });
}

function isHistoryError<T extends object>(result: T | MissionHistoryError): result is MissionHistoryError {
  return 'ok' in result && result.ok === false;
}

function send<T extends object>(reply: FastifyReply, result: T | MissionHistoryError, project: (_value: T) => object): FastifyReply {
  if (isHistoryError(result)) {
    const status = result.error === 'invalid' ? 400 : result.error === 'missing' ? 404 : 409;
    return reply.code(status).type('application/json; charset=utf-8').send(result);
  }
  return reply.code(200).type('application/json; charset=utf-8').send(project(result));
}

function offset(query: Query, key: string): number | undefined | null {
  const value = query[key];
  if (value === undefined) { return undefined; }
  return typeof value === 'string' && OFFSET.test(value) ? Number(value) : null;
}

/** A validated page request, or the reason the query is invalid. */
function pageRequest(query: Query): MissionHistoryPageRequest | string {
  const run = query.run;
  const stream = query.stream ?? 'stdout';
  const before = offset(query, 'before');
  const after = offset(query, 'after');
  const limit = offset(query, 'limit');
  if (typeof run !== 'string' || !RUN_ID.test(run)) { return 'run must name a retained operation'; }
  if (stream !== 'stdout' && stream !== 'stderr') { return 'stream must be stdout or stderr'; }
  if (before === null || after === null || limit === null || (before !== undefined && after !== undefined)) { return 'before, after and limit are non-negative integers; before and after are exclusive'; }
  return { runId: run, stream, ...(before !== undefined ? { before } : {}), ...(after !== undefined ? { after } : {}), ...(limit !== undefined ? { limit } : {}) };
}

export function registerTerminalRoute(app: FastifyInstance, options: {
  buildProjection?: () => Promise<BoardProjection>;
  missionTerminal?: () => WebMissionTerminal | null;
}): void {
  /** Resolve the capability for a Mission on the displayed board, or reply. */
  const resolve = async (request: { params: unknown }, reply: FastifyReply): Promise<{ terminal: WebMissionTerminal; missionId: string } | null> => {
    const build = options.buildProjection;
    const terminal = options.missionTerminal?.() ?? null;
    const missionId = (request.params as { missionId?: string }).missionId;
    if (build === undefined || terminal === null || missionId === undefined) { unavailable(reply); return null; }
    const projection = await build();
    if (!projection.stages.some(stage => stage.cards.some(card => card.id === missionId))) {
      reply.code(404).type('application/json; charset=utf-8').send({ ok: false, error: 'missing', detail: 'Mission is not on the board.' });
      return null;
    }
    return { terminal, missionId };
  };
  const guarded = (handler: (_request: { params: unknown; query: unknown }, _reply: FastifyReply) => Promise<FastifyReply | undefined>) =>
    async (request: { params: unknown; query: unknown }, reply: FastifyReply) => {
      try { return await handler(request, reply); } catch { return unavailable(reply); }
    };

  app.get(WEB_TERMINAL_PATH, guarded(async (request, reply) => {
    const resolved = await resolve(request, reply);
    return resolved ? send(reply, await resolved.terminal.overview(resolved.missionId), toHistoryOverview) : undefined;
  }));

  app.get(WEB_TERMINAL_HISTORY_PATH, guarded(async (request, reply) => {
    const parsed = pageRequest((request.query ?? {}) as Query);
    if (typeof parsed === 'string') { return invalid(reply, parsed); }
    const resolved = await resolve(request, reply);
    return resolved ? send(reply, await resolved.terminal.page(resolved.missionId, parsed), toHistoryPage) : undefined;
  }));

  app.get(WEB_TERMINAL_SEARCH_PATH, guarded(async (request, reply) => {
    const query = (request.query ?? {}) as Query;
    const pattern = query.q;
    const run = query.run;
    if (typeof pattern !== 'string' || pattern.length === 0 || pattern.length > MAX_QUERY_CHARS) { return invalid(reply, `q must be 1-${MAX_QUERY_CHARS} characters`); }
    if (run !== undefined && (typeof run !== 'string' || !RUN_ID.test(run))) { return invalid(reply, 'run must name a retained operation'); }
    const resolved = await resolve(request, reply);
    if (!resolved) { return undefined; }
    // Literal search only: the browser never supplies a regular expression.
    return send(reply, await resolved.terminal.search(resolved.missionId, { pattern, ...(typeof run === 'string' ? { runId: run } : {}) }), toHistorySearch);
  }));

  app.get(WEB_TERMINAL_LIVE_PATH, guarded(async (request, reply) => {
    const resolved = await resolve(request, reply);
    return resolved ? send(reply, await resolved.terminal.live(resolved.missionId), toHistoryLive) : undefined;
  }));
}
