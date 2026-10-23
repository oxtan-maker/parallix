import { attachWorkflowOperations } from './workflow-operations.js';

import { type Command } from '../interfaces/cli/runtime.js';

import type { CliCommandContext } from './cli-service-scope.js';

export function createReadCommands(context: CliCommandContext): Record<string, Command> {
  const { rootDir, configuration, packageDir, scope } = context;
  const { openServices, withGraph } = scope;
  const history = async (name: 'createHistoryCommand' | 'createAttachCommand', args: string[]) => {
    const [{ createRunHistoryPort }, commands] = await Promise.all([
      import('../adapters/cli/commands/run-history.js'), import('../interfaces/cli/run-history.js'),
    ]);
    return commands[name](createRunHistoryPort({ configuration }))(args);
  };
  return {
    history: args => history('createHistoryCommand', args),
    attach: args => history('createAttachCommand', args),
    stats: (args, options) => withGraph(async services => {
      const { createStatisticsCommand } = await import('./stats.js');
      if (!services.mission) { throw new Error('mission services are unavailable'); }
      return createStatisticsCommand({
        ...options, rootDir, missionStore: services.mission.store,
        laneEventRepo: services.operatorState.repositories?.boardLaneEvents,
        usageRepo: services.operatorState.repositories?.usage,
        repositoryId: services.mission.repositoryId,
      })(args, options);
    }),
    'github-publish-status': async (args, options) => {
      const [{ createGithubPublishStatusUseCase }, { createGithubPublishStatusCommand }] = await Promise.all([
        import('./github-publish-status.js'), import('../interfaces/cli/github-publish-status.js'),
      ]);
      const useCase = createGithubPublishStatusUseCase();
      return createGithubPublishStatusCommand(useCase)(args, options);
    },
    status: (args, options) => withGraph(async services => {
      const [{ createStatusReadBoard }, { StatusCommandUseCase }, { createStatusCommand }, {
        createStatusGitAdapter, createStatusPrAdapter, createStatusAgentAdapter, createStatusStaleWorktreesAdapter,
      }] = await Promise.all([
        import('./status-board.js'), import('../application/status-command-use-case.js'),
        import('../interfaces/cli/status.js'), import('../adapters/cli/commands/status-adapter.js'),
      ]);
      const board = await createStatusReadBoard(services, rootDir, configuration);
      const gitPort = createStatusGitAdapter();
      const prPort = createStatusPrAdapter({ rootDir });
      const agentPort = createStatusAgentAdapter({
        configuration,
        rootDir,
        blocklistRepo: services.operatorState.repositories?.agentBlocklist ?? null,
      });
      const staleWorktrees = createStatusStaleWorktreesAdapter({
        missionStore: services.mission?.store, repositoryId: services.mission?.repositoryId,
      });
      const useCase = new StatusCommandUseCase(board, gitPort, prPort, agentPort, staleWorktrees);
      const cmd = createStatusCommand(useCase);
      return cmd(args, options);
    }, { includePresentationCapabilities: false }),
    web: async (args: string[]) => {
      const [{ runWebCommand }, { loadWebAssets, resolveWebAssetRoot }] = await Promise.all([
        import('../interfaces/cli/web.js'), import('../adapters/web/asset-store.js'),
      ]);
      return runWebCommand(args, {
        // Packaged browser assets are loaded per invocation so a missing or
        // stale build/web fails the `web` command, not unrelated commands.
        assets: loadWebAssets(resolveWebAssetRoot(packageDir)),
        // Live board data (TASK-2432): the production board service's progress
        // sink becomes the host's SSE sink, and its BoardProjectionBuilder
        // becomes the host's injected build port. The command stays read-only:
        // nothing here dispatches a mutation.
        createBoardSource: async (progress) => {
          const services = await attachWorkflowOperations(rootDir, configuration, await openServices(rootDir, progress), true);
          const capabilities = services.presentationCapabilities;
          const builder = capabilities?.boardProjection;
          if (!builder) {
            await services.operatorState.close();
            throw new Error('board projection is unavailable for px web');
          }
          const { workflowObservationCapabilities } = await import('./workflow-observation.js');
          const observation = workflowObservationCapabilities(rootDir, configuration);
          const missionTerminal = observation.terminal;
          return {
            buildProjection: observation.board,
            // The same guarded BoardCommandController instance the TUI dispatches
            // through (built by composition from the production execute ports,
            // Mission services, current-work port, and Mission store). The web
            // endpoint adds a route, never a second dispatch path; the controller's
            // progress sink is this host's SSE sink.
            commandDispatcher: capabilities.commandController,
            missionTerminal,
            close: async () => { await observation.close(); await services.operatorState.close(); },
          };
        },
      });
    },
    ui: async (args: string[]) => {
      const { runUiCommand } = await import('../interfaces/tui/ui-command.js');
      const services = await attachWorkflowOperations(rootDir, configuration, await openServices(rootDir), true);
      const capabilities = services.presentationCapabilities?.tui;
      if (!capabilities) { throw new Error('operator-state capabilities are unavailable'); }
      return runUiCommand(capabilities, args);
    }
  };
}
