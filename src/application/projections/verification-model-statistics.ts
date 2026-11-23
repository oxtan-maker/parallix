import { reportingWindowContains, type ReportingWindow } from '../../domain/decision-window.js';
import type { OperationalHistoryEntry } from '../ports/operation-history.js';
import type { ReviewStartDecision, ReviewStartOutcome } from '../ports/verification-policy.js';
import { POLICY_ACTIONS, type PolicyAction } from '../verification-policy/policy-artifact.js';
import { REVIEW_START_DECISION_EVENT } from '../verification-policy/review-start-decision.js';
import { REVIEW_START_OUTCOME_EVENT } from '../verification-policy/review-start-outcome.js';
import { REVIEW_ACTION_STARTED_EVENT, type ReviewActionStarted } from '../ports/review-action-history.js';
import { isReviewActionLimitHit, parseReviewAction } from '../review-action-history.js';

const BIN_COUNT = 5;

export interface CalibrationBin {
  readonly lower: number;
  readonly upper: number;
  readonly count: number;
  readonly meanPredicted: number;
  readonly observedPassRate: number;
}

/** One check's recorded predictions against the outcomes matched to them; every unknown is counted, never imputed. */
export interface CheckCalibration {
  readonly check: PolicyAction;
  /** Decisions that actually ran this check. */
  readonly starts: number;
  readonly matched: number;
  readonly matchedPassed: number;
  readonly unknownPrediction: number;
  /** Known prediction with no matched observed outcome (not settled yet, or the outcome was unobservable). */
  readonly unknownOutcome: number;
  readonly meanPredicted: number | null;
  readonly observedPassRate: number | null;
  /** Mean absolute gap between prediction and observed pass rate over the bins, in percentage points. */
  readonly meanAbsoluteErrorPoints: number | null;
  readonly bins: readonly CalibrationBin[];
}

/** Artifact values of the configured policy: J_mu(pi_0) is the current sequence, V(pi_0) the policy's. */
export interface PolicyModelValues { readonly policyValue: number; readonly currentSequenceValue: number }

export interface ModelSaving {
  readonly policyValue: number | null;
  readonly currentSequenceValue: number | null;
  /** J_mu(pi_0) - V(pi_0); null when an artifact value is unavailable. */
  readonly absolute: number | null;
  /** The absolute saving divided by J_mu(pi_0); null when the saving or a positive denominator is unavailable. */
  readonly percentage: number | null;
}

/** One Mission's recorded review actions against the limit its latest action was recorded under. */
export interface ReviewActionUsage {
  readonly missionId: string;
  readonly actionsUsed: number;
  readonly configuredLimit: number;
  /** Stored limit-hit records; a count at the limit without such a record is not a hit. */
  readonly limitHits: number;
}

export interface VerificationModelStatistics {
  readonly calibration: readonly CheckCalibration[];
  /** Missions with at least one recorded action, in Mission order; a Mission with none is absent, not zero. */
  readonly actions: readonly ReviewActionUsage[];
  /** Action rows that could not be read; they are excluded from `actions`, never counted as an action. */
  readonly unreadableActionRows: number;
  /** Decision or outcome rows that could not be read; they are excluded, never counted as an outcome. */
  readonly unreadableRows: number;
  readonly saving: ModelSaving;
}

const mean = (values: readonly number[]): number => values.reduce((sum, value) => sum + value, 0) / values.length;

/** A row without its non-empty correlation key cannot be matched to a start or an outcome, so it is unreadable. */
function parsed<T extends object>(entries: readonly OperationalHistoryEntry[], type: string, key: keyof T): { readonly rows: T[]; readonly unreadable: number } {
  const rows: T[] = [];
  let unreadable = 0;
  for (const entry of entries.filter(value => value.eventType === type)) {
    try {
      const value = JSON.parse(entry.eventData) as T | null;
      if (value !== null && typeof value === 'object' && typeof value[key] === 'string' && value[key] !== '') { rows.push(value); } else { unreadable += 1; }
    } catch { unreadable += 1; }
  }
  return { rows, unreadable };
}

type Matched = { readonly predicted: number; readonly passed: boolean };

function calibrationOf(check: PolicyAction, starts: readonly ReviewStartDecision[],
  outcomes: ReadonlyMap<string, ReviewStartOutcome>): CheckCalibration {
  const own = starts.filter(start => start.actualAction === check);
  const matched: Matched[] = [];
  let unknownPrediction = 0, unknownOutcome = 0;
  for (const start of own) {
    const predicted = start.predictedPassProbability?.[check];
    if (typeof predicted !== 'number' || !Number.isFinite(predicted) || predicted < 0 || predicted > 1) { unknownPrediction += 1; continue; }
    const passed = outcomes.get(start.idempotencyKey)?.passed;
    if (typeof passed !== 'boolean') { unknownOutcome += 1; continue; }
    matched.push({ predicted, passed });
  }
  const bins = Array.from({ length: BIN_COUNT }, (_unused, index) => matched.filter(row =>
    Math.min(BIN_COUNT - 1, Math.floor(row.predicted * BIN_COUNT)) === index)).flatMap((rows, index) => rows.length === 0 ? [] : [{
    lower: index / BIN_COUNT, upper: (index + 1) / BIN_COUNT, count: rows.length,
    meanPredicted: mean(rows.map(row => row.predicted)), observedPassRate: mean(rows.map(row => Number(row.passed))) }]);
  return { check, starts: own.length, matched: matched.length, matchedPassed: matched.filter(row => row.passed).length,
    unknownPrediction, unknownOutcome,
    meanPredicted: matched.length ? mean(matched.map(row => row.predicted)) : null,
    observedPassRate: matched.length ? mean(matched.map(row => Number(row.passed))) : null,
    meanAbsoluteErrorPoints: matched.length ? bins.reduce((sum, bin) =>
      sum + bin.count * Math.abs(bin.meanPredicted - bin.observedPassRate) * 100, 0) / matched.length : null,
    bins };
}

const finiteOrNull = (value: number | undefined): number | null => typeof value === 'number' && Number.isFinite(value) ? value : null;

/** The model's saving J_mu(pi_0) - V(pi_0); an unavailable value or a zero baseline is unknown, never zero. */
export function modelSaving(values: PolicyModelValues | null | undefined): ModelSaving {
  const policyValue = finiteOrNull(values?.policyValue), currentSequenceValue = finiteOrNull(values?.currentSequenceValue);
  if (policyValue === null || currentSequenceValue === null) { return { policyValue, currentSequenceValue, absolute: null, percentage: null }; }
  // Finite inputs can still overflow when subtracted or divided: a derived value that is not finite is unknown.
  const difference = currentSequenceValue - policyValue;
  const absolute = Number.isFinite(difference) ? difference : null;
  const ratio = absolute === null || currentSequenceValue === 0 ? Number.NaN : absolute / currentSequenceValue * 100;
  return { policyValue, currentSequenceValue, absolute, percentage: Number.isFinite(ratio) ? ratio : null };
}

function actionUsage(history: readonly OperationalHistoryEntry[], repositoryId: string,
  missions: ReadonlySet<string> | undefined,
  windows: readonly ReportingWindow[] | undefined): { readonly usage: readonly ReviewActionUsage[]; readonly unreadable: number } {
  const byMission = new Map<string, ReviewActionStarted[]>();
  let unreadable = 0;
  for (const entry of history.filter(value => value.eventType === REVIEW_ACTION_STARTED_EVENT)) {
    const action = parseReviewAction(entry, repositoryId);
    if (!action) { unreadable += 1; continue; }
    if (action.repositoryId !== repositoryId || (missions && !missions.has(action.missionId))
      || (windows && !windows.some(window => reportingWindowContains(window, action.recordedAt)))) { continue; }
    byMission.set(action.missionId, [...(byMission.get(action.missionId) ?? []), action]);
  }
  const usage = [...byMission].sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0).map(([missionId, rows]) => {
    const latest = rows.reduce((best, row) => row.actionSequence > best.actionSequence ? row : best);
    return { missionId, actionsUsed: latest.actionSequence, configuredLimit: latest.configuredLimit,
      limitHits: rows.filter(isReviewActionLimitHit).length };
  });
  return { usage, unreadable };
}

/**
 * Calibration per check from the recorded review-start decisions of one repository and their settled outcomes, plus the
 * model saving. With reporting windows only decisions recorded inside one of them count. A row recorded without a repository belongs to the one that reads it, as the policy history owner treats it.
 */
export function verificationModelStatistics(history: readonly OperationalHistoryEntry[], repositoryId: string,
  values: PolicyModelValues | null | undefined, missions?: ReadonlySet<string>, windows?: readonly ReportingWindow[]): VerificationModelStatistics {
  const decisions = parsed<ReviewStartDecision>(history, REVIEW_START_DECISION_EVENT, 'idempotencyKey');
  const settled = parsed<ReviewStartOutcome>(history, REVIEW_START_OUTCOME_EVENT, 'startKey');
  const starts = decisions.rows.filter(start => (start.repositoryId === undefined || start.repositoryId === null || start.repositoryId === repositoryId)
    && (!missions || missions.has(start.missionId))
    && (!windows || windows.some(window => reportingWindowContains(window, start.recordedAt))));
  const outcomes = new Map(settled.rows.map(outcome => [outcome.startKey, outcome]));
  const actions = actionUsage(history, repositoryId, missions, windows);
  return { calibration: POLICY_ACTIONS.map(check => calibrationOf(check, starts, outcomes)), saving: modelSaving(values),
    actions: actions.usage, unreadableActionRows: actions.unreadable, unreadableRows: decisions.unreadable + settled.unreadable };
}
