import type { ParallixConfiguration } from "../../application/ports/configuration.js";
/**
 * Explicit interrupted-review preparation recovery interface.
 */

import * as fmt from '../../application/presentation/cli-format.js';
import { reconcileInterruptedReviewPreparation } from '../../application/review-round-use-case.js';
import type { MissionStore } from '../../application/domain-ports.js';
import { flagValue, repeatedFlagValues } from './review-cli-flags.js';

/** Rebuild a missing round-one aggregate from an operator-supplied review preparation record. */
export async function reconcileInterruptedReviewPreparationHandler(
  slug: string,
  args: string[],
  options: {
    configuration?: ParallixConfiguration;
    log?: (_msg: string) => void;
    error?: (_msg: string) => void;
    exit?: (_code: number) => never;
    reconcileInterruptedReviewPreparationFn?: typeof reconcileInterruptedReviewPreparation;
    missionStore?: MissionStore | null;
  } = {},
): Promise<void> {
  const log = options.log || fmt.log.plain;
  const error = options.error || fmt.log.plainError;
  const exit = options.exit || process.exit;
  const result = await (options.reconcileInterruptedReviewPreparationFn || reconcileInterruptedReviewPreparation)(slug, reconciliationInputs(args), options.missionStore ?? null);
  if (result.outcome === 'reconciled') {
    log(fmt.status('PASS', `Reconciled round-one review for ${slug}. Re-run px review ${slug} to launch the reviewer.`));
    return;
  }
  if (result.outcome === 'already-present') {
    log(fmt.status('INFO', `Mission ${slug} already has a valid Review aggregate; nothing to reconcile.`));
    return;
  }
  error(fmt.status('FAIL', `Cannot reconcile ${slug}: ${result.diagnostic}`));
  exit(1);
}

function reconciliationInputs(args: string[]) {
  return {
    sourceBranch: flagValue(args, '--branch') || '',
    targetBranch: flagValue(args, '--target') || '',
    reviewer: flagValue(args, '--reviewer') || '',
    implementer: flagValue(args, '--implementer') || '',
    revision: flagValue(args, '--revision') || '',
    eligibleReviewers: repeatedFlagValues(args, '--eligible-reviewer'),
    startedAt: new Date().toISOString(),
  };
}
