import path from 'node:path';
import { readIntegrationVerificationProof } from './integration-verification-proof.js';
import { createActiveVerificationIdentity, type ActiveVerificationOptions as Options } from './active-verification-identity.js';
export { createActiveVerificationIdentity } from './active-verification-identity.js';
import { git } from '../git/git.js';
import { ensureRebaseCompletionRecorder, readRebaseCompletions } from '../git/rebase-completion-recorder.js';
import { readJson, resolveParallixHome, writeJson } from '../storage/storage.js';
import { isVerificationBookkeeping } from './verification-proof-inputs.js';

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
  const integration = readIntegrationVerificationProof(command, root, current);
  if (integration.ok) { return { ...integration, identity: current.identity, rebased: false }; }
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
  return { ok: true as const, identity: current.identity, proof: updated, rebased, diagnostic: 'Active/review verification: reused successful proof.' };
}

export function writeActiveVerificationProof(command: string, root: string, options: Options = {}) {
  const current = createActiveVerificationIdentity(command, root, options);
  if (current.ok === false) { return current; }
  if (options.expectedIdentity && options.expectedIdentity !== current.identity) {
    return { ok: false as const, error: 'Active verification inputs changed while the command ran' };
  }
  try {
    ensureRebaseCompletionRecorder(root, { writeJson });
    const proof: ActiveProof = { policy: 'active-review-v1', scope: current.scope,
      inputFingerprint: current.inputFingerprint, toolchain: current.toolchain,
      coveredCommit: current.commit, verifiedCommit: current.commit,
      status: 'passed', verifiedAt: new Date().toISOString() };
    writeJson(proofPath(current.scope, options), proof, { mode: 0o600 });
    return { ok: true as const, identity: current.identity, proof };
  } catch { return { ok: false as const, error: 'Active verification proof or rebase recorder could not be written' }; }
}
