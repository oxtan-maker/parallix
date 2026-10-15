

import { createMissionTerminalCapability } from './mission-terminal-capability.js';

import { createRunHistoryPort } from '../adapters/cli/commands/run-history.js';
import { createAttachCommand, createHistoryCommand } from '../interfaces/cli/run-history.js';

import { StatusCommandUseCase } from '../application/status-command-use-case.js';
import { createGithubPublishStatusUseCase } from './github-publish-status.js';

import { createStatusCommand } from '../interfaces/cli/status.js';

import { createGithubPublishStatusCommand } from '../interfaces/cli/github-publish-status.js';

import { createStatisticsCommand } from './stats.js';
import {
  createStatusGitAdapter,
  createStatusPrAdapter,
  createStatusAgentAdapter,
  createStatusStaleWorktreesAdapter,
} from '../adapters/cli/commands/status-adapter.js';

import { runWebCommand } from '../interfaces/cli/web.js';
import { loadWebAssets, resolveWebAssetRoot } from '../adapters/web/asset-store.js';
import { type Command } from '../interfaces/cli/runtime.js';

import { createStatusBoardFor } from './status-board.js';

import type { CliCommandContext } from './cli-service-scope.js';

export function createReadCommands(context: CliCommandContext): Record<string, Command> {
  const { rootDir, configuration, packageDir, scope } = context;
  const { openServices, withGraph } = scope;
  const runHistory = createRunHistoryPort({ configuration });
  return {
    history: createHistoryCommand(runHistory),
    attach: createAttachCommand(runHistory),
    stats: (args, options) => withGraph(services => {
      if (!services.mission) { throw new Error('mission services are unavailable'); }
      return createStatisticsCommand({
        ...options, rootDir, missionStore: services.mission.store,
        laneEventRepo: services.operatorState.repositories?.boardLaneEvents,
        usageRepo: services.operatorState.repositories?.usage,
        repositoryId: services.mission.repositoryId,
      })(args, options);
    }),
    'github-publish-status': (args, options) => {
      const useCase = createGithubPublishStatusUseCase();
      return createGithubPublishStatusCommand(useCase)(args, options);
    },
    status: (args, options) => withGraph(services => {
      const board = createStatusBoardFor(services);
      const gitPort = createStatusGitAdapter();
      const prPort = createStatusPrAdapter({ rootDir });
      const agentPort = createStatusAgentAdapter({
        configuration,
        rootDir,
        blocklistRepo: services.operatorState.repositories?.agentBlocklist ?? null,
      });
      const staleWorktrees = createStatusStaleWorktreesAdapter();
      const useCase = new StatusCommandUseCase(board, gitPort, prPort, agentPort, staleWorktrees);
      const cmd = createStatusCommand(useCase);
      return cmd(args, options);
    }),
    web: (args: string[]) => runWebCommand(args, {
      // Packaged browser assets are loaded per invocation so a missing or
      // stale build/web fails the `web` command, not unrelated commands.
      assets: loadWebAssets(resolveWebAssetRoot(packageDir)),
      // Live board data (TASK-2432): the production board service's progress
      // sink becomes the host's SSE sink, and its BoardProjectionBuilder
      // becomes the host's injected build port. The command stays read-only:
      // nothing here dispatches a mutation.
      createBoardSource: async (progress) => {
        const services = await openServices(rootDir, progress);
        const capabilities = services.presentationCapabilities;
        const builder = capabilities?.boardProjection;
        if (!builder) {
          await services.operatorState.close();
          throw new Error('board projection is unavailable for px web');
        }
        const missionTerminal = createMissionTerminalCapability(rootDir, configuration);
        return {
          buildProjection: () => builder.build(),
          // The same guarded BoardCommandController instance the TUI dispatches
          // through (built by composition from the production execute ports,
          // Mission services, current-work port, and Mission store). The web
          // endpoint adds a route, never a second dispatch path; the controller's
          // progress sink is this host's SSE sink.
          commandDispatcher: capabilities.commandController,
          missionTerminal,
          close: () => services.operatorState.close(),
        };
      },
    }),
    ui: async (args: string[]) => {
      const { runUiCommand } = await import('../interfaces/tui/ui-command.js');
      const services = await openServices(rootDir);
      const capabilities = services.presentationCapabilities?.tui;
      if (!capabilities) { throw new Error('operator-state capabilities are unavailable'); }
      return runUiCommand(capabilities, args);
    }
  };
}
