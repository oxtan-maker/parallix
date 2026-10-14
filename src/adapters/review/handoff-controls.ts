import type { ParallixConfiguration } from '../../application/ports/configuration.js';
import { readActiveVerificationProof } from '../verification/active-verification-proof.js';
import { formatVerificationCommand } from '../verification/verification.js';

type GateProofRead = (_command: string, _root: string) => {
  ok: boolean; proof?: { status: 'passed'; verifiedCommit: string; verifiedAt: string }; error?: string;
};

/** Cite the existing handoff proof authority, including its validated revision. */
export function buildHandoffControls(root: string, declaredGates: readonly string[], options: {
  configuration?: ParallixConfiguration; readProof?: GateProofRead; repositoryCommand?: string;
} = {}): string {
  const repositoryCommand = options.repositoryCommand ?? formatVerificationCommand(undefined, root);
  const commands = [...new Set([repositoryCommand, ...declaredGates].filter(Boolean))];
  const readProof = options.readProof ?? ((command, checkout) => readActiveVerificationProof(command, checkout, { configuration: options.configuration }));
  return commands.map(command => {
    const result = readProof(command, root);
    return result.ok && result.proof
      ? `  - Handoff gate \`${command}\`: status ${result.proof.status}, exitCode 0, validated SHA ${result.proof.verifiedCommit}, recordedAt ${result.proof.verifiedAt}. Cite this result; do not rerun it.`
      : `  - Handoff gate \`${command}\`: no current matching proof available. Investigate a concrete verification finding with a focused check; handoff owns declared gate execution.`;
  }).concat('  - Handoff validated checkpoint references, complete criteria, combined evidence coverage and repair freshness.').join('\n');
}
