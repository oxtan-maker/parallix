import type { DecisionConfiguration, ParallixConfiguration } from '../application/ports/configuration.js';
import { createHash, randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import type { ReviewClassificationPorts } from '../application/ports/review-classification.js';
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
