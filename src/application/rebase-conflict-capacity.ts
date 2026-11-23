import { recognizedFailureReason } from '../domain/failure-reason.js';
import * as fmt from './presentation/cli-format.js';

interface ConflictResolverCapacityFailure {
  substitution: string;
  unavailable: string;
}

/** Classify the pinned-family capacity refusals that permit conflict-resolution substitution. */
export function conflictResolverCapacityFailure(error: unknown, implementer: string): ConflictResolverCapacityFailure | null {
  const reason = recognizedFailureReason((error as { failureReason?: unknown } | null)?.failureReason);
  const subject = `Implementer ${fmt.agent(implementer)}`;
  if (reason?.code === 'provider-unavailable') {
    return {
      substitution: `${subject} is temporarily unavailable from its provider`,
      unavailable: `${subject} is temporarily unavailable from its provider.`,
    };
  }
  if (reason?.code !== 'agent-quota') { return null; }
  const reset = reason.context?.resetAt ? ` (resets ${reason.context.resetAt})` : '';
  return {
    substitution: `${subject} hit an agent usage limit`,
    unavailable: `${subject} hit an agent usage limit${reset}.`,
  };
}
