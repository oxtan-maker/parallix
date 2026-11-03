import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

type Manifest = { pid: number; roots: string[] } | string[];

/** A temporary root recovery kept, and why. */
export interface UnresolvedTempRoot { readonly root: string; readonly reason: string }

/** What one recovery pass reclaimed and what it could not prove safe to remove. */
export interface TempRootRecoveryReport {
  readonly reclaimed: string[];
  readonly unresolved: UnresolvedTempRoot[];
}

/** Liveness of a recorded owner: `null` when its identity cannot be confirmed. */
type OwnerLiveness = (_pid: number, _startId: string | null) => boolean | null;

/** Without an identity probe a live PID may have been reused: uncertain, never dead. */
function pidOnlyLiveness(pid: number): boolean | null {
  return isProcessAlive(pid) ? null : false;
}

const OWNER_FILE = 'owner.json';
const SCRATCH_OWNER_FILE = '.parallix-scratch-owner.json';
interface ScratchOwner { pid: number; startId: string | null; bootId: string | null; root: string; children?: { pid: number; startId: string | null }[]; launching?: boolean }
function bootIdentity(): string | null {
  try { return fs.readFileSync('/proc/sys/kernel/random/boot_id', 'utf8').trim(); } catch { return null; }
}

const RUNNER_ROOTS_FILE = 'runner.json';
const CHECKOUT_TMP = /^(?:parallix-test-tmp-|px-tmp-)[a-f0-9]{12}$/;
const COVERAGE_SCRATCH = /^coverage-scratch-[A-Za-z0-9]{6}$/;
const FAST_UNIT_SCRATCH = /^fast-unit-scratch-[A-Za-z0-9]{6}$/;
/** A scratch root this young may belong to a runner that has not launched its suite yet. */
const LEGACY_SCRATCH_MIN_AGE_MS = 10 * 60 * 1000;

function defaultManifestDir() {
  return path.join(os.tmpdir(), 'parallix-temp-root-manifests');
}

function ownedDirectory(directory: string) {
  const stat = fs.lstatSync(directory);
  const uid = process.getuid?.();
  return stat.isDirectory() && !stat.isSymbolicLink() && (uid === undefined || stat.uid === uid);
}

function ensureManifestDir(manifestDir = defaultManifestDir()) {
  fs.mkdirSync(manifestDir, { recursive: true, mode: 0o700 });
  if (!ownedDirectory(manifestDir)) { throw new Error(`Unsafe temp-root manifest directory: ${manifestDir}`); }
  fs.chmodSync(manifestDir, 0o700);
  return manifestDir;
}

function manifestRoots(manifest: Manifest) {
  return Array.isArray(manifest) ? manifest : Array.isArray(manifest?.roots) ? manifest.roots : [];
}

function isProcessAlive(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== 'ESRCH';
  }
}

/**
 * Recovery only removes directories it can attribute, so it is never handed
 * authority over unrelated user data: anything under the system temp dir, or
 * a runner scratch root by its exact structure (TASK-2816) — a covered
 * runner's `px-tmp-<id>/coverage-scratch-*` on a disk-backed temporary base
 * and its checkout's `tmp/fast-unit-scratch-*`.
 */
function isTemporaryRoot(root: string) {
  const resolved = path.resolve(root);
  const base = path.resolve(os.tmpdir());
  if (resolved.startsWith(`${base}${path.sep}`)) { return true; }
  const name = path.basename(resolved);
  const parent = path.basename(path.dirname(resolved));
  return (COVERAGE_SCRATCH.test(name) && CHECKOUT_TMP.test(parent)) || ((FAST_UNIT_SCRATCH.test(name) || /^parallix-test-transcripts-[A-Za-z0-9]{6}$/.test(name)) && parent === 'tmp');
}

function removeRecordedRoots(roots: unknown[], report: TempRootRecoveryReport, liveness: OwnerLiveness): boolean {
  let resolved = true;
  for (const root of roots) {
    if (typeof root !== 'string' || !fs.existsSync(root)) { continue; }
    if (!isTemporaryRoot(root) || fs.realpathSync(root) !== path.resolve(root)) {
      report.unresolved.push({ root, reason: 'recorded outside the trusted temporary roots' });
      resolved = false;
      continue;
    }
    const owner = scratchOwner(root);
    if (owner !== null && scratchOwnerAlive(owner, liveness) !== false) { resolved = false; continue; }
    try { fs.rmSync(root, { recursive: true, force: true }); report.reclaimed.push(root); }
    catch (_) { report.unresolved.push({ root, reason: 'removal failed' }); resolved = false; }
  }
  return resolved;
}

function readJson(file: string): unknown {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_) { return null; }
}

/** A runner records its start identity so a reused PID cannot keep its roots alive. */
function nestedOwnerAlive(entryPath: string, pid: number, alive: (_pid: number) => boolean, liveness: OwnerLiveness): boolean | null {
  const owner = readJson(path.join(entryPath, OWNER_FILE)) as { pid?: unknown; startId?: unknown; bootId?: unknown } | null;
  if (owner && owner.pid === pid && (typeof owner.startId === 'string' || owner.startId === null)) {
    const boot = bootIdentity();
    if (boot !== null && typeof owner.bootId === 'string' && owner.bootId !== boot) { return false; }
    return liveness(pid, owner.startId);
  }
  return alive(pid);
}

function recoverManifestEntry(manifestDir: string, entry: string, alive: (_pid: number) => boolean, liveness: OwnerLiveness, report: TempRootRecoveryReport) {
  const nestedMatch = /^test-run-(\d+)$/.exec(entry);
  const entryPath = path.join(manifestDir, entry);
  if (nestedMatch) {
    recoverNestedManifest(entryPath, Number(nestedMatch[1]), alive, liveness, report);
    return;
  }
  const pid = Number(path.basename(entry, '.json'));
  const stat = fs.lstatSync(entryPath);
  if (!entry.endsWith('.json') || !Number.isInteger(pid) || pid <= 0 || alive(pid)
    || !stat.isFile() || stat.isSymbolicLink() || (process.getuid?.() !== undefined && (process.getuid?.() !== undefined && stat.uid !== process.getuid?.()))) { return; }
  // Unresolved roots keep their record, so they stay reported and reclaimable.
  if (removeRecordedRoots(manifestRoots(JSON.parse(fs.readFileSync(entryPath, 'utf8'))), report, liveness)) { fs.rmSync(entryPath, { force: true }); }
}

function recoverNestedManifest(entryPath: string, pid: number, alive: (_pid: number) => boolean, liveness: OwnerLiveness, report: TempRootRecoveryReport): void {
  // A live or uncertain owner keeps everything it recorded.
  if (!ownedDirectory(entryPath) || nestedOwnerAlive(entryPath, pid, alive, liveness) !== false) { return; }
  const runnerRoots = manifestRoots((readJson(path.join(entryPath, RUNNER_ROOTS_FILE)) ?? []) as Manifest);
  if (runnerRoots.some(root => { const owner = scratchOwner(root); return owner !== null && scratchOwnerAlive(owner, liveness) !== false; })) { return; }
  let resolved = true;
  for (const workerEntry of fs.readdirSync(entryPath)) {
    if (!workerEntry.endsWith('.json') || workerEntry === OWNER_FILE) { continue; }
    const recorded = readJson(path.join(entryPath, workerEntry));
    if (recorded !== null) { resolved = removeRecordedRoots(manifestRoots(recorded as Manifest), report, liveness) && resolved; }
  }
  if (resolved) { fs.rmSync(entryPath, { recursive: true, force: true }); }
}

/** Roots recorded by owners that are alive or whose liveness is uncertain. */
function protectedRoots(manifestDir: string, alive: (_pid: number) => boolean, liveness: OwnerLiveness): Set<string> {
  const roots = new Set<string>();
  for (const entry of fs.readdirSync(manifestDir)) {
    const nested = /^test-run-(\d+)$/.exec(entry);
    const entryPath = path.join(manifestDir, entry);
    try {
      if (nested) {
        if (nestedOwnerAlive(entryPath, Number(nested[1]), alive, liveness) === false) { continue; }
        for (const file of fs.readdirSync(entryPath)) { manifestRoots((readJson(path.join(entryPath, file)) ?? []) as Manifest).forEach(root => roots.add(path.resolve(root))); }
      } else if (entry.endsWith('.json')) {
        manifestRoots((readJson(entryPath) ?? []) as Manifest).forEach(root => roots.add(path.resolve(root)));
      }
    } catch (_) { /* raced */ }
  }
  return roots;
}

function validProcessOwner(value: { pid: number; startId: string | null }): boolean {
  return Number.isSafeInteger(value.pid) && value.pid > 0 && (typeof value.startId === 'string' || value.startId === null);
}

function validScratchOwner(owner: ScratchOwner, root: string): boolean {
  return owner.root === path.resolve(root) && validProcessOwner(owner)
    && (typeof owner.bootId === 'string' || owner.bootId === null)
    && (owner.launching === undefined || typeof owner.launching === 'boolean')
    && (owner.children === undefined || Array.isArray(owner.children) && owner.children.every(validProcessOwner));
}

/** Durable proof travels with the data, independently of volatile/older manifests. */
function scratchOwner(root: string): ScratchOwner | null {
  try {
    const file = path.join(root, SCRATCH_OWNER_FILE);
    const stat = fs.lstatSync(file);
    const uid = process.getuid?.();
    if (!stat.isFile() || stat.isSymbolicLink() || (uid !== undefined && stat.uid !== uid)) { return null; }
    const owner = readJson(file) as ScratchOwner | null;
    return owner && validScratchOwner(owner, root) ? owner : null;
  } catch { return null; }
}

function scratchOwnerAlive(owner: ScratchOwner, liveness: OwnerLiveness): boolean | null {
  const boot = bootIdentity();
  if (boot !== null && owner.bootId !== null && boot !== owner.bootId) { return false; }
  const observations = [liveness(owner.pid, owner.startId), ...(owner.children ?? []).map(child => liveness(child.pid, child.startId))];
  return observations.includes(true) ? true : observations.includes(null) || owner.launching ? null : false;
}

/** Legacy scratch roots under each base, by exact layout. */
function legacyScratchRoots(bases: readonly string[]): string[] {
  const listed = (dir: string, pattern: RegExp) => { try { return fs.readdirSync(dir).filter(name => pattern.test(name)); } catch (_) { return []; } };
  return [...new Set(bases.map(dir => path.resolve(dir)))].flatMap(base => listed(base, CHECKOUT_TMP)
    .flatMap(checkout => listed(path.join(base, checkout), COVERAGE_SCRATCH).map(name => path.join(base, checkout, name))));
}

/** `reclaim`, `keep` (live or too young) or a reason it cannot be resolved. */
function legacyScratchVerdict(root: string, liveness: OwnerLiveness, nowMs: number): 'reclaim' | 'keep' | string {
  if (!ownedDirectory(root) || fs.realpathSync(root) !== path.resolve(root)) { return 'coverage scratch is not a directory owned by this user'; }
  const owner = scratchOwner(root);
  if (owner !== null) {
    const alive = scratchOwnerAlive(owner, liveness);
    return alive === false ? 'reclaim' : alive === true ? 'keep' : 'owner absence cannot be confirmed';
  }
  if (nowMs - fs.lstatSync(root).mtimeMs < LEGACY_SCRATCH_MIN_AGE_MS) { return 'keep'; }
  return 'no trusted ownership record; owner absence cannot be confirmed';
}

function recoverLegacyCoverageScratch(bases: readonly string[], protectedSet: Set<string>, liveness: OwnerLiveness, nowMs: number, report: TempRootRecoveryReport): void {
  for (const root of legacyScratchRoots(bases).filter(candidate => !protectedSet.has(candidate))) {
    try {
      const verdict = legacyScratchVerdict(root, liveness, nowMs);
      if (verdict === 'reclaim') { fs.rmSync(root, { recursive: true, force: true }); report.reclaimed.push(root); }
      else if (verdict !== 'keep') { report.unresolved.push({ root, reason: verdict }); }
    } catch (_) { /* raced */ }
  }
}

/** Find covered worker manifests on the same disk as their scratch roots. */
function recoverDiskManifests(bases: readonly string[], manifestDir: string, alive: (_pid: number) => boolean, ownerLiveness: OwnerLiveness, report: TempRootRecoveryReport): void {
  const manifests = new Set(legacyScratchRoots(bases).map(root => path.join(path.dirname(root), 'manifests')));
  for (const diskManifests of manifests) {
    if (diskManifests === manifestDir || !fs.existsSync(diskManifests)) { continue; }
    const recovered = recoverRecordedTempRoots({ manifestDir: diskManifests, isProcessAlive: alive, ownerLiveness });
    report.reclaimed.push(...recovered.reclaimed);
    report.unresolved.push(...recovered.unresolved);
  }
}

function recoverRecordedTempRoots({
  manifestDir = defaultManifestDir(),
  isProcessAlive: alive = isProcessAlive,
  /** Compares a recorded start identity; callers inject the process adapter's probe. */
  ownerLiveness = pidOnlyLiveness,
  legacyCoverageBases = [],
  nowMs = Date.now(),
}: {
  manifestDir?: string;
  isProcessAlive?: (_pid: number) => boolean;
  ownerLiveness?: OwnerLiveness;
  /** Temporary bases whose unregistered `px-tmp-<id>/coverage-scratch-*` roots are examined. */
  legacyCoverageBases?: readonly string[];
  nowMs?: number;
} = {}): TempRootRecoveryReport {
  const report: TempRootRecoveryReport = { reclaimed: [], unresolved: [] };
  try {
    const entries = fs.existsSync(manifestDir) && ownedDirectory(manifestDir) ? fs.readdirSync(manifestDir) : [];
    for (const entry of entries) {
      try {
        recoverManifestEntry(manifestDir, entry, alive, ownerLiveness, report);
      } catch (_) {
        // One raced, malformed, or inaccessible record grants no authority and cannot abort recovery.
      }
    }
    if (legacyCoverageBases.length > 0) {
      recoverDiskManifests(legacyCoverageBases, manifestDir, alive, ownerLiveness, report);
      recoverLegacyCoverageScratch(legacyCoverageBases, entries.length ? protectedRoots(manifestDir, alive, ownerLiveness) : new Set(), ownerLiveness, nowMs, report);
    }
  } catch (_) {
    // Recovery is best effort and must never prevent verification from starting.
  }
  return report;
}

/**
 * Record this runner as the owner of a `test-run-<pid>` manifest directory,
 * with its start identity, and return a writer for the scratch roots it
 * creates itself. Each root is on disk before the runner depends on it, so a
 * SIGKILL leaves it for the next recovery rather than relying on exit handlers.
 */
function registerRunnerOwner(manifestDir: string, owner: { readonly pid: number; readonly startId: string | null; readonly bootId?: string | null }) {
  fs.writeFileSync(path.join(manifestDir, OWNER_FILE), JSON.stringify({ pid: owner.pid, startId: owner.startId, bootId: owner.bootId ?? bootIdentity() }), { mode: 0o600 });
  const roots: string[] = [];
  const children: { pid: number; startId: string | null }[] = [];
  let launching = false;
  const writeOwner = (root: string) => {
    const file = path.join(root, SCRATCH_OWNER_FILE);
    const temporary = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify({ ...owner, bootId: owner.bootId ?? bootIdentity(), root: path.resolve(root), children, launching }), { mode: 0o600 });
    fs.renameSync(temporary, file);
  };
  return {
    prepareChild(): void { launching = true; roots.forEach(writeOwner); },
    recordChild(child: { pid: number; startId: string | null }): void { children.push(child); launching = false; roots.forEach(writeOwner); },
    register(root: string): string {
      writeOwner(root);
      roots.push(root);
      fs.writeFileSync(path.join(manifestDir, RUNNER_ROOTS_FILE), JSON.stringify(roots), { mode: 0o600 });
      return root;
    },
  };
}

function createTempRootRegistry({ manifestDir = defaultManifestDir(), pid = process.pid } = {}) {
  ensureManifestDir(manifestDir);
  recoverRecordedTempRoots({ manifestDir });
  const manifestPath = path.join(manifestDir, `${pid}.json`);
  const roots: string[] = [];
  const flush = () => fs.writeFileSync(manifestPath, JSON.stringify(roots), { mode: 0o600 });
  const register = (root: string) => {
    if (!roots.includes(root)) { roots.push(root); }
    flush();
    return root;
  };
  const release = (root: string) => {
    const index = roots.indexOf(root);
    if (index >= 0) { roots.splice(index, 1); }
    flush();
  };
  const cleanup = () => {
    for (const root of roots.splice(0).reverse()) {
      if (isTemporaryRoot(root)) { try { fs.rmSync(root, { recursive: true, force: true }); } catch (_) { } }
    }
    try { fs.rmSync(manifestPath, { force: true }); } catch (_) { }
  };
  flush();
  return { cleanup, manifestDir, manifestPath, register, release };
}

export { createTempRootRegistry, defaultManifestDir, ensureManifestDir, recoverRecordedTempRoots, registerRunnerOwner };
