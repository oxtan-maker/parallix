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
import type { ProductionApplicationServices } from './application-services.js';

type StatusBoardServices = Pick<ProductionApplicationServices, 'presentationCapabilities' | 'mission'>;

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
