import { basename } from 'node:path';
import React from 'react';
import { render, renderToString } from 'ink';
import type { RepositoryId } from '../../domain/repository.js';
import type { BoardProgressSink } from '../../application/controller/board-command.js';
import type { AgentBlocklistRepository, OperationalHistoryRepository, BoardLaneEventRepository, UsageRepository } from '../../application/ports.js';
import { createBoardProjectionBuilder } from '../../application/projections/create-board-projection-builder.js';
import type { MissionDetail } from '../../application/projections/mission-detail.js';
import { ConcreteMissionReadAdapter } from '../../adapters/backlog/concrete-mission-read-adapter.js';
import { MissionProjectionQuery } from '../../application/projections/mission-query.js';
import { BoardCommandController } from '../../application/controller/board-controller.js';
import { BoardShell } from './shell.js';
import { resolveKnownAgentFamilies } from './agent-config-resolver.js';
export { resolveKnownAgentFamilies } from './agent-config-resolver.js';

// ---------------------------------------------------------------------------
// Fallback empty repositories — used only when the checked adapter is unavailable
// ---------------------------------------------------------------------------

/**
 * Empty fallback repositories for TUI projection when the composition root's
 * The checked adapter is unavailable (CJS rollback bundle, missing built-in module,
 * or database open/migration failure). These are not production authorities;
 * they are the graceful-degradation path.
 */
const EMPTY_BLOCKLIST: AgentBlocklistRepository = {
  async findAll() { return []; },
  async findByAgent() { return undefined; },
  async save(_entry: unknown): Promise<void> {},
  async deleteByAgent(_agent: string): Promise<void> {},
  async clear(): Promise<void> {},
};

const EMPTY_HISTORY: OperationalHistoryRepository = {
  async findAll() { return []; },
  async findByType(_type: string) { return []; },
  async append(_entry: unknown): Promise<void> {},
  async clear(): Promise<void> {},
};

const EMPTY_LANE_EVENTS: BoardLaneEventRepository = {
  async append(_entry: unknown): Promise<boolean> { return false; },
  async findByMissionId(_missionId: string) { return []; },
  async findAll() { return []; },
  async clear(): Promise<void> {},
};

const EMPTY_USAGE: UsageRepository = {
  async findAll() { return []; },
  async findWhere(_predicate: (_record: object) => boolean) { return []; },
  async save(_record: unknown): Promise<void> {},
  async saveAll(_records: readonly unknown[]): Promise<void> {},
  async clear(): Promise<void> {},
};

/**
 * The runtime composition point deliberately has no direct lifecycle adapter.
 * It still supplies the application controller so the UI's only dispatch path
 * is stable and testable; deployments provide the real ActivePort at the
 * application composition boundary as that adapter is extracted.
 */
class UnconfiguredActivePort {
  async validateSlug(_slug: string): Promise<string> { return 'active lifecycle adapter is not configured'; }
  async launch(_slug: string, _agent?: string | null): Promise<never> { throw new Error('unreachable after validation'); }
  async recordLaunch(_slug: string, _agent: string): Promise<never> { throw new Error('unreachable after validation'); }
  async handoff(_slug: string, _agent: string): Promise<void> {}
}

// ---------------------------------------------------------------------------
// Resolve repository identity from the target directory
// ---------------------------------------------------------------------------

function resolveRepositoryId(rootDir: string): RepositoryId {
  const name = basename(rootDir);
  if (!name) {
    throw new Error('Cannot determine repository identity from path');
  }
  return name as RepositoryId;
}

// ---------------------------------------------------------------------------
// px ui — render static BoardProjection shell
// ---------------------------------------------------------------------------

/**
 * Resolve repositories from the production composition root.
 *
 * The TUI receives its operator-state ports from the single composition root
 * rather than opening the database independently. When the adapter is unavailable
 * (CJS rollback, missing module, database failure), falls back to empty
 * repositories.
 */
async function resolveTuiRepositories(
  rootDir: string,
): Promise<{
  blocklistRepo: AgentBlocklistRepository;
  historyRepo: OperationalHistoryRepository;
  laneEventRepo: BoardLaneEventRepository;
  usageRepo: UsageRepository;
}> {
  try {
    const { createProductionApplicationServices } = await import(
      '../../platform/runtime/lib/composition/application-services.js'
    );
    const services = await createProductionApplicationServices(rootDir);
    if (services.operatorState.repositories) {
      // Real repositories from the composition root
      const repos = services.operatorState.repositories;
      return {
        blocklistRepo: repos.agentBlocklist,
        historyRepo: repos.operationalHistory,
        laneEventRepo: repos.boardLaneEvents,
        usageRepo: repos.usage,
      };
    }
  } catch {
    // Adapter unavailable — fall through to empty fallbacks
  }

  return {
    blocklistRepo: EMPTY_BLOCKLIST,
    historyRepo: EMPTY_HISTORY,
    laneEventRepo: EMPTY_LANE_EVENTS,
    usageRepo: EMPTY_USAGE,
  };
}

/**
 * Render the static Ink TUI shell.
 *
 * Obtains one BoardProjection from the composition root using concrete read
 * adapters, renders it with the BoardShell component, and exits cleanly on
 * 'q' keypress or Ctrl+C.
 *
 * Called by the command dispatcher. Uses process.cwd() as the target
 * repository root (set by the px.ts entry before dispatch).
 */
export async function runUiCommand(_args: string[] = []): Promise<number> {
  void _args; // intentionally unused — part of public API signature
  const rootDir = process.cwd();

  const repositoryId = resolveRepositoryId(rootDir);
  const knownAgentFamilies = resolveKnownAgentFamilies(rootDir);

  // Resolve repositories from the production composition root.
  const repos = await resolveTuiRepositories(rootDir);

  const builder = createBoardProjectionBuilder({
    rootDir,
    repositoryId,
    blocklistRepo: repos.blocklistRepo,
    historyRepo: repos.historyRepo,
    laneEventRepo: repos.laneEventRepo,
    usageRepo: repos.usageRepo,
    knownAgentFamilies,
  });

  const projection = await builder.build();
  // Detail materialisation stays in the composition root. BoardShell receives
  // pure projection data and therefore cannot reach the lifecycle authority.
  const missionQuery = new MissionProjectionQuery(
    new ConcreteMissionReadAdapter({ rootDir, repositoryId }),
  );
  const missionDetails: ReadonlyMap<string, MissionDetail> = await missionQuery.allDetails();
  const commandControllerFactory = (progress: BoardProgressSink) =>
    new BoardCommandController(new UnconfiguredActivePort(), progress);
  const refreshProjection = () => builder.build();

  // A piped CLI invocation has no keyboard source. Render one static frame and
  // return so shipped-artifact/headless callers cannot wait forever for `q`.
  if (!process.stdin.isTTY && !process.stdout.isTTY) {
    process.stdout.write(renderToString(React.createElement(BoardShell, { projection, missionDetails, commandControllerFactory, refreshProjection })));
    return 0;
  }

  const { waitUntilExit } = render(
    React.createElement(BoardShell, { projection, missionDetails, commandControllerFactory, refreshProjection }),
    {
      exitOnCtrlC: true,
    },
  );

  const exitCode = await waitUntilExit();
  return typeof exitCode === 'number' ? exitCode : 0;
}
