import { GitMissionPatchComparison } from '../adapters/review/mission-patch-comparison.js';
import { SqliteIntegrationValidationReader } from '../adapters/sqlite/integration-validation-reader.js';
import type { DecisionConfiguration, ParallixConfiguration } from '../application/ports/configuration.js';
import { createHash, randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import type { ReviewClassificationPorts } from '../application/ports/review-classification.js';
import { OperationalHistoryService } from '../application/services/operational-history-service.js';
import { INTEGRATION_VALIDATION_EVENT_TYPE, parseIntegrationValidationMarker } from '../application/integrate/validation-marker.js';
import { SqliteOperationalHistoryRepository } from '../adapters/sqlite/operational-history-repository.js';
import { createDecisionPort } from './decision.js';
import { GitReviewEvidence } from '../adapters/review/review-evidence.js';
import { SqliteReviewClassificationStore } from '../adapters/sqlite/review-classification-store.js';
import { initOperatorState } from '../adapters/sqlite/adapter-factory.js';
import { readToken } from '../adapters/review/review-adapter.js';
import { postReview } from '../adapters/forgejo/forgejo-pr.js';
import { missionBranchName } from '../adapters/filesystem/mission-utils.js';

/** Operator environment controls classifier opt-out independently of repository configuration. */
export function createReviewClassification(slug: string, worktree: string,
  settings: DecisionConfiguration, configuration?: ParallixConfiguration): ReviewClassificationPorts {
  const raw = settings.reviewMode;
  const mode = raw === undefined || raw === '' || raw === 'on' ? 'enabled' : raw === 'shadow' ? 'shadow' : 'disabled';
  return {
    mode, decision: createDecisionPort(settings), evidence: new GitReviewEvidence(worktree),
    telemetry: async () => new SqliteReviewClassificationStore((await initOperatorState({ configuration })).db),
    async validations(mission) {
      const { db } = await initOperatorState({ configuration });
      const history = new OperationalHistoryService(new SqliteOperationalHistoryRepository(db));
      return (await history.loadAllByTypeForMission(INTEGRATION_VALIDATION_EVENT_TYPE, mission)).flatMap(entry => {
        const marker = parseIntegrationValidationMarker(entry);
        return marker ? [{ sha: marker.sha, hooks: marker.hooks, recordedAt: entry.createdAt }] : [];
      });
    },
    hash: text => createHash('sha256').update(text).digest('hex'), fingerprint: randomUUID,
    now: () => new Date().toISOString(), clock: () => performance.now(),
    async publish(_source, route, summary) {
      const token = readToken('jev', { rootDir: worktree, configuration });
      if (!token) { return false; }
      return postReview(missionBranchName(slug, worktree), token,
        route === 'clear' ? 'approve' : 'request-changes', summary,
        { forgejoUser: 'jev', rootDir: worktree, configuration }).ok;
    },
  };
}

/** Integration restoration has separate mechanisms and no model dependency. */
export function createIntegrationApprovalRestoration(worktree: string, configuration?: ParallixConfiguration): import('../application/ports/integration-approval-restoration.js').IntegrationApprovalRestorationPort {
  const comparison = new GitMissionPatchComparison(worktree);
  return {
    samePatch: (a, b) => comparison.samePatch(a, b),
    now: () => new Date().toISOString(), clock: () => performance.now(),
    async validation(missionId) {
      const { db } = await initOperatorState({ configuration });
      return new SqliteIntegrationValidationReader(db).read(missionId);
    },
  };
}
