import { authorizeMissionWrite, reportAuthorizedActivity, inheritedMissionWrite, authorizedOperationId } from '../ports/mission-write-authorization.js';
import type { ExecutionActivityStore } from '../ports/execution-activity.js';
import { agentFamily, type AgentFamily } from '../../domain/agents.js';
import { missionId, type MissionId } from '../../domain/mission.js';
import type { ExecutionActivity, ExecutionActivityStage, ExecutionActivityState } from '../../domain/execution-activity.js';
export type { ExecutionActivity, ExecutionActivityStage, ExecutionActivityState } from '../../domain/execution-activity.js';
import type { OperationalHistoryEntry } from '../ports/operation-history.js';

/** Publishes typed domain activity; owned execution is updated through its fenced port. */
/** `event_type` recorded for every current-work fact. */
export const EXECUTION_ACTIVITY_EVENT_TYPE = 'mission.current-work';

/**
 * Map a current-work fact onto the stored history entry.
 *
 * `eventData` keeps the `message`/`agent` keys the operation log already
 * renders, so the same row is readable by `ConcreteOperationLogReadAdapter`
 * without a second encoding.
 */
export function executionActivityToEntry(event: ExecutionActivity, sourceId?: string, repositoryId?: string): OperationalHistoryEntry {
  return {
    eventType: EXECUTION_ACTIVITY_EVENT_TYPE,
    eventData: JSON.stringify({
      missionId: event.missionId,
      sourceId,
      repositoryId,
      purpose: event.purpose,
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
export function parseExecutionActivityEntry(entry: OperationalHistoryEntry): ExecutionActivity | null {
  if (entry.eventType !== EXECUTION_ACTIVITY_EVENT_TYPE) { return null; }
  let data: Record<string, unknown>;
  try {
    data = JSON.parse(entry.eventData) as Record<string, unknown>;
  } catch {
    return null;
  }
  const missionId = typeof data.missionId === 'string' ? data.missionId : null;
  const phase = typeof data.phase === 'string' ? data.phase : null;
  const state = typeof data.state === 'string' ? data.state : null;
  if (!missionId || !validOperationId(data.operationId) || !isPhase(phase) || !isState(state)) { return null; }
  return {
    ...activityPurpose(data.purpose),
    missionId: missionId as MissionId,
    operationId: data.operationId,
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

function validOperationId(value: unknown): value is string { return typeof value === 'string' && Boolean(value.trim()); }
function activityPurpose(value: unknown): Pick<ExecutionActivity, 'purpose'> {
  return value === 'repair' ? { purpose: value } : {};
}

function isPhase(value: string | null): value is ExecutionActivityStage {
  return value === 'waiting' || value === 'draft' || value === 'execute' || value === 'review'
    || value === 'review-response' || value === 'integrate' || value === 'recovery';
}

function isState(value: string | null): value is ExecutionActivityState {
  return value === 'running' || value === 'ended' || value === 'blocked';
}

/** What a caller must say to open or update a mission's current work. */
export interface ExecutionActivityIntent {
  readonly purpose?: 'repair';
  readonly missionId: MissionId;
  readonly operationId: string;
  readonly phase: ExecutionActivityStage;
  readonly summary: string;
  readonly agent?: AgentFamily | null;
}

/**
 * The application-facing port for publishing current work.
 *
 * Commands depend on this interface, never on the history repository, so a
 * command cannot acquire storage authority by publishing progress.
 */
export interface ExecutionActivityPort {
  /** An operation started, or continued with a different agent family. */
  running(_publication: ExecutionActivityIntent): Promise<void>;
  /** The operation cannot continue autonomously and needs an operator. */
  blocked(_publication: ExecutionActivityIntent, _reason: string): Promise<void>;
  /** The operation finished; nobody is working this mission. */
  ended(_publication: ExecutionActivityIntent): Promise<void>;
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
export function executionActivityIntent(input: {
  readonly slug: string;
  readonly operationId: string;
  readonly phase: ExecutionActivityStage;
  readonly summary: string;
  readonly agent?: string | null;
}): ExecutionActivityIntent | null {
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
 * Deliberately narrower than `ExecutionActivityStage`: the review loop launches
 * reviewers and implementers, and nothing else routes through this seam.
 */
export type AgentLaunchPhase = Extract<ExecutionActivityStage, 'review' | 'review-response'>;

/** What the review loop reports back to the execution activity projection. */
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
 * `px active` runs after review preparation — build their callbacks here, so the board
 * learns which family is reviewing (or answering findings), and why the loop
 * gave up, from the one place that knows. No CLI, TUI, or projection consumer
 * has to infer any of it.
 *
 * The callbacks are awaitable and swallow recorder failures: an authoritative
 * current-work write must be ordered against the operation's next state
 * change, but must never fail the operation it describes.
 */
export function reviewLoopPublisher(
  port: ExecutionActivityPort,
  operation: { readonly slug: string; readonly operationId: string },
): ReviewLoopPublication {
  const publicationFor = (phase: ExecutionActivityStage, summary: string, agent?: string) => executionActivityIntent({
    slug: operation.slug,
    operationId: operation.operationId,
    phase,
    summary,
    agent,
  });
  const publish = async (publication: ExecutionActivityIntent | null, write: (_p: ExecutionActivityIntent) => Promise<void>) => {
    if (!publication) { return; }
    try {
      await write(publication);
    } catch {}
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

/**
 * Work nested inside a still-running outer operation, such as the repair agent
 * and the re-review `px integrate` runs (TASK-2620).
 *
 * Nested work publishes under the outer operation's identity, so the board
 * shows its phase and family, and finishing it restores the outer operation
 * instead of ending the mission's live work while the outer process continues.
 */
export interface NestedWorkPublisher {
  readonly parent: ExecutionActivityIntent;
  /** Nested work is running under the outer operation. */
  running(_phase: ExecutionActivityStage, _summary: string, _agent?: string | null, _purpose?: 'repair'): Promise<void>;
  /** Nested work finished; the outer operation is still the mission's current work. */
  resume(): Promise<void>;
}

export function nestedWorkPublisher(port: ExecutionActivityPort, parent: ExecutionActivityIntent): NestedWorkPublisher {
  const publish = async (publication: ExecutionActivityIntent) => {
    try {
      await port.running(publication);
    } catch {}
  };
  return {
    parent,
    running: (phase, summary, agent, purpose) => publish({ ...parent, phase, summary, agent: parseFamily(agent ?? null),
      ...(purpose ? { purpose } : {}) }),
    resume: () => publish(parent),
  };
}

/** Whether an option bag carries a nested-work publisher from an outer operation. */
export function isNestedWorkPublisher(value: unknown): value is NestedWorkPublisher {
  const candidate = value as NestedWorkPublisher | null;
  return Boolean(candidate && typeof candidate.running === 'function' && typeof candidate.resume === 'function' && candidate.parent);
}

/**
 * Wrap an agent launch port so each launch inside an outer operation shows
 * its phase and actual family, then hands the board back to the outer operation.
 */
export function publishedAgentLaunch<T, Options extends Record<string, unknown>>(
  start: (_step: string, _options: Options) => Promise<T>,
  nested: NestedWorkPublisher,
  phase: ExecutionActivityStage,
  describe: (_agent: string) => string,
  purpose?: 'repair',
): (_step: string, _options: Options) => Promise<T> {
  return async (step, launchOptions) => {
    const requested = typeof launchOptions.agent === 'string' ? launchOptions.agent : null;
    const onLaunch = launchOptions.onLaunch as ((_info: { agent: string }) => unknown) | undefined;
    await nested.running(phase, describe(requested ?? 'agent'), requested, purpose);
    try {
      return await start(step, {
        ...launchOptions,
        onLaunch: async (info: { agent: string }) => {
          await nested.running(phase, describe(info.agent), info.agent, purpose);
          return onLaunch?.(info);
        },
      });
    } finally {
      await nested.resume();
    }
  };
}

export interface ExecutionActivityRecorderOptions {
  /**
   * This process's identifier, supplied by composition. The application layer
   * does not read process globals of its own.
   */
  readonly processId?: number | null;
  /** This process's start identity, supplied by composition alongside the pid. */
  readonly processIdentity?: string | null;
  readonly now?: () => Date;
  /** Best-effort capture correlation supplied by composition, never another activity store. */
  readonly onPublication?: (_publication: ExecutionActivityIntent) => void;
}

/**
 * Write side of the current-work fact.
 *
 * The recorder submits observed facts to the checked activity owner and never
 * writes a Mission row. The store commits the current snapshot and its audit
 * publication together. Liveness and expiry remain read-side observations.
 */
export class ExecutionActivityRecorder implements ExecutionActivityPort {
  private readonly processId: number | null;
  private readonly processIdentity: string | null;
  private readonly now: () => Date;
  private readonly onPublication: ExecutionActivityRecorderOptions['onPublication'];

  constructor(
    private readonly _activity: ExecutionActivityStore,
    options: ExecutionActivityRecorderOptions = {},
  ) {
    this.processId = options.processId ?? null;
    this.processIdentity = options.processIdentity ?? null;
    this.now = options.now ?? (() => new Date());
    this.onPublication = options.onPublication;
  }

  async running(publication: ExecutionActivityIntent): Promise<void> {
    await this.append(publication, 'running', null);
  }

  async blocked(publication: ExecutionActivityIntent, reason: string): Promise<void> {
    await this.append(publication, 'blocked', reason);
  }

  async ended(publication: ExecutionActivityIntent): Promise<void> {
    await this.append(publication, 'ended', null);
  }

  private async append(
    publication: ExecutionActivityIntent,
    state: ExecutionActivityState,
    blockedReason: string | null,
  ): Promise<void> {
    if (inheritedMissionWrite()) { return; }
    const sourceId = publication.operationId;
    publication = { ...publication, operationId: authorizedOperationId() ?? sourceId };
    await authorizeMissionWrite(publication.missionId);
    const event: ExecutionActivity = {
      ...activityPurpose(publication.purpose),
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
    };
    if (!await reportAuthorizedActivity(event, sourceId)) { await this._activity.publish(event, sourceId); }
    try { this.onPublication?.(publication); } catch { /* Capture cannot block current-work publication. */ }
  }
}

/**
 * A publisher that records nothing.
 *
 * Used when operator-local state is unavailable. Publication is best-effort by
 * design: a board that cannot see current work degrades to "unverified", which
 * the reader distinguishes from "idle" — it never blocks an operation.
 */
export const NO_EXECUTION_ACTIVITY: ExecutionActivityPort = {
  async running() {},
  async blocked() {},
  async ended() {},
};
