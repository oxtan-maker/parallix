import type { CheckpointData } from '../../src/domain/checkpoint.js';
import type { MissionId } from '../../src/domain/mission.js';

/** Older unverified repair CP-2 listed by a later verified same-command repair CP-3 carrying harness exact-success coverage. */
export function coveredRepairCheckpoints(missionId: MissionId, override: Partial<NonNullable<NonNullable<CheckpointData['repair']>['exactSuccessCoverage']>> = {}): CheckpointData[] {
  const occurrence = { openedMissionRevision: 1, worktree: '/fixture', failureRevision: 'failed-head', failureEvidenceId: 'failure:old' };
  const rows = [{ criterion: 'delivers', evidence: 'test/fixtures/covered-repair-checkpoints.ts' }];
  const verifiedOccurrence = { ...occurrence, failureEvidenceId: 'failure:new', checkpoint: 'CP-3', incidentId: 'new', attempt: 1 };
  const coverage = { producer: 'harness-exact-check' as const, missionId, worktree: '/fixture', command: 'npm test',
    authorizedGates: [], authorizedCriteria: ['delivers'], executionRevision: 'fixed-head', executionMissionRevision: 3,
    checkpointEvidenceRevision: 3, verifiedMissionRevision: 4,
    execution: { id: 'receipt', producer: 'rebound-exact-verifier' as const, exitCode: 0 as const,
      startedAt: '2026-11-20T10:00:00Z', completedAt: '2026-11-20T10:01:00Z' },
    verifiedOccurrence, coveredOccurrences: [{ ...occurrence, checkpoint: 'CP-2', incidentId: 'old', attempt: 1 }], ...override };
  const repair = { incidentId: 'repair', command: 'npm test', authorizedGates: [] as string[], authorizedCriteria: ['delivers'],
    attempt: 1, attemptsUsed: 1, maxAttempts: 2, evidenceRecorded: true, verified: false };
  return [
    { missionId, name: 'CP-1', firstLine: 'Implement', goalCheck: rows, nextActionText: 'Run verification' },
    { missionId, name: 'CP-2', firstLine: 'Older repair', goalCheck: rows, nextActionText: 'Repair',
      repair: { ...repair, incidentId: 'old', occurrence } },
    { missionId, name: 'CP-3', firstLine: 'Later repair', goalCheck: rows, nextActionText: 'Repaired',
      recording: { recordedAt: '2026-11-20T10:00:00Z', recordedRound: null, missionRevision: 3 },
      repair: { ...repair, incidentId: 'new', verified: true, occurrence: verifiedOccurrence, exactSuccessCoverage: coverage } },
  ];
}
