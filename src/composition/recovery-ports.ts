import { configureRepairCheckpoints } from '../application/ports/repair-checkpoint.js';
import { RepairCheckpointService } from '../application/repair-checkpoint-service.js';

import { configureReboundTelemetry } from '../application/rebound-telemetry.js';
import { resolveCanonicalRepositoryId } from '../adapters/git/repository-identity.js';
import { recoveryEvidenceFileSystem } from '../adapters/filesystem/recovery-evidence-fs.js';
import { setRecoveryEvidenceFileSystem } from '../application/recovery-evidence.js';
import type { MissionStore } from '../application/domain-ports.js';
import type { OperationalHistoryRepository } from '../application/ports/operation-history.js';

export function unavailableMissionTransitionStore(): import('../application/domain-ports.js').MissionTransitionStore {
  const unavailable = async () => ({ kind: 'missing' as const });
  return { load: unavailable, save: async () => { throw new Error('Mission authority is unavailable'); }, saveWithTransition: async () => { throw new Error('Mission authority is unavailable'); } };
}

export function bindRecoveryPorts(
  repositories: { operationalHistory: OperationalHistoryRepository } | null | undefined,
  mission: { repositoryId: string; store: MissionStore } | null | undefined,
  rootDir: string,
): void {
  setRecoveryEvidenceFileSystem(recoveryEvidenceFileSystem);
  configureRepairCheckpoints(new RepairCheckpointService(mission?.store ?? unavailableMissionTransitionStore()));
  configureReboundTelemetry(repositories ? { repositoryId: mission?.repositoryId ?? resolveCanonicalRepositoryId(rootDir), history: repositories.operationalHistory } : null);
}
