/**
 * Aggregate memory policy for the regular test runner (TASK-2722).
 *
 * A per-process V8 heap cap (`--max-old-space-size`) bounds only one isolate's
 * JavaScript heap. It does not bound Buffers and other native allocations,
 * compiler memory, nor the workers and descendants a suite spawns, so memory
 * exhaustion needs a boundary around the whole test process tree. This module
 * is the pure half: it validates configuration and formats reports. The
 * platform half lives in test-memory-cgroup.ts.
 */
import os from 'node:os';

export type MemoryWorkload = 'focused' | 'unit' | 'unit-covered' | 'integration' | 'integration-covered' | 'integration-local';

export const MEMORY_BOUNDARY_ENV = 'PARALLIX_TEST_MEMORY_BOUNDARY';
export const MEMORY_LIMIT_ENV = 'PARALLIX_TEST_MEMORY_LIMIT_MIB';
/**
 * Set by a contained runner for everything it launches, naming its scope unit.
 * A nested runner that verifies it really runs in that scope stays in it, so
 * the outer limit keeps accounting for, and killing, the whole nested tree.
 */
export const MEMORY_SCOPE_ENV = 'PARALLIX_TEST_MEMORY_SCOPE';

/** A limit below this cannot host Node plus the bootstrap preload. */
export const MIN_LIMIT_MIB = 256;

/**
 * Default aggregate limit per workload, in MiB. Each is the peak of the whole
 * process tree measured on a 16-core workstation (cgroup memory.peak, current
 * tree, 2026-10) with 3-4x headroom for more concurrent workers, compiler and
 * native allocations and descendants: unit 549, unit covered 1137, integration
 * 804, integration covered 1655, integration local 2862, heaviest focused
 * suite 506. A focused selection may be a covered or local-only suite, so it
 * carries the headroom of the largest of those.
 */
export const DEFAULT_LIMIT_MIB: Readonly<Record<MemoryWorkload, number>> = {
  focused: 4096,
  unit: 2048,
  'unit-covered': 4096,
  integration: 3072,
  'integration-covered': 6144,
  'integration-local': 8192,
};

export type MemoryBoundaryPolicy =
  | { mode: 'cgroup'; limitMiB: number; limitSource: 'default' | 'environment'; workload: MemoryWorkload }
  | { mode: 'off'; reason: string };

export class MemoryBoundaryConfigError extends Error {
  constructor(message: string) {
    super(`[test-memory-boundary] ${message}`);
    this.name = 'MemoryBoundaryConfigError';
  }
}

export interface PolicyInput {
  /** Raw PARALLIX_TEST_MEMORY_BOUNDARY value, read by the runner. */
  boundaryMode: string | undefined;
  /** Raw PARALLIX_TEST_MEMORY_LIMIT_MIB value, read by the runner. */
  limitMiB: string | undefined;
  workload: MemoryWorkload;
  /** Hosted GitHub runners are disposable VMs without a delegated user manager. */
  hostedRunner: boolean;
  platform?: NodeJS.Platform;
  totalMemoryMiB?: number;
}

export function classifyWorkload(input: { requestedArgs: readonly string[]; integration: boolean; local: boolean; coverage: boolean }): MemoryWorkload {
  const selectors = input.requestedArgs.filter(arg => !arg.startsWith('-'));
  if (selectors.length > 0) { return 'focused'; }
  if (input.local) { return 'integration-local'; }
  if (input.integration) { return input.coverage ? 'integration-covered' : 'integration'; }
  return input.coverage ? 'unit-covered' : 'unit';
}

function parseLimit(raw: string, totalMemoryMiB: number): number {
  if (!/^\d+$/.test(raw.trim())) {
    throw new MemoryBoundaryConfigError(`${MEMORY_LIMIT_ENV}=${JSON.stringify(raw)} is not a positive integer number of MiB`);
  }
  const value = Number(raw.trim());
  if (!Number.isSafeInteger(value) || value < MIN_LIMIT_MIB) {
    throw new MemoryBoundaryConfigError(`${MEMORY_LIMIT_ENV}=${raw} is below the ${MIN_LIMIT_MIB} MiB minimum a Node test tree needs`);
  }
  if (value > totalMemoryMiB) {
    throw new MemoryBoundaryConfigError(`${MEMORY_LIMIT_ENV}=${raw} exceeds this host's ${totalMemoryMiB} MiB of memory, so it would not bound anything`);
  }
  return value;
}

export function resolveMemoryBoundaryPolicy(input: PolicyInput): MemoryBoundaryPolicy {
  const mode = input.boundaryMode?.trim();
  if (mode !== undefined && mode !== '' && mode !== 'cgroup' && mode !== 'off') {
    throw new MemoryBoundaryConfigError(`${MEMORY_BOUNDARY_ENV}=${JSON.stringify(mode)} is not supported; use "cgroup" (default) or "off"`);
  }
  if (mode === 'off') {
    return { mode: 'off', reason: `${MEMORY_BOUNDARY_ENV}=off` };
  }
  if (mode !== 'cgroup' && input.hostedRunner) {
    return { mode: 'off', reason: 'GitHub-hosted runner (disposable VM; no delegated cgroup user manager)' };
  }
  const platform = input.platform ?? process.platform;
  if (platform !== 'linux') {
    throw new MemoryBoundaryConfigError(
      `aggregate memory containment needs Linux cgroup v2, found ${platform}. Set ${MEMORY_BOUNDARY_ENV}=off to run this invocation without a memory boundary.`);
  }
  const rawLimit = input.limitMiB;
  const totalMemoryMiB = input.totalMemoryMiB ?? Math.floor(os.totalmem() / 1048576);
  if (rawLimit !== undefined && rawLimit !== '') {
    return { mode: 'cgroup', limitMiB: parseLimit(rawLimit, totalMemoryMiB), limitSource: 'environment', workload: input.workload };
  }
  // A default larger than the host cannot be enforced; clamp to what exists.
  return { mode: 'cgroup', limitMiB: Math.min(DEFAULT_LIMIT_MIB[input.workload], totalMemoryMiB), limitSource: 'default', workload: input.workload };
}

export interface BreachEvidence {
  command: string;
  suite: string;
  limitMiB: number;
  peakBytes: number | null;
  oomKills: number | null;
  /** systemd's terminal scope Result, durable after the cgroup is gone. */
  scopeResult?: string | null;
  elapsedMs: number;
}

const MIB = 1048576;

export function formatBreachReport(evidence: BreachEvidence): string {
  const peak = evidence.peakBytes === null ? 'unavailable (cgroup memory.peak could not be read)' : `${(evidence.peakBytes / MIB).toFixed(1)} MiB`;
  const kills = evidence.oomKills === null ? 'unavailable' : String(evidence.oomKills);
  return [
    `[test-memory-boundary] MEMORY LIMIT EXCEEDED: command=${evidence.command} suite=${evidence.suite} limit=${evidence.limitMiB} MiB peak=${peak} oom_kill=${kills}${evidence.scopeResult ? ` scope_result=${evidence.scopeResult}` : ''} elapsed=${Math.round(evidence.elapsedMs)}ms`,
    '[test-memory-boundary] cause: aggregate test-process-tree memory limit (workers, native allocations and descendants combined); every owned test process was killed. This is not an assertion failure or a timeout.',
    `[test-memory-boundary] repair: find the suite or fixture that allocates without bound (rerun it alone with \`npm test -- <suite>\`) and bound its allocation. Raise ${MEMORY_LIMIT_ENV} only for a measured, legitimate need; see docs/test-memory-containment.md.`,
  ].join('\n');
}
