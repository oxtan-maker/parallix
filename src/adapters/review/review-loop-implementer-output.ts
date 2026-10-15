/** Terminal messages for the implementer stage of the application-owned review loop. */
import * as fmt from '../../application/presentation/cli-format.js';
import { reviewEventRenderer, type ReviewLoopRenderers } from './review-loop-output-formatting.js';

export const implementerOutputRenderers = {
  'local-disposition': reviewEventRenderer('local-disposition', (event, output) => {
    output.log(fmt.status('INFO', `Round ${event.attempt}: review provider disabled; using workflow-owned disposition state.`));
    return;
  }),
  'disposition-probe': reviewEventRenderer('disposition-probe', (event, output) => {
    output.log(fmt.status('INFO', `Round ${event.attempt}: checking for existing disposition by ${event.implementer} since ${event.startedAt}...`));
    return;
  }),
  'stale-disposition': reviewEventRenderer('stale-disposition', (event, output) => {
    output.log(fmt.status('INFO', `Round ${event.attempt}: implementer disposition found (${event.existing}). Re-launching implementer to assess whether blocker is resolved...`));
    return;
  }),
  'implementer-dry-run-header': reviewEventRenderer('implementer-dry-run-header', (event, output) => {
    output.log(`\n--- DRY-RUN: implementer (${event.implementer}) act-on-review prompt ---`);
    return;
  }),
  'implementer-dry-run-prompt': reviewEventRenderer('implementer-dry-run-prompt', (event, output) => {
    output.log(event.prompt);
    return;
  }),
  'disposition-relaunched': reviewEventRenderer('disposition-relaunched', (event, output) => {
    output.log(fmt.status('INFO', `Round ${event.attempt}: stale BLOCKED/PARKED disposition replaced by fresh implementer action.`));
    return;
  }),
  'acting-on-review': reviewEventRenderer('acting-on-review', (_event, output) => {
    output.log(fmt.status('INFO', 'ACTING ON REVIEW'));
    return;
  }),
  'acting-on-finding': reviewEventRenderer('acting-on-finding', (event, output) => {
    output.log(fmt.status('INFO', `Finding ${event.id}: ${event.summary}`));
    return;
  }),
  'autonomous-implementer': reviewEventRenderer('autonomous-implementer', (event, output) => {
    output.log(fmt.status('INFO', `Round ${event.attempt}: implementer identity is autonomous; skipping implementer launch and using local review artifacts only.`));
    return;
  }),
  'implementer-launching': reviewEventRenderer('implementer-launching', (event, output) => {
    output.log(fmt.status('INFO', `Round ${event.attempt}: launching implementer (${event.implementer}) for act-on-review...`));
    return;
  }),
  'implementer-launch-failed': reviewEventRenderer('implementer-launch-failed', (event, output) => {
    output.error(fmt.status('FAIL', `Could not launch implementer agent (${event.implementer}): ${event.message}`));
    return;
  }),
  'implementer-completed': reviewEventRenderer('implementer-completed', (event, output) => {
    output.log(fmt.status('INFO', `Round ${event.attempt}: implementer (${event.implementer}) completed act-on-review; reconciling workflow output.`));
    return;
  }),
  'stored-resolution': reviewEventRenderer('stored-resolution', (event, output) => {
    output.log(fmt.status('PASS', `Round ${event.attempt}: recognized stored workflow resolution from implementer ${event.implementer} for the matching round and revision.`));
    return;
  }),
  'missing-implementer-output': reviewEventRenderer('missing-implementer-output', (event, output) => {
    output.log(fmt.status('WARN', `Round ${event.attempt}: implementer ${event.implementer} completed with missing protocol output; starting artifact recovery before provider disposition polling.`));
    return;
  }),
  'implementer-artifact-infra': reviewEventRenderer('implementer-artifact-infra', (event, output) => {
    output.error(fmt.status('FAIL', `Implementer artifact infrastructure failure: ${event.diagnostic}`));
    return;
  }),
  'stored-recovery-resolution': reviewEventRenderer('stored-recovery-resolution', (event, output) => {
    output.log(fmt.status('PASS', `Round ${event.attempt}: recovery recognized stored workflow resolution from implementer ${event.implementer}.`));
    return;
  }),
  'implementer-recovery-human': reviewEventRenderer('implementer-recovery-human', (event, output) => {
    output.error(fmt.status('FAIL', `Implementer artifact recovery requires human intervention for ${event.slug}.`));
    return;
  }),
  'implementer-recovery-exhausted': reviewEventRenderer('implementer-recovery-exhausted', (event, output) => {
    output.error(fmt.status('FAIL', `Implementer artifact recovery exhausted its ${event.maxAttempts}-attempt budget for ${event.slug}.`));
    return;
  }),
  'implementer-artifacts-recovered': reviewEventRenderer('implementer-artifacts-recovered', (event, output) => {
    output.log(fmt.status('PASS', `Implementer artifacts re-consumed and complete after ${event.attempts} attempt(s).`));
    return;
  }),
  'missing-disposition': reviewEventRenderer('missing-disposition', (event, output) => {
    output.error(fmt.status('FAIL', `Implementer ${event.implementer} did not post an autonomous review disposition comment.`));
    return;
  }),
  'implementer-timeout-infra': reviewEventRenderer('implementer-timeout-infra', (event, output) => {
    output.error(fmt.status('FAIL', `Implementer artifact infrastructure failure during timeout recovery: ${event.diagnostic}`));
    return;
  }),
  'implementer-timeout-exhausted': reviewEventRenderer('implementer-timeout-exhausted', (event, output) => {
    output.error(fmt.status('FAIL', event.dossier || `Implementer timeout recovery exhausted for ${event.branch}.`));
    return;
  }),
  'implementer-disposition': reviewEventRenderer('implementer-disposition', (event, output) => {
    output.log(fmt.status('INFO', `Round ${event.attempt}: implementer disposition = ${event.value}`));
    return;
  }),
  'pushback-next-round': reviewEventRenderer('pushback-next-round', (event, output) => {
    output.log(fmt.status('INFO', `Round ${event.attempt}: implementer responded to all findings. Continuing to reviewer re-review round ${event.attempt + 1}.`));
    return;
  }),
  'implementer-stopped': reviewEventRenderer('implementer-stopped', (event, output) => {
    output.log(fmt.status('INFO', `Autonomous review stopped: implementer reported ${event.value}. Hand off to human review.`));
    return;
  }),
  'implementer-no-change': reviewEventRenderer('implementer-no-change', (event, output) => {
    output.log(fmt.status('FAIL', `Round ${event.attempt}: implementer reported CHANGES_MADE but the branch HEAD is unchanged. No new revision to review; handing off to human review.`));
    return;
  }),
  'revision-published': reviewEventRenderer('revision-published', (event, output) => {
    output.log(event.ok
      ? fmt.status('INFO', `Round ${event.attempt}: pushed mission branch ${event.branch} to review remote.`)
      : fmt.status('WARN', `Round ${event.attempt}: could not push mission branch to review remote (exit ${event.status}): ${event.detail || '(no output)'}. Continuing to next round.`));
    return;
  }),
  'revision-recorded': reviewEventRenderer('revision-recorded', (event, output) => {
    output.log(fmt.status('INFO', `Round ${event.attempt}: new revision ${event.revisedHead.slice(0, 12)} recorded after act-on-review.`));
    return;
  }),
  'implementer-next-round': reviewEventRenderer('implementer-next-round', (event, output) => {
    output.log(fmt.status('INFO', `Round ${event.attempt}: implementer made changes. Continuing to round ${event.attempt + 1}.`));
    return;
  }),
  'existing-disposition': reviewEventRenderer('existing-disposition', (event, output) => {
    output.log(fmt.status('INFO', `Round ${event.attempt}: implementer disposition found (${event.value}). Skipping implementer launch.`));
    return;
  }),
  'rebase-gate-failed': reviewEventRenderer('rebase-gate-failed', (event, output) => {
    output.error(fmt.status('FAIL', `Pre-review rebase gate failed for area "${event.area}" (exit ${event.exitCode}) during the ${event.operation} step.`));
    return;
  }),
  'gate-command': reviewEventRenderer('gate-command', (event, output) => {
    output.error(fmt.status('INFO', `Gate command: ${event.command}`));
    return;
  }),
  'rebase-repair-stranded': reviewEventRenderer('rebase-repair-stranded', (event, output) => {
    output.error(fmt.status('FAIL', `Pre-review rebase gate failure stranded mission ${event.slug} (${event.outcome}). Exiting review loop.`));
    return;
  }),
  'rebase-repair-verified': reviewEventRenderer('rebase-repair-verified', (event, output) => {
    output.log(fmt.status('PASS', `Pre-review rebase gate repair verified for ${event.slug}; continuing this review round.`));
    return;
  }),
  'hook-repair-stranded': reviewEventRenderer('hook-repair-stranded', (event, output) => {
    output.error(fmt.status('FAIL', `Pre-review Git hook failure ${event.outcome === 'human-only' ? 'requires human intervention' : 'exhausted its repair budget'} for ${event.slug}.`));
    return;
  }),
  'hook-repair-verified': reviewEventRenderer('hook-repair-verified', (event, output) => {
    output.log(fmt.status('PASS', `Pre-review Git hook failure repaired and re-verified for ${event.slug}; continuing this review round.`));
    return;
  }),
  'gate-repair-started': reviewEventRenderer('gate-repair-started', (event, output) => {
    output.log(fmt.status('WARN', `Pre-review gate failed for area "${event.area}" (exit ${event.exitCode}). Bouncing to implementer.`));
    return;
  }),
  'gate-repair-stranded': reviewEventRenderer('gate-repair-stranded', (event, output) => {
    output.error(fmt.status('FAIL', `Pre-review gate failure stranded mission ${event.slug} (${event.outcome}). Exiting review loop.`));
    return;
  }),
  'gate-repair-verified': reviewEventRenderer('gate-repair-verified', (event, output) => {
    output.log(fmt.status('PASS', `Declared gate repair verified for ${event.slug}; resuming this review round.`));
    return;
  }),
} satisfies Partial<ReviewLoopRenderers>;
