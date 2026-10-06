import type { Review } from '../../src/domain/review.js';
import { changeRevision, reviewFindingId } from '../../src/domain/review.js';
import { agentFamily } from '../../src/domain/agents.js';
import type { ClassifierCallMeasurement } from '../../src/application/ports/review-classification-telemetry.js';

export function repeatReview(): Review {
  const change = { kind: 'pull-request' as const, provider: 'forgejo', id: '1', url: null, sourceBranch: 'mission/task-2658', targetBranch: 'main' };
  const base = { reviewer: agentFamily('claude'), implementer: agentFamily('codex'), reviewerRetryCount: 0, implementerRetryCount: 0 };
  return { intervention: null, stageLaunches: [], reviewEvents: [], rounds: [{ ...base, number: 1,
    subject: { change, revision: changeRevision('a'.repeat(40)) }, startedAt: '2026-10-01T00:00:00Z', phase: 'pending-approval', disposition: 'CHANGES_MADE',
    decision: { kind: 'changes-requested', decidedAt: '2026-10-01T00:01:00Z', comment: 'Fix output in `x.java`',
      findings: [{ id: reviewFindingId('F1'), summary: 'x.java:1 drops output', location: 'x.java:1' }] },
    response: { kind: 'resolved', respondedAt: '2026-10-01T00:02:00Z', resultingRevision: changeRevision('b'.repeat(40)),
      resolutions: [{ findingId: reviewFindingId('F1'), kind: 'fixed', evidence: 'Preserve output' }] },
    implementerResponseContent: 'Fixed F1 in x.java:1, preserving output.',
  }, { ...base, number: 2, subject: { change, revision: changeRevision('b'.repeat(40)) }, startedAt: '2026-10-01T00:03:00Z',
    phase: 'reviewing', disposition: null, decision: null, response: null }] };
}
export function classificationAttempt(overrides: Partial<ClassifierCallMeasurement> = {}): ClassifierCallMeasurement {
  return { decisionId: 'decision', fingerprint: 'attempt', repository: 'parallix', mission: 'task-2658', round: 2,
    observedAt: '2026-10-06T00:00:00Z', priorRevision: 'a'.repeat(40), candidateRevision: 'b'.repeat(40), findingIds: ['F1'],
    packetHash: 'c'.repeat(64), packetVersion: 'v1', promptVersion: 'v1', policyVersion: 'repeat-findings-52-89-v2', provider: 'typesafe', model: 'jev',
    implementer: 'codex', reviewer: 'claude', label: 'addresses', score: 0.52, route: 'clear', reason: 'resolved', shadow: false,
    preparationMs: 0.15, classificationMs: 0.27, ...overrides };
}
