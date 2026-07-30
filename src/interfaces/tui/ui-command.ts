import { basename } from 'node:path';
import React from 'react';
import { render, renderToString } from 'ink';
import type { RepositoryId } from '../../domain/repository.js';
import type { BoardProgressSink } from '../../application/controller/board-command.js';
import { createBoardProjectionBuilder } from '../../application/projections/create-board-projection-builder.js';
import type { MissionDetail } from '../../application/projections/mission-detail.js';
import { ConcreteMissionReadAdapter } from '../../adapters/backlog/concrete-mission-read-adapter.js';
import { MissionProjectionQuery } from '../../application/projections/mission-query.js';
import { BoardCommandController } from '../../application/controller/board-controller.js';
import { BoardShell } from './shell.js';
import { resolveKnownAgentFamilies } from './agent-config-resolver.js';
export { resolveKnownAgentFamilies } from './agent-config-resolver.js';

// ---------------------------------------------------------------------------
// In-memory stub repositories for read-only TUI shell
// ---------------------------------------------------------------------------

/**
 * The read-only TUI does not open persistence adapters itself. Its host
 * composition root supplies an AgentBlock repository when a live operator
 * projection is needed; the standalone shell stays side-effect free.
 */
class EmptyBlocklistRepository {
  async findAll() { return []; }
  async findByAgent() { return undefined; }
  async save(_entry: unknown): Promise<void> {}
  async deleteByAgent(_agent: string): Promise<void> {}
  async clear(): Promise<void> {}
}

/**
 * Minimal in-memory OperationalHistoryRepository for read-only TUI use.
 * Returns empty history — sufficient for the static shell projection.
 */
class EmptyHistoryRepository {
  async findAll() { return []; }
  async findByType(_type: string) { return []; }
  async append(_entry: unknown): Promise<void> {}
  async clear(): Promise<void> {}
}

/**
 * Minimal in-memory BoardLaneEventRepository for read-only TUI use.
 * Returns empty lane-event log — sufficient for the static shell projection.
 * Lane events are used by Wave 3 flow panel (TASK-2304+).
 */
class EmptyLaneEventRepository {
  async append(_entry: unknown): Promise<boolean> { return false; }
  async findByMissionId(_missionId: string) { return []; }
  async findAll() { return []; }
  async clear(): Promise<void> {}
}

/**
 * Minimal in-memory UsageRepository for read-only TUI use.
 * Returns empty usage records — sufficient for the static shell projection.
 * Usage records are used by Wave 3 metrics (TASK-2304+).
 */
class EmptyUsageRepository {
  async findAll() { return []; }
  async findWhere(_predicate: (_record: object) => boolean) { return []; }
  async save(_record: unknown): Promise<void> {}
  async saveAll(_records: readonly unknown[]): Promise<void> {}
  async clear(): Promise<void> {}
}

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

  const builder = createBoardProjectionBuilder({
    rootDir,
    repositoryId,
    blocklistRepo: new EmptyBlocklistRepository(),
    historyRepo: new EmptyHistoryRepository(),
    laneEventRepo: new EmptyLaneEventRepository(),
    usageRepo: new EmptyUsageRepository(),
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
