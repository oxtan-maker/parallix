import { gateFailureReasonFromProcess } from '../../domain/failure-classification.js';
import { verificationObservation, type VerificationObservationInput } from '../ports/verification-observation.js';

/** Observe synchronous and asynchronous commands at their application boundary. */
export async function observeVerificationCommand<T extends { status: number | null; signal?: string | null;
  stdout?: unknown; stderr?: unknown; reused?: boolean }>(input: VerificationObservationInput, execute: () => T | Promise<T>): Promise<T> {
  const handle = await verificationObservation()?.begin(input).catch(() => null);
  const start = Date.now();
  try {
    await handle?.started().catch(() => undefined);
    const result = await execute();
    await handle?.complete({ result: result.reused ? 'reused' : result.status === 0 ? 'passed' : result.signal ? 'interrupted' : 'failed',
      exitCode: result.status, failureReason: gateFailureReasonFromProcess(result) ?? null,
      wallMs: result.reused ? null : Date.now() - start, cpu: null }).catch(() => undefined);
    return result;
  } catch (error) {
    await handle?.complete({ result: 'failed', exitCode: null,
      failureReason: gateFailureReasonFromProcess({ status: null, stderr: String(error) }) ?? null,
      wallMs: Date.now() - start, cpu: null }).catch(() => undefined);
    throw error;
  }
}
