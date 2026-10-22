

import { attachWorkflowOperations, observeWorkflowOperations } from './workflow-operations.js';
import type { ParallixConfiguration } from '../application/ports/configuration.js';

import { type Command } from '../interfaces/cli/runtime.js';
import { createProductionApplicationServices, type ProductionApplicationServiceOptions } from './application-services.js';

export function createCliServiceScope(rootDir: string, configuration: ParallixConfiguration) {
  const openServices = (root: string, progress?: Parameters<typeof createProductionApplicationServices>[1], options: Omit<ProductionApplicationServiceOptions, 'configuration'> = {}) =>
    createProductionApplicationServices(root, progress, { ...options, configuration }).then(observeWorkflowOperations);
  const openWorkflowServices = async (root: string, progress?: Parameters<typeof createProductionApplicationServices>[1]) =>
    attachWorkflowOperations(root, configuration, await openServices(root, progress), false, progress);
  const withGraph = async (
    invoke: (_services: Awaited<ReturnType<typeof createProductionApplicationServices>>) => unknown,
    options: Omit<ProductionApplicationServiceOptions, 'configuration'> = {},
  ) => {
    const services = await openServices(rootDir, undefined, options);
    try { return await invoke(services); } finally { await services.operatorState.close(); }
  };
  const withMissionFactories = async (invoke: (_missionServicesFn: (rootDir: string) => Promise<import('./application-services.js').MissionApplicationServices>) => unknown, borrowed?: Awaited<ReturnType<typeof createProductionApplicationServices>>) => {
    const opened: Awaited<ReturnType<typeof createProductionApplicationServices>>[] = [];
    const missionServicesFn = async (requestedRoot: string) => {
      const existing = requestedRoot === rootDir ? borrowed : undefined;
      const services = existing ?? await openServices(requestedRoot);
      if (!existing) { opened.push(services); }
      if (!services.mission) { throw new Error('mission services are unavailable'); }
      return services.mission;
    };
    try { return await invoke(missionServicesFn); } finally {
      await Promise.all(opened.map(services => services.operatorState.close()));
    }
  };
  const withMissionAndGraph = (
    run: (_missionServicesFn: (rootDir: string) => Promise<import('./application-services.js').MissionApplicationServices>, _services: Awaited<ReturnType<typeof createProductionApplicationServices>>) => unknown,
    options: Omit<ProductionApplicationServiceOptions, 'configuration'> = {},
    borrowed?: Awaited<ReturnType<typeof createProductionApplicationServices>>,
  ) => {
    const invoke = (services: Awaited<ReturnType<typeof createProductionApplicationServices>>) => withMissionFactories(missionServicesFn => run(missionServicesFn, services), services);
    return borrowed ? invoke(borrowed) : withGraph(invoke, options);
  };
  return { openServices, openWorkflowServices, withGraph, withMissionFactories, withMissionAndGraph };
}
export type CliServiceScope = ReturnType<typeof createCliServiceScope>;

export interface CliCommandContext {
  operatorReview?: boolean;
  rootDir: string; configuration: ParallixConfiguration; packageDir: string; scope: CliServiceScope; active: Command; commands(): Record<string, Command>;
}
