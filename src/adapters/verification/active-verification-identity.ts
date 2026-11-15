import type { VerificationReadSnapshot } from './verification-read-snapshot.js';
import type { ParallixConfiguration } from '../../application/ports/configuration.js';
import { git } from '../git/git.js';
import { rebaseInProgress } from '../git/rebase-completion-recorder.js';
import { isVerificationBookkeeping } from '../../domain/integration-validation-policy.js';
import { readVerificationInputs, verificationDigest, type VerificationInputs } from './verification-proof-inputs.js';

export interface ActiveVerificationOptions {
  configuration?: ParallixConfiguration;
  proofPath?: string;
  expectedIdentity?: string;
  context?: string;
}

export function createActiveVerificationIdentity(command: string, root: string, options: ActiveVerificationOptions = {}, readSnapshot?: VerificationReadSnapshot) {
  return readSnapshot
    ? readSnapshot.memo(JSON.stringify(['identity', root, command, options.context, options.configuration?.agents.searchPath]),
      () => readIdentity(command, root, options, readSnapshot))
    : readIdentity(command, root, options);
}

/** Verification identity for one command and checkout, or why it has none. */
export type ActiveVerificationIdentity = {
  readonly ok: true; readonly scope: string; readonly inputFingerprint: string; readonly toolchain: string;
  readonly branch: string; readonly commit: string; readonly identity: string;
};
export type ActiveVerificationFailure = {
  readonly ok: false; readonly error: string; readonly blocked?: true;
  /** Checkout facts Git already named before the identity failed. */
  readonly inputs?: VerificationInputs;
};

function readIdentity(command: string, root: string, options: ActiveVerificationOptions,
  readSnapshot?: VerificationReadSnapshot): ActiveVerificationIdentity | ActiveVerificationFailure {
  const gitRunner = readSnapshot?.git ?? git;
  try {
    if (rebaseInProgress(root, gitRunner)) { return { ok: false as const, blocked: true as const, error: 'Rebase in progress; complete or abort it before verification' }; }
  } catch { return { ok: false as const, error: 'Git metadata unavailable for active verification reuse' }; }
  const inputs = readVerificationInputs(root, gitRunner, options.configuration?.agents.searchPath ?? '',
    readSnapshot ? () => readSnapshot!.toolchain(options.configuration?.agents.searchPath ?? '') : undefined);
  if (inputs.ok === false) { return inputs; }
  // A failed identity still carries the checkout facts Git already named, so a
  // caller classifying the proof slot needs no second subprocess for them.
  if (!command.trim() || !inputs.branch) { return { ok: false as const, error: 'Active verification requires a command and attached mission branch', inputs }; }
  if (!inputs.commit) { return { ok: false as const, error: 'Active verification HEAD unavailable', inputs }; }
  const fingerprint = () => verificationDigest(inputs.trackedOutput.split('\n').filter(entry =>
    !isVerificationBookkeeping(entry.slice(entry.indexOf('\t') + 1))).join('\n'));
  const inputFingerprint = readSnapshot?.memo(JSON.stringify(['fingerprint', inputs.root]), fingerprint) ?? fingerprint();
  const scope = activeVerificationScope(inputs.root, inputs.branch, command, inputs.toolchain, options.context);
  return { ok: true as const, scope, inputFingerprint, toolchain: inputs.toolchain,
    branch: inputs.branch, commit: inputs.commit,
    identity: verificationDigest(JSON.stringify({ scope, inputFingerprint, commit: inputs.commit })) };
}

/** The proof slot one command occupies for one checkout branch and toolchain. */
export function activeVerificationScope(root: string, branch: string, command: string, toolchain: string, context = ''): string {
  return verificationDigest(JSON.stringify({ policy: 'active-review-v1', root, branch, command: command.trim(), toolchain, context }));
}
