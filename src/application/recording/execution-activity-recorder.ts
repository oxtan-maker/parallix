import { authorizeMissionWrite, reportAuthorizedActivity, inheritedMissionWrite, authorizedOperationGeneration, authorizedOperationId } from '../ports/mission-write-authorization.js';
import type { ExecutionActivityStore } from '../ports/execution-activity.js';
import { agentFamily, type AgentFamily } from '../../domain/agents.js';
import { missionId, type MissionId } from '../../domain/mission.js';
import type { ExecutionActivity, ExecutionActivityActor, ExecutionActivityStage, ExecutionActivityState, ExecutionTimeState } from '../../domain/execution-activity.js';
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
      operationGeneration: event.operationGeneration,
      revision: event.revision,
      attempt: event.attempt,
      dependencies: event.dependencies,
      actor: event.actor,
      model: event.model,
      timeState: event.timeState,
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
  const identity = parsedActivityIdentity(data);
  if (!identity) { return null; }
  return {
    ...activityPurpose(data.purpose),
    ...identity,
    operationGeneration: numberOrNull(data.operationGeneration),
    revision: stringOrNull(data.revision),
    attempt: numberOrNull(data.attempt),
    dependencies: stringArrayOrNull(data.dependencies),
    actor: stringOrUndefined(data.actor) as ExecutionActivityActor | undefined,
    model: stringOrNull(data.model),
    timeState: isTimeState(data.timeState) ? data.timeState : undefined,
    summary: stringOrUndefined(data.summary) ?? '',
    agent: stringOrNull(data.agent) as AgentFamily | null,
    processId: numberOrNull(data.processId),
    processIdentity: stringOrNull(data.processIdentity),
    blockedReason: stringOrNull(data.blockedReason),
    occurredAt: entry.createdAt,
    // The store's row id is the only ordering that survives two events written
    // inside the same millisecond.
    sequence: entry.id,
  };
}

function parsedActivityIdentity(data: Record<string, unknown>): Pick<ExecutionActivity, 'missionId' | 'operationId' | 'phase' | 'state'> | null {
  const mission = stringOrNull(data.missionId);
  const phase = stringOrNull(data.phase);
  const state = stringOrNull(data.state);
  if (!mission || !validOperationId(data.operationId) || !isPhase(phase) || !isState(state)) { return null; }
  return { missionId: mission as MissionId, operationId: data.operationId, phase, state };
}

function stringOrNull(value: unknown): string | null { return typeof value === 'string' ? value : null; }
function stringOrUndefined(value: unknown): string | undefined { return typeof value === 'string' ? value : undefined; }
function numberOrNull(value: unknown): number | null { return typeof value === 'number' ? value : null; }
function stringArrayOrNull(value: unknown): string[] | null {
  return Array.isArray(value) && value.every(item => typeof item === 'string') ? value : null;
}

function validOperationId(value: unknown): value is string { return typeof value === 'string' && Boolean(value.trim()); }
function activityPurpose(value: unknown): Pick<ExecutionActivity, 'purpose'> {
  return value === 'repair' ? { purpose: value } : {};
}

function isPhase(value: string | null): value is ExecutionActivityStage {
  return value === 'waiting' || value === 'draft' || value === 'execute' || value === 'review'
    || value === 'review-response' || value === 'rebase' || value === 'integrate' || value === 'recovery';
}

function isState(value: string | null): value is ExecutionActivityState {
  return value === 'running' || value === 'ended' || value === 'blocked' || value === 'interrupted' || value === 'cancelled';
}
function isTimeState(value: unknown): value is ExecutionTimeState {
  return value === 'working' || value === 'waiting' || value === 'held';
}

/** What a caller must say to open or update a mission's current work. */
export interface ExecutionActivityIntent {
  readonly purpose?: 'repair';
  readonly missionId: MissionId;
  readonly operationId: string;
  /** One nested publication source inside the workflow operation. */
  readonly sourceId?: string;
  readonly phase: ExecutionActivityStage;
  readonly summary: string;
  readonly agent?: AgentFamily | null;
  readonly attempt?: number;
  readonly dependencies?: readonly string[] | null;
  readonly actor?: ExecutionActivityActor;
  readonly model?: string | null;
  readonly timeState?: ExecutionTimeState;
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
  readonly sourceId?: string;
  readonly attempt?: number;
  readonly actor?: ExecutionActivityActor;
  readonly model?: string | null;
  readonly timeState?: ExecutionTimeState;
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
    sourceId: input.sourceId ?? input.operationId,
    phase: input.phase,
    summary: input.summary,
    agent: parseFamily(input.agent ?? null),
    ...(input.actor === undefined ? {} : { actor: input.actor }),
    ...(input.model === undefined ? {} : { model: input.model }),
    ...(input.timeState === undefined ? {} : { timeState: input.timeState }),
    ...(input.attempt === undefined ? {} : { attempt: input.attempt }),
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
  readonly onAgentLaunched: (_agent: string, _phase: AgentLaunchPhase, _model?: string | null) => Promise<void>;
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
  const modelled = (publication: ExecutionActivityIntent | null, model?: string | null) => publication
    ? { ...publication, model: model ?? null } : null;
  return {
    onAgentLaunched: (agent, phase, model) => publish(
      modelled(publicationFor(
        phase,
        phase === 'review-response'
          ? `implementer ${agent} answering review findings`
          : `reviewer ${agent} reviewing`,
        agent,
      ), model),
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
  running(_phase: ExecutionActivityStage, _summary: string, _agent?: string | null, _purpose?: 'repair', _model?: string | null): Promise<void>;
  /** Nested work finished; the outer operation is still the mission's current work. */
  resume(): Promise<void>;
}

export function nestedWorkPublisher(port: ExecutionActivityPort, parent: ExecutionActivityIntent): NestedWorkPublisher {
  let sequence = 0;
  let active: ExecutionActivityIntent | null = null;
  let predecessor = parent.sourceId ?? parent.operationId;
  const publish = async (publication: ExecutionActivityIntent) => {
    try {
      await port.running(publication);
    } catch {}
  };
  return {
    parent,
    running: async (phase, summary, agent, purpose, model) => {
      if (active) { try { await port.ended(active); } catch {} }
      const family = parseFamily(agent ?? null);
      active = { ...parent, sourceId: `${parent.sourceId ?? parent.operationId}:nested:${++sequence}`, attempt: sequence,
        dependencies: [predecessor],
        phase, summary, agent: family, actor: family ?? parent.actor, model: model ?? null, ...(purpose ? { purpose } : {}) };
      predecessor = active.sourceId!;
      await publish(active);
    },
    resume: async () => {
      if (active) { try { await port.ended(active); } catch {} active = null; }
      await publish({ ...parent, dependencies: [predecessor] });
    },
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
    const onLaunch = launchOptions.onLaunch as ((_info: { agent: string; model?: string | null }) => unknown) | undefined;
    const requestedModel = typeof launchOptions.model === 'string' ? launchOptions.model : null;
    await nested.running(phase, describe(requested ?? 'agent'), requested, purpose, requestedModel);
    try {
      return await start(step, {
        ...launchOptions,
        onLaunch: async (info: { agent: string; model?: string | null }) => {
          await nested.running(phase, describe(info.agent), info.agent, purpose, info.model ?? requestedModel);
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
  readonly revision?: string | null;
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
  private readonly revision: string | null;

  constructor(
    private readonly _activity: ExecutionActivityStore,
    options: ExecutionActivityRecorderOptions = {},
  ) {
    this.processId = options.processId ?? null;
    this.processIdentity = options.processIdentity ?? null;
    this.now = options.now ?? (() => new Date());
    this.onPublication = options.onPublication;
    this.revision = options.revision ?? null;
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
    const sourceId = publication.sourceId ?? publication.operationId;
    publication = { ...publication, operationId: authorizedOperationId() ?? publication.operationId };
    await authorizeMissionWrite(publication.missionId);
    const event: ExecutionActivity = {
      ...activityPurpose(publication.purpose),
      missionId: publication.missionId,
      operationId: publication.operationId,
      operationGeneration: authorizedOperationGeneration(),
      revision: this.revision,
      attempt: publication.attempt ?? null,
      dependencies: publication.dependencies ?? null,
      // The recorder is invoked by a running Parallix workflow. Nested agent
      // launches name their concrete family above; an otherwise unnamed
      // publication is therefore observed Parallix work, not evidence of a
      // human or external actor.
      actor: publication.actor ?? publication.agent ?? 'parallix',
      model: publication.model ?? null,
      timeState: publication.timeState ?? defaultTimeState(state, publication.phase),
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

function defaultTimeState(state: ExecutionActivityState, phase: ExecutionActivityStage): ExecutionTimeState {
  return state === 'blocked' || phase === 'waiting' ? 'waiting' : 'working';
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
