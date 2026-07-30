// Package-content audit for the canonical ESM bundle (ADR 0044 §8, TASK-2285).
//
// The published tarball is the bundle payload plus release metadata: build/,
// package.json, LICENSE, README.md, CHANGELOG.md, NOTICES. It carries no
// unbundled source tree, no CommonJS dist/ output, no tests, and no operator
// state. TASK-2288 retired the transitional CommonJS dist/ tree entirely; the
// `dist/` prefix stays in the forbidden list so a reintroduced tree can never
// slip into a published tarball (see docs/npm-package-major-migration.md).

import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';

const REQUIRED_PATHS = [
  'build/px.mjs',
  'build/px.mjs.map',
  'build/asset-manifest.json',
  'build/manifest.sha256',
  'build/package.json',
  'build/sbom.json',
  'package.json',
  'README.md',
  'LICENSE',
  'CHANGELOG.md',
  'NOTICES',
];
// Runtime assets are staged under the bundle's own package root so they resolve
// from build/ in the checkout, in an npm install, and from the SEA payload.
const REQUIRED_PREFIXES = [
  'build/config/', 'build/migrations/', 'build/prompts/', 'build/templates/',
];
const FORBIDDEN_PATHS = new Set([
  'tsconfig.json', 'tsconfig.test.json', 'eslint.config.mjs', 'stryker.conf.json',
  'workflow.config.json', 'AGENTS.md', 'CLAUDE.md',
]);
const FORBIDDEN_PREFIXES = [
  // The retired CommonJS tree and the source of authority never ship.
  'dist/', 'src/', 'test/', 'scripts/', 'node_modules/',
  // Repository-local material that is not part of the runtime payload.
  '.forgejo-local/', 'sessions/', 'graphify-out/', 'missions/', 'backlog/',
  'docs/', 'examples/', 'tools/', 'proofs/', 'forgejo/',
  // Package-root asset directories: superseded by their build/ staged copies.
  'config/', 'data/', 'prompts/', 'templates/',
];

function violationsFor(files: string[]): string[] {
  const names = new Set(files);
  const violations: string[] = [];
  for (const required of REQUIRED_PATHS) {
    if (!names.has(required)) {violations.push(`missing required package file: ${required}`);}
  }
  for (const prefix of REQUIRED_PREFIXES) {
    if (!files.some(file => file.startsWith(prefix))) {violations.push(`missing required package asset directory: ${prefix}`);}
  }
  for (const file of files) {
    if (FORBIDDEN_PATHS.has(file) || file.endsWith('.ts') || file.endsWith('.tsx') || file.endsWith('.d.ts')
      || FORBIDDEN_PREFIXES.some(prefix => file.startsWith(prefix))
      || /(^|\/)agents\.local\.json$/.test(file)) {
      violations.push(`forbidden package file: ${file}`);
    }
  }
  // Every published payload file lives under build/ except the four root
  // metadata files; anything else means the `files` allowlist has drifted.
  const rootAllowed = new Set(['package.json', 'README.md', 'LICENSE', 'CHANGELOG.md', 'NOTICES']);
  for (const file of files) {
    if (!file.startsWith('build/') && !rootAllowed.has(file)) {
      violations.push(`unexpected package file outside build/: ${file}`);
    }
  }
  if (!files.some(file => /^build\/.+\.mjs$/.test(file))) {violations.push('missing canonical ESM bundle');}
  if (!files.some(file => /^build\/.+\.mjs\.map$/.test(file))) {violations.push('missing canonical bundle source map');}
  return violations;
}

/**
 * Checksum gate: every published build/ file must be listed in
 * build/manifest.sha256 with a digest matching the file on disk.
 */
function checksumViolations(rootDir: string, files: string[]): string[] {
  const manifestPath = path.join(rootDir, 'build', 'manifest.sha256');
  if (!fs.existsSync(manifestPath)) {
    return ['missing checksum manifest: build/manifest.sha256'];
  }
  const recorded = new Map(
    fs.readFileSync(manifestPath, 'utf8').split('\n').filter(Boolean).map(line => {
      const [digest, ...rest] = line.split(/\s+/);
      return [rest.join(' '), digest];
    }),
  );
  const violations: string[] = [];
  for (const file of files) {
    if (!file.startsWith('build/') || file === 'build/manifest.sha256') { continue; }
    const relative = file.slice('build/'.length);
    const digest = recorded.get(relative);
    if (digest === undefined) {
      violations.push(`checksum manifest does not cover published file: ${file}`);
      continue;
    }
    const actual = crypto.createHash('sha256').update(fs.readFileSync(path.join(rootDir, file))).digest('hex');
    if (actual !== digest) {
      violations.push(`checksum mismatch for ${file}: manifest ${digest}, actual ${actual}`);
    }
  }
  return violations;
}

/**
 * `npm pack --json` runs the `prepack` build first, and that build's progress
 * output lands on the same stdout stream ahead of the JSON report. Parse from
 * the first line that opens the report array rather than from raw stdout.
 */
function parsePackReport(stdout: string): Array<{ files?: Array<{ path: string }> }> {
  const start = stdout.search(/^\[\s*$/m);
  const json = start === -1 ? stdout : stdout.slice(start);
  return JSON.parse(json);
}

function packageFiles(rootDir: string): string[] {
  const result = spawnSync('npm', ['pack', '--dry-run', '--json'], {
    cwd: rootDir,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (result.status !== 0) {
    throw new Error(`npm pack --dry-run failed (exit ${result.status}): ${result.stderr || result.stdout}`);
  }
  const report = parsePackReport(result.stdout);
  const files = report[0] && Array.isArray(report[0].files) ? report[0].files.map(entry => entry.path) : null;
  if (!files) {throw new Error('npm pack --dry-run --json did not return a file list');}
  return files.sort();
}

function main(rootDir: string = process.cwd()): number {
  const files = packageFiles(rootDir);
  const violations = [...violationsFor(files), ...checksumViolations(rootDir, files)];
  if (violations.length > 0) {
    process.stderr.write(`Package-content audit failed:\n${violations.map(item => `- ${item}`).join('\n')}\n`);
    return 1;
  }
  process.stdout.write(`Package-content audit passed (ADR 0044 §8): ${files.length} files, checksums verified.\n`);
  return 0;
}

export { checksumViolations, main, packageFiles, parsePackReport, violationsFor };

// Run as a script (`tsx scripts/package-content-audit.ts`) and also consumed via
// require() from the CommonJS test files, so both entry shapes are handled.
declare const module: { exports: any } | undefined;
declare const require: { main?: unknown } | undefined;
if (typeof module !== 'undefined') {
  if (typeof require !== 'undefined' && require.main === module) { process.exitCode = main(); }
  module.exports = { checksumViolations, main, packageFiles, parsePackReport, violationsFor };
} else if (process.argv[1] && path.basename(process.argv[1]).startsWith('package-content-audit')) {
  process.exitCode = main();
}
