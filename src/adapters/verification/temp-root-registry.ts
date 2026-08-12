import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

type Manifest = { pid: number; roots: string[] } | string[];

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
  } catch (_) {
    return false;
  }
}

function isTemporaryRoot(root: string) {
  const tempRoot = path.resolve(os.tmpdir());
  const resolved = path.resolve(root);
  return resolved.startsWith(`${tempRoot}${path.sep}`);
}

function removeRecordedRoots(roots: string[]) {
  for (const root of roots) {
    if (typeof root === 'string' && isTemporaryRoot(root)) {
      try { fs.rmSync(root, { recursive: true, force: true }); } catch (_) {}
    }
  }
}

function recoverRecordedTempRoots({
  manifestDir = defaultManifestDir(),
  isProcessAlive: alive = isProcessAlive,
}: {
  manifestDir?: string;
  isProcessAlive?: (_pid: number) => boolean;
} = {}) {
  try {
    if (!fs.existsSync(manifestDir) || !ownedDirectory(manifestDir)) { return; }
    for (const entry of fs.readdirSync(manifestDir)) {
      try {
        const nestedMatch = /^test-run-(\d+)$/.exec(entry);
        const entryPath = path.join(manifestDir, entry);
        if (nestedMatch) {
          if (alive(Number(nestedMatch[1])) || !ownedDirectory(entryPath)) { continue; }
          for (const workerEntry of fs.readdirSync(entryPath)) {
            if (!workerEntry.endsWith('.json')) { continue; }
            try { removeRecordedRoots(manifestRoots(JSON.parse(fs.readFileSync(path.join(entryPath, workerEntry), 'utf8')))); } catch (_) {}
          }
          fs.rmSync(entryPath, { recursive: true, force: true });
          continue;
        }
        const pid = Number(path.basename(entry, '.json'));
        const stat = fs.lstatSync(entryPath);
        if (!entry.endsWith('.json') || !Number.isInteger(pid) || pid <= 0 || alive(pid)
          || !stat.isFile() || stat.isSymbolicLink() || (process.getuid?.() !== undefined && stat.uid !== process.getuid?.())) { continue; }
        removeRecordedRoots(manifestRoots(JSON.parse(fs.readFileSync(entryPath, 'utf8'))));
        fs.rmSync(entryPath, { force: true });
      } catch (_) {
        // One raced, malformed, or inaccessible record grants no authority and cannot abort recovery.
      }
    }
  } catch (_) {
    // Recovery is best effort and must never prevent verification from starting.
  }
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
    removeRecordedRoots(roots.splice(0).reverse());
    try { fs.rmSync(manifestPath, { force: true }); } catch (_) {}
  };
  flush();
  return { cleanup, manifestDir, manifestPath, register, release };
}

export { createTempRootRegistry, defaultManifestDir, ensureManifestDir, recoverRecordedTempRoots };
