/** Terminal messages for the reviewer stage of the application-owned review loop. */
import * as fmt from '../../application/presentation/cli-format.js';
import { reviewEventRenderer, classifierFallbackMessage, renderReviewVerdict, reviewIndependence, type ReviewLoopRenderers } from './review-loop-output-formatting.js';
import { recordAgentSelectionOutcome } from '../../application/services/agent-selection-telemetry.js';

export const reviewerOutputRenderers = {
  'local-provider': reviewEventRenderer('local-provider', (_event, output) => {
    output.log(fmt.status('INFO', 'Forgejo validation skipped (review provider is not forgejo). Using workflow-owned review surfaces.'));
    return;
  }),
  'review-resumed': reviewEventRenderer('review-resumed', (event, output) => {
    output.log(fmt.status('INFO', `Resuming review loop from round ${event.round} (${event.phase}).`));
    return;
  }),
  'round-started': reviewEventRenderer('round-started', (event, output) => {
    output.log('\n' + fmt.status('INFO', `========== Round ${event.attempt} / ${event.maxAttempts} ==========`));
    return;
  }),
  'review-reset': reviewEventRenderer('review-reset', (event, output) => {
    output.log(fmt.status('INFO', `Review state reset for ${event.slug}.`));
    return;
  }),
  'reviewer-escalated': reviewEventRenderer('reviewer-escalated', (event, output) => {
    output.log(fmt.status('INFO', `Autonomous review stopped: human review required after reviewer ${event.reason}.`));
    return;
  }),
  'approved-round-revoked': reviewEventRenderer('approved-round-revoked', (event, output) => {
    output.log(fmt.status('INFO', `${event.operator} requested changes on ${event.slug}; round ${event.round} approval revoked on their authority. Continuing with their correction.`));
    return;
  }),
  'approved-round-correction': reviewEventRenderer('approved-round-correction', (event, output) => {
    if (event.diagnostic) { output.log(fmt.status('INFO', `Approval revocation failed: ${event.diagnostic}`)); }
    output.log(fmt.status('INFO', `A human requested changes on ${event.slug} while its round ${event.round} approval is still effective. Run: px revoke-review --slug ${event.slug} --decision ${event.round} --reason <text> --operator <name>, then px review ${event.slug} --continue.`));
    return;
  }),
  'attempts-exhausted': reviewEventRenderer('attempts-exhausted', (event, output) => {
    output.log(fmt.status('INFO', `Autonomous review stopped: reached ${event.maxAttempts} attempts. Hand off to human review.`));
    return;
  }),
  'controller-active': reviewEventRenderer('controller-active', (event, output) => {
    output.log(fmt.status('INFO', `Review controller already active for ${event.slug}; this invocation is not starting a competing loop. Run px review ${event.slug} --continue after the active controller stops if the authoritative round still needs work.`));
    return;
  }),
  'local-review': reviewEventRenderer('local-review', (event, output) => {
    output.log(fmt.status('INFO', `Round ${event.attempt}: review provider disabled; using workflow-owned review state.`));
    return;
  }),
  'review-probe': reviewEventRenderer('review-probe', (event, output) => {
    output.log(fmt.status('INFO', `Round ${event.attempt}: checking for existing review by ${event.reviewer} since ${event.startedAt}...`));
    return;
  }),
  'autonomous-reviewer-dry-run': reviewEventRenderer('autonomous-reviewer-dry-run', (event, output) => {
    output.log(fmt.status('INFO', `Round ${event.attempt}: reviewer identity is autonomous; skipping dry-run reviewer prompt and using local review artifacts only.`));
    return;
  }),
  'reviewer-dry-run-header': reviewEventRenderer('reviewer-dry-run-header', (event, output) => {
    output.log(`\n--- DRY-RUN: reviewer (${event.reviewer}) prompt ---`);
    return;
  }),
  'reviewer-dry-run-prompt': reviewEventRenderer('reviewer-dry-run-prompt', (event, output) => {
    output.log(event.prompt);
    return;
  }),
  'autonomous-reviewer': reviewEventRenderer('autonomous-reviewer', (event, output) => {
    output.log(fmt.status('INFO', `Round ${event.attempt}: reviewer identity is autonomous; skipping reviewer launch and using local review artifacts only.`));
    return;
  }),
  'reviewer-launching': reviewEventRenderer('reviewer-launching', (event, output) => {
    output.log(fmt.status('INFO', `Round ${event.attempt}: launching reviewer (${event.reviewer})...`));
    return;
  }),
  'reviewer-classification': reviewEventRenderer('reviewer-classification', (event, output) => {
    output.log(fmt.status('INFO', classifierFallbackMessage(event.reason)));
    return;
  }),
  'decision-key-missing': reviewEventRenderer('decision-key-missing', (_event, output) => {
    output.log(fmt.status('WARN', 'Reviewer classifier not used: this px process has no decision provider key (TYPESAFE_API_KEY, OPENROUTER_API_KEY or AI_GATEWAY_API_KEY). '
      + 'Export one where non-interactive shells read it, before the interactive guard in ~/.bashrc or in ~/.profile, and run px from your own terminal: launched agents never receive these keys. Continuing with the general reviewer.'));
    return;
  }),
  'reviewer-launch-failed': reviewEventRenderer('reviewer-launch-failed', (event, output) => {
    output.error(fmt.status('FAIL', `Could not launch reviewer agent (${event.reviewer}): ${event.message}`));
    return;
  }),
  'reviewer-artifact-infra': reviewEventRenderer('reviewer-artifact-infra', (event, output) => {
    output.error(fmt.status('FAIL', `Reviewer artifact infrastructure failure: ${event.diagnostic}`));
    return;
  }),
  'reviewer-recovery-human': reviewEventRenderer('reviewer-recovery-human', (event, output) => {
    output.error(fmt.status('FAIL', `Reviewer artifact recovery requires human intervention for ${event.slug}.`));
    return;
  }),
  'reviewer-recovery-exhausted': reviewEventRenderer('reviewer-recovery-exhausted', (event, output) => {
    output.error(fmt.status('FAIL', `Reviewer artifact recovery exhausted its ${event.maxAttempts}-attempt budget for ${event.slug}.`));
    return;
  }),
  'reviewer-artifacts-recovered': reviewEventRenderer('reviewer-artifacts-recovered', (event, output) => {
    output.log(fmt.status('PASS', `Reviewer artifacts re-consumed and complete after ${event.attempts} attempt(s).`));
    return;
  }),
  'missing-review-outcome': reviewEventRenderer('missing-review-outcome', (event, output) => {
    output.log(fmt.status('WARN', `Reviewer ${event.reviewer} ${event.providerEnabled ? 'did not submit a formal review outcome' : 'did not record a review verdict through px'} for ${event.branch}; retrying the reviewer.`));
    return;
  }),
  'reviewer-timeout-exhausted': reviewEventRenderer('reviewer-timeout-exhausted', (event, output) => {
    output.error(fmt.status('FAIL', event.dossier || `Reviewer ${event.reviewer} did not submit a usable formal review outcome after ${event.attempts} recovery attempt(s).`));
    return;
  }),
  'human-review-guidance': reviewEventRenderer('human-review-guidance', (_event, output) => {
    output.log('       Human intervention is required to complete or repair the review.');
    return;
  }),
  'approval-transition-failed': reviewEventRenderer('approval-transition-failed', (event, output) => {
    output.error(fmt.status('FAIL', `Reviewer approved ${event.slug} but the review → integration transition failed: ${event.diagnostic}`));
    return;
  }),
  'integrate-guidance': reviewEventRenderer('integrate-guidance', (event, output) => {
    output.error(fmt.status('FAIL', `Recovery: px integrate ${event.slug}`));
    return;
  }),
  'reviewer-approved': reviewEventRenderer('reviewer-approved', (_event, output) => {
    output.log(fmt.status('PASS', 'Autonomous review stopped: reviewer approved the PR. Hand off to human review/integration.'));
    return;
  }),
  'missing-resumed-review': reviewEventRenderer('missing-resumed-review', (event, output) => {
    output.log(fmt.status('WARN', event.providerEnabled
      ? `No review found for ${event.reviewer} since ${event.startedAt}; treating as request-changes and proceeding to fixing phase.`
      : `No local review state found for ${event.reviewer}; treating as request-changes and proceeding to fixing phase.`));
    return;
  }),
  'fixing-resumed': reviewEventRenderer('fixing-resumed', (event, output) => {
    output.log(fmt.status('INFO', `Round ${event.attempt}: resuming in fixing phase with review outcome = ${event.reviewState}`));
    return;
  }),
  'revision-verified': reviewEventRenderer('revision-verified', (event, output) => {
    output.log(fmt.status('PASS', `✓ verification passed against the revised tree (round ${event.attempt})`));
    return;
  }),
  'runtime-matrix-header': reviewEventRenderer('runtime-matrix-header', (_event, output) => {
    output.error('\n' + fmt.status('INFO', 'Full runtime matrix:'));
    return;
  }),
  'runtime-matrix-line': reviewEventRenderer('runtime-matrix-line', (event, output) => {
    output.error(`  ${event.line}`);
    return;
  }),
  'reviewer-route-unavailable': reviewEventRenderer('reviewer-route-unavailable', (event, output) => {
    output.error('\n' + fmt.status('FAIL', `No runnable reviewer route for implementer "${event.implementer}".`));
    return;
  }),
  'different-family-unavailable': reviewEventRenderer('different-family-unavailable', (event, output) => {
    output.log(fmt.status('WARN', `no different-family agent is runnable for implementer "${event.implementer}"; unavailable families: ${event.unavailable.map(({ agent, detail }) => `${agent}: ${detail || 'unavailable'}`).join('; ')}.`));
    return;
  }),
  'single-family-review': reviewEventRenderer('single-family-review', (event, output) => {
    output.log(fmt.status('WARN', `Single-family fallback: reviewer="${event.implementer}" is the PR author family; local review will run, but external formal approval will be required.`));
    return;
  }),
  'reviewer-resumed': reviewEventRenderer('reviewer-resumed', (event, output) => {
    output.log(fmt.status('INFO', `${event.round === 1 && !event.isContinue ? 'Initial reviewer' : 'Resuming persisted reviewer'}: ${event.reviewer} (round ${event.round})`));
    return;
  }),
  'reviewer-defaulted': reviewEventRenderer('reviewer-defaulted', (event, output) => {
    output.log(fmt.status('WARN', `No reviewer could be auto-derived${event.detail ? `: ${event.detail}` : ''}; defaulting to "autonomous"`));
    return;
  }),
  'local-review-surfaces': reviewEventRenderer('local-review-surfaces', (_event, output) => {
    output.log(fmt.status('INFO', 'Review provider disabled and no runnable reviewer route available; using autonomous workflow-owned review surfaces.'));
    return;
  }),
  'reviewer-derivation-failed': reviewEventRenderer('reviewer-derivation-failed', (event, output) => {
    output.error(fmt.status('FAIL', `No reviewer could be auto-derived${event.detail ? `: ${event.detail}` : ''}.`));
    return;
  }),
  'reviewer-override-unavailable': reviewEventRenderer('reviewer-override-unavailable', (event, output) => {
    output.log(fmt.status('WARN', `Unsupported explicit reviewer "${event.reviewer}" while resuming ${event.slug}; falling back to persisted reviewer "${event.persistedContinueReviewer}" for the in-flight round.`));
    return;
  }),
  'reviewer-unsupported': reviewEventRenderer('reviewer-unsupported', (event, output) => {
    output.error(fmt.status('FAIL', `Unsupported reviewer: "${event.reviewer}" (${event.eligible ? 'launcher is not available' : 'blocked or unsupported'})${event.exhausted ? ' and no unblocked different-family fallback is available' : ''}.`));
    return;
  }),
  'launcher-detail': reviewEventRenderer('launcher-detail', (event, output) => {
    output.error(`       Looked for: ${event.detail}`);
    return;
  }),
  'reviewer-continue-resumed': reviewEventRenderer('reviewer-continue-resumed', (event, output) => {
    output.log(fmt.status('INFO', `Resuming persisted reviewer "${event.reviewer}" for continue-mode validation.`));
    return;
  }),
  'reviewer-dry-run-defaulted': reviewEventRenderer('reviewer-dry-run-defaulted', (_event, output) => {
    output.log(fmt.status('WARN', 'No runnable reviewer launcher available in dry-run; defaulting reviewer identity to "autonomous".'));
    return;
  }),
  'reviewer-fallback-routing': reviewEventRenderer('reviewer-fallback-routing', (event, output) => {
    output.log(fmt.status('WARN', `Unsupported reviewer: "${event.reviewer}" (${event.eligible ? 'launcher is not available' : 'blocked or unsupported'}); trying fallback "${event.fallback}".`));
    return;
  }),
  'autonomous-reviewer-selected': reviewEventRenderer('autonomous-reviewer-selected', (_event, output) => {
    output.log(fmt.status('INFO', 'Reviewer identity defaulted to autonomous; skipping launcher availability check.'));
    return;
  }),
  'fixing-reviewer-resumed': reviewEventRenderer('fixing-reviewer-resumed', (event, output) => {
    output.log(fmt.status('INFO', `Resuming in fixing phase with reviewer "${event.reviewer}"; skipping launcher availability check until a new review launch is needed.`));
    return;
  }),
  'reviewer-selected': reviewEventRenderer('reviewer-selected', (event, output) => {
    output.log(fmt.status('INFO', `Selected reviewer: ${event.reviewer} (${event.round === 1 && !event.isContinue && event.source.startsWith('persisted') ? 'initial selection' : event.source})`));
    return;
  }),
  'round-recovery-exhausted': reviewEventRenderer('round-recovery-exhausted', (event, output) => {
    output.error(fmt.status('FAIL', `Per-round relaunch cap reached for ${event.slug}: ${event.used}/${event.reboundsPerRound} relaunches used in round ${event.attempt}; no further ${event.occurrence} relaunches.`));
    return;
  }),
  'agent-fallback': reviewEventRenderer('agent-fallback', (event, output) => {
    output.log(fmt.status('INFO', `${event.role} fell back from ${event.original} to ${event.fallback}; updating identity before polling.`));
    return;
  }),
  'assignee-failed': reviewEventRenderer('assignee-failed', (event, output) => {
    output.log(fmt.status('WARN', `Could not enforce fallback implementer ${event.fallback} in backlog task.`));
    return;
  }),
  'controller-superseded': reviewEventRenderer('controller-superseded', (event, output) => {
    output.log(fmt.status('INFO', `Review controller for ${event.slug} was superseded before ${event.boundary} by authoritative round ${event.round} (${event.phase}). Stopping without applying stale state; run px review ${event.slug} --continue only if the authoritative round still needs work.`));
    return;
  }),
  'review-started': reviewEventRenderer('review-started', (event, output) => {
    output.log(fmt.status('INFO', `REVIEW — ${event.slug}`));
    output.log(fmt.status('INFO', `Implementer: ${event.implementer}`));
    output.log(fmt.status('INFO', `Reviewer: ${event.reviewer}`));
    output.log(fmt.status('INFO', `Independence: ${reviewIndependence(event.implementer, event.reviewer)}`));
    output.log(fmt.status('INFO', `Branch: ${event.branch}`));
    if (event.verbose) {
      output.log(fmt.status('INFO', `Focus: ${event.focus} | Max attempts: ${event.maxAttempts}`));
      output.log(fmt.status('INFO', `Poll interval: ${Math.round(event.intervalMs / 1000)}s | Poll timeout: ${Math.round(event.timeoutMs / 1000)}s | Verbose: on`));
    }
    if (event.dryRun) { output.log(fmt.status('DRY-RUN', 'No agents will be launched.')); }
    return;
  }),
  'review-verdict': reviewEventRenderer('review-verdict', (event, output) => {
    renderReviewVerdict(event.disposition, event.findings, message => output.log(message), event.verbose, event.round);
    return;
  }),
  'recovery-progress': reviewEventRenderer('recovery-progress', (event, output) => {
    output[event.channel](event.diagnostic);
    return;
  }),
  'agent-selection': reviewEventRenderer('agent-selection', (event, output) => {
    recordAgentSelectionOutcome(message => output.log(message), event.outcome, event.fields);
    return;
  }),
} satisfies Partial<ReviewLoopRenderers>;
