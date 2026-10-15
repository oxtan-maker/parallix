import type { DecisionData, DecisionRequest } from '../ports/decision.js';
import { EvidencePreparationError, EvidenceReadError, type ReviewEvidencePort, type ReviewFindingEvidence } from '../ports/review-evidence.js';
import { RESOLUTION_QUESTION, resolveEvidencePath, type EvidencePacket } from './evidence-packet.js';
import { type MeasureBudget } from './repair-evidence-packet.js';

import { fitPacket } from './fit-packet.js';

export { ARCHIVED_PACKING_VERSION } from '../../domain/classifier-review.js';
const COMPLETE = 'Complete selected candidate files supplied. Unreferenced dependencies, external contracts and runtime evidence may be missing. Do not assume missing evidence. Select insufficient_evidence if material.';
type Excerpt = { startLine: number; endLine: number; text: string };

/** Complete pinned selection; admission belongs exclusively to the decision adapter. */
export async function packArchivedState(input: ReviewFindingEvidence, repository: ReviewEvidencePort, worktree?: string): Promise<EvidencePacket> {
  const [priorTree, tree] = await Promise.all([repository.tree(input.priorRevision), repository.tree(input.candidateRevision)]);
  const citationTree = [...new Set([...priorTree, ...tree])];
  const text = [input.priorReviewComment, input.implementerResponse,
    ...input.findings.map(f => `${f.summary} ${f.location ?? ''}`)].join('\n');
  const relative = (path: string) => worktree && path.startsWith(`${worktree.replace(/\/$/, '')}/`)
    ? path.slice(worktree.replace(/\/$/, '').length + 1) : path;
  const tokens = (text.match(/(?<![A-Za-z0-9_./@-])[A-Za-z0-9_./@-]+\.[A-Za-z0-9_+-]+/g) ?? []).map(relative);
  // Exact paths also handle filenames with spaces, which lexical tokens cannot express.
  const cited = citationTree.filter(path => text.includes(path));
  const references = [...new Set([...cited, ...tokens.map(token => resolveEvidencePath(token, citationTree)).filter((p): p is string => p !== null)])];
  const failureText = input.findings.map(f => `${f.summary} ${f.location ?? ''}`).join('\n');
  const failurePaths = references.filter(path => failureText.includes(path) || failureText.includes(path.split('/').at(-1)!));
  const range = input.missionRange;
  const interdiff = range ? await repository.missionInterdiff(range.approved, range.candidate) : null;
  const diff = interdiff ? interdiff.diff : await repository.diff(input.priorRevision, input.candidateRevision, []);
  const changedPaths = interdiff ? [...interdiff.paths] : [...new Set([...diff.matchAll(/^(?:--- a\/|\+\+\+ b\/)(.*)$/gm)].map(m => m[1].replace(/\t$/, '')))];
  const mainCommits = range ? await repository.mainCommits(range.approved.baseline, range.candidate.baseline, failurePaths) : [];
  const paths = [...new Set([...references, ...changedPaths])].filter(path => tree.includes(path));
  const excerpts: Record<string, Excerpt[]> = {};
  for (const path of paths) {
    const source = await repository.source(input.candidateRevision, path);
    if (source) { excerpts[path] = [{ startLine: 1, endLine: source.split(/\r\n|[\n\r\v\f\x1c-\x1e\x85\u2028\u2029]/).length - Number(/[\n\r\v\f\x1c-\x1e\x85\u2028\u2029]$/.test(source)), text: source }]; }
  }
  if (!Object.keys(excerpts).length) { throw new EvidencePreparationError('No selectable candidate source excerpt'); }
  const request: DecisionRequest = { state: {
    finding: input.findings.map(f => `${f.id}: ${f.summary}`).join('\n\n'),
    findings: input.findings.map(finding => ({ ...finding })),
    priorReviewComment: input.priorReviewComment, implementerResponse: input.implementerResponse,
    candidateSourceExcerpts: excerpts, contextOmissions: [], coverage: COMPLETE,
    diff, changedPaths, repairComparison: range
      ? 'Baseline-relative mission interdiff; main-only changes excluded. Main commits touching failure-cited paths are separate provenance, including fixes by main.'
        + (range.approved.baseline !== range.candidate.baseline ? ' Candidate rebased onto a different baseline; rebase-induced and conflict-resolution changes may appear in the interdiff and do not by themselves establish an implementer repair.' : '')
      : 'Missing review baselines: plain revision comparison; may include main changes introduced by rebase.',
    ...(range ? { missionRange: { ...range, approved: { ...range.approved }, candidate: { ...range.candidate } }, mainCommits: mainCommits.map(commit => ({ ...commit })) } : {}),
    validation: 'No runtime execution proof supplied. Comments and implementer responses are unverified claims.',
  }, questions: { resolution: RESOLUTION_QUESTION } };
  return { request, paths: Object.keys(excerpts) };
}

/** Mandatory repair hunks, findings and provenance never yield to optional whole-file context. */
export async function buildArchivedEvidencePacket(input: ReviewFindingEvidence, repository: ReviewEvidencePort,
  measure: MeasureBudget, validation?: DecisionData, worktree?: string): Promise<EvidencePacket> {
  try { await repository.tree(input.priorRevision); }
  catch { throw new EvidenceReadError('Pinned prior revision unavailable'); }
  const packet = await packArchivedState(input, repository, worktree);
  const state = packet.request.state as Record<string, DecisionData>;
  if (input.humanFeedback) { state.humanFeedback = input.humanFeedback; }
  if (validation) { state.validation = validation; }
  const excerpts = state.candidateSourceExcerpts as Record<string, Excerpt[]>;
  const omissions = state.contextOmissions as string[];
  fitPacket(packet.request, measure, { diffKey: 'diff', context: packet.paths.map(path => ({
    text: excerpts[path],
    tokens: measure({ ...packet.request, state: { candidateSourceExcerpts: { [path]: excerpts[path] } } }).inputTokens,
    omit: () => {
      state.coverage = 'Selected evidence supplied; omissions are listed in state. Do not assume missing evidence. Select insufficient_evidence when omitted evidence could decide the answer.';
      delete excerpts[path]; omissions.push(`${path}: complete candidate file omitted by token budget`);
    },
  })), commits: [{ values: (state.mainCommits ?? []) as DecisionData[], set: (values, counts) => {
    state.mainCommits = [...values]; state.mainCommitCounts = counts;
  } }] });
  return { request: packet.request, paths: Object.keys(excerpts) };
}
