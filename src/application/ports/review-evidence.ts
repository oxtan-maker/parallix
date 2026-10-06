/** Revision-pinned repository reads; no working-tree content or language parser. */
export interface ReviewEvidencePort {
  tree(_revision: string): Promise<readonly string[]>;
  source(_revision: string, _path: string): Promise<string>;
  diff(_prior: string, _candidate: string, _paths: readonly string[]): Promise<string>;
}
export interface RepeatFindingEvidence {
  readonly priorRevision: string;
  readonly candidateRevision: string;
  readonly findings: readonly { readonly id: string; readonly summary: string; readonly location: string | null }[];
  readonly priorReviewComment: string;
  readonly implementerResponse: string;
  readonly resolvedFindingIds: readonly string[];
}
