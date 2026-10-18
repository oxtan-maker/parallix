/**
 * The one composition of `px status`'s Mission read (StatusBoardPort) from a
 * production service graph. `px status` reports through it, and `px active`
 * resolves its headline title through it, so both commands name a Mission
 * from the same authority with the same precedence: the task-card title
 * first, then the title recorded in the Mission store.
 */
import type { StatusBoardPort } from '../application/ports/cli-workflows.js';
import { createStatusBoardAdapter } from '../adapters/cli/commands/status-adapter.js';
import { missionId } from '../domain/mission.js';
import type { MissionStore } from '../application/domain-ports.js';
import type { BoardProjectionBuilder } from '../application/projections/board-readers.js';
import type { ProductionApplicationServices } from './application-services.js';
import type { ParallixConfiguration } from '../application/ports/configuration.js';

interface StatusBoardServices {
  presentationCapabilities?: { boardProjection: Pick<BoardProjectionBuilder, 'buildMissionCard'> } | null;
  mission?: { store: Pick<MissionStore, 'load'> } | null;
}

/** Status needs the shared board reader, without constructing mutation services. */
export async function createStatusReadBoard(
  services: ProductionApplicationServices, rootDir: string, configuration: ParallixConfiguration,
): Promise<StatusBoardPort> {
  const { repositories, db } = services.operatorState;
  const mission = services.mission;
  if (!repositories || !db || !mission) { return createStatusBoardFor(services); }
  const [{ composeBoardProjection }, { resolveKnownAgentFamilies }, { SqliteSessionMarkerRepository }] = await Promise.all([
    import('./board-projection.js'), import('../adapters/agents/known-agent-families.js'),
    import('../adapters/sqlite/session-marker-repository.js'),
  ]);
  const { builder } = composeBoardProjection({
    configuration, rootDir, missionStore: mission.store, database: db, repositoryId: mission.repositoryId,
    blocklistRepo: repositories.agentBlocklist, historyRepo: repositories.operationalHistory,
    laneEventRepo: repositories.boardLaneEvents, usageRepo: repositories.usage,
    knownAgentFamilies: resolveKnownAgentFamilies(rootDir), sessionMarkers: new SqliteSessionMarkerRepository(db, mission.repositoryId),
  });
  return createStatusBoardFor({ mission, presentationCapabilities: { boardProjection: builder } });
}

/** Build the StatusBoardPort `px status` reads a Mission through. */
export function createStatusBoardFor(services: StatusBoardServices): StatusBoardPort {
  return createStatusBoardAdapter({
    buildProjectionFn: async () => {
      const builder = services.presentationCapabilities?.boardProjection;
      if (!builder) { throw new Error('board projection is unavailable'); }
      return builder;
    },
    // `px status` is the single Mission reporting surface, so it reads the
    // recorded execution context and write version from the store itself.
    loadMissionFn: services.mission
      ? async (slug) => {
        const loaded = await services.mission!.store.load(missionId(slug));
        return loaded.kind === 'found' ? { mission: loaded.mission, version: loaded.version } : null;
      }
      : undefined,
  });
}

/** The Mission title exactly as `px status` reports it, or null when none is known. */
export async function statusMissionTitle(services: StatusBoardServices, slug: string, rootDir: string): Promise<string | null> {
  const data = await createStatusBoardFor(services).getMissionData(slug, rootDir);
  return data?.title ?? null;
}
