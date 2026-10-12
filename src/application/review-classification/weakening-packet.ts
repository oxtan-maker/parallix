import type { DecisionRequest } from '../ports/decision.js';
import { EvidenceOverBudgetError, EvidencePreparationError, EvidenceReadError, type MissionRevision, type ReviewEvidencePort } from '../ports/review-evidence.js';
import { isBookkeepingPath } from '../../domain/integration-validation-policy.js';
import type { GateFact } from './gate-fact.js';
import type { MeasureBudget } from './repair-evidence-packet.js';
import { WEAKENING_QUESTION } from './weakening-policy.js';

/** Lines of a retained gate log which name a failure; the whole tail stands in when none match. */
/** Only the decision token budget limits this packet, so repository reads carry no byte ceiling. */
const UNBOUNDED = { unbounded: true } as const;
const FAILURE_LINE = /(?:\bnot ok\b|\bfail(?:ed|ure|ing)?\b|\berror\b|\bAssertionError\b|✖|✗|\bexceed(?:ed|s)?\b|\bMEMORY LIMIT\b)/i;

export function failureLines(log: string | null | undefined): readonly string[] {
  const lines = (log ?? '').split('\n').map(line => line.trimEnd()).filter(line => line.trim());
  const failing = lines.filter(line => FAILURE_LINE.test(line));
  return failing.length ? failing : lines;
}

export interface WeakeningEvidence {
  readonly gate: string;
  readonly log: string | null;
  readonly approved: MissionRevision;
  readonly candidate: MissionRevision;
  readonly fact: GateFact;
}

/** Both main baselines and the main commits a rebase brought in, so rebase-delivered changes are named as such. */
async function rebaseFact(approved: MissionRevision, candidate: MissionRevision, repository: ReviewEvidencePort) {
  const rebased = approved.baseline !== candidate.baseline;
  return { approvedBaseline: approved.baseline, candidateBaseline: candidate.baseline, rebased,
    incorporatedMainCommits: rebased ? await repository.subjects(approved.baseline, candidate.baseline, UNBOUNDED) : [] };
}

/**
 * Packet for the single weakening question. The diff is the plain prior-to-candidate diff restricted to the
 * files whose mission change differs between the two revisions, so main-only changes and Backlog records
 * stay out. Only the decision token budget can refuse it; nothing is cut.
 */
export async function buildWeakeningPacket(input: WeakeningEvidence, repository: ReviewEvidencePort, measure: MeasureBudget): Promise<DecisionRequest> {
  let state: DecisionRequest['state'];
  try {
    const interdiff = await repository.missionInterdiff(input.approved, input.candidate, UNBOUNDED);
    const paths = interdiff.paths.filter(path => !isBookkeepingPath(path));
    if (!paths.length) { throw new EvidencePreparationError('The repair changes no file outside Backlog records'); }
    const [diff, subjects, rebase] = await Promise.all([
      repository.diff(input.approved.revision, input.candidate.revision, paths, UNBOUNDED),
      repository.subjects(input.approved.revision, input.candidate.revision, UNBOUNDED), rebaseFact(input.approved, input.candidate, repository)]);
    state = {
      failedGate: input.gate,
      failureLines: [...failureLines(input.log)],
      repairRange: { before: input.approved.revision, after: input.candidate.revision },
      repairComparison: 'Plain prior-to-candidate diff restricted to files whose mission change differs between the two revisions; Backlog task records and files changed only on main are excluded.',
      changedPaths: paths,
      repairDiff: diff,
      repairCommitSubjects: [...subjects],
      rebase,
      validation: { status: 'passed', failedIntegrationGateRerun: 'passed', gate: input.fact.gate, validationRevision: input.fact.validationSha,
        candidateRevision: input.fact.candidate, relationToCandidate: input.fact.relation, recordedAt: input.fact.recordedAt,
        provenance: 'Parallix integration validation recorded the failed gate green at the validation revision before this review round started.' },
    };
  } catch (error) {
    if (error instanceof EvidencePreparationError || error instanceof EvidenceReadError) { throw error; }
    throw new EvidenceReadError('Repair evidence could not be read');
  }
  const request: DecisionRequest = { state, questions: { resolution: WEAKENING_QUESTION } };
  const budget = measure(request);
  if (budget.inputTokens > budget.maxInputTokens || budget.contextTokens > budget.maxContextTokens) { throw new EvidenceOverBudgetError('Weakening evidence exceeds the decision budget'); }
  return request;
}
