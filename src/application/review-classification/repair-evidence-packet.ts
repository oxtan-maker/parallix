import type { DecisionData, DecisionRequest, DecisionRequestBudget } from '../ports/decision.js';
import { EvidenceOverBudgetError, EvidenceReadError, type ReviewFindingEvidence, type ReviewEvidencePort } from '../ports/review-evidence.js';
import type { EvidencePacket } from './evidence-packet.js';

export const REPAIR_PROMPT_VERSION = 'gate-repair-preservation-v1';
export const REPAIR_PACKET_VERSION = 'complete-repair-token-budget-v1';
export const REPAIR_RESOLUTION_QUESTION = {
  type: 'choice' as const,
  instructions: 'Machine-recorded gate results are authoritative execution facts only at their stated revision and scope. Use them as evidence; do not treat them as implementer claims. Infer individual test execution only when explicitly recorded. Previously approved changes are outside this repair assessment. Do not approve the whole PR, reopen unrelated behavior, or assume omitted material dependencies. A passing gate alone does not prove the obligation was preserved. Assess whether this repair resolves every reported failure while preserving the checked obligation. Use the complete repair diff, relevant supplied code and recorded execution facts together. Disabling or skipping checks, deleting required assertions, suppressing required output, or bypassing required behavior does not resolve the obligation. Select insufficient_evidence only when a material gap prevents this scoped judgment.',
  criteria: {
    addresses: 'The supplied repair and recorded evidence establish resolution of the reported failure without weakening its obligation.',
    does_not_address: 'The failure remains, or the repair merely hides it by weakening or bypassing the checked obligation.',
    insufficient_evidence: 'A material missing fact or ambiguous contract prevents judging this repair.',
  },
};
export type MeasureBudget = (_request: DecisionRequest) => DecisionRequestBudget;

/** Both sides of renames/deletions remain visible, including paths without a log citation. */
function changedPaths(diff: string): string[] {
  const paths = new Set<string>();
  for (const line of diff.split('\n')) {
    const match = line.match(/^(?:--- a\/|\+\+\+ b\/)(.*)$/);
    if (match) { paths.add(match[1]); }
  }
  return [...paths].sort((a, b) => a.localeCompare(b));
}
/** Whether the adapter's token accounting admits the request. */
export function fitsBudget(request: DecisionRequest, measure: MeasureBudget): boolean {
  const b = measure(request);
  return b.requestBytes <= b.maxRequestBytes && b.inputTokens <= b.maxInputTokens && b.contextTokens <= b.maxContextTokens;
}
/** Mission-only interdiff when both subjects kept a baseline; otherwise the plain revision range. */
async function readRepairDiff(input: ReviewFindingEvidence, repository: ReviewEvidencePort) {
  try {
    const [beforeTree, afterTree] = await Promise.all([repository.tree(input.priorRevision), repository.tree(input.candidateRevision)]);
    if (input.missionRange) {
      const interdiff = await repository.missionInterdiff(input.missionRange.approved, input.missionRange.candidate);
      return { beforeTree, afterTree, diff: interdiff.diff, paths: [...interdiff.paths] };
    }
    const diff = await repository.diff(input.priorRevision, input.candidateRevision, []);
    return { beforeTree, afterTree, diff, paths: changedPaths(diff) };
  } catch (error) {
    throw error instanceof EvidenceReadError ? error : new EvidenceReadError('Repair diff could not be read');
  }
}

/** What the repair diff compares, so rebase-induced and conflict-resolution changes are declared rather than hidden. */
function repairComparison(input: ReviewFindingEvidence): string {
  const range = input.missionRange;
  if (!range) {
    return 'No review baseline was recorded for the approved revision: the diff is the plain revision range and may include changes landed on main by a rebase.';
  }
  const rebased = range.approved.baseline !== range.candidate.baseline;
  return `The repair diff compares the mission diff of the approved revision (${range.approved.baseline}..${range.approved.revision}) with the mission diff of the candidate (${range.candidate.baseline}..${range.candidate.revision}); changes made only on main are excluded.`
    + (rebased ? ' The candidate was rebased onto a newer baseline: rebase-induced and conflict-resolution changes appear in this diff and are not the implementer\'s repair of the failure.' : '');
}

interface SourcePair { path: string; before: string | null; after: string | null; coverage: string }

/** Complete repair diff is mandatory; optional context never displaces or truncates it. */
export async function buildRepairEvidencePacket(input: ReviewFindingEvidence, repository: ReviewEvidencePort,
  measure: MeasureBudget, verification?: DecisionData): Promise<EvidencePacket> {
  const { beforeTree, afterTree, diff, paths } = await readRepairDiff(input, repository);
  const comparison = repairComparison(input);
  const pairs: SourcePair[] = [];
  const omitted = new Set(paths);
  const losses: string[] = [];
  const packet = (): DecisionRequest => ({ state: {
    finding: input.findings.map(f => `${f.id}: ${f.summary}`).join('\n\n'),
    priorReviewComment: input.priorReviewComment, implementerResponse: input.implementerResponse,
    ...(input.humanFeedback ? { humanFeedback: input.humanFeedback } : {}),
    repairRange: { before: input.priorRevision, after: input.candidateRevision }, repairComparison: comparison,
    repairDiff: diff, changedPaths: paths, sourcePairs: pairs as unknown as DecisionData,
    contextOmissions: [...omitted].map(p => `${p}: complete source pair omitted; complete repair diff retained`).concat(losses),
    coverage: 'Complete repair diff. Individual source coverage is labelled; unreferenced dependencies are not established. Omitted material contracts require insufficient_evidence.',
    validation: verification ?? { status: 'unknown', specificTestResult: 'unknown', failedIntegrationGateRerun: 'unknown' },
  }, questions: { resolution: REPAIR_RESOLUTION_QUESTION } });
  if (!fitsBudget(packet(), measure)) { throw new EvidenceOverBudgetError('Complete repair diff and failure evidence exceed the decision budget'); }
  const cited = input.findings.map(f => `${f.summary}\n${f.location ?? ''}`).join('\n');
  const tree = [...new Set([...beforeTree, ...afterTree])];
  const basenames = new Map<string, number>();
  for (const path of tree) {
    const name = path.split('/').at(-1)!; basenames.set(name, (basenames.get(name) ?? 0) + 1);
  }
  const referenced = tree.filter(p => cited.includes(p)
    || (basenames.get(p.split('/').at(-1)!) === 1 && cited.includes(p.split('/').at(-1)!)));
  for (const path of referenced) { omitted.add(path); }
  const priority = [...new Set([...paths, ...referenced])].sort((a, b) => Number(referenced.includes(b)) - Number(referenced.includes(a)) || a.localeCompare(b));
  for (const path of priority) {
    let before: string | null;
    let after: string | null;
    try {
      [before, after] = await Promise.all([
        beforeTree.includes(path) ? repository.source(input.priorRevision, path) : Promise.resolve(null),
        afterTree.includes(path) ? repository.source(input.candidateRevision, path) : Promise.resolve(null),
      ]);
    } catch { losses.push(`${path}: pinned source read unavailable`); continue; }
    const pair = { path, before, after, coverage: 'Complete pinned before/after files; null means absent at that revision.' };
    pairs.push(pair); omitted.delete(path);
    if (!fitsBudget(packet(), measure)) {
      pairs.pop();
      pairs.push({ path, before: null, after, coverage: 'Complete candidate file; prior whole file omitted, not absent. All before-change hunks remain in the complete repair diff.' });
      if (!fitsBudget(packet(), measure)) { pairs.pop(); omitted.add(path); }
    }
  }
  const request = packet();
  if (!fitsBudget(request, measure)) { throw new EvidenceOverBudgetError('Repair evidence omissions exceed the decision budget'); }
  return { request, paths };
}
