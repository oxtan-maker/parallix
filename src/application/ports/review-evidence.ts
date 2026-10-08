/** Revision-pinned repository reads; no working-tree content or language parser. */
export interface ReviewEvidencePort {
  tree(_revision: string): Promise<readonly string[]>;
  source(_revision: string, _path: string): Promise<string>;
  diff(_prior: string, _candidate: string, _paths: readonly string[]): Promise<string>;
}
export interface ReviewFindingEvidence {
  readonly priorRevision: string;
  readonly candidateRevision: string;
  readonly findings: readonly { readonly id: string; readonly summary: string; readonly location: string | null }[];
  readonly priorReviewComment: string;
  readonly implementerResponse: string;
  /** Human corrections for this round; sent to the classifier as evidence, never used to skip it. */
  readonly humanFeedback?: string;
}
