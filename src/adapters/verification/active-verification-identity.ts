import type { ParallixConfiguration } from '../../application/ports/configuration.js';
import { git } from '../git/git.js';
import { rebaseInProgress } from '../git/rebase-completion-recorder.js';
import { isVerificationBookkeeping, readVerificationInputs, verificationDigest } from './verification-proof-inputs.js';

export interface ActiveVerificationOptions {
  configuration?: ParallixConfiguration;
  proofPath?: string;
  expectedIdentity?: string;
  context?: string;
}

export function createActiveVerificationIdentity(command: string, root: string, options: ActiveVerificationOptions = {}) {
  try {
    if (rebaseInProgress(root)) { return { ok: false as const, blocked: true as const, error: 'Rebase in progress; complete or abort it before verification' }; }
  } catch { return { ok: false as const, error: 'Git metadata unavailable for active verification reuse' }; }
  const inputs = readVerificationInputs(root, git, options.configuration?.agents.searchPath ?? '');
  if (inputs.ok === false) { return inputs; }
  if (!command.trim() || !inputs.branch) { return { ok: false as const, error: 'Active verification requires a command and attached mission branch' }; }
  const head = git(['-C', root, 'rev-parse', 'HEAD']);
  if (head.status !== 0) { return { ok: false as const, error: 'Active verification HEAD unavailable' }; }
  const inputFingerprint = verificationDigest(inputs.trackedOutput.split('\n').filter(entry =>
    !isVerificationBookkeeping(entry.slice(entry.indexOf('\t') + 1))).join('\n'));
  const scope = verificationDigest(JSON.stringify({ policy: 'active-review-v1', root: inputs.root,
    branch: inputs.branch, command: command.trim(), toolchain: inputs.toolchain, context: options.context ?? '' }));
  return { ok: true as const, scope, inputFingerprint, toolchain: inputs.toolchain,
    branch: inputs.branch, commit: head.stdout.trim(),
    identity: verificationDigest(JSON.stringify({ scope, inputFingerprint, commit: head.stdout.trim() })) };
}
