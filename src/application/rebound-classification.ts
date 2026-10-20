import { classifyReboundReason as classify, type ReboundReason } from '../domain/rebound-policy.js';
import { legacyFailureReason } from '../domain/failure-reason.js';
import * as fmt from './presentation/cli-format.js';

/** Logging belongs to the application boundary; the domain classifier stays pure. */
export function classifyRecoveryReason(reason: ReboundReason, log: (_message: string) => void = fmt.log.plain) {
  if (reason.kind === 'gate-failure') {
    const fallback = legacyFailureReason(reason.failureReason);
    if (fallback) { log(`Failure classification: legacy fallback (${fallback}); command=${reason.command}`); }
  }
  return classify(reason);
}
