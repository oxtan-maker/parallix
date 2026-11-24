import type { MissionStore } from '../application/domain-ports.js';
import type { ParallixConfiguration } from '../application/ports/configuration.js';
import type { ReviewStartPolicyPorts } from '../application/ports/verification-policy.js';
import type { OperationalHistoryService } from '../application/services/operational-history-service.js';
import { readVerificationHistory, type PolicyHistoryPorts } from '../application/verification-policy/history-adapter.js';
import { missionId } from '../domain/mission.js';
import type { RepositoryId } from '../domain/repository.js';
import { loadEffectiveConfig } from '../adapters/config/product-config.js';
import { createPolicyArtifactLoader } from '../adapters/config/verification-policy.js';
import { createGitChangeIdentity } from '../adapters/git/change-identity.js';
import { snapshotWorktreeTopology } from '../adapters/git/worktree.js';
import { processLivenessProbe } from '../adapters/process/process-liveness.js';
import type { SqliteDatabaseAdapter } from '../adapters/sqlite/database-adapter.js';
import { SqliteIntegrationValidationReader } from '../adapters/sqlite/integration-validation-reader.js';
import { SqliteWorkflowOperationStore } from '../adapters/sqlite/workflow-operation-store.js';
import { VerificationGateEvidenceReader } from '../adapters/verification/gate-evidence-reader.js';

/** Existing authorities required by every verification-policy observation reader. */
export interface VerificationPolicyReaderServices {
  readonly db: SqliteDatabaseAdapter;
  readonly store: MissionStore;
  readonly history: OperationalHistoryService;
  readonly lifecycle: PolicyHistoryPorts['lifecycle'];
  readonly repositoryId: RepositoryId;
}

/** One active policy loader and history reader graph per checkout root. */
export function createVerificationPolicyReaders(
  rootDir: string,
  configuration: ParallixConfiguration,
  services: VerificationPolicyReaderServices,
): Pick<ReviewStartPolicyPorts, 'configuration' | 'loadPolicy' | 'identity'> & {
  readonly readHistoryFor: (_slug: string, _signal?: AbortSignal) => ReturnType<ReviewStartPolicyPorts['readHistory']>;
} {
  const policy = loadEffectiveConfig(rootDir).verificationPolicy;
  const identity = createGitChangeIdentity(rootDir, undefined, { snapshotBranchHeads: true });
  const operations = new SqliteWorkflowOperationStore(services.db, services.repositoryId);
  const readHistoryFor = async (slug: string, _signal?: AbortSignal) => {
    const topology = snapshotWorktreeTopology({ cwd: rootDir });
    const validations = new SqliteIntegrationValidationReader(services.db);
    const gates = new VerificationGateEvidenceReader({ configuration,
      resolveWorktree: id => topology.resolveWorktree(id, { cwd: rootDir }),
      integrationValidation: id => validations.read(id), isProcessAlive: processLivenessProbe });
    return await readVerificationHistory({ store: services.store, gates, history: services.history,
      lifecycle: services.lifecycle, operations, identity },
    { repositoryId: services.repositoryId, missionId: missionId(slug) });
  };
  return {
    configuration: policy,
    loadPolicy: createPolicyArtifactLoader(rootDir, policy),
    identity,
    readHistoryFor,
  };
}
