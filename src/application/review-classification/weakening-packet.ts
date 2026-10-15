import type { DecisionRequest } from '../ports/decision.js';
import { EvidencePreparationError, EvidenceReadError, type MissionRevision, type ReviewEvidencePort } from '../ports/review-evidence.js';
import { isBookkeepingPath } from '../../domain/integration-validation-policy.js';
import type { GateFact } from './gate-fact.js';
import type { MeasureBudget } from './repair-evidence-packet.js';
import { fitPacket } from './fit-packet.js';
import { weakeningQuestion, INTEGRATION_RERUN_GUARANTEE } from './weakening-policy.js';

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
  readonly fact?: GateFact;
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
 * stay out. Optional evidence is fitted to the decision token budget.
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
    if (!diff.trim()) { throw new EvidencePreparationError('The repair diff is empty'); }
    state = {
      failedGate: input.gate,
      failureLines: [...failureLines(input.log)],
      repairRange: { before: input.approved.revision, after: input.candidate.revision },
      repairComparison: 'Plain prior-to-candidate diff restricted to files whose mission change differs between the two revisions; Backlog task records and files changed only on main are excluded.',
      changedPaths: paths,
      repairDiff: diff,
      repairCommitSubjects: [...subjects],
      rebase,
      validation: input.fact ? { status: 'passed', failedIntegrationGateRerun: 'passed', gate: input.fact.gate, validationRevision: input.fact.validationSha,
        candidateRevision: input.fact.candidate, relationToCandidate: input.fact.relation, recordedAt: input.fact.recordedAt,
        provenance: 'Parallix integration validation recorded the failed gate green at the validation revision before this review round started.' } : { status: 'not-rerun-before-review',
        failedIntegrationGateRerun: INTEGRATION_RERUN_GUARANTEE },
    };
  } catch (error) {
    if (error instanceof EvidencePreparationError || error instanceof EvidenceReadError) { throw error; }
    throw new EvidenceReadError('Repair evidence could not be read');
  }
  const request: DecisionRequest = { state, questions: { resolution: weakeningQuestion(!!input.fact) } };
  const data = state as Record<string, import('../ports/decision.js').DecisionData>;
  const rebase = data.rebase as Record<string, import('../ports/decision.js').DecisionData>;
  return fitPacket(request, measure, { diffKey: 'repairDiff', commits: [
    { values: data.repairCommitSubjects as string[], set: (values, counts) => { data.repairCommitSubjects = [...values]; data.repairCommitCounts = counts; } },
    { values: rebase.incorporatedMainCommits as string[], set: (values, counts) => { rebase.incorporatedMainCommits = [...values]; rebase.commitCounts = counts; } },
  ] });
}
