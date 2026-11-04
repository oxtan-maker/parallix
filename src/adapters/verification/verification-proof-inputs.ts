import type { GitFn } from './verification.js';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { VerificationMeasurement } from '../../application/ports/verification-observation.js';
import type { ControlledVerificationComparison } from '../../application/ports/verification-profile.js';

/** Observational metadata only; it cannot certify a tree or a sampled workload. */
export function verificationObservationContext(root: string, reference?: string): {
  configuration: string | null; runtime: string; profile: VerificationMeasurement['profile'];
} {
  let configuration: string | null = null;
  try { configuration = createHash('sha256').update(fs.readFileSync(path.join(root, 'workflow.config.json')))
    .update(process.version).digest('hex'); } catch { /* Unknown configuration equivalence. */ }
  return { configuration, runtime: process.version, profile: readProfile(reference) };
}

function readProfile(reference?: string): VerificationMeasurement['profile'] {
  if (!reference || !fs.existsSync(reference)) { return null; }
  try {
    const value = JSON.parse(fs.readFileSync(reference, 'utf8')) as { controlledComparisons?: unknown };
    const controlledComparisons = Array.isArray(value.controlledComparisons)
      ? value.controlledComparisons.filter(isControlledComparison) : [];
    return { reference, samples: controlledComparisons.length
      ? controlledComparisons.reduce((sum, comparison) => sum + comparison.samples, 0) : null,
    ...(controlledComparisons.length ? { controlledComparisons } : {}) };
  } catch { return { reference, samples: null }; }
}

function isControlledComparison(value: unknown): value is ControlledVerificationComparison {
  if (!value || typeof value !== 'object') { return false; }
  const item = value as Partial<ControlledVerificationComparison>;
  return hasControlledComparisonIdentity(item) && hasEquivalentRuntime(item)
    && hasControlledSamples(item) && hasControlledMeasurements(item);
}

function hasControlledComparisonIdentity(item: Partial<ControlledVerificationComparison>): boolean {
  return typeof item.experimentId === 'string' && typeof item.coverage === 'boolean'
    && typeof item.workloadFingerprint === 'string' && typeof item.configurationFingerprint === 'string'
    && typeof item.runtimeFingerprint === 'string';
}

function hasEquivalentRuntime(item: Partial<ControlledVerificationComparison>): boolean {
  return item.workloadEquivalent === true && item.configurationEquivalent === true && item.runtimeEquivalent === true;
}

function hasControlledSamples(item: Partial<ControlledVerificationComparison>): boolean {
  return typeof item.samples === 'number' && Number.isSafeInteger(item.samples) && item.samples > 0;
}

function hasControlledMeasurements(item: Partial<ControlledVerificationComparison>): boolean {
  return Boolean(item.before && item.after && item.component && item.optimizationBenefitBound)
    && typeof item.interpretation === 'string';
}

export function verificationDigest(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function resolveNpm(searchPath: string): string | null {
  for (const directory of searchPath.split(path.delimiter)) {
    const candidate = path.join(directory, 'npm');
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      return fs.realpathSync(candidate);
    } catch { /* Continue to the next executable lookup candidate. */ }
  }
  return null;
}

function npmSignature(npm: string): string {
  const manifest = path.resolve(path.dirname(npm), '../package.json');
  const hash = createHash('sha256').update(fs.readFileSync(npm));
  if (fs.existsSync(manifest)) { hash.update(fs.readFileSync(manifest)); }
  return hash.digest('hex');
}

/** Runtime and effective npm launcher identity; file reads avoid spawning npm.
 * Missing npm supports non-npm verifiers; appearance/change invalidates proof. */
export function verificationToolchainIdentity(searchPath = ''): string {
  const npm = resolveNpm(searchPath);
  return JSON.stringify({ node: process.version, executable: fs.realpathSync(process.execPath),
    modules: process.versions.modules, platform: process.platform, arch: process.arch,
    npm, npmDigest: npm ? npmSignature(npm) : null });
}

function isVerificationHeadIdentity(oid: string): boolean {
  return oid === '(initial)' || /^[a-f0-9]{40,64}$/.test(oid);
}

export function readVerificationInputs(rootDir: string, gitRunner: GitFn, searchPath = '',
  toolchainIdentity = () => verificationToolchainIdentity(searchPath)):
  { ok: true; root: string; trackedOutput: string; branch: string; commit: string | null; toolchain: string } | { ok: false; error: string } {
  let root: string;
  try { root = fs.realpathSync(rootDir); } catch { return { ok: false, error: 'verification proof root is unreadable' }; }
  // Porcelain v2 reports cleanliness, branch and HEAD together. Repeated
  // active/review checks need no separate branch and revision subprocesses.
  const status = gitRunner(['-C', root, 'status', '--porcelain=v2', '--branch']);
  const lines = (status.stdout || '').split('\n').filter(Boolean);
  if (status.status !== 0 || lines.some(line => !line.startsWith('# '))) {
    return { ok: false, error: 'verification proof cannot reuse a dirty worktree' };
  }
  const branchLine = lines.find(line => line.startsWith('# branch.head '));
  const oidLine = lines.find(line => line.startsWith('# branch.oid '));
  if (!branchLine || !oidLine) { return { ok: false, error: 'verification branch identity is unreadable' }; }
  const branch = branchLine.slice('# branch.head '.length);
  const oid = oidLine.slice('# branch.oid '.length);
  if (!isVerificationHeadIdentity(oid)) {
    return { ok: false, error: 'verification HEAD identity is unreadable' };
  }
  const tracked = gitRunner(['-C', root, 'ls-files', '-s']);
  const trackedOutput = tracked.stdout || '';
  if (tracked.status !== 0 || !trackedOutput.trim()) {
    return { ok: false, error: 'verification proof input manifest is unreadable' };
  }
  return { ok: true, root, trackedOutput, branch: branch === '(detached)' ? '' : branch,
    commit: oid === '(initial)' ? null : oid, toolchain: toolchainIdentity() };
}

/** External task catalog paths excluded from active candidate inputs. */
export const isVerificationBookkeeping = (file: string): boolean =>
  file.startsWith('backlog/tasks/') || file.startsWith('backlog/completed/');
