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
type ObservationResponse = { readonly id: number; readonly value?: unknown; readonly error?: string; readonly deadlineExpired?: true };

const OBSERVATION_TIMEOUT_MS = 10_000;
const MAX_PENDING_OBSERVATIONS = 64;

/** One read-only observer amortizes startup without blocking the HTTP event loop. */
function observer(root: string, configuration: ParallixConfiguration, cli: CliInvocation) {
  let child: ReturnType<typeof spawn> | null = null;
  let sequence = 0;
  let closed = false;
  const pending = new Map<number, { owner: ReturnType<typeof spawn>; deadlineAt: number; finish(_error?: Error, _value?: unknown): void }>();
  let boardFlight: { requestId: number; readonly callers: Set<number> } | null = null;
  const failBoardFlight = (flight: NonNullable<typeof boardFlight>, error: Error) => {
    if (boardFlight !== flight) { return; }
    boardFlight = null;
    for (const caller of [...flight.callers]) { pending.get(caller)?.finish(error); }
  };
  const sendBoardFlight = (flight: NonNullable<typeof boardFlight>) => {
    const requestId = flight.requestId;
    const call = pending.get(requestId);
    if (!call) { return; }
    call.owner.send?.({ id: requestId, observation: { kind: 'board' }, deadlineAt: call.deadlineAt } satisfies ObservationRequest,
      error => { if (error && boardFlight === flight && flight.requestId === requestId) { failBoardFlight(flight, error); } });
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
      if (boardFlight && [...boardFlight.callers].some(id => pending.get(id)?.owner === launched)) { boardFlight = null; }
      for (const call of pending.values()) { if (call.owner === launched) { call.finish(error); } }
    };
    launched.on('error', fail);
    launched.on('exit', code => fail(new Error(`Workflow observer exited (${code})`)));
    launched.on('message', value => {
      const response = value as ObservationResponse;
      const error = response.error ? new Error(response.error) : undefined;
      if (boardFlight?.requestId === response.id) {
        if (response.deadlineExpired) {
          pending.get(response.id)?.finish(error, response.value);
        } else {
          const completed = boardFlight;
          boardFlight = null;
          for (const id of [...completed.callers]) { pending.get(id)?.finish(error, response.value); }
        }
      } else { pending.get(response.id)?.finish(error, response.value); }
    });
    return launched;
  };
  return {
    request<T>(observation: Observation): Promise<T> {
      if (closed) { return Promise.reject(new Error('Workflow observer is closed or busy')); }
      if (pending.size >= MAX_PENDING_OBSERVATIONS) { return Promise.reject(new Error('Workflow observer is closed or busy')); }
      const current = start(); const id = ++sequence;
      let resolve!: (value: T) => void; let reject!: (error: Error) => void;
      const promise = new Promise<T>((resolvePromise, rejectPromise) => {
        resolve = resolvePromise; reject = rejectPromise;
      });
      const flight = observation.kind === 'board'
        ? boardFlight ?? { requestId: id, callers: new Set<number>() }
        : null;
      if (flight) { flight.callers.add(id); boardFlight = flight; }
      const deadlineAt = Date.now() + OBSERVATION_TIMEOUT_MS;
      const timer = setTimeout(() => {
        pending.get(id)?.finish(new Error('Workflow observation timed out'));
        // The deadline belongs to this caller. Keep finite cold work and its
        // warm graph alive for later requests; close owns child termination.
      }, OBSERVATION_TIMEOUT_MS);
      pending.set(id, { owner: current, deadlineAt, finish(error, value) {
        if (!pending.delete(id)) { return; }
        clearTimeout(timer);
        const ownedFlight = flight !== null && boardFlight === flight && flight.requestId === id;
        flight?.callers.delete(id);
        if (flight && boardFlight === flight) {
          if (flight.callers.size === 0) { boardFlight = null; }
          else if (ownedFlight) {
            flight.requestId = flight.callers.values().next().value!;
            sendBoardFlight(flight);
          }
        }
        if (error) { reject(error); } else { resolve(value as T); }
      } });
      if (flight?.requestId === id) { sendBoardFlight(flight); }
      else if (!flight) { current.send?.({ id, observation, deadlineAt } satisfies ObservationRequest,
        error => { if (error) { pending.get(id)?.finish(error); } }); }
      return promise;
    },
    async close(): Promise<void> {
      closed = true;
      boardFlight = null;
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

export function runWorkflowObservation(root: string, configuration: ParallixConfiguration, terminalFactory: typeof createMissionTerminalCapability = createMissionTerminalCapability,
  createGraph: typeof createProductionApplicationServices = createProductionApplicationServices): void {
  let graph: Awaited<ReturnType<typeof createProductionApplicationServices>> | null = null;
  let terminal: ReturnType<typeof createMissionTerminalCapability> | null = null;
  let providerTerminal: ReturnType<typeof createMissionTerminalCapability> | null = null;
  type QueuedObservation = { readonly observation: Observation; readonly callers: Array<{ readonly id: number; readonly deadlineAt: number }> };
  const queue: QueuedObservation[] = [];
  let callerCount = 0;
  let running = false;
  let closing = false;
  let finalized = false;
  const send = (value: unknown) => { if (process.connected) { process.send?.(value); } };
  const finalize = async () => {
    if (finalized || running || !closing) { return; }
    finalized = true;
    await graph?.operatorState.close();
    process.exit(0);
  };
  const read = async (observation: Observation): Promise<unknown> => {
    if (observation.kind === 'provider-execution') {
      // Run metadata only: no application graph, no Git worktree resolution, no board or history projection.
      providerTerminal ??= terminalFactory(root, configuration, () => null, observation.repository);
      if (!providerTerminal.providerSnapshot) { throw new Error('Provider execution snapshot unavailable'); }
      return providerTerminal.providerSnapshot(resolveKnownAgentFamilies(root));
    }
    graph ??= await createGraph(root, undefined, { configuration });
    if (observation.kind === 'board') {
      if (!graph.presentationCapabilities || !graph.mission) { throw new Error('Board authority unavailable'); }
      return graph.presentationCapabilities.boardProjection.build();
    }
    terminal ??= terminalFactory(root, configuration);
    return observation.kind === 'overview' ? terminal.overview(observation.mission)
      : observation.kind === 'live' ? terminal.live(observation.mission)
      : observation.kind === 'page' ? terminal.page(observation.mission, observation.request)
      : terminal.search(observation.mission, observation.request);
  };
  const respond = async (job: QueuedObservation) => {
    const now = Date.now();
    const expired = job.callers.filter(caller => caller.deadlineAt <= now);
    const live = job.callers.filter(caller => caller.deadlineAt > now);
    for (const caller of expired) {
      send({ id: caller.id, error: 'Workflow observation expired before execution', deadlineExpired: true } satisfies ObservationResponse);
    }
    callerCount -= expired.length;
    if (live.length === 0) { return; }
    try {
      const value = await read(job.observation);
      for (const caller of live) { send({ id: caller.id, value }); }
    } catch (error) {
      for (const caller of live) { send({ id: caller.id, error: error instanceof Error ? error.message : String(error) }); }
    } finally { callerCount -= live.length; }
  };
  const drain = () => {
    if (running) { return; }
    const job = queue.shift();
    if (!job) { void finalize(); return; }
    running = true;
    void respond(job).finally(() => {
      running = false;
      if (closing) {
        callerCount -= queue.reduce((total, queued) => total + queued.callers.length, 0);
        queue.length = 0;
      }
      drain();
    });
  };
  const enqueue = (input: unknown) => {
    const request = input as ObservationRequest;
    const deadlineAt = Number.isFinite(request.deadlineAt) ? request.deadlineAt! : Number.POSITIVE_INFINITY;
    if (closing) { send({ id: request.id, error: 'Workflow observer is closed' }); return; }
    if (deadlineAt <= Date.now()) {
      send({ id: request.id, error: 'Workflow observation expired before execution', deadlineExpired: true } satisfies ObservationResponse);
      return;
    }
    if (callerCount >= MAX_PENDING_OBSERVATIONS) { send({ id: request.id, error: 'Workflow observer is busy' }); return; }
    const duplicate = request.observation.kind === 'board'
      ? queue.find(job => job.observation.kind === 'board')
      : undefined;
    if (duplicate) { duplicate.callers.push({ id: request.id, deadlineAt }); }
    else { queue.push({ observation: request.observation, callers: [{ id: request.id, deadlineAt }] }); }
    callerCount++;
    drain();
  };
  process.on('message', enqueue);
  process.once('disconnect', () => {
    closing = true;
    if (!running) {
      callerCount -= queue.reduce((total, queued) => total + queued.callers.length, 0);
      queue.length = 0;
    }
    drain();
  });
}

/** `repository` is the identity the host already resolved; the provider observer then performs no Git at all. */
export function workflowObservationCapabilities(root: string, configuration: ParallixConfiguration, cli?: CliInvocation, repository?: ResolvedMissionRepository) {
  const reader = observer(root, configuration, cli ?? cliInvocation(process.argv[1]));
  const terminalReader = observer(root, configuration, cli ?? cliInvocation(process.argv[1]));
  // A sampler's cheap read never queues behind board builds or history pages; the child starts on first use.
  const providerReader = observer(root, configuration, cli ?? cliInvocation(process.argv[1]));
  return {
    close: async () => { await Promise.all([reader.close(), terminalReader.close(), providerReader.close()]); },
    providerExecution: () => providerReader.request<ProviderExecutionSnapshot>({ kind: 'provider-execution', ...(repository ? { repository } : {}) }),
    board: () => reader.request<BoardProjection>({ kind: 'board' }),
    terminal: {
      overview: (mission: string) => terminalReader.request<ReturnType<ReturnType<typeof createMissionTerminalCapability>['overview']>>({ kind: 'overview', mission }),
      live: (mission: string) => terminalReader.request<ReturnType<ReturnType<typeof createMissionTerminalCapability>['live']>>({ kind: 'live', mission }),
      page: (mission: string, request: MissionHistoryPageRequest) => terminalReader.request<ReturnType<ReturnType<typeof createMissionTerminalCapability>['page']>>({ kind: 'page', mission, request }),
      search: (mission: string, request: MissionHistorySearchQuery) => terminalReader.request<ReturnType<ReturnType<typeof createMissionTerminalCapability>['search']>>({ kind: 'search', mission, request }),
    },
  };
}
