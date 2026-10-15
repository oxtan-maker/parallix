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
import { applyClassifierReview, classifierPolicyForReview } from '../../../src/domain/classifier-review.js';
import { reviewRounds } from '../../../src/application/review-classification/statistics.js';

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
          }, { store });
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
        }, { store });
        upsertMeasurementRow({
          date: '2026-06-02', repo: REPO, mission: UNKNOWN_A, classification: 'ai_sdlc',
          implementer: 'claude', pr_fix_rounds: null, stage: 'default',
        }, { store });
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

it('classifier measurements retain retry cost and precision (TASK-2658)', async () => {
  await withStatisticsDatabase(async ({ db }) => {
    const store = new SqliteReviewClassificationStore(db);
    const first = classificationAttempt();
    await store.recordCall(first);
    await store.recordCall(first);
    await store.recordCall(classificationAttempt({ fingerprint: 'retry', preparationMs: null, classificationMs: 0.33 }));
    const attempts = await store.calls('parallix');
    assert.equal(attempts.length, 2);
    assert.equal(attempts.reduce((n, a) => n + (a.preparationMs ?? 0), 0), 0.15);
    assert.ok(Math.abs(attempts.reduce((n, a) => n + (a.classificationMs ?? 0), 0) - 0.6) < 1e-9);
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

it('local review authority supplies decided totals independently of cross-week samples (TASK-2658)', async () => {
  await withStatisticsDatabase(async ({ db }) => {
    const telemetry = new SqliteReviewClassificationStore(db), store = new SqliteMissionStore(db);
    const initial = repeatReview();
    const sample = classificationAttempt({ repository: REPO, observedAt: '2026-09-27T00:00:00Z', policyVersion: classifierPolicyForReview(initial) });
    const review = applyClassifierReview(initial, { kind: 'classifier', identity: 'jev', decisionId: sample.decisionId,
      provider: 'typesafe', model: 'jev', priorRevision: sample.priorRevision, candidateRevision: sample.candidateRevision,
      findingIds: sample.findingIds, packetHash: sample.packetHash!, policyVersion: sample.policyVersion, label: 'addresses', score: 0.52 },
    'clear', '2026-10-06T00:00:00Z');
    await store.save(fixtureMission(sample.mission, { repositoryId: REPO, status: 'done', closedAt: '2026-10-06T00:01:00Z',
      netEngineeringLines: 1, review }), null);
    await store.save(fixtureMission('still-open', { repositoryId: REPO, status: 'review', review: repeatReview() }), null);
    await telemetry.recordCall(sample);
    await db.execute('INSERT INTO review_classifier_observations (decision_id, payload) VALUES (?, ?)', [sample.decisionId, 'historical-unread-payload']);
    const read = await new SqliteClassifierStatisticsReader(db, telemetry, REPO).read();
    const window = weeklyDecisionWindows('2026-10-06').current;
    const counts = reviewRounds(read, window);
    assert.equal(counts.rounds, 3, 'decided rounds include missing samples and exclude the open round');
    assert.equal(counts.jevDecisions, 1);
    assert.equal(counts.called, 0, 'the call happened before the decision week');
    assert.equal(counts.coverage, 'partial');
    assert.equal(reviewRounds(read, window, 'first review').rounds, 2);
    assert.equal(reviewRounds(read, window, 're-review').rounds, 1);
    const legacyRounds = review.rounds.map(round => round.decision?.classifier
      ? { ...round, decision: { ...round.decision, classifier: { ...round.decision.classifier,
        decisionId: 'legacy-decision', policyVersion: 'repeat-findings-51-90-v1', score: 0.51 } } } : round);
    const legacyReview = { ...review, rounds: [legacyRounds[0], ...legacyRounds.slice(1)] as const } satisfies import("../../../src/domain/review.js").Review;
    await store.save(fixtureMission('legacy-policy', { repositoryId: REPO, status: 'review', review: legacyReview }), null);
    const historical = await new SqliteClassifierStatisticsReader(db, telemetry, REPO).read();
    assert.equal(historical.coverage, 'complete', 'historical policy provenance remains readable after tightening the cutoff');
    assert.equal(reviewRounds(historical, window).jevDecisions, 2);
    assert.deepEqual((await db.query<{ payload: string }>('SELECT payload FROM review_classifier_observations')).map(row => row.payload),
      ['historical-unread-payload'], 'historical observations remain stored and unread');
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
    const counts = reviewRounds({ decisions: [], attempts: rows, coverage: 'complete' }, weeklyDecisionWindows('2026-10-06').current);
    assert.equal(counts.called, 1, 'one workflow attempt retains all provider calls');
    assert.equal(counts.rounds, 0, 'samples do not fabricate decisions');
    await store.recordCall(classificationAttempt({ decisionId: 'historical', fingerprint: 'old' }));
    assert.equal((await store.calls('parallix')).find(row => row.decisionId === 'historical')!.panel, undefined);
    await assert.rejects(store.recordCall({ ...sample, fingerprint: 'oversize', model: 'x'.repeat(17000) }), /bounded allowance/);
    assert.equal((await store.calls('parallix')).length, 2);
  });
});

import { applyReviewerCommand, revokeApprovedDecision, currentReviewRound, startReview, changeRevision, ConfiguredReviewerEligibility } from '../../../src/domain/review.js';
import { agentFamily } from '../../../src/domain/agents.js';

it('mechanical attribution survives SQLite reload without samples (TASK-2734)', async () => {
  await withStatisticsDatabase(async ({ db }) => {
    const store = new SqliteMissionStore(db), telemetry = new SqliteReviewClassificationStore(db);
    const assessedAt = '2026-10-05T12:00:00Z';
    const reviewer = agentFamily('codex'), implementer = agentFamily('custom');
    let review = startReview({ change: { kind: 'pull-request', provider: 'forgejo', id: '1', url: null,
      sourceBranch: 'mission/task-9734', targetBranch: 'main' }, revision: changeRevision('approved'), baseline: changeRevision('base') },
    reviewer, implementer, '2026-10-04T12:00:00Z', ConfiguredReviewerEligibility.fromReviewStep({ eligible: [reviewer], strategy: 'random' }));
    review = applyReviewerCommand(review, { type: 'approve', revision: changeRevision('approved'), decidedAt: '2026-10-04T13:00:00Z', comment: 'reviewed', source: { kind: 'provider', provider: 'forgejo' } });
    review = revokeApprovedDecision(review, 1, { revokedAt: '2026-10-05T10:00:00Z', revokedBy: 'parallix', reason: 'gate failed', cause: { kind: 'integration-gate-failure', gate: 'unit' } });
    const source = { kind: 'mechanical-restoration' as const, approvedRevision: 'approved', candidateRevision: 'approved', failedGate: 'unit',
      validationRevision: 'approved', validatedAt: '2026-10-05T11:00:00Z', validationReference: 'operational_history:42' } satisfies import("../../../src/domain/integration-approval-restoration.js").MechanicalApprovalSource;
    const current = currentReviewRound(review);
    review = { ...review, rounds: [review.rounds[0], { ...current, subject: { ...current.subject, revision: changeRevision('round-start') }, integrationRepairAssessment: {
      assessedAt, outcome: 'restored', approvedRevision: 'approved', candidateRevision: 'approved', failedGate: 'unit', source } }] };
    review = applyReviewerCommand(review, { type: 'approve', revision: changeRevision('approved'), decidedAt: assessedAt, comment: 'mechanical', source });
    const mission = { ...fixtureMission('task-9734', { repositoryId: REPO }), status: 'integration' as const, closedAt: null, review };
    await store.save(mission, null);
    const first = await new SqliteClassifierStatisticsReader(db, telemetry, REPO).read();
    const counts = reviewRounds(first, weeklyDecisionWindows('2026-10-06', 'UTC').current);
    assert.equal(first.decisions.length, 2);
    assert.equal(first.attempts.length, 0);
    assert.deepEqual([counts.rounds, counts.mechanical, counts.reviewer, counts.jevDecisions], [2, 1, 1, 0]);
    assert.equal(counts.coverage, 'partial');

  });
});

it('classifier decision heads survive SQLite reload for both verdicts (TASK-2752)', async () => {
  await withStatisticsDatabase(async ({ db }) => {
    const store = new SqliteMissionStore(db);
    for (const route of ['clear', 'implementer'] as const) {
      const initial = repeatReview();
      const source = { kind: 'classifier' as const, identity: 'jev' as const, decisionId: route, provider: 'typesafe', model: 'jev',
        packetHash: 'd'.repeat(64), priorRevision: 'a'.repeat(40), candidateRevision: 'c'.repeat(40), responseRevision: 'b'.repeat(40),
        findingIds: ['F1'], policyVersion: classifierPolicyForReview(initial), label: route === 'clear' ? 'addresses' : 'does_not_address', score: 0.89 };
      const review = applyClassifierReview(initial, source, route, '2026-10-06T00:00:00Z', [], 'c'.repeat(40));
      const mission = fixtureMission('classifier-' + route, { repositoryId: REPO, status: 'review', review });
      await store.save(mission, null);
      const loaded = await store.load(mission.id);
      assert.equal(loaded.kind, 'found');
      if (loaded.kind !== 'found') { continue; }
      const round = currentReviewRound(loaded.mission.review!);
      assert.equal(round.subject.revision, 'b'.repeat(40));
      assert.equal(round.decision?.revision, 'c'.repeat(40));
      assert.deepEqual(round.decision?.classifier, source);
    }
  });
});

it('obligation shadow probabilities and aggregate survive SQLite readback (TASK-2753)', async () => {
  await withStatisticsDatabase(async ({ db }) => {
    const store = new SqliteReviewClassificationStore(db);
    const sample = classificationAttempt({ shadow: true, policyVersion: 'general-obligations-97-97-v1', route: 'clear',
      obligations: [{ id: 'F1', selected: 'addresses', probabilities: { addresses: 0.97, does_not_address: 0.02, insufficient_evidence: 0.01 }, failure: null }] });
    await store.recordCall(sample);
    assert.deepEqual(await new SqliteReviewClassificationStore(db).calls('parallix'), [sample]);
  });
});
