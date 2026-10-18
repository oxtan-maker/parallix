import { spawn } from 'node:child_process';
import { flushCompileCache } from 'node:module';
import type { ParallixConfiguration } from '../application/ports/configuration.js';
import type { BoardProjection } from '../application/projections/board.js';
import type { MissionHistoryPageRequest, MissionHistorySearchQuery } from '../application/ports/mission-terminal.js';
import { cliInvocation, type CliInvocation } from '../adapters/process/cli-invocation.js';
import { createProductionApplicationServices } from './application-services.js';
import { createMissionTerminalCapability } from './mission-terminal-capability.js';

export const workflowObservationSystem = { spawn };

type Observation = { readonly kind: 'board' } | { readonly kind: 'overview'; readonly mission: string } | { readonly kind: 'live'; readonly mission: string }
  | { readonly kind: 'page'; readonly mission: string; readonly request: MissionHistoryPageRequest }
  | { readonly kind: 'search'; readonly mission: string; readonly request: MissionHistorySearchQuery };

/** One read-only observer amortizes startup without blocking the HTTP event loop. */
function observer(root: string, configuration: ParallixConfiguration, cli: CliInvocation) {
  let child: ReturnType<typeof spawn> | null = null;
  let sequence = 0;
  let closed = false;
  const pending = new Map<number, { owner: ReturnType<typeof spawn>; finish(_error?: Error, _value?: unknown): void }>();
  const start = () => {
    if (child) { return child; }
    // The host stays alive while the observer starts. Publish its compiled
    // modules now so the child can reuse them before the host eventually exits.
    flushCompileCache();
    const launched = workflowObservationSystem.spawn(cli.command, [...cli.args, '--workflow-observe', root], {
      cwd: root, env: { ...configuration.forwardedEnvironment }, stdio: ['ignore', 'ignore', 'ignore', 'ipc'], serialization: 'advanced',
    });
    child = launched;
    const fail = (error: Error) => {
      if (child === launched) { child = null; }
      for (const call of pending.values()) { if (call.owner === launched) { call.finish(error); } }
    };
    launched.on('error', fail);
    launched.on('exit', code => fail(new Error(`Workflow observer exited (${code})`)));
    launched.on('message', value => {
      const response = value as { id: number; value?: unknown; error?: string };
      pending.get(response.id)?.finish(response.error ? new Error(response.error) : undefined, response.value);
    });
    return launched;
  };
  return {
    request<T>(observation: Observation): Promise<T> {
      if (closed || pending.size >= 64) { return Promise.reject(new Error('Workflow observer is closed or busy')); }
      const current = start(); const id = ++sequence;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.get(id)?.finish(new Error('Workflow observation timed out'));
          // The deadline belongs to this caller. Keep finite cold work and its
          // warm graph alive for later requests; close owns child termination.
        }, 10_000);
        pending.set(id, { owner: current, finish(error, value) {
          if (!pending.delete(id)) { return; } clearTimeout(timer);
          if (error) { reject(error); } else { resolve(value as T); }
        } });
        current.send?.({ id, observation }, error => { if (error) { pending.get(id)?.finish(error); } });
      });
    },
    async close(): Promise<void> {
      closed = true;
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
  let tail: Promise<void> = Promise.resolve();
  const respond = async (input: unknown) => {
    const { id, observation } = input as { id: number; observation: Observation };
    try {
      graph ??= await createGraph(root, undefined, { configuration });
      let value: unknown;
      if (observation.kind === 'board') {
        if (!graph.presentationCapabilities || !graph.mission) { throw new Error('Board authority unavailable'); }
        value = await graph.presentationCapabilities.boardProjection.build();
      } else {
        const terminal = terminalFactory(root, configuration);
        value = observation.kind === 'overview' ? terminal.overview(observation.mission)
          : observation.kind === 'live' ? terminal.live(observation.mission)
          : observation.kind === 'page' ? terminal.page(observation.mission, observation.request)
          : terminal.search(observation.mission, observation.request);
      }
      if (process.connected) { process.send?.({ id, value }); }
    } catch (error) { if (process.connected) { process.send?.({ id, error: error instanceof Error ? error.message : String(error) }); } }
  };
  process.on('message', input => { tail = tail.then(() => respond(input)); });
  process.once('disconnect', () => { void tail.finally(async () => { await graph?.operatorState.close(); process.exit(0); }); });
}

export function workflowObservationCapabilities(root: string, configuration: ParallixConfiguration, cli?: CliInvocation) {
  const reader = observer(root, configuration, cli ?? cliInvocation(process.argv[1]));
  const terminalReader = observer(root, configuration, cli ?? cliInvocation(process.argv[1]));
  return {
    close: async () => { await Promise.all([reader.close(), terminalReader.close()]); },
    board: () => reader.request<BoardProjection>({ kind: 'board' }),
    terminal: {
      overview: (mission: string) => terminalReader.request<ReturnType<ReturnType<typeof createMissionTerminalCapability>['overview']>>({ kind: 'overview', mission }),
      live: (mission: string) => terminalReader.request<ReturnType<ReturnType<typeof createMissionTerminalCapability>['live']>>({ kind: 'live', mission }),
      page: (mission: string, request: MissionHistoryPageRequest) => terminalReader.request<ReturnType<ReturnType<typeof createMissionTerminalCapability>['page']>>({ kind: 'page', mission, request }),
      search: (mission: string, request: MissionHistorySearchQuery) => terminalReader.request<ReturnType<ReturnType<typeof createMissionTerminalCapability>['search']>>({ kind: 'search', mission, request }),
    },
  };
}
