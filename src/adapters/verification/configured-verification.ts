import { resolveCanonicalMaxConcurrentGates } from '../config/product-config.js';
import type { ParallixConfiguration } from '../../application/ports/configuration.js';
import { runPhaseGates } from '../config/repository-gates.js';
import { formatVerificationCommand, resolveVerificationAdapter, runVerificationGate, type VerificationGateResult } from './verification.js';

/** The enabled path uses the same admitted child runner as lifecycle gates. */
export async function runConfiguredVerification(area: string | undefined, root: string, configuration?: ParallixConfiguration): Promise<VerificationGateResult> {
  if (!Number.isFinite(resolveCanonicalMaxConcurrentGates(root))) { return runVerificationGate(area, { rootDir: root, env: configuration?.forwardedEnvironment }); }
  if (!resolveVerificationAdapter(root).command) { return { status: 0 }; }
  const command = formatVerificationCommand(area, root);
  const result = await runPhaseGates('handoff', { configuration, slug: '', checkoutPath: root,
    gates: [{ key: 'verification', command, order: 0 }], maxParallel: 1,
  });
  return { status: result.ok ? 0 : result.failedGate ? result.failedGate.exitCode : 1,
    signal: result.failedGate?.signal ?? null, failureReason: result.failedGate?.failureReason,
    stdout: result.outcomes?.map(outcome => outcome.stdout).join('\n') ?? '',
    stderr: result.outcomes?.map(outcome => outcome.stderr).join('\n') || result.error || '' };
}
