/** A revision together with the review baseline its mission diff is measured from. */
export interface MissionRevision {
  readonly baseline: string;
  readonly revision: string;
}
/** The mission-only change between an approved subject and its repaired candidate. */
export interface MissionInterdiff {
  /** Diff of the two baseline-relative mission diffs; main-only changes never appear. */
  readonly diff: string;
  /** Files either mission diff touches. */
  readonly paths: readonly string[];
}
/** Why a revision-pinned read produced no usable evidence. */
export class EvidenceReadError extends Error {
  readonly name = 'EvidenceReadError';
  readonly oversize: boolean;
  constructor(message: string, oversize = false) {
    super(message);
    this.oversize = oversize;
  }
}
/** Main commits touching failure-cited paths between the two review baselines. */
export interface MainCommitEvidence {
  readonly revision: string;
  readonly paths: readonly string[];
  readonly diff: string;
}
/** Selection found no candidate source excerpt, independently of token admission. */
export class EvidencePreparationError extends Error {
  readonly name = 'EvidencePreparationError';
}
/** Complete mandatory evidence cannot fit the decision budget; nothing is left to declare as a loss. */
export class EvidenceOverBudgetError extends Error {
  readonly name = 'EvidenceOverBudgetError';
}
/** Revision-pinned repository reads; no working-tree content or language parser. */
export interface ReviewEvidencePort {
  tree(_revision: string): Promise<readonly string[]>;
  source(_revision: string, _path: string): Promise<string>;
  diff(_prior: string, _candidate: string, _paths: readonly string[]): Promise<string>;
  /** Main-side provenance restricted to failure-cited paths between pinned baselines. */
  mainCommits(_beforeBaseline: string, _afterBaseline: string, _paths: readonly string[]): Promise<readonly MainCommitEvidence[]>;
  /** Mission interdiff of `before` and `after`, each measured against its own baseline. */
  missionInterdiff(_before: MissionRevision, _after: MissionRevision): Promise<MissionInterdiff>;
}
export interface ReviewFindingEvidence {
  readonly priorRevision: string;
  readonly candidateRevision: string;
  /** Present for a repair whose subjects both retain a baseline; the repair is then compared mission-to-mission. */
  readonly missionRange?: { readonly approved: MissionRevision; readonly candidate: MissionRevision };
  readonly findings: readonly { readonly id: string; readonly summary: string; readonly location: string | null }[];
  readonly priorReviewComment: string;
  readonly implementerResponse: string;
  /** Human corrections for this round; sent to the classifier as evidence, never used to skip it. */
  readonly humanFeedback?: string;
}
