import test from 'node:test';
import assert from 'node:assert/strict';
import {
  reconcileRecoveryEvidence,
  recoveryConflictIdentity,
  recoveryIdentity,
  recoveryInstant,
  type StatsRecoveryEvidence,
} from '../../../../src/application/stats-recovery-evidence.js';
import { analyzeStatsRecovery } from '../../../../src/application/stats-recovery-analysis.js';

test('historical recovery identities normalize offsets and retain conflicts (TASK-2834)', () => {
  const identity = recoveryIdentity('forgejo-review', ['repo', 735, 42]);
  const evidence = (raw: Readonly<Record<string, unknown>>): StatsRecoveryEvidence => ({ identity,
    source: 'forgejo-review', kind: 'review-decision', observedAt: recoveryInstant('2026-11-03T07:00:00+01:00'),
    links: { repositoryId: 'repo', missionId: 'task-2834', revision: 'abc', pullRequest: 735 },
    provenance: 'Forgejo GET /pulls/735/reviews id=42', collectionEra: 'historical-reconstruction',
    classification: 'direct-observation', raw });
  assert.equal(evidence({ state: 'REQUEST_CHANGES' }).observedAt, '2026-11-03T06:00:00.000Z');
  assert.throws(() => recoveryInstant('not-a-timestamp'), /Invalid recovery timestamp/);
  const first = evidence({ state: 'REQUEST_CHANGES' });
  const result = reconcileRecoveryEvidence([first, first, evidence({ state: 'APPROVED' })]);
  assert.equal(result.evidence.length, 1);
  assert.equal(result.duplicateCount, 1);
  assert.deepEqual(result.conflicts.map(conflict => conflict.fields), [['raw']]);
  assert.equal(result.conflicts[0]?.retained.raw.state, 'REQUEST_CHANGES');
  const conflict = result.conflicts[0]!;
  assert.equal(recoveryConflictIdentity({ ...conflict, fields: ['raw', 'provenance'] }),
    recoveryConflictIdentity({ ...conflict, retained: conflict.conflicting, conflicting: conflict.retained,
      fields: ['provenance', 'raw'] }), 'conflict identity is independent of collection and field order');
});

test('historical analysis labels coverage, distributions and unavailable telemetry (TASK-2834)', () => {
  const record = (overrides: Partial<StatsRecoveryEvidence>): StatsRecoveryEvidence => ({
    identity: String(overrides.identity), source: overrides.source ?? 'rebound-repair',
    kind: overrides.kind ?? 'repair-attempt', observedAt: overrides.observedAt ?? '2026-10-01T10:00:00.000Z',
    links: overrides.links ?? { repositoryId: 'repo', missionId: 'task-1', revision: 'abc', pullRequest: null },
    provenance: overrides.provenance ?? 'operational_history/rebound.repair/1',
    collectionEra: 'historical-reconstruction', classification: 'direct-observation', raw: overrides.raw ?? {},
  });
  const evidence = [
    record({ identity: 'repair-1', raw: { durationMs: 100, model: 'gpt-6.1-sol', stage: 'integration' } }),
    record({ identity: 'repair-2', observedAt: '2026-10-02T10:00:00Z', raw: { durationMs: 300, model: 'gpt-6.1-sol', stage: 'integration' } }),
    record({ identity: 'pr-1', source: 'forgejo-pr', kind: 'workflow-telemetry',
      links: { repositoryId: 'repo', missionId: 'task-1', revision: 'abc', pullRequest: 735 }, raw: {} }),
    record({ identity: 'review-1', source: 'forgejo-review', kind: 'review-decision', observedAt: '2026-10-01T11:00:00Z',
      links: { repositoryId: 'repo', missionId: 'task-1', revision: 'abc', pullRequest: 735 }, raw: { state: 'REQUEST_CHANGES' } }),
  ];
  const analysis = analyzeStatsRecovery({ rows: [
    { mission: 'task-1', repo: 'repo', date: '2026-10-01', model: 'gpt-6.1-sol', stage: 'execute', pr_fix_rounds: 2 },
    { mission: 'task-2', repo: 'repo', date: '2026-10-02', model: 'claude', stage: 'execute' },
  ], sources: [], changes: [
    { mission: 'task-1', before: [1], beforeObserved: true, after: 2, byImplementer: { codex: 2 }, returns: [
      { identity: 'review:1', author: 'codex', at: '2026-10-01T11:00:00Z', origin: { actor: 'agent',
        stage: 'agent-review', decisionIdentity: 'review:1', revision: 'abc', sender: 'claude', cause: 'changes-requested' } },
      { identity: 'repair:1', author: 'codex', at: '2026-10-02T11:00:00Z', origin: { actor: 'workflow',
        stage: 'workflow', decisionIdentity: 'repair:1', revision: null, sender: 'parallix', cause: 'repair' } },
    ] },
    { mission: 'task-2', before: [], beforeObserved: false, after: null, byImplementer: {}, returns: [] },
  ], recovery: { evidence, conflicts: [], duplicateCount: 0,
    failures: [{ source: 'forgejo-review-comment', detail: 'page unavailable' }], completedSources: ['rebound-repair'] } });
  assert.equal(analysis.metrics.returnsPerMission.classification, 'reconstructed-fact');
  assert.deepEqual([analysis.metrics.returnsPerMission.observationCount, analysis.metrics.returnsPerMission.denominator], [1, 2]);
  assert.deepEqual([analysis.metrics.repairAttemptDuration.median, analysis.metrics.repairAttemptDuration.p90], [200, 280]);
  assert.equal(analysis.metrics.repairAttemptDuration.uncertainty?.confidence,
    'sampling uncertainty only; retention bias is not corrected');
  assert.equal(analysis.metrics.prToReviewTurnaround.median, 3_600_000);
  assert.ok(analysis.cohorts.some(item => item.dimension === 'model' && item.value === 'gpt-6.1-sol'));
  assert.deepEqual(analysis.cohorts.filter(item => item.dimension === 'cause').map(item => item.value).sort(),
    ['changes-requested', 'repair'], 'cause cohorts come from distinct final-owner returns, never approvals');
  assert.equal(analysis.cohorts.some(item => item.dimension === 'cause' && item.value === 'approved'), false);
  assert.ok(analysis.unavailable.some(item => item.metric === 'CPU' && item.classification === 'unavailable'));
  assert.match(analysis.interpretation.missingness.join(' '), /1\/2 return-eligible missions/);
  assert.match(analysis.interpretation.representativeness, /no representativeness claim or correction multiplier/);
  assert.doesNotMatch(JSON.stringify(analysis.metrics), /gateAttempts|cpuUs|dag/);
});
