import { createMissionAuthority } from './mission-authority.js';
import type { ParallixConfiguration } from '../application/ports/configuration.js';

import { MissionCheckpointService, type CheckpointEvidenceReferences } from '../application/mission-checkpoint-service.js';
import { MissionBriefService } from '../application/mission-brief-service.js';
import { MissionAssignmentService } from '../application/mission-assignment-service.js';
import { MissionHandoffService } from '../application/mission-handoff-service.js';
import { MissionIntakeService } from '../application/mission-intake-service.js';
import { MissionIntegrationService } from '../application/mission-integration-service.js';
import { resolveWorktree } from '../adapters/git/worktree.js';

import fs from 'node:fs';
import type { MissionApplicationServices } from './application-services.js';
import { bindRecoveryPorts } from './recovery-ports.js';

export interface MissionApplicationServiceOverrides {
  readonly configuration?: ParallixConfiguration;
  readonly inheritWorkflowAuthorization?: boolean;
  /** Repository ID override (for test fixtures). */
  readonly repositoryId?: string;
  /** Database path override (for test fixtures). */
  readonly databasePath?: string;
}

/** Recording resolves evidence references in the Mission's checkout, as handoff does. */
export function checkpointEvidenceReferences(): CheckpointEvidenceReferences {
  return { fileSystem: { existsSync: target => fs.existsSync(target), readText: target => fs.readFileSync(target, 'utf8'),
    listNames: target => fs.readdirSync(target), listEntries: target => fs.readdirSync(target, { withFileTypes: true }) },
    rootFor: (id) => resolveWorktree(id) };
}

export async function createMissionApplicationServices(
  rootDir: string,
  overrides: MissionApplicationServiceOverrides = {},
): Promise<MissionApplicationServices> {
  const { db, repositoryId: repoId, store, lifecycle } = await createMissionAuthority(rootDir, overrides);
  const { SqliteOperationalHistoryRepository } = await import('../adapters/sqlite/operational-history-repository.js');
  const { SqliteBoardLaneEventRepository } = await import('../adapters/sqlite/board-lane-event-repository.js');
  const { SqliteUsageRepository } = await import('../adapters/sqlite/usage-repository.js');
  const readStatsMissionFlow = async () => (await import('./stats.js')).createStatsMissionFlowReader({
    rootDir, missionStore: store, repositoryId: repoId,
    laneEventRepo: new SqliteBoardLaneEventRepository(db), usageRepo: new SqliteUsageRepository(db),
  })();
  bindRecoveryPorts({ operationalHistory: new SqliteOperationalHistoryRepository(db) }, { repositoryId: repoId, store }, rootDir);
  const operationalHistory = new (await import('../application/services/operational-history-service.js')).OperationalHistoryService(new SqliteOperationalHistoryRepository(db));
  return {
    store,
    operationalHistory,
    readStatsMissionFlow,
    repositoryId: repoId,
    intake: new MissionIntakeService(store),
    lifecycle,
    integration: new MissionIntegrationService(store),
    checkpoints: new MissionCheckpointService(store, checkpointEvidenceReferences()),
    brief: new MissionBriefService(store, new SqliteOperationalHistoryRepository(db)),
    assignment: new MissionAssignmentService(store),
    handoff: new MissionHandoffService(store, store),
  };
}
