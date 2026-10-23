/** Terminal messages for the handoff stage of the application-owned review loop. */
import * as fmt from '../../application/presentation/cli-format.js';
import { reviewEventRenderer, type ReviewLoopRenderers } from './review-loop-output-formatting.js';

export const handoffOutputRenderers = {
  'implementer-resumed': reviewEventRenderer('implementer-resumed', (event, output) => {
    output.log(fmt.status('INFO', `Resuming persisted implementer: ${event.implementer}`));
    return;
  }),
  'implementer-derived': reviewEventRenderer('implementer-derived', (event, output) => {
    output.log(fmt.status('INFO', `Auto-derived implementer from backlog task: ${event.implementer}`));
    return;
  }),
  'implementer-unresolved': reviewEventRenderer('implementer-unresolved', (event, output) => {
    output.log(fmt.status('WARN', `No implementer identity resolved for ${event.slug}; defaulting to "autonomous"`));
    return;
  }),
  'adhoc-without-task': reviewEventRenderer('adhoc-without-task', (event, output) => {
    output.log(fmt.status('WARN', `No Backlog task file for DB-owned adhoc identity ${event.slug}; identity and lifecycle are DB-authoritative.`));
    return;
  }),
  'handoff-validation-failed': reviewEventRenderer('handoff-validation-failed', (event, output) => {
    output.log(fmt.status('INFO', `Auto-bounced ${event.slug} to active: declared-gate validation failure. Fix the declared gate in the mission contract and retry.`));
    return;
  }),
  'missing-review-pr': reviewEventRenderer('missing-review-pr', (event, output) => {
    output.error(fmt.status('FAIL', `No open review PR found for ${event.branch}. Handoff did not publish the required PR; resolve the handoff failure and retry review.`));
    return;
  }),
  'handoff-diagnostic': reviewEventRenderer('handoff-diagnostic', (event, output) => {
    output.error(`       Handoff failure: ${String(event.error)}`);
    return;
  }),
  'push-guidance': reviewEventRenderer('push-guidance', (event, output) => {
    output.error(`       Run: px review ${event.slug} --push`);
    return;
  }),
  'handoff-failed': reviewEventRenderer('handoff-failed', (event, output) => {
    output.error(fmt.status('FAIL', `Handoff failed for ${event.branch}: ${event.error ? String(event.error) : 'see above'}.`));
    return;
  }),
  'start-guidance': reviewEventRenderer('start-guidance', (event, output) => {
    output.error(`       Run: px review ${event.slug} after resolving the error.`);
    return;
  }),
  'handoff-unbound': reviewEventRenderer('handoff-unbound', (event, output) => {
    output.error(fmt.status('FAIL', `Cannot start ${event.slug}: no handoff transition wired into the review loop.`));
    return;
  }),
  'handoff-starting': reviewEventRenderer('handoff-starting', (event, output) => {
    output.log(fmt.status('INFO', `No completed handoff for ${event.branch} (task in ${event.taskStatus}) — performing handoff (attempting automatic handoff) via px review ${event.slug}...`));
    return;
  }),
  'handoff-blocked': reviewEventRenderer('handoff-blocked', (event, output) => {
    output.error(fmt.status('FAIL', `Handoff blocked for ${event.branch}: mandatory mission artifacts are missing. Task stays in ${event.taskStatus}; supply the required artifacts and retry.`));
    return;
  }),
  'handoff-healed': reviewEventRenderer('handoff-healed', (event, output) => {
    output.log(fmt.status('INFO', `Self-heal succeeded: review PR #${event.id} confirmed open for ${event.branch}. Continuing review loop.`));
    return;
  }),
  'review-pr-confirmed': reviewEventRenderer('review-pr-confirmed', (event, output) => {
    output.log(fmt.status('INFO', `Review PR #${event.id} confirmed open for ${event.branch}.`));
    return;
  }),
} satisfies Partial<ReviewLoopRenderers>;
