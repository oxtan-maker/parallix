// Deterministic-artifact gate for the canonical bundle (TASK-2288, SC6).
//
// Replaces scripts/verify-reproducible-dist.js, which checked the retired
// CommonJS dist/ tree and compared file *names* only. The published payload is
// now build/, so this rebuilds build/ twice from a clean state and compares both
// the file list and every file's SHA-256 — a name-only comparison would pass a
// build that silently embedded a timestamp or an absolute path.

import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';

interface BuildArtifact {
  files: string[];
  digests: Record<string, string>;
}

function listFiles(rootDir: string, relative = ''): string[] {
  const directory = path.join(rootDir, relative);
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const child = relative ? path.posix.join(relative, entry.name) : entry.name;
    return entry.isDirectory() ? listFiles(rootDir, child) : [child];
  }).sort();
}

function compareFileLists(first: string[], second: string[]): boolean {
  return JSON.stringify(first) === JSON.stringify(second);
}

/** Files present in one build but not the other, plus files whose bytes differ. */
function artifactDifferences(first: BuildArtifact, second: BuildArtifact): string[] {
  const differences: string[] = [];
  for (const file of first.files) {
    if (!second.files.includes(file)) { differences.push(`only in first build: ${file}`); }
  }
  for (const file of second.files) {
    if (!first.files.includes(file)) { differences.push(`only in second build: ${file}`); }
  }
  for (const file of first.files) {
    if (!second.files.includes(file)) { continue; }
    if (first.digests[file] !== second.digests[file]) {
      differences.push(`content differs: ${file} (${first.digests[file]} != ${second.digests[file]})`);
    }
  }
  return differences;
}

function buildClean(rootDir: string): BuildArtifact {
  const buildDir = path.join(rootDir, 'build');
  fs.rmSync(buildDir, { recursive: true, force: true });
  const result = spawnSync('npm', ['run', 'build'], { cwd: rootDir, encoding: 'utf8', stdio: 'inherit' });
  if (result.status !== 0) { throw new Error(`npm run build failed (exit ${result.status})`); }
  const files = listFiles(buildDir);
  const digests: Record<string, string> = {};
  for (const file of files) {
    digests[file] = crypto.createHash('sha256')
      .update(fs.readFileSync(path.join(buildDir, file)))
      .digest('hex');
  }
  return { files, digests };
}

function main(rootDir: string = process.cwd()): number {
  const first = buildClean(rootDir);
  const second = buildClean(rootDir);
  const differences = artifactDifferences(first, second);
  if (differences.length > 0) {
    process.stderr.write(
      `Reproducible build check failed:\n${differences.map(item => `- ${item}`).join('\n')}\n`,
    );
    return 1;
  }
  process.stdout.write(
    `Reproducible build check passed (${first.files.length} files, byte-identical across two clean builds).\n`,
  );
  return 0;
}

export { artifactDifferences, buildClean, compareFileLists, listFiles, main };
export type { BuildArtifact };

if (process.argv[1] && path.basename(process.argv[1]).startsWith('verify-reproducible-build')) {
  process.exitCode = main();
}
