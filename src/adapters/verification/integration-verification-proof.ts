import fs from 'node:fs';
import path from 'node:path';
import type { ParallixConfiguration } from '../../application/ports/configuration.js';
import type { IntegrationVerificationEvidencePort } from '../../application/ports/integration-verification-evidence.js';
import { loadAdapterConfig } from '../config/product-config.js';
import { git } from '../git/git.js';
import { readJson, writeJson } from '../storage/storage.js';
import { createActiveVerificationIdentity } from './active-verification-identity.js';
import { isVerificationBookkeeping, verificationDigest } from './verification-proof-inputs.js';

type Gate = { key: string; command: string };
type Outcome = { key: string; command: string; exitCode: number | null };
type Identity = Extract<ReturnType<typeof createActiveVerificationIdentity>, { ok: true }>;
interface Coverage { command: string; checks: Record<string, string[]> }
interface Evidence {
  policy: 'integration-verification-v1';
  scope: string;
  inputFingerprint: string;
  toolchain: string;
  verifiedCommit: string;
  coveredCommit: string;
  verifiedAt: string;
  status: 'passed';
  plan: string;
  checks: Record<string, string[]>;
  outcomes: { key: string; command: string; exitCode: number | null }[];
}
interface Pending { root: string; file: string; coverage: Coverage; gates: readonly Gate[]; identity: Identity; plan: string }

function coverageFor(root: string): Coverage | null {
  const verification = loadAdapterConfig(root).verification as { command?: unknown; integrationCoverage?: unknown } | undefined;
  const raw = verification?.integrationCoverage;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) { return null; }
  const { command, checks } = raw as Partial<Coverage>;
  if (typeof command !== 'string' || !command.trim() || typeof verification?.command !== 'string'
    || command !== verification.command.replaceAll('{{area}}', 'all')
    || !checks || typeof checks !== 'object' || Array.isArray(checks) || !Object.keys(checks).length
    || Object.entries(checks).some(([check, keys]) => !check.trim() || !Array.isArray(keys) || !keys.length
      || keys.some(key => typeof key !== 'string' || !key.trim()) || new Set(keys).size !== keys.length)) { return null; }
  return { command, checks };
}

function evidencePath(root: string): string | null {
  const result = git(['-C', root, 'rev-parse', '--git-path', 'integration-verification-proof.json']);
  return result.status === 0 && result.stdout.trim() ? path.resolve(root, result.stdout.trim()) : null;
}

function configuredPlan(root: string): readonly Gate[] | null {
  const raw = (loadAdapterConfig(root).gates as { preIntegration?: unknown } | undefined)?.preIntegration;
  if (!Array.isArray(raw) || !raw.length || raw.some(gate => !gate || typeof gate.key !== 'string'
    || !gate.key || typeof gate.command !== 'string' || !gate.command.trim())
    || new Set(raw.map(gate => gate.key)).size !== raw.length) { return null; }
  return raw as readonly Gate[];
}

const planDigest = (gates: readonly Gate[], coverage: Coverage) => verificationDigest(JSON.stringify({ gates, coverage }));
function covers(coverage: Coverage, gates: readonly Gate[]): boolean {
  return Object.values(coverage.checks).flat().every(key => gates.some(gate => gate.key === key));
}

/** Clear prior evidence before execution, including partial or failed retries.
 * Capture inputs before the first gate, so a changed checkout cannot be certified. */
function beginIntegrationVerification(root: string, gates: readonly Gate[], configuration?: ParallixConfiguration): Pending | null {
  try {
    const file = evidencePath(root);
    if (!file) { return null; }
    fs.rmSync(file, { force: true });
    const coverage = coverageFor(root);
    const configured = configuredPlan(root);
    if (!coverage || !configured || !covers(coverage, configured)
      || gates.length !== configured.length
      || gates.some(gate => !configured.some(expected => expected.key === gate.key && expected.command === gate.command))) { return null; }
    const identity = createActiveVerificationIdentity(coverage.command, root, { configuration });
    return identity.ok ? { root, file, coverage, gates: configured, identity, plan: planDigest(configured, coverage) } : null;
  } catch { return null; }
}

function finishIntegrationVerification(pending: Pending, outcomes: readonly Outcome[], configuration?: ParallixConfiguration): void {
  try {
    const current = createActiveVerificationIdentity(pending.coverage.command, pending.root, { configuration });
    if (!current.ok || current.identity !== pending.identity.identity || outcomes.length !== pending.gates.length
      || pending.gates.some(gate => !outcomes.some(outcome => outcome.key === gate.key
        && outcome.command === gate.command && outcome.exitCode === 0))) { return; }
    const evidence: Evidence = { policy: 'integration-verification-v1', scope: current.scope,
      inputFingerprint: current.inputFingerprint, toolchain: current.toolchain,
      verifiedCommit: current.commit, coveredCommit: current.commit, verifiedAt: new Date().toISOString(),
      status: 'passed', plan: pending.plan, checks: pending.coverage.checks,
      outcomes: outcomes.map(({ key, command, exitCode }) => ({ key, command, exitCode })) };
    writeJson(pending.file, evidence, { mode: 0o600 });
  } catch { /* Evidence is optional; verification executes on a cache miss. */ }
}

function matchesIdentity(proof: Evidence, current: Identity): boolean {
  return proof.policy === 'integration-verification-v1' && proof.status === 'passed'
    && proof.scope === current.scope && proof.toolchain === current.toolchain
    && proof.inputFingerprint === current.inputFingerprint
    && typeof proof.verifiedCommit === 'string' && /^[a-f0-9]{40,64}$/.test(proof.verifiedCommit)
    && proof.coveredCommit === proof.verifiedCommit && typeof proof.verifiedAt === 'string'
    && Number.isFinite(Date.parse(proof.verifiedAt));
}

function matchesCoverage(proof: Evidence, gates: readonly Gate[], coverage: Coverage): boolean {
  return proof.plan === planDigest(gates, coverage) && JSON.stringify(proof.checks) === JSON.stringify(coverage.checks)
    && Array.isArray(proof.outcomes) && proof.outcomes.length === gates.length
    && gates.every(gate => proof.outcomes.some(outcome => outcome && outcome.key === gate.key
      && outcome.command === gate.command && outcome.exitCode === 0));
}

/** Integration evidence never inherits the active cache's completed-rebase
 * exception. A different revision requires a successful bookkeeping-only diff. */
export function readIntegrationVerificationProof(command: string, root: string, current: Identity) {
  const miss = { ok: false as const };
  try {
    const coverage = coverageFor(root);
    const gates = configuredPlan(root);
    const file = evidencePath(root);
    if (!coverage || coverage.command !== command || !gates || !file || !covers(coverage, gates)) { return miss; }
    const result = readJson<Evidence>(file);
    const proof = result.data;
    if (!result.ok || !proof || !matchesIdentity(proof, current) || !matchesCoverage(proof, gates, coverage)) { return miss; }
    if (current.commit !== proof.verifiedCommit) {
      const diff = git(['-C', root, 'diff', '--name-only', '-z', proof.verifiedCommit, current.commit, '--']);
      if (diff.status !== 0 || !diff.stdout.split('\0').filter(Boolean).every(isVerificationBookkeeping)) { return miss; }
    }
    return { ok: true as const, proof, diagnostic: `Repository verification passed by reuse of integration evidence ${file}; validated ${proof.verifiedCommit}, covered ${current.commit}.` };
  } catch { return miss; }
}

/** Bound by CLI composition; the generic gate executor imports only the port. */
export function createIntegrationVerificationEvidencePort(configuration?: ParallixConfiguration): IntegrationVerificationEvidencePort {
  return { start: (root, gates) => {
    const pending = beginIntegrationVerification(root, gates, configuration);
    return pending ? { complete: outcomes => finishIntegrationVerification(pending, outcomes, configuration) } : null;
  } };
}
