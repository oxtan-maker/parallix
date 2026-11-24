import { MissionLifecycleService } from '../../src/application/mission-lifecycle-service.js';
import type { IntegrationApprovalEvidencePort } from '../../src/application/ports/integration-approval-evidence.js';
import { decideMission } from '../../src/domain/mission-workflow.js';
import { changeRevision, currentReviewRound, replaceCurrentRound } from '../../src/domain/review.js';
import type { AgentFamily } from '../../src/domain/agents.js';
import type { Mission } from '../../src/domain/mission.js';
import { inMemoryTransitionStore } from '../fixtures/mission-builders.js';
import { integrationServices } from './stub-integration-services.js';

/** Approval-retention aggregate with one failed gate and matching validation evidence. */
export function integrationRetentionScenario(original: Mission, implementer: AgentFamily) {
  const review = original.review!;
  const current = currentReviewRound(review);
  const approved = { ...original, review: { ...review, rounds: replaceCurrentRound(review,
    { ...current, subject: { ...current.subject, baseline: changeRevision('base') } }) } };
  const active = decideMission(approved, { type: 'rebound-to-active', agent: implementer,
    cause: { kind: 'integration-gate-failure', gate: 'unit', command: 'npm test', log: 'broken' },
    occurredAt: '2026-09-20T11:05:00Z' });
  const store = inMemoryTransitionStore(active);
  const services = integrationServices({ store, lifecycle: new MissionLifecycleService(store) });
  const evidence: IntegrationApprovalEvidencePort = {
    reconcileHumanFeedback: async () => true, samePatch: async () => true, now: () => '2026-09-20T12:00:00Z',
    validation: async () => ({ missionId: 'task-2620', sha: 'candidate', baseline: 'base', hooks: ['unit'],
      createdAt: '2026-09-20T11:10:00Z', reference: 'operational_history:1' }),
  };
  const input = { slug: 'task-2620', services, evidence,
    candidate: { revision: 'candidate', baseline: 'base' }, head: () => 'candidate' };
  return { approved, active, store, services, evidence, input };
}
