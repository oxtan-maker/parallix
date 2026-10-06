/** Render application review observations for the CLI. No workflow decisions live here. */
import * as fmt from '../../application/presentation/cli-format.js';
import type { ReviewLoopEvent } from '../../application/ports/review-loop-output.js';
import { recordAgentSelectionOutcome } from '../../application/services/agent-selection-telemetry.js';

export interface ReviewLoopTextOutput { log(_message: string): void; error(_message: string): void }

export function renderReviewLoopEvent(event: ReviewLoopEvent, output: ReviewLoopTextOutput): void {
  const log = (message: string) => output.log(message);
  const error = (message: string) => output.error(message);
  switch (event.kind) {
    case 'local-disposition':
      log(fmt.status('INFO', `Round ${event.attempt}: review provider disabled; using workflow-owned disposition state.`));
      return;
    case 'disposition-probe':
      log(fmt.status('INFO', `Round ${event.attempt}: checking for existing disposition by ${event.implementer} since ${event.startedAt}...`));
      return;
    case 'stale-disposition':
      log(fmt.status('INFO', `Round ${event.attempt}: implementer disposition found (${event.existing}). Re-launching implementer to assess whether blocker is resolved...`));
      return;
    case 'implementer-dry-run-header':
      log(`\n--- DRY-RUN: implementer (${event.implementer}) act-on-review prompt ---`);
      return;
    case 'implementer-dry-run-prompt':
      log(event.prompt);
      return;
    case 'disposition-relaunched':
      log(fmt.status('INFO', `Round ${event.attempt}: stale BLOCKED/PARKED disposition replaced by fresh implementer action.`));
      return;
    case 'acting-on-review':
      log(fmt.status('INFO', 'ACTING ON REVIEW'));
      return;
    case 'acting-on-finding':
      log(fmt.status('INFO', `Finding ${event.id}: ${event.summary}`));
      return;
    case 'autonomous-implementer':
      log(fmt.status('INFO', `Round ${event.attempt}: implementer identity is autonomous; skipping implementer launch and using local review artifacts only.`));
      return;
    case 'implementer-launching':
      log(fmt.status('INFO', `Round ${event.attempt}: launching implementer (${event.implementer}) for act-on-review...`));
      return;
    case 'implementer-launch-failed':
      error(fmt.status('FAIL', `Could not launch implementer agent (${event.implementer}): ${event.message}`));
      return;
    case 'implementer-completed':
      log(fmt.status('INFO', `Round ${event.attempt}: implementer (${event.implementer}) completed act-on-review; reconciling workflow output.`));
      return;
    case 'stored-resolution':
      log(fmt.status('PASS', `Round ${event.attempt}: recognized stored workflow resolution from implementer ${event.implementer} for the matching round and revision.`));
      return;
    case 'missing-implementer-output':
      log(fmt.status('WARN', `Round ${event.attempt}: implementer ${event.implementer} completed with missing protocol output; starting artifact recovery before provider disposition polling.`));
      return;
    case 'implementer-artifact-infra':
      error(fmt.status('FAIL', `Implementer artifact infrastructure failure: ${event.diagnostic}`));
      return;
    case 'stored-recovery-resolution':
      log(fmt.status('PASS', `Round ${event.attempt}: recovery recognized stored workflow resolution from implementer ${event.implementer}.`));
      return;
    case 'implementer-recovery-human':
      error(fmt.status('FAIL', `Implementer artifact recovery requires human intervention for ${event.slug}.`));
      return;
    case 'implementer-recovery-exhausted':
      error(fmt.status('FAIL', `Implementer artifact recovery exhausted its ${event.maxAttempts}-attempt budget for ${event.slug}.`));
      return;
    case 'implementer-artifacts-recovered':
      log(fmt.status('PASS', `Implementer artifacts re-consumed and complete after ${event.attempts} attempt(s).`));
      return;
    case 'missing-disposition':
      error(fmt.status('FAIL', `Implementer ${event.implementer} did not post an autonomous review disposition comment.`));
      return;
    case 'implementer-timeout-infra':
      error(fmt.status('FAIL', `Implementer artifact infrastructure failure during timeout recovery: ${event.diagnostic}`));
      return;
    case 'implementer-timeout-exhausted':
      error(fmt.status('FAIL', event.dossier || `Implementer timeout recovery exhausted for ${event.branch}.`));
      return;
    case 'implementer-disposition':
      log(fmt.status('INFO', `Round ${event.attempt}: implementer disposition = ${event.value}`));
      return;
    case 'pushback-next-round':
      log(fmt.status('INFO', `Round ${event.attempt}: implementer responded to all findings. Continuing to reviewer re-review round ${event.attempt + 1}.`));
      return;
    case 'implementer-stopped':
      log(fmt.status('INFO', `Autonomous review stopped: implementer reported ${event.value}. Hand off to human review.`));
      return;
    case 'implementer-no-change':
      log(fmt.status('FAIL', `Round ${event.attempt}: implementer reported CHANGES_MADE but the branch HEAD is unchanged. No new revision to review; handing off to human review.`));
      return;
    case 'revision-published': log(event.ok
      ? fmt.status('INFO', `Round ${event.attempt}: pushed mission branch ${event.branch} to review remote.`)
      : fmt.status('WARN', `Round ${event.attempt}: could not push mission branch to review remote (exit ${event.status}): ${event.detail || '(no output)'}. Continuing to next round.`)); return;
    case 'revision-recorded':
      log(fmt.status('INFO', `Round ${event.attempt}: new revision ${event.revisedHead.slice(0, 12)} recorded after act-on-review.`));
      return;
    case 'implementer-next-round':
      log(fmt.status('INFO', `Round ${event.attempt}: implementer made changes. Continuing to round ${event.attempt + 1}.`));
      return;
    case 'existing-disposition':
      log(fmt.status('INFO', `Round ${event.attempt}: implementer disposition found (${event.value}). Skipping implementer launch.`));
      return;
    case 'rebase-gate-failed':
      error(fmt.status('FAIL', `Pre-review rebase gate failed for area "${event.area}" (exit ${event.exitCode}) during the ${event.operation} step.`));
      return;
    case 'gate-command':
      error(fmt.status('INFO', `Gate command: ${event.command}`));
      return;
    case 'rebase-repair-stranded':
      error(fmt.status('FAIL', `Pre-review rebase gate failure stranded mission ${event.slug} (${event.outcome}). Exiting review loop.`));
      return;
    case 'rebase-repair-verified':
      log(fmt.status('PASS', `Pre-review rebase gate repair verified for ${event.slug}; continuing this review round.`));
      return;
    case 'hook-repair-stranded':
      error(fmt.status('FAIL', `Pre-review Git hook failure ${event.outcome === 'human-only' ? 'requires human intervention' : 'exhausted its repair budget'} for ${event.slug}.`));
      return;
    case 'hook-repair-verified':
      log(fmt.status('PASS', `Pre-review Git hook failure repaired and re-verified for ${event.slug}; continuing this review round.`));
      return;
    case 'gate-repair-started':
      log(fmt.status('WARN', `Pre-review gate failed for area "${event.area}" (exit ${event.exitCode}). Bouncing to implementer.`));
      return;
    case 'gate-repair-stranded':
      error(fmt.status('FAIL', `Pre-review gate failure stranded mission ${event.slug} (${event.outcome}). Exiting review loop.`));
      return;
    case 'gate-repair-verified':
      log(fmt.status('PASS', `Declared gate repair verified for ${event.slug}; resuming this review round.`));
      return;
    case 'implementer-resumed':
      log(fmt.status('INFO', `Resuming persisted implementer: ${event.implementer}`));
      return;
    case 'implementer-derived':
      log(fmt.status('INFO', `Auto-derived implementer from backlog task: ${event.implementer}`));
      return;
    case 'implementer-unresolved':
      log(fmt.status('WARN', `No implementer identity resolved for ${event.slug}; defaulting to "autonomous"`));
      return;
    case 'adhoc-without-task':
      log(fmt.status('WARN', `No Backlog task file for DB-owned adhoc identity ${event.slug}; identity and lifecycle are DB-authoritative.`));
      return;
    case 'handoff-validation-failed':
      log(fmt.status('INFO', `Auto-bounced ${event.slug} to active: declared-gate validation failure. Fix the declared gate in the mission contract and retry.`));
      return;
    case 'missing-review-pr':
      error(fmt.status('FAIL', `No open review PR found for ${event.branch}. Create the PR before starting the review loop.`));
      return;
    case 'handoff-diagnostic':
      error(`       Handoff failure: ${String(event.error)}`);
      return;
    case 'push-guidance':
      error(`       Run: px review ${event.slug} --push`);
      return;
    case 'handoff-failed':
      error(fmt.status('FAIL', `Handoff failed for ${event.branch}: ${event.error ? String(event.error) : 'see above'}.`));
      return;
    case 'start-guidance':
      error(`       Run: px review ${event.slug} --start after resolving the error.`);
      return;
    case 'handoff-unbound':
      error(fmt.status('FAIL', `Cannot start ${event.slug}: no handoff transition wired into the review loop.`));
      return;
    case 'handoff-starting':
      log(fmt.status('INFO', `No completed handoff for ${event.branch} (task in ${event.taskStatus}) — performing handoff (attempting automatic handoff) via px review ${event.slug} --start...`));
      return;
    case 'handoff-blocked':
      error(fmt.status('FAIL', `Handoff blocked for ${event.branch}: mandatory mission artifacts are missing. Task stays in ${event.taskStatus}; supply the required artifacts and retry.`));
      return;
    case 'handoff-healed':
      log(fmt.status('INFO', `Self-heal succeeded: review PR #${event.id} confirmed open for ${event.branch}. Continuing review loop.`));
      return;
    case 'review-pr-confirmed':
      log(fmt.status('INFO', `Review PR #${event.id} confirmed open for ${event.branch}.`));
      return;
    case 'local-provider':
      log(fmt.status('INFO', 'Forgejo validation skipped (review provider is not forgejo). Using workflow-owned review surfaces.'));
      return;
    case 'review-resumed':
      log(fmt.status('INFO', `Resuming review loop from round ${event.round} (${event.phase}).`));
      return;
    case 'round-started':
      log('\n' + fmt.status('INFO', `========== Round ${event.attempt} / ${event.maxAttempts} ==========`));
      return;
    case 'review-reset':
      log(fmt.status('INFO', `Review state reset for ${event.slug}.`));
      return;
    case 'reviewer-escalated':
      log(fmt.status('INFO', `Autonomous review stopped: human review required after reviewer ${event.reason}.`));
      return;
    case 'attempts-exhausted':
      log(fmt.status('INFO', `Autonomous review stopped: reached ${event.maxAttempts} attempts. Hand off to human review.`));
      return;
    case 'controller-active':
      log(fmt.status('INFO', `Review controller already active for ${event.slug}; this invocation is not starting a competing loop. Run px review ${event.slug} --continue after the active controller stops if the authoritative round still needs work.`));
      return;
    case 'local-review':
      log(fmt.status('INFO', `Round ${event.attempt}: review provider disabled; using workflow-owned review state.`));
      return;
    case 'review-probe':
      log(fmt.status('INFO', `Round ${event.attempt}: checking for existing review by ${event.reviewer} since ${event.startedAt}...`));
      return;
    case 'autonomous-reviewer-dry-run':
      log(fmt.status('INFO', `Round ${event.attempt}: reviewer identity is autonomous; skipping dry-run reviewer prompt and using local review artifacts only.`));
      return;
    case 'reviewer-dry-run-header':
      log(`\n--- DRY-RUN: reviewer (${event.reviewer}) prompt ---`);
      return;
    case 'reviewer-dry-run-prompt':
      log(event.prompt);
      return;
    case 'autonomous-reviewer':
      log(fmt.status('INFO', `Round ${event.attempt}: reviewer identity is autonomous; skipping reviewer launch and using local review artifacts only.`));
      return;
    case 'reviewer-launching':
      log(fmt.status('INFO', `Round ${event.attempt}: launching reviewer (${event.reviewer})...`));
      return;
    case 'reviewer-classification':
      log(fmt.status('INFO', `Using general reviewer: ${event.reason}.`));
      return;
    case 'reviewer-launch-failed':
      error(fmt.status('FAIL', `Could not launch reviewer agent (${event.reviewer}): ${event.message}`));
      return;
    case 'reviewer-artifact-infra':
      error(fmt.status('FAIL', `Reviewer artifact infrastructure failure: ${event.diagnostic}`));
      return;
    case 'reviewer-recovery-human':
      error(fmt.status('FAIL', `Reviewer artifact recovery requires human intervention for ${event.slug}.`));
      return;
    case 'reviewer-recovery-exhausted':
      error(fmt.status('FAIL', `Reviewer artifact recovery exhausted its ${event.maxAttempts}-attempt budget for ${event.slug}.`));
      return;
    case 'reviewer-artifacts-recovered':
      log(fmt.status('PASS', `Reviewer artifacts re-consumed and complete after ${event.attempts} attempt(s).`));
      return;
    case 'missing-review-outcome':
      log(fmt.status('WARN', `Reviewer ${event.reviewer} ${event.providerEnabled ? 'did not submit a formal review outcome' : 'did not record a review verdict through px'} for ${event.branch}; retrying the reviewer.`));
      return;
    case 'reviewer-timeout-exhausted':
      error(fmt.status('FAIL', event.dossier || `Reviewer ${event.reviewer} did not submit a usable formal review outcome after ${event.attempts} recovery attempt(s).`));
      return;
    case 'human-review-guidance':
      log('       Human intervention is required to complete or repair the review.');
      return;
    case 'approval-transition-failed':
      error(fmt.status('FAIL', `Reviewer approved ${event.slug} but the review → integration transition failed: ${event.diagnostic}`));
      return;
    case 'integrate-guidance':
      error(fmt.status('FAIL', `Recovery: px integrate ${event.slug}`));
      return;
    case 'reviewer-approved':
      log(fmt.status('PASS', 'Autonomous review stopped: reviewer approved the PR. Hand off to human review/integration.'));
      return;
    case 'missing-resumed-review': log(fmt.status('WARN', event.providerEnabled
      ? `No review found for ${event.reviewer} since ${event.startedAt}; treating as request-changes and proceeding to fixing phase.`
      : `No local review state found for ${event.reviewer}; treating as request-changes and proceeding to fixing phase.`)); return;
    case 'fixing-resumed':
      log(fmt.status('INFO', `Round ${event.attempt}: resuming in fixing phase with review outcome = ${event.reviewState}`));
      return;
    case 'revision-verified':
      log(fmt.status('PASS', `✓ verification passed against the revised tree (round ${event.attempt})`));
      return;
    case 'runtime-matrix-header':
      error('\n' + fmt.status('INFO', 'Full runtime matrix:'));
      return;
    case 'runtime-matrix-line':
      error(`  ${event.line}`);
      return;
    case 'reviewer-route-unavailable':
      error('\n' + fmt.status('FAIL', `No runnable reviewer route for implementer "${event.implementer}".`));
      return;
    case 'different-family-unavailable':
      log(fmt.status('WARN', `no different-family agent is runnable for implementer "${event.implementer}"; unavailable families: ${event.unavailable.map(({ agent, detail }) => `${agent}: ${detail || 'unavailable'}`).join('; ')}.`));
      return;
    case 'single-family-review':
      log(fmt.status('WARN', `Single-family fallback: reviewer="${event.implementer}" is the PR author family; local review will run, but external formal approval will be required.`));
      return;
    case 'reviewer-resumed':
      log(fmt.status('INFO', `Resuming persisted reviewer: ${event.reviewer} (round ${event.round})`));
      return;
    case 'reviewer-defaulted':
      log(fmt.status('WARN', `No reviewer could be auto-derived${event.detail ? `: ${event.detail}` : ''}; defaulting to "autonomous"`));
      return;
    case 'local-review-surfaces':
      log(fmt.status('INFO', 'Review provider disabled and no runnable reviewer route available; using autonomous workflow-owned review surfaces.'));
      return;
    case 'reviewer-derivation-failed':
      error(fmt.status('FAIL', `No reviewer could be auto-derived${event.detail ? `: ${event.detail}` : ''}.`));
      return;
    case 'reviewer-override-unavailable':
      log(fmt.status('WARN', `Unsupported explicit reviewer "${event.reviewer}" while resuming ${event.slug}; falling back to persisted reviewer "${event.persistedContinueReviewer}" for the in-flight round.`));
      return;
    case 'reviewer-unsupported':
      error(fmt.status('FAIL', `Unsupported reviewer: "${event.reviewer}" (${event.eligible ? 'launcher is not available' : 'blocked or unsupported'})${event.exhausted ? ' and no unblocked different-family fallback is available' : ''}.`));
      return;
    case 'launcher-detail':
      error(`       Looked for: ${event.detail}`);
      return;
    case 'reviewer-continue-resumed':
      log(fmt.status('INFO', `Resuming persisted reviewer "${event.reviewer}" for continue-mode validation.`));
      return;
    case 'reviewer-dry-run-defaulted':
      log(fmt.status('WARN', 'No runnable reviewer launcher available in dry-run; defaulting reviewer identity to "autonomous".'));
      return;
    case 'reviewer-fallback-routing':
      log(fmt.status('WARN', `Unsupported reviewer: "${event.reviewer}" (${event.eligible ? 'launcher is not available' : 'blocked or unsupported'}); trying fallback "${event.fallback}".`));
      return;
    case 'autonomous-reviewer-selected':
      log(fmt.status('INFO', 'Reviewer identity defaulted to autonomous; skipping launcher availability check.'));
      return;
    case 'fixing-reviewer-resumed':
      log(fmt.status('INFO', `Resuming in fixing phase with reviewer "${event.reviewer}"; skipping launcher availability check until a new review launch is needed.`));
      return;
    case 'reviewer-selected':
      log(fmt.status('INFO', `Selected reviewer: ${event.reviewer} (${event.source})`));
      return;
    case 'round-recovery-exhausted':
      error(fmt.status('FAIL', `Per-round relaunch cap reached for ${event.slug}: ${event.used}/${event.reboundsPerRound} relaunches used in round ${event.attempt}; no further ${event.occurrence} relaunches.`));
      return;
    case 'agent-fallback':
      log(fmt.status('INFO', `${event.role} fell back from ${event.original} to ${event.fallback}; updating identity before polling.`));
      return;
    case 'assignee-failed':
      log(fmt.status('WARN', `Could not enforce fallback implementer ${event.fallback} in backlog task.`));
      return;
    case 'controller-superseded':
      log(fmt.status('INFO', `Review controller for ${event.slug} was superseded before ${event.boundary} by authoritative round ${event.round} (${event.phase}). Stopping without applying stale state; run px review ${event.slug} --continue only if the authoritative round still needs work.`));
      return;
    case 'review-started':
      log(fmt.status('INFO', `REVIEW — ${event.slug}`));
      log(fmt.status('INFO', `Implementer: ${event.implementer}`));
      log(fmt.status('INFO', `Reviewer: ${event.reviewer}`));
      log(fmt.status('INFO', `Independence: ${reviewIndependence(event.implementer, event.reviewer)}`));
      log(fmt.status('INFO', `Branch: ${event.branch}`));
      if (event.verbose) {
        log(fmt.status('INFO', `Focus: ${event.focus} | Max attempts: ${event.maxAttempts}`));
        log(fmt.status('INFO', `Poll interval: ${Math.round(event.intervalMs / 1000)}s | Poll timeout: ${Math.round(event.timeoutMs / 1000)}s | Verbose: on`));
      }
      if (event.dryRun) { log(fmt.status('DRY-RUN', 'No agents will be launched.')); }
      return;
    case 'review-verdict':
      renderReviewVerdict(event.disposition, event.findings, log, event.verbose, event.round);
      return;
    case 'recovery-progress':
      output[event.channel](event.diagnostic);
      return;
    case 'agent-selection':
      recordAgentSelectionOutcome(log, event.outcome, event.fields);
      return;
  }
  const unhandled: never = event;
  throw new Error(`Unhandled review observation: ${JSON.stringify(unhandled)}`);
}

export function reviewLoopReporter(output: ReviewLoopTextOutput): { emit(_event: ReviewLoopEvent): void } {
  return { emit: event => renderReviewLoopEvent(event, output) };
}

/** Render only a persisted, authoritative review state as the operator verdict. */
export function renderReviewVerdict(reviewState: string | null, findings: readonly { id: string; summary: string }[], log: (_msg: string) => void, verbose = false, round?: number): void {
  if (reviewState === 'APPROVED') {
    log(fmt.status('PASS', `========== APPROVED${round && round > 1 ? ` · round ${round}` : ''} ==========`));
    return;
  }
  if (reviewState === 'REQUEST_CHANGES') {
    log(fmt.status('WARN', '====== CHANGES REQUESTED ======'));
    for (const finding of findings) {
      log(fmt.status('WARN', `Blocking finding: ${finding.id} — ${finding.summary}`));
    }
    return;
  }
  // A non-binary outcome (e.g. COMMENT) is demoted to verbose rather than
  // dropped, so a silent non-binary verdict is not a regression (TASK-2477/F2).
  if (verbose && reviewState) {
    log(fmt.status('INFO', `Reviewer outcome = ${reviewState}`));
  }
}

/** The review relationship, expressed with configured agent-family IDs. */
export function reviewIndependence(implementer: string, reviewer: string): string {
  return implementer === reviewer
    ? 'same-family fallback / self-review'
    : 'different-family review';
}
