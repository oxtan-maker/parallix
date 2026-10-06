import type { DecisionPort } from '../application/ports/decision.js';
import { resolveDecisionProvider } from '../adapters/decision/provider.js';
import { SystemOneDecisionAdapter } from '../adapters/decision/system-one.js';

/** Resolve once from operator state; callers receive only the application port. */
export function createDecisionPort(options: {
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly transport?: typeof fetch;
} = {}): DecisionPort {
  return new SystemOneDecisionAdapter(resolveDecisionProvider(options.env ?? process.env), options.transport);
}
