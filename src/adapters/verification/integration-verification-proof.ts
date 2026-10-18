import type { VerificationReadSnapshot } from './verification-read-snapshot.js';
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
type RunStatus = 'running' | 'passed' | 'failed' | 'cancelled';
/** The executor's own record of one integration gate phase attempt. */
interface RunMeta { attempt: string | null; startedAt: string; finishedAt: string | null; inputIdentity: string | null }
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
  run: RunMeta;
}
/** A settled or in-flight run that is not reusable success evidence. */
interface RunRecord {
  policy: 'integration-verification-v1';
  status: RunStatus;
  run: RunMeta;
  revision: string;
  gates: Gate[];
  outcomes: Outcome[];
}
interface Pending {
  root: string; file: string; coverage: Coverage | null; configured: readonly Gate[]; gates: readonly Gate[];
  identity: Identity | null; plan: string | null; revision: string; run: RunMeta;
}

const REVISION = /^[a-f0-9]{40,64}$/;

/** The workflow attempt that started the run, when one owns it. */
function attemptOf(configuration?: ParallixConfiguration): string | null {
  const operation = configuration?.runtime?.workflowOperation;
  return typeof operation === 'string' && operation ? `${operation}:${configuration?.runtime?.workflowGeneration ?? 0}` : null;
}

function headRevision(root: string): string | null {
  const head = git(['-C', root, 'rev-parse', 'HEAD']);
  const revision = head.stdout.trim();
  return head.status === 0 && REVISION.test(revision) ? revision : null;
}

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

function evidencePath(root: string, snapshot?: VerificationReadSnapshot): string | null {
  const result = (snapshot?.git ?? git)(['-C', root, 'rev-parse', '--git-path', 'integration-verification-proof.json']);
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

/** Gate execution identity includes its plan, checkout branch, inputs and toolchain. */
function runIdentity(root: string, gates: readonly Gate[], configuration?: ParallixConfiguration, readSnapshot?: VerificationReadSnapshot): string | null {
  const current = createActiveVerificationIdentity(JSON.stringify(gates.map(({ key, command }) => ({ key, command }))), root, { configuration }, readSnapshot);
  return current.ok ? current.identity : null;
}

function reusablePlan(coverage: Coverage | null, configured: readonly Gate[] | null, gates: readonly Gate[]): boolean {
  return coverage !== null && configured !== null && covers(coverage, configured)
    && gates.length === configured.length
    && gates.every(gate => configured.some(expected => expected.key === gate.key && expected.command === gate.command));
}

function successfulOutcomes(pending: Pending, outcomes: readonly Outcome[]): boolean {
  return pending.gates.length === pending.configured.length && outcomes.length === pending.gates.length
    && pending.gates.every(gate => outcomes.some(outcome => outcome.key === gate.key
      && outcome.command === gate.command && outcome.exitCode === 0));
}

/**
 * Record that the configured integration gate phase started, then let it settle.
 * The record replaces prior evidence before execution, including for partial or
 * failed retries, and it is the only authority for "a gate run is in progress".
 * Inputs for proof reuse are captured before the first gate, so a changed
 * checkout cannot be certified.
 */
function beginIntegrationRun(root: string, gates: readonly Gate[], configuration?: ParallixConfiguration): Pending | null {
  const file = evidencePath(root);
  const revision = file ? headRevision(root) : null;
  if (!file || !revision || gates.length === 0) { return null; }
  try {
    const coverage = coverageFor(root);
    const configured = configuredPlan(root);
    const eligible = reusablePlan(coverage, configured, gates);
    const identity = eligible ? createActiveVerificationIdentity(coverage!.command, root, { configuration }) : null;
    const pending: Pending = {
      root, file, coverage, configured: configured ?? gates, gates,
      identity: identity && identity.ok ? identity : null,
      plan: coverage && configured ? planDigest(configured, coverage) : null,
      revision, run: { attempt: attemptOf(configuration), startedAt: new Date().toISOString(), finishedAt: null,
        inputIdentity: runIdentity(root, gates, configuration) },
    };
    writeJson(file, { policy: 'integration-verification-v1', status: 'running', run: pending.run, revision,
      gates: gates.map(({ key, command }) => ({ key, command })), outcomes: [] } satisfies RunRecord, { mode: 0o600 });
    return pending;
  } catch {
    // Prior evidence must not survive a run that could not be recorded.
    try { fs.rmSync(file, { force: true }); } catch { /* clearing is best effort */ }
    return null;
  }
}

function finishIntegrationRun(pending: Pending, outcomes: readonly Outcome[], disposition: 'passed' | 'failed' | 'cancelled',
  configuration?: ParallixConfiguration): void {
  const run: RunMeta = { ...pending.run, finishedAt: new Date().toISOString() };
  try {
    const current = pending.identity && pending.coverage
      ? createActiveVerificationIdentity(pending.coverage.command, pending.root, { configuration }) : null;
    const reusable = disposition === 'passed' && pending.identity !== null && current !== null && current.ok
      && current.identity === pending.identity.identity && pending.coverage !== null && pending.plan !== null
      && successfulOutcomes(pending, outcomes);
    if (reusable && current && pending.coverage && pending.plan) {
      const evidence: Evidence = { policy: 'integration-verification-v1', scope: current.scope,
        inputFingerprint: current.inputFingerprint, toolchain: current.toolchain,
        verifiedCommit: current.commit, coveredCommit: current.commit, verifiedAt: run.finishedAt!,
        status: 'passed', plan: pending.plan, checks: pending.coverage.checks,
        outcomes: outcomes.map(({ key, command, exitCode }) => ({ key, command, exitCode })), run };
      writeJson(pending.file, evidence, { mode: 0o600 });
      return;
    }
    // A run that is not reusable success evidence still settles: its per-gate
    // outcomes are what the board reports, and an unsettled record is what it
    // reports as running.
    writeJson(pending.file, { policy: 'integration-verification-v1',
      status: disposition, run, revision: pending.revision,
      gates: pending.gates.map(({ key, command }) => ({ key, command })),
      outcomes: outcomes.map(({ key, command, exitCode }) => ({ key, command, exitCode })) } satisfies RunRecord, { mode: 0o600 });
  } catch { /* Evidence is optional; verification executes on a cache miss. */ }
}

/** The executor's integration run observation for this checkout, if any. */
export interface IntegrationGateRun {
  readonly current: boolean;
  readonly status: RunStatus;
  readonly attempt: string | null;
  readonly startedAt: string;
  readonly finishedAt: string | null;
  readonly revision: string;
  readonly gates: readonly Gate[];
  readonly outcomes: readonly Outcome[];
}

interface StoredRun {
  policy?: unknown; status?: RunStatus; run?: Partial<RunMeta>; revision?: string;
  coveredCommit?: string; verifiedAt?: string; gates?: Gate[]; outcomes?: Outcome[];
}
function validStatus(status: unknown): status is RunStatus {
  return status === 'running' || status === 'passed' || status === 'failed' || status === 'cancelled';
}
function runOutcomes(data: StoredRun): Outcome[] {
  return (Array.isArray(data.outcomes) ? data.outcomes : []).filter((outcome): outcome is Outcome =>
    !!outcome && typeof outcome.key === 'string' && typeof outcome.command === 'string'
    && (outcome.exitCode === null || typeof outcome.exitCode === 'number'));
}
function runGates(data: StoredRun, outcomes: Outcome[]): Gate[] {
  const gates = (Array.isArray(data.gates) ? data.gates : []).filter((gate): gate is Gate =>
    !!gate && typeof gate.key === 'string' && typeof gate.command === 'string');
  return gates.length ? gates : outcomes.map(({ key, command }) => ({ key, command }));
}
function runTimes(data: StoredRun, status: RunStatus) {
  const stored = data.run;
  const verifiedAt = typeof data.verifiedAt === 'string' ? data.verifiedAt : null;
  const startedAt = typeof stored?.startedAt === 'string' ? stored.startedAt : verifiedAt;
  const finishedAt = typeof stored?.finishedAt === 'string' ? stored.finishedAt : status === 'running' ? null : startedAt;
  return { startedAt, finishedAt };
}

function storedRevision(data: StoredRun): string {
  if (typeof data.revision === 'string') { return data.revision; }
  return typeof data.coveredCommit === 'string' ? data.coveredCommit : '';
}
/** Read the run record without reuse identity: an observation, not authority. */
export function readIntegrationGateRun(root: string, configuration?: ParallixConfiguration, snapshot?: VerificationReadSnapshot): IntegrationGateRun | null {
  try {
    const file = evidencePath(root, snapshot);
    if (!file) { return null; }
    const result = readJson<StoredRun>(file);
    if (!result.ok && result.error) { throw result.error; }
    const data = result.ok ? result.data : null;
    if (!data || data.policy !== 'integration-verification-v1') { return null; }
    const status = data.status;
    if (!validStatus(status)) { return null; }
    const revision = storedRevision(data);
    if (!REVISION.test(revision)) { return null; }
    const outcomes = runOutcomes(data);
    const observedGates = runGates(data, outcomes);
    const stored = data.run;
    const { startedAt, finishedAt } = runTimes(data, status);
    if (!startedAt) { return null; } // a record without run identity predates observation
    return {
      current: typeof stored?.inputIdentity === 'string' && stored.inputIdentity === runIdentity(root, observedGates, configuration, snapshot),
      status, attempt: typeof stored?.attempt === 'string' ? stored.attempt : null,
      startedAt, finishedAt,
      revision,
      gates: observedGates,
      outcomes,
    };
  } catch (error) { throw new Error('Integration execution evidence is unreadable', { cause: error }); }
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

function coversRevision(root: string, from: string, to: string, snapshot?: VerificationReadSnapshot): boolean {
  if (from === to) { return true; }
  const diff = (snapshot?.git ?? git)(['-C', root, 'diff', '--name-only', '-z', from, to, '--']);
  return diff.status === 0 && diff.stdout.split('\0').filter(Boolean).every(isVerificationBookkeeping);
}

/** Integration evidence never inherits the active cache's completed-rebase
 * exception. A different revision requires a successful bookkeeping-only diff. */
export function readIntegrationVerificationProof(command: string, root: string, current: Identity, snapshot?: VerificationReadSnapshot) {
  const miss = { ok: false as const };
  try {
    const coverage = coverageFor(root);
    const gates = configuredPlan(root);
    if (!coverage || coverage.command !== command || !gates || !covers(coverage, gates)) { return miss; }
    const file = evidencePath(root, snapshot);
    if (!file) { return miss; }
    const result = readJson<Evidence>(file);
    const proof = result.data;
    if (!result.ok || !proof || !matchesIdentity(proof, current) || !matchesCoverage(proof, gates, coverage)) { return miss; }
    if (!coversRevision(root, proof.verifiedCommit, current.commit, snapshot)) { return miss; }
    return { ok: true as const, proof, diagnostic: `Repository verification passed by reuse of integration evidence ${file}; validated ${proof.verifiedCommit}, covered ${current.commit}.` };
  } catch { return miss; }
}

/** Bound by CLI composition; the generic gate executor imports only the port. */
export function createIntegrationVerificationEvidencePort(configuration?: ParallixConfiguration): IntegrationVerificationEvidencePort {
  return { start: (root, gates) => {
    const pending = beginIntegrationRun(root, gates, configuration);
    return pending ? { complete: (outcomes, disposition) => finishIntegrationRun(pending, outcomes, disposition, configuration) } : null;
  } };
}
