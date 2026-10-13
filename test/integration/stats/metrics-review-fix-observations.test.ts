// Regression provenance: TASK-2357.c.
// Historical regression provenance: TASK-2357, task-201, task-202, task-203, task-204.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { SqliteReviewClassificationStore } from '../../../src/adapters/sqlite/review-classification-store.js';
import { weeklyDecisionWindows } from '../../../src/application/services/decision-window.js';
import { SqliteClassifierStatisticsReader } from '../../../src/adapters/sqlite/classifier-statistics-reader.js';
import { SqliteMissionStore } from '../../../src/adapters/sqlite/mission-store.js';
import { fixtureMission } from '../../fixtures/mission-builders.js';
import { repeatReview, classificationAttempt } from '../../fixtures/repeat-review.js';
import { applyClassifierReview } from '../../../src/domain/classifier-review.js';
import { classifierStatistics, classifierGroups } from '../../../src/application/review-classification/statistics.js';

import { SqliteMeasurementStore } from '../../../src/adapters/sqlite/measurement-store.js';
import { upsertMeasurementRow } from '../../../src/adapters/cli/commands/stats.js';
import { ConcreteMetricsReadAdapter } from '../../../src/application/projections/metrics-read-adapter.js';
import type { MissionId, MissionStatus } from '../../../src/domain/mission.js';
import { missionId } from '../../../src/domain/mission.js';
import { repositoryId } from '../../../src/domain/repository.js';
import {
  fixedClock,
  laneEvent,
  withStatisticsDatabase,
} from '../../fixtures/statistics-database.js';

// ---------------------------------------------------------------------------
// TASK-2357 defect C — an unknown review-fix round count is not a zero.
//
// Four completed missions: one measured 0 rounds, one measured 2, and two never
// had a count derived at all. The cohort population is 4; the review-fix
// observation count is 2; the reported median is the median of [0, 2].
// ---------------------------------------------------------------------------

const REPO = repositoryId('fixture-repo');
const KNOWN_ZERO = missionId('task-201');
const KNOWN_TWO = missionId('task-202');
const UNKNOWN_A = missionId('task-203');
const UNKNOWN_B = missionId('task-204');

const INTAKE = '2026-06-01T09:00:00.000Z';
const DONE = '2026-06-02T09:00:00.000Z';
const NOW = '2026-06-03T09:00:00.000Z';

/** Hand-computed expectations, stated beside the fixture they describe. */
const EXPECTED_POPULATION = 4;
const EXPECTED_REVIEW_FIX_OBSERVATIONS = 2;
const EXPECTED_MEDIAN_REVIEW_FIX_ROUNDS = 1; // median of [0, 2]

describe("defect C: unknown review-fix rounds survive to presentation", () => {
  it('stores an unknown count as SQL NULL and excludes it from cohort aggregates', async () => {
    await withStatisticsDatabase(async ({ db, databasePath, laneEventRepo, usageRepo }) => {
      const rounds: readonly [MissionId, number | null][] = [
        [KNOWN_ZERO, 0],
        [KNOWN_TWO, 2],
        [UNKNOWN_A, null],
        [UNKNOWN_B, null],
      ];

      for (const [mission] of rounds) {
        await laneEventRepo.append(laneEvent({ repositoryId: REPO, missionId: mission, from: null, to: 'backlog', at: INTAKE }));
        await laneEventRepo.append(laneEvent({ repositoryId: REPO, missionId: mission, from: 'backlog', to: 'done', at: DONE }));
      }

      // Write through the production CLI producer, which is where the count is
      // canonicalized before it reaches the measurement store.
      const store = new SqliteMeasurementStore(databasePath);
      try {
        for (const [mission, value] of rounds) {
          upsertMeasurementRow({
            date: '2026-06-02',
            repo: REPO,
            mission,
            classification: 'ai_sdlc',
            implementer: 'claude',
            pr_fix_rounds: value === null ? null : String(value),
            stage: 'default',
          } as never, { store });
        }
      } finally {
        store.close();
      }

      // 1. The unknown values really are SQL NULL in the migrated database.
      const persisted = await db.query<{ mission: string; pr_fix_rounds: unknown }>(
        'SELECT mission, pr_fix_rounds FROM usage_statistics ORDER BY mission ASC;',
      );
      const byMission = new Map(persisted.map((row) => [row.mission, row.pr_fix_rounds]));
      assert.equal(byMission.size, EXPECTED_POPULATION);
      assert.equal(byMission.get(KNOWN_ZERO), 0, 'a measured zero stays a zero');
      assert.equal(byMission.get(KNOWN_TWO), 2);
      assert.equal(byMission.get(UNKNOWN_A), null, 'an unknown count must persist as SQL NULL');
      assert.equal(byMission.get(UNKNOWN_B), null, 'an unknown count must persist as SQL NULL');

      // 2. Read it back through the normal adapters to presentation.
      const metrics = await new ConcreteMetricsReadAdapter({
        laneEventRepo, usageRepo, repositoryId: REPO, clock: fixedClock(NOW),
      }).buildMetrics(new Map<MissionId, MissionStatus>(
        rounds.map(([mission]) => [mission, 'done' as MissionStatus]),
      ));

      const cohort = metrics.cohorts?.cohorts.find((entry) => entry.key === 'ai_sdlc');
      assert.ok(cohort, `expected an ai_sdlc cohort, got ${
        JSON.stringify(metrics.cohorts?.cohorts.map((entry) => entry.key))}`);
      assert.equal(cohort.n, EXPECTED_POPULATION, 'cohort population counts every completed mission');
      assert.equal(
        cohort.observationCounts.reviewFixRounds,
        EXPECTED_REVIEW_FIX_OBSERVATIONS,
        'only the two measured counts are observations',
      );
      assert.equal(cohort.medianReviewFixRounds, EXPECTED_MEDIAN_REVIEW_FIX_ROUNDS);
    });
  });

  it('keeps a measured zero distinct from an unknown count in the outcome model', async () => {
    await withStatisticsDatabase(async ({ databasePath, laneEventRepo, usageRepo }) => {
      for (const mission of [KNOWN_ZERO, UNKNOWN_A]) {
        await laneEventRepo.append(laneEvent({ repositoryId: REPO, missionId: mission, from: null, to: 'backlog', at: INTAKE }));
        await laneEventRepo.append(laneEvent({ repositoryId: REPO, missionId: mission, from: 'backlog', to: 'done', at: DONE }));
      }
      const store = new SqliteMeasurementStore(databasePath);
      try {
        upsertMeasurementRow({
          date: '2026-06-02', repo: REPO, mission: KNOWN_ZERO, classification: 'ai_sdlc',
          implementer: 'claude', pr_fix_rounds: '0', stage: 'default',
        } as never, { store });
        upsertMeasurementRow({
          date: '2026-06-02', repo: REPO, mission: UNKNOWN_A, classification: 'ai_sdlc',
          implementer: 'claude', pr_fix_rounds: null, stage: 'default',
        } as never, { store });
      } finally {
        store.close();
      }

      const outcomes = await new ConcreteMetricsReadAdapter({
        laneEventRepo, usageRepo, repositoryId: REPO, clock: fixedClock(NOW),
      }).readOutcomes();

      const known = outcomes.find((outcome) => outcome.missionId === KNOWN_ZERO);
      const unknown = outcomes.find((outcome) => outcome.missionId === UNKNOWN_A);
      assert.equal(known?.reviewFixRounds, 0, 'a real zero measurement stays 0');
      assert.equal(unknown?.reviewFixRounds, null, 'an unknown count reaches the outcome as null');
    });
  });
});

it('classifier measurements retain retry cost, precision and unobserved outcomes (TASK-2658)', async () => {
  await withStatisticsDatabase(async ({ db }) => {
    const store = new SqliteReviewClassificationStore(db);
    const first = classificationAttempt();
    await store.recordCall(first);
    await store.recordCall(first);
    await store.recordCall(classificationAttempt({ fingerprint: 'retry', preparationMs: null, classificationMs: 0.33 }));
    const applied = { decisionId: 'decision', fingerprint: 'retry', decidedAt: first.observedAt, route: 'clear' as const };
    const attempts = await store.calls('parallix');
    assert.equal(attempts.length, 2);
    const counts = classifierStatistics({ decisions: [], attempts, applied: [applied], observations: [], coverage: 'complete' }, weeklyDecisionWindows('2026-10-06').current);
    assert.equal(counts.calls, 2);
    assert.equal(counts.unobserved, 1);
    assert.equal(counts.preparation.totalMs, 0.15);
    assert.ok(Math.abs(counts.classification.totalMs! - 0.6) < 1e-9);
    await store.recordCall({ ...first, route: 'reviewer', reason: 'classifier-publication-failed' });
    const corrected = await store.calls('parallix');
    assert.equal(corrected.length, 2, 'publication fallback updates the observed route without inventing another call');
    assert.equal(corrected[0].reason, 'classifier-publication-failed');
    assert.equal(corrected[0].classificationMs, first.classificationMs);
    await assert.rejects(store.recordCall({ ...first, classificationMs: 4 }), /different evidence or cost/);
    await store.recordCall(classificationAttempt({ fingerprint: 'shadow', shadow: true }));
    assert.equal((await store.calls('parallix')).filter(s => s.shadow).length, 1);
  });
});

it('local review authority supplies weekly PR totals and completed full-history cohorts (TASK-2658)', async () => {
  await withStatisticsDatabase(async ({ db }) => {
    const telemetry = new SqliteReviewClassificationStore(db), store = new SqliteMissionStore(db);
    const sample = classificationAttempt({ repository: REPO, observedAt: '2026-09-27T00:00:00Z', policyVersion: 'jev-three-question-51-80-89-v1' });
    const review = applyClassifierReview(repeatReview(), { kind: 'classifier', identity: 'jev', decisionId: sample.decisionId,
      provider: 'typesafe', model: 'jev', priorRevision: sample.priorRevision, candidateRevision: sample.candidateRevision,
      findingIds: sample.findingIds, packetHash: sample.packetHash!, policyVersion: sample.policyVersion, label: 'addresses', score: 0.52 },
    'clear', '2026-10-06T00:00:00Z');
    await store.save(fixtureMission(sample.mission, { repositoryId: REPO, status: 'done', closedAt: '2026-10-06T00:01:00Z',
      netEngineeringLines: 1, review }), null);
    await store.save(fixtureMission('still-open', { repositoryId: REPO, status: 'review', review: repeatReview() }), null);
    await telemetry.recordCall(sample);
    const read = await new SqliteClassifierStatisticsReader(db, telemetry, REPO).read();
    const window = weeklyDecisionWindows('2026-10-06').current;
    const counts = classifierStatistics(read, window);
    assert.equal(counts.total, 3, 'two verdicts on the closed mission and one on the still-open mission');
    assert.equal(counts.classifier, 1);
    assert.ok(Math.abs(counts.percentage! - 100 / 3) < 1e-9);
    assert.equal(counts.unobserved, 1);
    assert.equal(counts.calls, 0, 'the call happened before the decision week');
    const group = classifierGroups(read, window)![0];
    assert.equal(group.statistics.calls, 1, 'the completed cohort includes its full call history');
    assert.equal(group.reviewRounds, 2);
    assert.equal(group.fixRounds, 1);
    assert.equal(group.missions, 1);
    const legacyRounds = review.rounds.map(round => round.decision?.classifier
      ? { ...round, decision: { ...round.decision, classifier: { ...round.decision.classifier,
        decisionId: 'legacy-decision', policyVersion: 'repeat-findings-51-90-v1', score: 0.51 } } } : round);
    const legacyReview = { ...review, rounds: [legacyRounds[0], ...legacyRounds.slice(1)] as const };
    await store.save(fixtureMission('legacy-policy', { repositoryId: REPO, status: 'review', review: legacyReview }), null);
    const historical = await new SqliteClassifierStatisticsReader(db, telemetry, REPO).read();
    assert.equal(historical.coverage, 'complete', 'historical policy provenance remains readable after tightening the cutoff');
    assert.equal(classifierStatistics(historical, window).classifier, 2);
  });
});

it('restored integration approvals are read back with what later happened to their missions (TASK-2736)', async () => {
  const { WEAKENING_POLICY_VERSION } = await import('../../../src/domain/classifier-review.js');
  await withStatisticsDatabase(async ({ db }) => {
    const telemetry = new SqliteReviewClassificationStore(db), store = new SqliteMissionStore(db);
    const initial = repeatReview();
    const revokedAt = '2026-10-01T00:02:00Z';
    const withdrawn = { ...initial.rounds[0], response: null, decision: { kind: 'approved' as const, decidedAt: '2026-10-01T00:01:00Z', comment: 'Prior approval',
      source: { kind: 'local' as const }, revocation: { revokedAt, revokedBy: 'workflow', reason: 'Gate failed',
        cause: { kind: 'integration-gate-failure' as const, gate: 'unit', command: 'npm test', log: 'x.java:1 failed' } } } };
    const source = { kind: 'classifier' as const, identity: 'jev' as const, decisionId: 'restored', provider: 'typesafe', model: 'jev',
      packetHash: 'c'.repeat(64), priorRevision: 'a'.repeat(40), candidateRevision: 'b'.repeat(40), responseRevision: 'b'.repeat(40),
      findingIds: ['integration-gate-repair'], integrationRepair: { revokedAt, gate: 'unit' }, policyVersion: WEAKENING_POLICY_VERSION, label: 'preserves', score: 0.7,
      weakening: { decisionSource: 'integration-repair-weakening' as const, approvedRevision: 'a'.repeat(40), gate: 'unit', validationSha: 'b'.repeat(40),
        validationRecordedAt: '2026-10-01T00:02:30Z', relation: 'same' as const } };
    const restored = applyClassifierReview({ ...initial, rounds: [withdrawn, initial.rounds[1]] } as typeof initial, source, 'clear', '2026-10-06T00:00:00Z');
    await store.save(fixtureMission('landed-repair', { repositoryId: REPO, status: 'done', closedAt: '2026-10-06T00:01:00Z', netEngineeringLines: 1, review: restored }), null);
    await store.save(fixtureMission('open-repair', { repositoryId: REPO, status: 'integration', review: restored }), null);
    const read = await new SqliteClassifierStatisticsReader(db, telemetry, REPO).read();
    assert.deepEqual(read.repairClears?.map(fact => fact.outcome).sort(), ['landed', 'open']);
    assert.equal(read.repairClears?.[0].decisionId, 'restored');
    assert.equal(read.coverage, 'complete');
  });
});

it('bounded panel telemetry survives persistence without multiplying workflow counts (TASK-2716)', async () => {
  const { runPanel } = await import('../../../src/application/review-classification/panel.js');
  await withStatisticsDatabase(async ({ db }) => {
    const store = new SqliteReviewClassificationStore(db);
    const outcome = await runPanel({ finding: 'x.java:1 drops output' }, {
      available: () => ({ status: 'available', provider: 'typesafe', model: 'jev-latest' }), requestBytes: () => 100,
      requestBudget: () => ({ requestBytes: 100, inputTokens: 500, contextTokens: 200, maxRequestBytes: 1000000,
        maxInputTokens: 64000, maxContextTokens: 30000, tokenizerModel: 'stub' }),
      decide: async () => ({ provider: 'typesafe', model: 'actual-jev', answers: { resolution: {
        type: 'choice', selected: 'addresses', probabilities: { addresses: 0.8, does_not_address: 0.1, insufficient_evidence: 0.1 }, confidence: 0.01,
      } }, usage: { inputTokens: 500, outputTokens: 1, cost: 0.001 } }),
    }, { provider: 'typesafe', model: 'jev-latest' }, () => 'a'.repeat(64));
    const sample = classificationAttempt({ panel: outcome.measurement, policyVersion: outcome.measurement.policyVersion });
    await store.recordCall(sample);
    await store.recordCall(sample);
    const rows = await store.calls('parallix');
    assert.equal(rows.length, 1);
    assert.deepEqual(rows[0].panel, outcome.measurement);
    assert.equal(rows[0].panel!.members[0].model, 'actual-jev');
    assert.equal(rows[0].panel!.members[0].configuredModel, 'jev-latest');
    assert.equal(rows[0].panel!.members[0].usage!.inputTokens, 500);
    const counts = classifierStatistics({ decisions: [], attempts: rows,
      applied: [{ decisionId: sample.decisionId, decidedAt: sample.observedAt, route: 'clear' }], observations: [], coverage: 'complete' },
      weeklyDecisionWindows('2026-10-06').current);
    assert.equal(counts.calls, 1, 'one workflow attempt retains all three provider calls');
    assert.equal(counts.unobserved, 1);
    await store.recordCall(classificationAttempt({ decisionId: 'historical', fingerprint: 'old' }));
    assert.equal((await store.calls('parallix')).find(row => row.decisionId === 'historical')!.panel, undefined);
    await assert.rejects(store.recordCall({ ...sample, fingerprint: 'oversize', model: 'x'.repeat(17000) }), /bounded allowance/);
    assert.equal((await store.calls('parallix')).length, 2);
  });
});

import { applyReviewerCommand, revokeApprovedDecision, currentReviewRound, startReview, changeRevision, reviewFindingId, ConfiguredReviewerEligibility } from '../../../src/domain/review.js';
import { agentFamily } from '../../../src/domain/agents.js';
import { integrationRestorationStatistics } from '../../../src/application/review-loop/integration-restoration-statistics.js';

it('restoration audit and period stats survive SQLite reload and later human corrections before landing (TASK-2734)', async () => {
  await withStatisticsDatabase(async ({ db }) => {
    const store = new SqliteMissionStore(db), telemetry = new SqliteReviewClassificationStore(db);
    const assessedAt = '2026-10-05T12:00:00Z';
    const reviewer = agentFamily('codex'), implementer = agentFamily('custom');
    let review = startReview({ change: { kind: 'pull-request', provider: 'forgejo', id: '1', url: null,
      sourceBranch: 'mission/task-9734', targetBranch: 'main' }, revision: changeRevision('approved'), baseline: changeRevision('base') },
    reviewer, implementer, '2026-10-04T12:00:00Z', ConfiguredReviewerEligibility.fromReviewStep({ eligible: [reviewer], strategy: 'random' }));
    review = applyReviewerCommand(review, { type: 'approve', decidedAt: '2026-10-04T13:00:00Z', comment: 'reviewed', source: { kind: 'provider', provider: 'forgejo' } });
    review = revokeApprovedDecision(review, 1, { revokedAt: '2026-10-05T10:00:00Z', revokedBy: 'parallix', reason: 'gate failed', cause: { kind: 'integration-gate-failure', gate: 'unit' } });
    const source = { kind: 'mechanical-restoration' as const, approvedRevision: 'approved', candidateRevision: 'approved', failedGate: 'unit',
      validationRevision: 'approved', validatedAt: '2026-10-05T11:00:00Z', validationReference: 'operational_history:42' };
    const current = currentReviewRound(review);
    review = { ...review, rounds: [review.rounds[0], { ...current, integrationRepairAssessment: {
      assessedAt, outcome: 'restored', approvedRevision: 'approved', candidateRevision: 'approved', failedGate: 'unit', source } }] };
    review = applyReviewerCommand(review, { type: 'approve', decidedAt: assessedAt, comment: 'mechanical', source });
    const mission = { ...fixtureMission('task-9734', { repositoryId: REPO }), status: 'integration' as const, closedAt: null, review };
    let version = await store.save(mission, null);
    const reader = new SqliteClassifierStatisticsReader(db, telemetry, REPO);
    const window = weeklyDecisionWindows('2026-10-06', 'UTC').current;
    const first = await reader.read();
    assert.equal(first.decisions.length, 1, 'only the original reviewer decision, never the restoration');
    assert.equal(first.attempts.length, 0, 'mechanical source does not become classifier telemetry');
    const s = integrationRestorationStatistics(first.integrationRepairs!, window);
    assert.deepEqual([s.restores, s.observed, s.unobserved, s.observedWrong], [1, 0, 1, 0]);
    assert.equal(s.medianNormalReviewCostUsd, null);
    const corrected = revokeApprovedDecision(review, 2, { revokedAt: '2026-10-12T10:00:00Z', revokedBy: 'human', reason: 'incorrect restore', cause: { kind: 'operator' } });
    version = await store.save({ ...mission, status: 'review', review: corrected }, version);
    const correctedStats = integrationRestorationStatistics((await reader.read()).integrationRepairs!, window);
    assert.deepEqual([correctedStats.observedWrong, correctedStats.observed, correctedStats.unobserved], [1, 1, 0]);
    // A later requested change also observes the restore, without double-counting the revocation.
    const requested = applyReviewerCommand(corrected, { type: 'request-changes', decidedAt: '2026-10-12T11:00:00Z', comment: 'wrong',
      findings: [{ id: reviewFindingId('F1'), summary: 'correct the repair', location: null }] });
    version = await store.save({ ...mission, status: 'active', review: requested }, version);
    assert.equal(integrationRestorationStatistics((await reader.read()).integrationRepairs!, window).observedWrong, 1);
    // Ignore corrections after recorded landing; no correctness is inferred from landing itself.
    await store.save({ ...mission, status: 'done', closedAt: '2026-10-10T12:00:00Z', review: requested }, version);
    assert.equal(integrationRestorationStatistics((await reader.read()).integrationRepairs!, window).unobserved, 1);
  });
});
