import { agentFamily, type AgentFamily } from '../../domain/agents.js';
import { missionId, type MissionId } from '../../domain/mission.js';
import type { OperationalHistoryEntry, OperationalHistoryRepository } from '../ports/operation-history.js';

/**
 * Ephemeral current-work facts, recorded on the operational-history authority.
 *
 * This is the *write* side of `MissionOperationalFacts.currentWork`. It answers
 * one question — "is a long-running Parallix operation working this mission
 * right now, and which family is doing it?" — and nothing else.
 *
 * Deliberate non-decisions:
 *
 *  - It is **not** a mission lifecycle state. `Mission.status` stays the
 *    lifecycle authority and is never written from here (ADR 0053).
 *  - It is **not** a durable per-launch entity. There is no run/attempt
 *    identity: the mission is the key, `operationId` is a correlation string,
 *    and the newest event for a mission replaces every older one. ADR 0053
 *    excludes `Attempt`, and `test/domain-attempt-guard.test.ts` enforces it.
 *  - It is **not** the availability authority. A family being usable is still
 *    `AgentBlock`; this only records which family is presently running.
 *  - It is **not** proof that a process exists. The recorded `processId` is
 *    evidence for bounded reconciliation only — see
 *    `src/application/projections/current-work.ts`.
 *
 * Storage reuses the existing `operational_history` table through
 * `OperationalHistoryRepository`, so no second durable authority is created.
 * ADR 0053 makes that table authoritative for the event history itself and
 * never for current Mission state, which is exactly how the reader treats it.
 */

/** `event_type` recorded for every current-work fact. */
export const CURRENT_WORK_EVENT_TYPE = 'mission.current-work';

/**
 * The board-relevant long-running operations. Each value is a phase an
 * operator can see on the board, not a lifecycle lane.
 */
export type CurrentWorkPhase =
  | 'execute'
  | 'handoff'
  | 'review'
  | 'review-response'
  | 'integrate';

/**
 * What the newest event says about the mission:
 *
 *  - `running` — an operation is underway;
 *  - `ended`   — the operation finished; nobody is working the mission;
 *  - `blocked` — the operation could not continue autonomously (for example
 *    every eligible agent family is unavailable) and needs an operator.
 */
export type CurrentWorkState = 'running' | 'ended' | 'blocked';

export interface CurrentWorkEvent {
  readonly missionId: MissionId;
  /** Correlates the events of one operation. Not a durable run identity. */
  readonly operationId: string;
  readonly phase: CurrentWorkPhase;
  readonly state: CurrentWorkState;
  /** One operator-facing line describing what is happening. */
  readonly summary: string;
  /** The family running the operation, or `null` when none applies. */
  readonly agent: AgentFamily | null;
  /**
   * The `px` process that published the event. Used only to reconcile a
   * `running` fact left behind by an abnormally terminated process; it is not
   * a stored Process entity (ADR 0053 excludes one).
   */
  readonly processId: number | null;
  /**
   * The publishing process's start identity, when the platform could supply
   * one. Paired with `processId` it survives pid reuse; absent (legacy rows,
   * or a platform that cannot report it) degrades reconciliation to the
   * bare-pid check it used before.
   */
  readonly processIdentity?: string | null;
  /** Why the operation cannot continue; `null` unless `state` is `blocked`. */
  readonly blockedReason: string | null;
  readonly occurredAt: string;
  /**
   * The operational store's own append order for this event, when the row came
   * from storage. Two events published inside the same millisecond are ordered
   * by this and never by timestamp coincidence; a freshly built (unstored)
   * event has none.
   */
  readonly sequence?: number;
}

/**
 * Map a current-work fact onto the stored history entry.
 *
 * `eventData` keeps the `message`/`agent` keys the operation log already
 * renders, so the same row is readable by `ConcreteOperationLogReadAdapter`
 * without a second encoding.
 */
export function currentWorkEventToEntry(event: CurrentWorkEvent): OperationalHistoryEntry {
  return {
    eventType: CURRENT_WORK_EVENT_TYPE,
    eventData: JSON.stringify({
      missionId: event.missionId,
      operationId: event.operationId,
      phase: event.phase,
      state: event.state,
      summary: event.summary,
      message: event.summary,
      agent: event.agent,
      processId: event.processId,
      processIdentity: event.processIdentity,
      blockedReason: event.blockedReason,
    }),
    createdAt: event.occurredAt,
  };
}

/** Parse a stored entry back into a current-work fact, or `null` when it is not one. */
export function parseCurrentWorkEntry(entry: OperationalHistoryEntry): CurrentWorkEvent | null {
  if (entry.eventType !== CURRENT_WORK_EVENT_TYPE) { return null; }
  let data: Record<string, unknown>;
  try {
    data = JSON.parse(entry.eventData) as Record<string, unknown>;
  } catch {
    return null;
  }
  const missionId = typeof data.missionId === 'string' ? data.missionId : null;
  const phase = typeof data.phase === 'string' ? data.phase : null;
  const state = typeof data.state === 'string' ? data.state : null;
  if (!missionId || !isPhase(phase) || !isState(state)) { return null; }
  return {
    missionId: missionId as MissionId,
    operationId: typeof data.operationId === 'string' ? data.operationId : '',
    phase,
    state,
    summary: typeof data.summary === 'string' ? data.summary : '',
    agent: typeof data.agent === 'string' ? data.agent as AgentFamily : null,
    processId: typeof data.processId === 'number' ? data.processId : null,
    processIdentity: typeof data.processIdentity === 'string' ? data.processIdentity : null,
    blockedReason: typeof data.blockedReason === 'string' ? data.blockedReason : null,
    occurredAt: entry.createdAt,
    // The store's row id is the only ordering that survives two events written
    // inside the same millisecond.
    sequence: entry.id,
  };
}

function isPhase(value: string | null): value is CurrentWorkPhase {
  return value === 'execute' || value === 'handoff' || value === 'review'
    || value === 'review-response' || value === 'integrate';
}

function isState(value: string | null): value is CurrentWorkState {
  return value === 'running' || value === 'ended' || value === 'blocked';
}

/** What a caller must say to open or update a mission's current work. */
export interface CurrentWorkPublication {
  readonly missionId: MissionId;
  readonly operationId: string;
  readonly phase: CurrentWorkPhase;
  readonly summary: string;
  readonly agent?: AgentFamily | null;
}

/**
 * The application-facing port for publishing current work.
 *
 * Commands depend on this interface, never on the history repository, so a
 * command cannot acquire storage authority by publishing progress.
 */
export interface CurrentWorkPort {
  /** An operation started, or continued with a different agent family. */
  running(_publication: CurrentWorkPublication): Promise<void>;
  /** The operation cannot continue autonomously and needs an operator. */
  blocked(_publication: CurrentWorkPublication, _reason: string): Promise<void>;
  /** The operation finished; nobody is working this mission. */
  ended(_publication: CurrentWorkPublication): Promise<void>;
}

/**
 * Build a publication from raw command strings, or `null` when the slug is not
 * a mission slug.
 *
 * Publication is an observability concern layered onto commands that already
 * work. Parsing must therefore never throw into the operation: an unparseable
 * slug or family means "publish nothing", not "fail the command". An
 * unrecognized family degrades to `null` so the phase and summary still reach
 * the board.
 */
export function currentWorkPublication(input: {
  readonly slug: string;
  readonly operationId: string;
  readonly phase: CurrentWorkPhase;
  readonly summary: string;
  readonly agent?: string | null;
}): CurrentWorkPublication | null {
  let mission: MissionId;
  try {
    mission = missionId(input.slug);
  } catch {
    return null;
  }
  return {
    missionId: mission,
    operationId: input.operationId,
    phase: input.phase,
    summary: input.summary,
    agent: parseFamily(input.agent ?? null),
  };
}

function parseFamily(value: string | null): AgentFamily | null {
  if (!value) { return null; }
  try {
    return agentFamily(value);
  } catch {
    return null;
  }
}

/**
 * The phases a nested agent launch inside the review loop can publish.
 *
 * Deliberately narrower than `CurrentWorkPhase`: the review loop launches
 * reviewers and implementers, and nothing else routes through this seam.
 */
export type AgentLaunchPhase = Extract<CurrentWorkPhase, 'review' | 'review-response'>;

/** What the review loop reports back to the current-work authority. */
export interface ReviewLoopPublication {
  /** A reviewer or implementer was launched for this mission. */
  readonly onAgentLaunched: (_agent: string, _phase: AgentLaunchPhase) => Promise<void>;
  /**
   * The loop stopped because it could not continue autonomously. The reason is
   * the only sentence that tells the operator why they are needed, so it is
   * published rather than dropped when the operation ends.
   */
  readonly onAutonomousStop: (_reason: string) => Promise<void>;
}

/**
 * The single publication seam for work happening inside the review loop.
 *
 * Both entry points to that loop — `px review` and the autonomous review
 * `px active` runs after handoff — build their callbacks here, so the board
 * learns which family is reviewing (or answering findings), and why the loop
 * gave up, from the one place that knows. No CLI, TUI, or projection consumer
 * has to infer any of it.
 *
 * The callbacks are awaitable and swallow recorder failures: an authoritative
 * current-work write must be ordered against the operation's next state
 * change, but must never fail the operation it describes.
 */
export function reviewLoopPublisher(
  port: CurrentWorkPort,
  operation: { readonly slug: string; readonly operationId: string },
): ReviewLoopPublication {
  const publicationFor = (phase: CurrentWorkPhase, summary: string, agent?: string) => currentWorkPublication({
    slug: operation.slug,
    operationId: operation.operationId,
    phase,
    summary,
    agent,
  });
  const publish = async (publication: CurrentWorkPublication | null, write: (_p: CurrentWorkPublication) => Promise<void>) => {
    if (!publication) { return; }
    try {
      await write(publication);
    } catch (error) {
      void error;
    }
  };
  return {
    onAgentLaunched: (agent, phase) => publish(
      publicationFor(
        phase,
        phase === 'review-response'
          ? `implementer ${agent} answering review findings`
          : `reviewer ${agent} reviewing`,
        agent,
      ),
      (publication) => port.running(publication),
    ),
    onAutonomousStop: (reason) => publish(
      publicationFor('review', `autonomous review stopped: ${reason}`),
      (publication) => port.blocked(publication, `autonomous review stopped: ${reason}`),
    ),
  };
}

export interface CurrentWorkRecorderOptions {
  /**
   * This process's identifier, supplied by composition. The application layer
   * does not read process globals of its own.
   */
  readonly processId?: number | null;
  /** This process's start identity, supplied by composition alongside the pid. */
  readonly processIdentity?: string | null;
  readonly now?: () => Date;
}

/**
 * Write side of the current-work fact.
 *
 * The recorder appends; it never mutates or deletes, and it never writes a
 * Mission row. Reconciliation and expiry are read-side concerns, so a crashed
 * publisher leaves an event that the reader can age out rather than a lock the
 * next process has to clean up.
 */
export class CurrentWorkRecorder implements CurrentWorkPort {
  private readonly processId: number | null;
  private readonly processIdentity: string | null;
  private readonly now: () => Date;

  constructor(
    private readonly _historyRepo: OperationalHistoryRepository,
    options: CurrentWorkRecorderOptions = {},
  ) {
    this.processId = options.processId ?? null;
    this.processIdentity = options.processIdentity ?? null;
    this.now = options.now ?? (() => new Date());
  }

  async running(publication: CurrentWorkPublication): Promise<void> {
    await this.append(publication, 'running', null);
  }

  async blocked(publication: CurrentWorkPublication, reason: string): Promise<void> {
    await this.append(publication, 'blocked', reason);
  }

  async ended(publication: CurrentWorkPublication): Promise<void> {
    await this.append(publication, 'ended', null);
  }

  private async append(
    publication: CurrentWorkPublication,
    state: CurrentWorkState,
    blockedReason: string | null,
  ): Promise<void> {
    await this._historyRepo.append(currentWorkEventToEntry({
      missionId: publication.missionId,
      operationId: publication.operationId,
      phase: publication.phase,
      state,
      summary: publication.summary,
      agent: publication.agent ?? null,
      processId: this.processId,
      processIdentity: this.processIdentity,
      blockedReason,
      occurredAt: this.now().toISOString(),
    }));
  }
}

/**
 * A publisher that records nothing.
 *
 * Used when operator-local state is unavailable. Publication is best-effort by
 * design: a board that cannot see current work degrades to "unverified", which
 * the reader distinguishes from "idle" — it never blocks an operation.
 */
export const NO_CURRENT_WORK_PORT: CurrentWorkPort = {
  async running() {},
  async blocked() {},
  async ended() {},
};
