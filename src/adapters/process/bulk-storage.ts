import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * Bulk-storage placement (TASK-2816).
 *
 * Terminal transcripts and raw coverage payloads can reach gigabytes. On many
 * Linux hosts `/tmp` and `$XDG_RUNTIME_DIR` are tmpfs: memory-backed and small,
 * so bulk data there competes with RAM and can fill the runtime filesystem.
 * Bulk writers choose the first disk-backed candidate; sockets and launch
 * transports keep their short private runtime paths.
 */

// Linux statfs(2) f_type values of memory-backed filesystems.
const MEMORY_BACKED_TYPES = new Set([0x01021994 /* tmpfs */, 0x858458f6 /* ramfs */]);

/** Test seam: the filesystem probes bulk placement uses. */
export const bulkStorageProbe = {
  statfs: (dir: string): { type: number } => fs.statfsSync(dir),
  writable: (dir: string): boolean => { try { fs.accessSync(dir, fs.constants.W_OK); return true; } catch { return false; } },
};

/** The disk-backed system temporary directory used when `TMPDIR` is memory-backed. */
export const DISK_TEMP_FALLBACK = '/var/tmp';

function nearestExisting(dir: string): string {
  let current = path.resolve(dir);
  while (!fs.existsSync(current)) {
    const parent = path.dirname(current);
    if (parent === current) { break; }
    current = parent;
  }
  return current;
}

/**
 * Whether `dir` (or its nearest existing ancestor) is memory-backed. A path
 * inside the user runtime directory counts as memory-backed: that directory
 * is a small per-user tmpfs by specification. `null` means the type is unknown.
 */
export function isMemoryBacked(dir: string, runtimeDir?: string): boolean | null {
  const resolved = path.resolve(dir);
  if (runtimeDir && path.isAbsolute(runtimeDir)) {
    const runtime = path.resolve(runtimeDir);
    if (resolved === runtime || resolved.startsWith(`${runtime}${path.sep}`)) { return true; }
  }
  if (process.platform !== 'linux') { return false; }
  try { return MEMORY_BACKED_TYPES.has(bulkStorageProbe.statfs(nearestExisting(resolved)).type); }
  catch { return null; }
}

export class BulkStorageUnavailableError extends Error {
  constructor(purpose: string, candidates: readonly string[], remedy: string) {
    super(`${purpose} need disk-backed storage, but every candidate is memory-backed, unreadable or not writable: ${candidates.join(', ')}. ${remedy}`);
    this.name = 'BulkStorageUnavailableError';
  }
}

/**
 * The first writable candidate directory whose filesystem is known to be
 * disk-backed. Throws an actionable error when none is: bulk data never
 * silently lands in tmpfs or the runtime directory.
 */
export function selectDiskBackedDirectory(input: { readonly purpose: string; readonly candidates: readonly string[]; readonly remedy: string; readonly runtimeDir?: string }): string {
  const candidates = [...new Set(input.candidates.map(candidate => path.resolve(candidate)))];
  const chosen = candidates.find(candidate => isMemoryBacked(candidate, input.runtimeDir) === false && bulkStorageProbe.writable(nearestExisting(candidate)));
  if (!chosen) { throw new BulkStorageUnavailableError(input.purpose, candidates, input.remedy); }
  return chosen;
}

/** A disk-backed temporary base: `TMPDIR`, `/var/tmp`, then explicit owned fallbacks. */
export function diskBackedTempBase(runtimeDir: string | undefined, ownedFallbacks: readonly string[] = []): string {
  return selectDiskBackedDirectory({
    purpose: 'Raw coverage payloads',
    candidates: [os.tmpdir(), ...(process.platform === 'win32' ? [] : [DISK_TEMP_FALLBACK]), ...ownedFallbacks],
    remedy: 'Set TMPDIR to a directory on a disk-backed filesystem.',
    runtimeDir,
  });
}
