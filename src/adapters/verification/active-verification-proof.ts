import path from 'node:path';
import type { ParallixConfiguration } from '../../application/ports/configuration.js';
import { git } from '../git/git.js';
import { ensureRebaseCompletionRecorder, readRebaseCompletions, rebaseInProgress } from '../git/rebase-completion-recorder.js';
import { readJson, resolveParallixHome, writeJson } from '../storage/storage.js';
import { isVerificationBookkeeping, readVerificationInputs, verificationDigest } from './verification-proof-inputs.js';

interface Options {
  configuration?: ParallixConfiguration;
  proofPath?: string;
  expectedIdentity?: string;
  context?: string;
}

interface ActiveProof {
  policy: 'active-review-v1';
  scope: string;
  inputFingerprint: string;
  toolchain: string;
  coveredCommit: string;
  verifiedCommit: string;
  status: 'passed';
  verifiedAt: string;
}

const revision = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{40,64}$/.test(value);

export function createActiveVerificationIdentity(command: string, root: string, options: Options = {}) {
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

function proofPath(scope: string, options: Options): string {
  return options.proofPath ?? path.join(resolveParallixHome({ configuration: options.configuration, ensureDir: false }),
    'active-verification-proofs', `${scope}.json`);
}

function matchesProof(proof: ActiveProof | null, scope: string, toolchain: string): proof is ActiveProof {
  return Boolean(proof && proof.policy === 'active-review-v1' && proof.status === 'passed'
    && proof.scope === scope && proof.toolchain === toolchain && revision(proof.coveredCommit)
    && revision(proof.verifiedCommit) && typeof proof.inputFingerprint === 'string');
}

function onlyBookkeeping(root: string, from: string, to: string): boolean {
  const result = git(['-C', root, 'diff', '--name-only', '-z', from, to, '--']);
  return result.status === 0 && result.stdout.split('\0').filter(Boolean).every(isVerificationBookkeeping);
}

function completedRebaseCovers(root: string, branch: string, from: string, to: string): boolean {
  let covered = from;
  for (const record of readRebaseCompletions(root)) {
    if (!record || !revision(record.from) || !revision(record.to) || record.branch !== branch || !Array.isArray(record.mappings)
      || !onlyBookkeeping(root, covered, record.from)) { continue; }
    // Git invokes post-rewrite only after completion. It may drop already
    // upstream commits, so the covered HEAD need not occur in its mapping list.
    covered = record.to;
    if (onlyBookkeeping(root, covered, to)) { return true; }
  }
  return false;
}

/** Active/review scheduling evidence only; configured integration gates and
 * downstream CI validate their own candidates independently. */
export function readActiveVerificationProof(command: string, root: string, options: Options = {}) {
  const current = createActiveVerificationIdentity(command, root, options);
  if (current.ok === false) { return current; }
  const file = proofPath(current.scope, options);
  const cached = readJson<ActiveProof>(file);
  const proof = cached.data;
  if (!cached.ok || !matchesProof(proof, current.scope, current.toolchain)) {
    return { ok: false as const, identity: current.identity, error: 'No matching active verification proof' };
  }
  const rebased = proof.inputFingerprint !== current.inputFingerprint;
  if (rebased && !completedRebaseCovers(root, current.branch, proof.coveredCommit, current.commit)) {
    return { ok: false as const, identity: current.identity, error: 'Active verification inputs changed outside a completed rebase' };
  }
  const updated = { ...proof, coveredCommit: current.commit, inputFingerprint: current.inputFingerprint };
  if (proof.coveredCommit !== current.commit || rebased) {
    try { writeJson(file, updated, { mode: 0o600 }); }
    catch { return { ok: false as const, error: 'Could not advance active verification proof' }; }
  }
  return { ok: true as const, identity: current.identity, proof: updated, rebased };
}

export function writeActiveVerificationProof(command: string, root: string, options: Options = {}) {
  const current = createActiveVerificationIdentity(command, root, options);
  if (current.ok === false) { return current; }
  if (options.expectedIdentity && options.expectedIdentity !== current.identity) {
    return { ok: false as const, error: 'Active verification inputs changed while the command ran' };
  }
  try {
    ensureRebaseCompletionRecorder(root);
    const proof: ActiveProof = { policy: 'active-review-v1', scope: current.scope,
      inputFingerprint: current.inputFingerprint, toolchain: current.toolchain,
      coveredCommit: current.commit, verifiedCommit: current.commit,
      status: 'passed', verifiedAt: new Date().toISOString() };
    writeJson(proofPath(current.scope, options), proof, { mode: 0o600 });
    return { ok: true as const, identity: current.identity, proof };
  } catch { return { ok: false as const, error: 'Active verification proof or rebase recorder could not be written' }; }
}
