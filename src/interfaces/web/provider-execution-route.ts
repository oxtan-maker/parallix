/**
 * GET /api/provider-execution: the slim, versioned provider snapshot a
 * same-host sampler polls (ADR 0054 loopback policy applies unchanged).
 *
 * The route reads one injected port. It never builds the board, owns no
 * timer or cache, and turns a source failure into a typed non-success
 * response, never an empty snapshot that a sampler could read as zero usage.
 */
import type { FastifyInstance } from 'fastify';
import type { ProviderExecutionSnapshot } from '../../application/projections/provider-execution.js';
import { errorMessage } from './host-support.js';

export const WEB_PROVIDER_EXECUTION_PATH = '/api/provider-execution';

/** Read-only provider snapshot port; composition supplies the observer-backed read. */
export type WebProviderExecution = () => Promise<ProviderExecutionSnapshot> | ProviderExecutionSnapshot;

export interface WebProviderExecutionError {
  readonly kind: 'provider-execution-error';
  readonly version: 1;
  readonly error: { readonly kind: 'unavailable'; readonly message: string };
}

const unavailable = (message: string): WebProviderExecutionError =>
  ({ kind: 'provider-execution-error', version: 1, error: { kind: 'unavailable', message } });

export function registerProviderExecutionRoute(app: FastifyInstance, source: () => WebProviderExecution | null): void {
  app.get(WEB_PROVIDER_EXECUTION_PATH, async (_request, reply) => {
    let snapshot: ProviderExecutionSnapshot;
    try {
      const read = source();
      if (read === null) { return reply.code(503).send(unavailable('provider execution port is not wired')); }
      snapshot = await read();
    } catch (error) { return reply.code(503).send(unavailable(errorMessage(error))); }
    return reply.type('application/json; charset=utf-8').send(snapshot);
  });
}
