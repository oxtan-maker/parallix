// Runs the Vite web build and then regenerates build/web/manifest.json from the
// freshly emitted assets. Kept as one script so the manifest always matches the
// assets in the same outDir, whether the outDir is the default build/web
// (standalone `npm run build:web`) or the private staging tree the canonical
// bundle build passes via --outDir. Without the manifest step, a bare build:web
// (vite emptyOutDir) leaves build/web/manifest.json absent while
// build/manifest.sha256 still lists it, failing the task-2285 contract.
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeWebManifest } from './web-manifest.mjs';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(scriptDir, '..');

let outDir = path.join(root, 'build', 'web');
for (let i = 2; i < process.argv.length; i++) {
  if (process.argv[i] === '--outDir') {
    outDir = path.resolve(root, process.argv[i + 1]);
    i++;
  }
}

const vite = path.join(root, 'node_modules', '.bin', 'vite');
// Pass an ABSOLUTE outDir: Vite 7 empties a relative outDir that lives outside
// the project root after the build completes, which would delete the staging
// tree the canonical bundle build just populated.
const build = spawnSync(
  vite,
  ['build', '--config', 'web/vite.config.ts', '--outDir', outDir],
  { cwd: root, stdio: 'inherit' },
);

if (build.status !== 0) {
  process.exit(build.status ?? 1);
}

writeWebManifest(outDir);
