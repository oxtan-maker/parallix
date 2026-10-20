/** Compatibility exports; recovery classification belongs to the domain. */
export * from '../domain/failure-classification.js';
import { classifyError as classify } from '../domain/failure-classification.js';
import { legacyFailureReason } from '../domain/failure-reason.js';
import * as fmt from './presentation/cli-format.js';

export function classifyError(message: string, failureReason?: unknown, log: (_message: string) => void = fmt.log.plain) {
  const fallback = legacyFailureReason(failureReason);
  if (fallback) { log(`Failure classification: legacy fallback (${fallback})`); }
  return classify(message, failureReason);
}
