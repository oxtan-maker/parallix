import { fixtureMission, inMemoryTransitionStore } from '../fixtures/mission-builders.js';
import { agentFamily } from '../../src/domain/agents.js';
import { changeRevision, ConfiguredReviewerEligibility, startReview } from '../../src/domain/review.js';
import { MissionLifecycleService } from '../../src/application/mission-lifecycle-service.js';
import { bindReviewPersistence } from '../../src/adapters/review/review-persistence.js';

/** A live round using the real decision and lifecycle owners, without operator state. */
export function reviewVerdictFixture(slug: string, reviewerName = 'codex', implementerName = 'claude') {
  const reviewer = agentFamily(reviewerName);
  const implementer = agentFamily(implementerName);
  const revision = 'fixture-reviewed-revision';
  const review = startReview({ change: { kind: 'local-branch', sourceBranch: `mission/${slug}`, targetBranch: 'main' }, revision: changeRevision(revision) },
    reviewer, implementer, '2026-01-01T10:00:00Z',
    ConfiguredReviewerEligibility.fromReviewStep({ eligible: [reviewer], strategy: 'random' }));
  const missionStore = inMemoryTransitionStore(fixtureMission(slug, { status: 'review', rawStatus: 'review', assignee: implementer, review }));
  const lifecycleService = new MissionLifecycleService(missionStore);
  const persistence = bindReviewPersistence(missionStore, lifecycleService);
  // This fixture owns a one-reviewer round. Keep explicit approval refreshes
  // isolated from workstation agent configuration and availability.
  const reviewerRouting = {
    eligibleFamilies: () => [reviewer],
    launcherStatus: () => ({ supported: true, detail: 'fixture reviewer' }),
    nominate: () => reviewer,
    runtimeMatrix: () => [],
  };
  return { missionStore, lifecycleService, revision, readReviewStateFn: persistence.readReviewState,
    writeReviewStateFn: persistence.writeReviewState, createEventFn: persistence.createEvent, reviewerRouting };
}
