import type { IntegrationApproval } from '../../application/ports/integration-records.js';
import { dismissStandingApprovals, readToken } from '../forgejo/forgejo.js';
import { PARALLIX_FORGEJO_USER } from './setup-review-repository.js';

export interface ApprovalInvalidation {
  /** False when at least one standing approval could not be dismissed. */
  ok: boolean;
  /** Logins whose approval Parallix dismissed. */
  dismissed: string[];
  errors: string[];
}

/**
 * Dismiss the standing approvals on the mission pull request as the dedicated
 * `parallix` Forgejo login, through the review dismissal API.
 *
 * Parallix never posts a review as another login and never writes a finding
 * nobody raised: the approval is dismissed with the integration failure as
 * the stated reason. A missing `parallix` token is an error, not a silent skip
 * — an undismissed approval must fail closed so the changed revision cannot
 * land under it.
 */
export async function invalidateApprovedPrReview(opts: {
  slug: string;
  branch: string;
  approval: IntegrationApproval | null | undefined;
  summary: string;
  approvedRevision?: string;
  rootDir?: string;
  configuration?: import('../../application/ports/configuration.js').ParallixConfiguration;
  readTokenFn?: typeof readToken;
  dismissFn?: typeof dismissStandingApprovals;
}): Promise<ApprovalInvalidation> {
  const { readTokenFn = readToken, dismissFn = dismissStandingApprovals } = opts;
  if (opts.approval?.ok !== true || opts.approval.providerDisabled === true) { return { ok: true, dismissed: [], errors: [] }; }
  const token = readTokenFn(PARALLIX_FORGEJO_USER, opts.rootDir, opts.configuration);
  if (!token) {
    return { ok: false, dismissed: [], errors: [`no Forgejo token for ${PARALLIX_FORGEJO_USER}; run px setup-review to create the ${PARALLIX_FORGEJO_USER} user so it can dismiss the standing approval on ${opts.branch}`] };
  }
  const result = dismissFn(opts.branch, token, opts.summary, { forgejoUser: PARALLIX_FORGEJO_USER, expectedRevision: opts.approvedRevision, ...(opts.rootDir ? { rootDir: opts.rootDir } : {}), ...(opts.configuration ? { configuration: opts.configuration } : {}) });
  return { ok: result.ok, dismissed: result.dismissed, errors: result.errors };
}

