import { reportingWindowContains, type ReportingWindow } from '../../domain/decision-window.js';
import type { ReviewRound } from '../../domain/review.js';
import type { Mission } from '../../domain/mission.js';
import type { IntegrationRepairAssessment, RestorationFallback } from '../../domain/integration-approval-restoration.js';

export interface IntegrationRepairRoundFact {
  readonly id: string;
  readonly assessedAt: string;
  readonly outcome: IntegrationRepairAssessment['outcome'] | 'unrecorded';
  readonly restored: boolean;
  readonly observedWrong: boolean;
  readonly normalReviewMs: number | null;
  readonly normalReviewCostUsd: number | null;
}

/** Later human corrections are observations, not inferred correctness from silence or landing. */
export function integrationRepairFacts(missions: readonly Mission[]): readonly IntegrationRepairRoundFact[] {
  return missions.flatMap(m => (m.review?.rounds ?? []).flatMap((round, index, rounds): IntegrationRepairRoundFact[] => {
    const assessment = round.integrationRepairAssessment;
    if (!assessment) {
      const prior = rounds[index - 1]?.decision;
      return prior?.kind === 'approved' && prior.revocation?.cause?.kind === 'integration-gate-failure'
        ? [{ id: `${m.repositoryId}:${m.id}:${round.number}`, assessedAt: round.startedAt, outcome: 'unrecorded' as const,
          restored: false, observedWrong: false, normalReviewMs: null, normalReviewCostUsd: null }] : [];
    }
    const restored = round.decision?.kind === 'approved' && round.decision.source.kind === 'mechanical-restoration';
    const observedWrong = restored && restoreCorrectedBeforeLanding(m, round, rounds.slice(index + 1), assessment.assessedAt);
    return [{ id: `${m.repositoryId}:${m.id}:${round.number}`, assessedAt: assessment.assessedAt,
      outcome: assessment.outcome, restored, observedWrong,
      normalReviewMs: restored ? null : assessment.normalReviewMs ?? null,
      normalReviewCostUsd: restored ? null : assessment.normalReviewCostUsd ?? null }];
  }));
}

function median(values: readonly number[]): number | null {
  const sorted = [...values].filter(n => Number.isFinite(n) && n >= 0).sort((a, b) => a - b);
  if (!sorted.length) { return null; }
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

export function integrationRestorationStatistics(facts: readonly IntegrationRepairRoundFact[], window: ReportingWindow) {
  const rows = [...new Map(facts.map(f => [f.id, f])).values()].filter(f => reportingWindowContains(window, f.assessedAt));
  const restores = rows.filter(f => f.restored);
  const reasons: readonly RestorationFallback[] = ['mission-change-differs', 'gate-evidence-missing', 'gate-failed', 'comparison-error'];
  const normal = rows.filter(f => !f.restored && f.outcome !== 'restored' && f.outcome !== 'unrecorded');
  const durations = normal.flatMap(f => f.normalReviewMs === null ? [] : [f.normalReviewMs]);
  const costs = normal.flatMap(f => f.normalReviewCostUsd === null ? [] : [f.normalReviewCostUsd]);
  const duration = median(durations), cost = median(costs);
  const wrong = restores.filter(f => f.observedWrong).length;
  return { rounds: rows.length, unrecorded: rows.filter(f => f.outcome === 'unrecorded' || (f.outcome === 'restored' && !f.restored)).length, restores: restores.length, share: rows.length ? restores.length / rows.length : null,
    fallbacks: Object.fromEntries(reasons.map(r => [r, normal.filter(f => f.outcome === r).length])),
    observedWrong: wrong, observed: wrong, unobserved: restores.length - wrong,
    medianNormalReviewMs: duration, durationMeasurements: durations.length,
    medianNormalReviewCostUsd: cost, costMeasurements: costs.length,
    estimatedAvoidedMs: duration === null ? null : restores.length * duration,
    estimatedAvoidedCostUsd: cost === null ? null : restores.length * cost };
}

function restoreCorrectedBeforeLanding(mission: Mission, round: ReviewRound, later: readonly ReviewRound[], at: string): boolean {
  const beforeLanding = (time: string) => Date.parse(time) > Date.parse(at)
    && (!mission.closedAt || Date.parse(time) < Date.parse(mission.closedAt));
  const revoked = round.decision?.kind === 'approved' ? round.decision.revocation : null;
  return Boolean(revoked?.cause?.kind === 'operator' && beforeLanding(revoked.revokedAt))
    || later.some(r => r.decision?.kind === 'changes-requested' && beforeLanding(r.decision.decidedAt));
}
