

import { migrateLegacyAdhocIdsMissions } from '../application/legacy-adhoc-migration.js';

import { createImportLegacyCommand } from '../interfaces/cli/import-legacy.js';
import { createMigrateLegacyAdhocIdsCommand } from '../interfaces/cli/migrate-legacy-adhoc-ids.js';
import { importLegacyMissions } from '../adapters/backlog/legacy-mission-import.js';
import { auditLegacyFiles } from '../adapters/backlog/legacy-mission-audit.js';

import { type Command } from '../interfaces/cli/runtime.js';

import type { CliCommandContext } from './cli-service-scope.js';

export function createLegacyCommands(context: CliCommandContext): Record<string, Command> {
  const { rootDir, scope } = context;
  const { withGraph } = scope;
  return {
    'import-legacy': (args) => withGraph(services => {
      if (!services.mission) { throw new Error('mission services are unavailable'); }
      const mission = services.mission;
      return createImportLegacyCommand(
        ({ dryRun, reconcileCheckpoints, existingOnly }) => importLegacyMissions(
          {
            repositoryId: mission.repositoryId,
            store: mission.store,
            intake: mission.intake,
            dependencies: mission.brief,
          },
          { rootDir, dryRun, reconcileCheckpoints, existingOnly },
        ),
      )(args);
    }),
    'migrate-legacy-adhoc-ids': (args) => withGraph(async services => {
      if (args.length > 0) {
        throw new Error('Usage: px migrate-legacy-adhoc-ids');
      }
      if (!services.mission) { throw new Error('mission services are unavailable'); }
      const mission = services.mission;
      return createMigrateLegacyAdhocIdsCommand(() => migrateLegacyAdhocIdsMissions(mission.store))(args);
    }),
    'audit-legacy': (args) => withGraph(async services => {
      if (args.length > 1 || (args.length === 1 && args[0] !== '--json')) {
        throw new Error('Usage: px audit-legacy [--json]');
      }
      if (!services.mission) { throw new Error('mission services are unavailable'); }
      const report = await auditLegacyFiles(rootDir, services.mission.repositoryId, services.mission.store);
      console.log(args.includes('--json') ? JSON.stringify(report, null, 2) : JSON.stringify({ verdict: report.verdict, counters: report.counters }, null, 2));
      if (report.verdict !== 'GO') { throw new Error('Legacy audit NO-GO'); }
    })
  };
}
