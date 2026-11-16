import { spawn } from 'node:child_process';
import { flushCompileCache } from 'node:module';
import type { ParallixConfiguration } from '../application/ports/configuration.js';
import type { BoardProjection } from '../application/projections/board.js';
import type { ProviderExecutionSnapshot } from '../application/projections/provider-execution.js';
import { resolveKnownAgentFamilies } from '../adapters/agents/known-agent-families.js';
import type { MissionHistoryPageRequest, MissionHistorySearchQuery } from '../application/ports/mission-terminal.js';
import { cliInvocation, type CliInvocation } from '../adapters/process/cli-invocation.js';
import { createProductionApplicationServices } from './application-services.js';
import { createMissionTerminalCapability, type ResolvedMissionRepository } from './mission-terminal-capability.js';

export const workflowObservationSystem = { spawn };

type Observation = { readonly kind: 'board' } | { readonly kind: 'provider-execution'; readonly repository?: ResolvedMissionRepository } | { readonly kind: 'overview'; readonly mission: string } | { readonly kind: 'live'; readonly mission: string }
  | { readonly kind: 'page'; readonly mission: string; readonly request: MissionHistoryPageRequest }
  | { readonly kind: 'search'; readonly mission: string; readonly request: MissionHistorySearchQuery };
type ObservationRequest = { readonly id: number; readonly observation: Observation; readonly deadlineAt?: number };
/** Caller-counted observer load: queued and running work still owed to live callers, plus expired callers discarded so far. */
export type ObservationQueueCounters = { readonly queued: number; readonly running: number; readonly expired: number };
type ObservationResponse = { readonly id: number; readonly value?: unknown; readonly error?: string; readonly deadlineExpired?: true; readonly queue?: ObservationQueueCounters };

const OBSERVATION_TIMEOUT_MS = 10_000;
const MAX_PENDING_OBSERVATIONS = 64;
const EXPIRY_SWEEP_INTERVAL_MS = 1_000;
const MAX_FAIR_LANES = 256;

/**
 * Equivalent demand shares one IPC request; the key is the observation itself. A flight
 * outlives its callers until the child answers (or the observer fails), so repeated
 * timeouts of the same read never stack further IPC behind a child that is still busy.
 * A request lives until its last caller gives up; when the child drops it at the first
 * caller's deadline, callers still waiting get a fresh request.
 */
type Flight = { readonly key: string; readonly observation: Observation; readonly owner: ReturnType<typeof spawn>; requestId: number; readonly callers: Set<number> };
/**
 * Canonical key for equivalent demand: two typed requests carrying the same fields are
 * one request, whatever property order the caller wrote them in and however deeply the
 * payload nests. Arrays keep their order, because there it is meaning.
 */
function canonicalForm(value: unknown): string {
  if (value === null || typeof value !== 'object') { return JSON.stringify(value ?? null); }
  if (Array.isArray(value)) { return `[${value.map(canonicalForm).join(',')}]`; }
  const fields = Object.entries(value as Record<string, unknown>)
    .filter(([, field]) => field !== undefined)
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
  return `{${fields.map(([name, field]) => `${JSON.stringify(name)}:${canonicalForm(field)}`).join(',')}}`;
}
const flightKey = (observation: Observation) => canonicalForm(observation);

/** One read-only observer amortizes startup without blocking the HTTP event loop. */
function observer(root: string, configuration: ParallixConfiguration, cli: CliInvocation) {
  let child: ReturnType<typeof spawn> | null = null;
  let sequence = 0; let closed = false;
  let lastQueue: ObservationQueueCounters = { queued: 0, running: 0, expired: 0 };
  const pending = new Map<number, { owner: ReturnType<typeof spawn>; deadlineAt: number; flight: Flight; finish(_error?: Error, _value?: unknown): void }>();
  const flights = new Map<string, Flight>(); const outstanding = new Map<number, Flight>();
  const dropFlight = (flight: Flight) => {
    if (flights.get(flight.key) === flight) { flights.delete(flight.key); }
    for (const [id, owner] of outstanding) { if (owner === flight) { outstanding.delete(id); } }
  };
  const failFlight = (flight: Flight, error: Error) => { dropFlight(flight); for (const caller of [...flight.callers]) { pending.get(caller)?.finish(error); } };
  const sendFlight = (flight: Flight) => {
    const requestId = flight.requestId;
    const deadlineAt = Math.max(...[...flight.callers].map(caller => pending.get(caller)?.deadlineAt ?? 0));
    outstanding.set(requestId, flight);
    flight.owner.send?.({ id: requestId, observation: flight.observation, deadlineAt } satisfies ObservationRequest,
      error => { if (error && flights.get(flight.key) === flight && flight.requestId === requestId) { failFlight(flight, error); } });
  };
  const answer = (response: ObservationResponse) => {
    const flight = outstanding.get(response.id);
    outstanding.delete(response.id);
    if (!flight || flights.get(flight.key) !== flight || flight.requestId !== response.id) { return; }
    const error = response.error ? new Error(response.error) : undefined;
    if (!response.deadlineExpired) {
      dropFlight(flight);
      for (const id of [...flight.callers]) { pending.get(id)?.finish(error, response.value); }
      return;
    }
    const now = Date.now();
    for (const id of [...flight.callers]) { if ((pending.get(id)?.deadlineAt ?? 0) <= now) { pending.get(id)?.finish(error); } }
    if (flight.callers.size === 0) { dropFlight(flight); return; }
    flight.requestId = ++sequence;
    sendFlight(flight);
  };
  const start = () => {
    if (child) { return child; }
    // The host stays alive while the observer starts. Publish its compiled
    // modules now so the child can reuse them before the host eventually exits.
    flushCompileCache();
    const launched = workflowObservationSystem.spawn(cli.command, [...cli.args, '--workflow-observe', root], {
      cwd: root, env: { ...configuration.forwardedEnvironment }, stdio: ['ignore', 'ignore', configuration.storage.debugSql ? 'inherit' : 'ignore', 'ipc'], serialization: 'advanced',
    });
    child = launched;
    const fail = (error: Error) => {
      if (child === launched) { child = null; }
      for (const flight of [...flights.values()]) { if (flight.owner === launched) { dropFlight(flight); } }
      for (const call of pending.values()) { if (call.owner === launched) { call.finish(error); } }
    };
    launched.on('error', fail);
    launched.on('exit', code => fail(new Error(`Workflow observer exited (${code})`)));
    launched.on('message', value => {
      const response = value as ObservationResponse;
      if (response.queue) { lastQueue = response.queue; }
      answer(response);
    });
    return launched;
  };
  return {
    counters: (): ObservationQueueCounters => lastQueue,
    request<T>(observation: Observation): Promise<T> {
      if (closed) { return Promise.reject(new Error('Workflow observer is closed or busy')); }
      if (pending.size >= MAX_PENDING_OBSERVATIONS) { return Promise.reject(new Error('Workflow observer is closed or busy')); }
      const key = flightKey(observation);
      const joined = flights.get(key);
      if (!joined && outstanding.size >= MAX_PENDING_OBSERVATIONS) { return Promise.reject(new Error('Workflow observer is closed or busy')); }
      const current = start(); const id = ++sequence;
      let resolve!: (value: T) => void; let reject!: (error: Error) => void;
      const promise = new Promise<T>((resolvePromise, rejectPromise) => {
        resolve = resolvePromise; reject = rejectPromise;
      });
      const flight: Flight = joined ?? { key, observation, owner: current, requestId: id, callers: new Set<number>() };
      flight.callers.add(id); flights.set(key, flight);
      const deadlineAt = Date.now() + OBSERVATION_TIMEOUT_MS;
      const timer = setTimeout(() => {
        pending.get(id)?.finish(new Error('Workflow observation timed out'));
        // The deadline belongs to this caller. Keep finite cold work and its
        // warm graph alive for later requests; close owns child termination.
      }, OBSERVATION_TIMEOUT_MS);
      pending.set(id, { owner: current, deadlineAt, flight, finish(error, value) {
        if (!pending.delete(id)) { return; }
        clearTimeout(timer);
        flight.callers.delete(id);
        if (error) { reject(error); } else { resolve(value as T); }
      } });
      if (!joined) { sendFlight(flight); }
      return promise;
    },
    async close(): Promise<void> {
      closed = true;
      flights.clear(); outstanding.clear();
      for (const call of pending.values()) { call.finish(new Error('Workflow observer closed')); }
      const current = child; child = null;
      if (!current) { return; }
      await new Promise<void>(resolve => {
        const timer = setTimeout(() => { current.kill('SIGKILL'); resolve(); }, 2000);
        current.once('exit', () => { clearTimeout(timer); resolve(); });
        if (current.connected) { current.disconnect(); } else { current.kill('SIGTERM'); }
      });
    },
  };
}

export async function observeWorkflow<T>(root: string, configuration: ParallixConfiguration, observation: Observation, cli = cliInvocation(process.argv[1])): Promise<T> {
  const reader = observer(root, configuration, cli);
  try { return await reader.request<T>(observation); } finally { await reader.close(); }
}

type QueuedCaller = { readonly id: number; readonly deadlineAt: number };
type QueuedObservation = { readonly key: string; readonly observation: Observation; readonly arrivedAt: number; callers: QueuedCaller[] };

const queueLane = (observation: Observation) => observation.kind === 'board' || observation.kind === 'provider-execution'
  ? `\0${observation.kind}` : observation.mission;

/**
 * The observer's finite wait queue. Equivalent observations coalesce; callers whose
 * deadline passed are dropped before they can run; the least recently served mission
 * lane runs next. A mission lane the observer has not served yet enters the rotation at
 * the moment its work arrived, never ahead of work that is already waiting, so sustained
 * arrivals from new missions cannot bypass a read that is queued. Current-state and
 * history reads never share a queue: the host gives history its own observer process,
 * because history reads are synchronous.
 */
function observationQueue(onExpired: (_callers: readonly QueuedCaller[]) => void) {
  const jobs: QueuedObservation[] = [];
  const servedAt = new Map<string, number>();
  // One clock for arrivals and services, so a lane's rank and a job's arrival compare.
  let tick = 0;
  const sweep = (now: number) => {
    for (const job of [...jobs]) {
      const expired = job.callers.filter(caller => caller.deadlineAt <= now);
      if (expired.length === 0) { continue; }
      job.callers = job.callers.filter(caller => caller.deadlineAt > now);
      if (job.callers.length === 0) { jobs.splice(jobs.indexOf(job), 1); }
      onExpired(expired);
    }
  };
  return {
    sweep,
    callers: () => jobs.reduce((total, job) => total + job.callers.length, 0),
    isEmpty: () => jobs.length === 0,
    clear: () => { jobs.length = 0; },
    push(observation: Observation, caller: QueuedCaller) {
      const key = flightKey(observation);
      const duplicate = jobs.find(job => job.key === key);
      if (duplicate) { duplicate.callers.push(caller); } else { jobs.push({ key, observation, arrivedAt: ++tick, callers: [caller] }); }
    },
    next(now: number): QueuedObservation | undefined {
      sweep(now);
      const rank = (job: QueuedObservation) => servedAt.get(queueLane(job.observation)) ?? job.arrivedAt;
      let next: QueuedObservation | undefined;
      for (const job of jobs) {
        if (!next || rank(job) < rank(next)) { next = job; }
      }
      if (!next) { return undefined; }
      jobs.splice(jobs.indexOf(next), 1);
      const lane = queueLane(next.observation);
      servedAt.delete(lane);
      servedAt.set(lane, ++tick);
      if (servedAt.size > MAX_FAIR_LANES) { servedAt.delete(servedAt.keys().next().value!); }
      return next;
    },
  };
}

export function runWorkflowObservation(root: string, configuration: ParallixConfiguration, terminalFactory: typeof createMissionTerminalCapability = createMissionTerminalCapability,
  createGraph: typeof createProductionApplicationServices = createProductionApplicationServices): void {
  type ProductionServices = Awaited<ReturnType<typeof createProductionApplicationServices>>;
  let graph: ProductionServices | null = null;
  let terminal: ReturnType<typeof createMissionTerminalCapability> | null = null;
  let providerTerminal: ReturnType<typeof createMissionTerminalCapability> | null = null;
  let runningCallers = 0;
  let running = false;
  let graphReady: Promise<ProductionServices> | null = null;
  let expiredCallers = 0;
  let sweepTimer: ReturnType<typeof setTimeout> | null = null;
  let closing = false;
  let finalized = false;
  const send = (value: Omit<ObservationResponse, 'queue'>) => {
    if (process.connected) { process.send?.({ ...value, queue: { queued: queue.callers(), running: runningCallers, expired: expiredCallers } } satisfies ObservationResponse); }
  };
  const expire = (callers: readonly QueuedCaller[]) => {
    expiredCallers += callers.length;
    for (const caller of callers) { send({ id: caller.id, error: 'Workflow observation expired before execution', deadlineExpired: true }); }
  };
  const queue = observationQueue(expire);
  const scheduleSweep = () => {
    if (sweepTimer || queue.isEmpty() || closing) { return; }
    sweepTimer = setTimeout(() => { sweepTimer = null; queue.sweep(Date.now()); scheduleSweep(); }, EXPIRY_SWEEP_INTERVAL_MS);
    sweepTimer.unref();
  };
  const finalize = async () => {
    if (finalized || running || !closing) { return; }
    finalized = true;
    await graph?.operatorState.close();
    process.exit(0);
  };
  /** One graph serves the observer; a failed composition is forgotten so the next read retries it. */
  const ensureGraph = () => {
    graphReady ??= createGraph(root, undefined, { configuration }).then(created => (graph = created), error => { graphReady = null; throw error; });
    return graphReady;
  };
  const execute = async (observation: Observation): Promise<unknown> => {
    if (observation.kind === 'provider-execution') {
      // Run metadata only: no application graph, no Git worktree resolution, no board or history projection.
      providerTerminal ??= terminalFactory(root, configuration, () => null, observation.repository);
      if (!providerTerminal.providerSnapshot) { throw new Error('Provider execution snapshot unavailable'); }
      return providerTerminal.providerSnapshot(resolveKnownAgentFamilies(root));
    }
    if (observation.kind === 'board') {
      const board = await ensureGraph();
      if (!board.presentationCapabilities || !board.mission) { throw new Error('Board authority unavailable'); }
      return board.presentationCapabilities.boardProjection.build();
    }
    terminal ??= terminalFactory(root, configuration);
    return observation.kind === 'overview' ? terminal.overview(observation.mission)
      : observation.kind === 'live' ? terminal.live(observation.mission)
      : observation.kind === 'page' ? terminal.page(observation.mission, observation.request)
      : terminal.search(observation.mission, observation.request);
  };
  const respond = async (job: QueuedObservation) => {
    const now = Date.now();
    expire(job.callers.filter(caller => caller.deadlineAt <= now));
    const live = job.callers.filter(caller => caller.deadlineAt > now);
    runningCallers = live.length;
    if (live.length === 0) { return; }
    let reply: Omit<ObservationResponse, 'id' | 'queue'>;
    try { reply = { value: await execute(job.observation) }; }
    catch (error) { reply = { error: error instanceof Error ? error.message : String(error) }; }
    runningCallers = 0;
    for (const caller of live) { send({ id: caller.id, ...reply }); }
  };
  const drain = () => {
    if (running) { return; }
    if (closing) { queue.clear(); }
    const job = queue.next(Date.now());
    if (!job) { void finalize(); return; }
    running = true;
    void respond(job).finally(() => { running = false; drain(); });
  };
  const enqueue = (input: unknown) => {
    const request = input as ObservationRequest;
    const now = Date.now();
    const deadlineAt = Number.isFinite(request.deadlineAt) ? request.deadlineAt! : Number.POSITIVE_INFINITY;
    if (closing) { send({ id: request.id, error: 'Workflow observer is closed' }); return; }
    if (deadlineAt <= now) { expire([{ id: request.id, deadlineAt }]); return; }
    queue.sweep(now);
    if (queue.callers() + runningCallers >= MAX_PENDING_OBSERVATIONS) { send({ id: request.id, error: 'Workflow observer is busy' }); return; }
    queue.push(request.observation, { id: request.id, deadlineAt });
    drain();
    scheduleSweep();
  };
  process.on('message', enqueue);
  process.once('disconnect', () => {
    closing = true;
    if (sweepTimer) { clearTimeout(sweepTimer); sweepTimer = null; }
    drain();
  });
}

/** `repository` is the identity the host already resolved; the provider observer then performs no Git at all. */
export function workflowObservationCapabilities(root: string, configuration: ParallixConfiguration, cli?: CliInvocation, repository?: ResolvedMissionRepository) {
  const reader = observer(root, configuration, cli ?? cliInvocation(process.argv[1]));
  const terminalReader = observer(root, configuration, cli ?? cliInvocation(process.argv[1]));
  // History reads are synchronous, so a slow search would hold its whole process.
  // It gets its own warm observer, started on first use, and never delays current reads.
  const historyReader = observer(root, configuration, cli ?? cliInvocation(process.argv[1]));
  // A sampler's cheap read never queues behind board builds or history pages; the child starts on first use.
  const providerReader = observer(root, configuration, cli ?? cliInvocation(process.argv[1]));
  return {
    close: async () => { await Promise.all([reader.close(), terminalReader.close(), historyReader.close(), providerReader.close()]); },
    providerExecution: () => providerReader.request<ProviderExecutionSnapshot>({ kind: 'provider-execution', ...(repository ? { repository } : {}) }),
    board: () => reader.request<BoardProjection>({ kind: 'board' }),
    counters: () => ({ board: reader.counters(), terminal: terminalReader.counters(), history: historyReader.counters() }),
    terminal: {
      overview: (mission: string) => terminalReader.request<ReturnType<ReturnType<typeof createMissionTerminalCapability>['overview']>>({ kind: 'overview', mission }),
      live: (mission: string) => terminalReader.request<ReturnType<ReturnType<typeof createMissionTerminalCapability>['live']>>({ kind: 'live', mission }),
      page: (mission: string, request: MissionHistoryPageRequest) => historyReader.request<ReturnType<ReturnType<typeof createMissionTerminalCapability>['page']>>({ kind: 'page', mission, request }),
      search: (mission: string, request: MissionHistorySearchQuery) => historyReader.request<ReturnType<ReturnType<typeof createMissionTerminalCapability>['search']>>({ kind: 'search', mission, request }),
    },
  };
}
