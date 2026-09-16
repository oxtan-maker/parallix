/**
 * Preflight section for the Forgejo review provider: PR state, approval
 * authority, stale sibling PRs, and the integrating user's token.
 */
import * as fmt from '../presentation/cli-format.js';
import { recoveryEstablishesApproval } from './approval.js';
import { baseTaskSlug } from './support.js';
import type { PreflightReport } from './preflight.js';
import type { IntegrateForgejoPort } from '../ports/integrate-workflow.js';

interface ReviewProviderTarget {
  baseWorktree: string;
  baseBranch: string;
  readTokenFn: IntegrateForgejoPort['readToken'];
  resolveTokenFileFn: IntegrateForgejoPort['resolveTokenFile'];
}

function printMergedPrRecoveryGuidance(log: PreflightReport['log'], slug: string, baseWorktree: string, baseBranch: string) {
  log(fmt.status('INFO', 'Recovery: re-sync the local base branch, confirm the landed commit locally, then retry integrate.'));
  log(fmt.status('INFO', `  git -C ${baseWorktree} fetch --all --prune`));
  log(fmt.status('INFO', `  git -C ${baseWorktree} checkout ${baseBranch}`));
  log(fmt.status('INFO', `  git -C ${baseWorktree} pull --ff-only`));
  log(fmt.status('INFO', `  px integrate ${slug} --dry-run`));
}

function checkPullRequest(report: PreflightReport, context: any, { baseWorktree, baseBranch }: ReviewProviderTarget, localApprovalFallback: boolean) {
  const { failures, log, detail } = report;
  const lifecycleAuthoritative = context.missionStatus === 'integration' || context.missionStatus === 'done';

  if (context.pr.exists && context.pr.state === 'open') {
    // Review round 1 (F3): predict the authority the real run would establish
    // through recovery; consumed only when the provider state looks
    // unapproved and the Mission lifecycle has not already left review (a
    // dry run has not run recovery, so missionStatus is still stale).
    const recoveryDecision = recoveryEstablishesApproval(context);
    const recoveryWouldEstablishApproval = recoveryDecision.established && recoveryDecision.via !== 'lifecycle';
    detail(`Forgejo PR: PR #${context.pr.number} open`);
    if (lifecycleAuthoritative) {
      // TASK-2379: recovery has established the authoritative approval in
      // the Mission lifecycle; the provider state read at context build
      // time is informational from here on.
      detail(`Forgejo approval: Mission lifecycle is authoritative (${context.missionStatus}); provider state informational (${context.approval.reviewState || 'missing'})`);
    } else if (localApprovalFallback) {
      detail(`Forgejo approval: token unavailable, approval sourced from the local Review (phase=approved)`);
    } else if (!context.approval.ok) {
      failures.push('pr-approval');
      log(fmt.status('FAIL', `Forgejo approval: could not verify an approved review (${context.approval.error})`));
    } else if (context.approval.reviewState !== 'APPROVED' && !recoveryWouldEstablishApproval) {
      failures.push('pr-approval');
      log(fmt.status('FAIL', `Forgejo approval: latest formal review state is ${context.approval.reviewState || 'missing'}, expected APPROVED`));
    } else if (context.approval.reviewState !== 'APPROVED') {
      // A dry run has not run recovery, so the provider state read at
      // context-build time looks unapproved. Report the authority the real
      // run would establish instead of failing for exactly the case the
      // real run accepts.
      detail(`Forgejo approval: recovery would establish the authoritative approval (${recoveryDecision.via} at ${recoveryDecision.decidedAt || 'n/a'}); provider state informational (${context.approval.reviewState || 'missing'})`);
    } else {
      detail(`Forgejo approval: latest formal review state is ${context.approval.reviewState}`);
    }
  } else if (context.pr.exists && context.pr.state === 'merged') {
    if (lifecycleAuthoritative) {
      detail(`Forgejo PR: PR #${context.pr.number} is already marked merged; Mission lifecycle is authoritative (${context.missionStatus})`);
    } else {
      failures.push('pr-merged');
      log(fmt.status('FAIL', `Forgejo PR: PR #${context.pr.number} is already marked merged`));
      printMergedPrRecoveryGuidance(log, context.slug, baseWorktree, baseBranch);
    }
  } else if (context.pr.exists) {
    failures.push('pr-state');
    log(fmt.status('FAIL', `Forgejo PR: unexpected state '${context.pr.state}'`));
  } else {
    failures.push('pr-missing');
    log(fmt.status('FAIL', `Forgejo PR: ${context.pr.raw || 'no PR found'}`));
  }
}

export function checkReviewProvider(report: PreflightReport, context: any, target: ReviewProviderTarget) {
  const { failures, warnings, log, detail } = report;
  const localApprovalFallback = context.approval?.source === 'local-review-state';

  checkPullRequest(report, context, target, localApprovalFallback);

  if (context.siblingPrs && context.siblingPrs.length > 0) {
    warnings.push('sibling-prs');
    log(fmt.status('WARN', `Multiple open PRs detected for ${baseTaskSlug(context.slug)}. Close stale PRs before integrating:`));
    context.siblingPrs.forEach((sibling: any) => {
      log(fmt.status('INFO', `  - PR #${sibling.number} (${sibling.head}): ${sibling.html_url}`));
    });
  }

  if (context.forgejoUser) {
    const tokenPath = target.resolveTokenFileFn(context.forgejoUser);
    const token = target.readTokenFn(context.forgejoUser);
    if (token) {
      detail(`Forgejo token: resolved for ${context.forgejoUser} (${tokenPath || 'env:FORGEJO_TOKEN'})`);
    } else if (localApprovalFallback) {
      detail(`Forgejo token: no token file found for ${context.forgejoUser} (approval sourced from the local Review)`);
    } else {
      failures.push('forgejo-token');
      log(fmt.status('FAIL', `Forgejo token: no token file found for ${context.forgejoUser}`));
    }
  } else if (!localApprovalFallback) {
    failures.push('forgejo-token');
    log(fmt.status('FAIL', 'Forgejo token: no forgejoUser configured'));
  }
}
