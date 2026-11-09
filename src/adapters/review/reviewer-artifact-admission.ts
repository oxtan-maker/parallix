import * as fmt from '../../application/presentation/cli-format.js';
import type { FailureReason } from '../../domain/failure-reason.js';
import type { ReviewerProcessResult } from './reviewer-result-attribution.js';

type ArtifactFailure = {
  consumed: true;
  ok: false;
  failureReason?: FailureReason;
  diagnostic: string;
};

/** A native run must itself be known-successful; complete files alone carry no authority. */
export function invalidReviewerProcessResult(
  supplied: boolean,
  result: ReviewerProcessResult | null | undefined,
): ArtifactFailure | null {
  if (!supplied || result?.status === 0) { return null; }
  const status = result?.status;
  return { consumed: true, ok: false,
    diagnostic: `Reviewer result has ${status === null || status === undefined ? 'unknown' : `nonzero ${status}`} process status` };
}

/** Report the missing member of the reviewer artifact set before any decision write. */
export function incompleteReviewerArtifacts(context: {
  slug: string; findings: string | null; outcomeMessage: string | null; verdict: string | null;
  findingsPath: string; outcomePath: string; verdictPath: string;
  providerEnabled: boolean; error: (_msg: string) => void;
}): ArtifactFailure | null {
  const { slug, findings, outcomeMessage, verdict, findingsPath, outcomePath, verdictPath, providerEnabled, error } = context;
  const localRepair = providerEnabled
    ? ''
    : ` No provider review posted (provider=none); add a review-outcome.md with a Verdict line or use \`node parallix review <slug> --submit-review approve\`.`;
  if (!findings || !outcomeMessage) {
    const missing: string[] = [];
    if (!findings) { missing.push('findings'); }
    if (!outcomeMessage) { missing.push('outcome'); }
    error(fmt.status('FAIL', `Incomplete reviewer artifacts for ${slug}. Expected ${findingsPath} and ${outcomePath}.${localRepair}`));
    return { consumed: true, ok: false, diagnostic: `Reviewer artifacts incomplete: missing ${missing.join(', ')}` };
  }
  if (!verdict) {
    error(fmt.status('FAIL', `Reviewer artifacts for ${slug} missing verdict. Expected in ${verdictPath} or in ${outcomePath} content.${localRepair}`));
    return { consumed: true, ok: false, diagnostic: 'Reviewer artifacts incomplete: missing verdict' };
  }
  return null;
}
