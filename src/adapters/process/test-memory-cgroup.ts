/**
 * Linux cgroup v2 mechanism for the test-runner memory boundary (TASK-2722).
 *
 * The suite is launched through `systemd-run --user --scope`, which moves the
 * process into a new transient scope with `MemoryMax` (and no swap) before it
 * executes, so every worker, native allocation and descendant it ever creates
 * is charged to the scope. The runner stays in its own cgroup and keeps
 * running when the scope is killed. `OOMPolicy=kill` makes the kernel's single
 * victim kill take the whole scope with it.
 */
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';

const MIB = 1048576;
const CGROUP_ROOT = '/sys/fs/cgroup';

export class MemoryBoundaryUnavailableError extends Error {
  constructor(reason: string) {
    super(`[test-memory-boundary] cannot enforce the aggregate memory boundary: ${reason}\n`
      + '[test-memory-boundary] needs: Linux cgroup v2 with the memory controller delegated to the user systemd manager '
      + '(check `systemd-run --user --scope -p MemoryMax=512M -p MemorySwapMax=0 -- true` and `systemctl --user show -p DelegateControllers`; '
      + 'on a headless host run `loginctl enable-linger $USER`).\n'
      + '[test-memory-boundary] To run this invocation anyway without a memory boundary, set PARALLIX_TEST_MEMORY_BOUNDARY=off. '
      + 'That is an unsupported bypass: nothing contains a memory-growing test.');
    this.name = 'MemoryBoundaryUnavailableError';
  }
}

type SpawnSyncLike = (_command: string, _args: string[], _options: { encoding: 'utf8'; timeout: number }) =>
  { status: number | null; stdout: string; stderr: string; error?: Error };

/**
 * Non-login launchers (agent harnesses, cron) often drop XDG_RUNTIME_DIR, which
 * leaves `systemd-run --user` unable to find the user manager's bus. Returns the
 * standard per-user runtime directory when its bus exists, else undefined.
 */
export function defaultUserRuntimeDir(uid: number | undefined = process.getuid?.(), exists: (_path: string) => boolean = fs.existsSync): string | undefined {
  if (uid === undefined) { return undefined; }
  const dir = `/run/user/${uid}`;
  return exists(`${dir}/bus`) ? dir : undefined;
}

export interface ScopeLaunch { command: string; args: string[]; unit: string }

export function scopeUnitName(): string {
  return `parallix-test-${process.pid}-${randomBytes(3).toString('hex')}.scope`;
}

export function scopeProperties(limitMiB: number): string[] {
  return ['-p', `MemoryMax=${limitMiB}M`, '-p', 'MemorySwapMax=0', '-p', 'OOMPolicy=kill'];
}

/** Wrap `command` so it starts inside a memory-limited scope. */
export function wrapInScope(limitMiB: number, command: string, args: readonly string[], unit = scopeUnitName(), retainFailure = false): ScopeLaunch {
  // A retained failed scope keeps systemd's terminal Result (`oom-kill`) readable
  // after the cgroup is gone; the owner must call forgetScope.
  return {
    unit,
    command: 'systemd-run',
    args: ['--user', '--scope', '--quiet', ...(retainFailure ? [] : ['--collect']), '--unit', unit, ...scopeProperties(limitMiB), '--', command, ...args],
  };
}

/** systemd's terminal Result of a retained scope, e.g. `oom-kill`; null when unreadable. */
export function scopeResult(unit: string, spawnImpl: SpawnSyncLike = spawnSync): string | null {
  const result = spawnImpl('systemctl', ['--user', 'show', '-p', 'Result', '--value', unit], { encoding: 'utf8', timeout: 5_000 });
  return result.error || result.status !== 0 ? null : result.stdout.trim() || null;
}

/** Drop a retained failed scope so no unit outlives its runner. */
export function forgetScope(unit: string, spawnImpl: SpawnSyncLike = spawnSync): void {
  spawnImpl('systemctl', ['--user', 'reset-failed', unit], { encoding: 'utf8', timeout: 5_000 });
}

const PROBE_SCRIPT = 'p="/sys/fs/cgroup$(sed -n "s/^0:://p" /proc/self/cgroup)"; cat "$p/memory.max" "$p/memory.swap.max"';

/**
 * Prove, before any test allocates, that a scope with the requested limit can
 * be created and that the kernel reports the limit and the swap cap back. A
 * missing user manager, an undelegated controller or a read-only cgroup tree
 * all fail here instead of silently running unbounded.
 */
export function assertCgroupEnforcement(limitMiB: number, spawnImpl: SpawnSyncLike = spawnSync): void {
  if (process.platform !== 'linux') { throw new MemoryBoundaryUnavailableError(`platform ${process.platform} is not Linux`); }
  const probe = wrapInScope(limitMiB, 'sh', ['-c', PROBE_SCRIPT]);
  const result = spawnImpl(probe.command, probe.args, { encoding: 'utf8', timeout: 15_000 });
  if (result.error) { throw new MemoryBoundaryUnavailableError(`systemd-run is unavailable (${result.error.message})`); }
  if (result.status !== 0) {
    throw new MemoryBoundaryUnavailableError(`systemd-run could not create a memory-limited scope (exit ${result.status}: ${result.stderr.trim() || 'no output'})`);
  }
  const [memoryMax, swapMax] = result.stdout.trim().split('\n');
  if (memoryMax !== String(limitMiB * MIB)) {
    throw new MemoryBoundaryUnavailableError(`the scope reported memory.max=${memoryMax} instead of ${limitMiB * MIB}; the memory controller is not enforcing`);
  }
  if (swapMax !== '0') {
    throw new MemoryBoundaryUnavailableError(`the scope reported memory.swap.max=${swapMax}; swap is not capped, so a breach would thrash the host instead of being killed`);
  }
}

export interface MemorySample { peakBytes: number | null; oomKills: number | null }

export function readScopeSample(cgroupDir: string, read: (_file: string) => string = (file) => fs.readFileSync(file, 'utf8')): MemorySample {
  const number = (name: string): number | null => {
    try { return Number(read(`${cgroupDir}/${name}`).trim()); } catch { return null; }
  };
  let oomKills: number | null = null;
  try {
    const events = read(`${cgroupDir}/memory.events`);
    oomKills = Number(/^oom_kill (\d+)$/m.exec(events)?.[1] ?? 0) + Number(/^oom_group_kill (\d+)$/m.exec(events)?.[1] ?? 0);
  } catch { /* scope already gone */ }
  return { peakBytes: number('memory.peak'), oomKills };
}

/** The scope's cgroup directory, read from the launched process once it moved in. */
export function scopeCgroupDir(pid: number, unit: string, read: (_file: string) => string = (file) => fs.readFileSync(file, 'utf8')): string | null {
  try {
    const line = read(`/proc/${pid}/cgroup`).split('\n').find(entry => entry.startsWith('0::'));
    const cgroupPath = line?.slice(3);
    return cgroupPath?.endsWith(`/${unit}`) ? `${CGROUP_ROOT}${cgroupPath}` : null;
  } catch { return null; }
}

export interface ScopeWatch { stop(): MemorySample & { breached: boolean } }

/**
 * Sample the scope while it lives. The scope disappears once its last process
 * exits, so the latest successful sample is the evidence; a sampled OOM kill
 * calls `onBreach` immediately so the runner can reclaim the tree.
 */
export function watchScope(pid: number, unit: string, onBreach: () => void, intervalMs = 25, probes: { dirOf?: typeof scopeCgroupDir; sample?: typeof readScopeSample } = {}): ScopeWatch {
  const dirOf = probes.dirOf ?? scopeCgroupDir;
  const sampleOf = probes.sample ?? readScopeSample;
  let dir: string | null = null;
  let latest: MemorySample = { peakBytes: null, oomKills: null };
  let breached = false;
  const tick = () => {
    dir ??= dirOf(pid, unit);
    if (dir === null) { return; }
    const sample = sampleOf(dir);
    if (sample.peakBytes !== null || sample.oomKills !== null) {
      latest = { peakBytes: sample.peakBytes ?? latest.peakBytes, oomKills: sample.oomKills ?? latest.oomKills };
    }
    if (!breached && (sample.oomKills ?? 0) > 0) { breached = true; onBreach(); }
  };
  const timer = setInterval(tick, intervalMs);
  timer.unref();
  return { stop: () => { clearInterval(timer); tick(); return { ...latest, breached }; } };
}
