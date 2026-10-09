import fs from 'node:fs';
import { canonicalizeSymlink } from './canonicalize-symlink.js';
import path from 'node:path';

/**
 * A host configuration directory seen from inside the sandbox through a
 * Parallix-owned cell.
 *
 * The cell is mounted writable over `target`, every host entry of `target` is
 * mounted back read-only, and only the profile's explicit binds are writable on
 * top. A launcher that creates new entries next to its state — the Claude CLI's
 * OAuth refresh lock and the temp file of its atomic credential save — writes
 * them into the cell, never into the host directory. Its rename onto a
 * bind-mounted file fails with `EBUSY`, and the CLI falls back to an in-place
 * write of that file, which is the host file.
 *
 * The launcher's own configuration names (`guarded`) are read-only whether or
 * not the host has them: an absent one is covered by an empty read-only
 * placeholder, so the cell can never supply settings, hooks, skills or
 * instructions the operator did not write.
 */
export interface ConfigCell {
  target: string;
  cell: string;
  /** Nested directories kept read-only on top of the writable binds; created empty when absent. */
  readOnly?: string[];
  /** Top-level names the launcher reads as configuration; read-only even when absent on the host. */
  guarded?: { files: string[]; directories: string[] };
  /** Cell entries that are live state rather than stale mount stubs. */
  keep?: RegExp[];
}

type EntryKind = 'file' | 'directory';

function kindOf(stat: fs.Stats): EntryKind | null {
  if (stat.isDirectory()) { return 'directory'; }
  return stat.isFile() ? 'file' : null;
}

/** Host entries bwrap can mount; dangling links and special files are skipped. */
function hostEntries(target: string): Map<string, EntryKind> {
  const entries = new Map<string, EntryKind>();
  for (const name of fs.readdirSync(target)) {
    try {
      const kind = kindOf(fs.statSync(path.join(target, name)));
      if (kind) { entries.set(name, kind); }
    } catch { /* dangling symlink: nothing to mount */ }
  }
  return entries;
}

/**
 * Drop cell entries that are not the stub of a current mount of the same kind, so
 * nothing a sandbox created in the cell outlives the next launch and a stub
 * never has the wrong type for its mount. Live shared state named by `keep`
 * (a lock another sandbox holds, a save in flight) stays.
 */
function pruneCell(cell: string, expected: Map<string, EntryKind>, keep: RegExp[]): void {
  for (const name of fs.readdirSync(cell)) {
    if (keep.some(pattern => pattern.test(name))) { continue; }
    const entry = path.join(cell, name);
    let kind: EntryKind | null;
    try { kind = kindOf(fs.lstatSync(entry)); } catch { continue; }
    if (kind && expected.get(name) === kind) { continue; }
    fs.rmSync(entry, { recursive: true, force: true });
  }
}

/**
 * Build the bwrap mounts for one config cell, whose directory must exist.
 * `writable` are the profile's writable binds beneath `target`, applied after
 * the read-only host entries.
 * Bubblewrap resolves every source on the host, so a source beneath `target`
 * is the host entry even after the cell covers `target`.
 */
export function configCellArgs(configCell: ConfigCell, writable: string[]): string[] {
  const canonicalize = (dir: string) => canonicalizeSymlink(path.resolve(dir));
  const target = canonicalize(configCell.target);
  const cell = canonicalize(configCell.cell);
  const host = hostEntries(target);
  const guarded = configCell.guarded || { files: [], directories: [] };
  const placeholders = new Map<string, EntryKind>([
    ...guarded.files.map(name => [name, 'file'] as const),
    ...guarded.directories.map(name => [name, 'directory'] as const),
  ].filter(([name]) => !host.has(name)));
  pruneCell(cell, new Map([...host, ...placeholders]), configCell.keep || []);
  const args = ['--bind', cell, target];
  for (const name of [...host.keys()].sort((left, right) => left.localeCompare(right))) {
    const entry = canonicalize(path.join(target, name));
    args.push('--ro-bind', entry, entry);
  }
  for (const [name, kind] of [...placeholders].sort(([left], [right]) => left.localeCompare(right))) {
    const entry = path.join(target, name);
    args.push(...(kind === 'file' ? ['--ro-bind', '/dev/null', entry] : ['--tmpfs', entry, '--remount-ro', entry]));
  }
  for (const dir of writable) { args.push('--bind', dir, dir); }
  for (const dir of [...(configCell.readOnly || [])].map(canonicalize)) {
    fs.mkdirSync(dir, { recursive: true });
    args.push('--ro-bind', dir, dir);
  }
  return args;
}
