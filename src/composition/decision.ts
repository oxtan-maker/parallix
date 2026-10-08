import type { DecisionPort } from '../application/ports/decision.js';
import type { DecisionConfiguration } from '../application/ports/configuration.js';
import { resolveDecisionProvider } from '../adapters/decision/provider.js';
import { SystemOneDecisionAdapter } from '../adapters/decision/system-one.js';

/** Resolve once from operator state; callers receive only the application port. */
export function createDecisionPort(settings: DecisionConfiguration, transport?: typeof fetch): DecisionPort {
  return new SystemOneDecisionAdapter(resolveDecisionProvider(settings), transport);
}
