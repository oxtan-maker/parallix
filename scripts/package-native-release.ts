#!/usr/bin/env tsx
/**
 * Package the SEA executable into a release archive and record evidence.
 *
 * Usage: tsx scripts/package-native-release.ts <target>
 *   target  platform string, e.g. linux-x64
 *
 * Reads build/sea/ (produced by build-sea.ts), tars it into
 * release-artifacts/parallix-v{version}-{target}.tar.gz, verifies the
 * extracted executable, and writes release-evidence/{target}/release.json.
 */

import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import packageJson from '../package.json' with { type: 'json' };

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const version = packageJson.version;
const seaDir = path.join(root, 'build', 'sea');
const artifactsDir = path.join(root, 'release-artifacts');
const evidenceDir = path.join(root, 'release-evidence');
const executable = process.platform === 'win32' ? 'px.exe' : 'px';

function sha256(file: string): string {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function walk(dir: string, prefix = ''): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const relative = `${prefix}${entry.name}`;
    return entry.isDirectory() ? walk(path.join(dir, entry.name), `${relative}/`) : [relative];
  });
}

function main(target: string): void {
  const px = path.join(seaDir, executable);
  if (!fs.existsSync(px)) {
    throw new Error(`SEA executable missing at ${px}; run \`tsx scripts/build-sea.ts\` first`);
  }

  const metadata = JSON.parse(fs.readFileSync(path.join(seaDir, 'sea-metadata.json'), 'utf8'));
  if (metadata.platform !== target) {
    throw new Error(`SEA was built for ${metadata.platform}, not ${target}`);
  }

  const dirName = `parallix-v${version}-${target}`;
  const archiveName = `${dirName}.tar.gz`;
  const archivePath = path.join(artifactsDir, archiveName);

  fs.mkdirSync(artifactsDir, { recursive: true });
  const stageDir = fs.mkdtempSync(path.join(os.tmpdir(), 'px-package-'));
  try {
    fs.cpSync(seaDir, path.join(stageDir, dirName), { recursive: true });
    execFileSync('tar', ['-C', stageDir, '-czf', archivePath, dirName], { stdio: 'inherit' });
  } finally {
    fs.rmSync(stageDir, { recursive: true, force: true });
  }

  const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'px-verify-'));
  try {
    execFileSync('tar', ['-xzf', archivePath, '-C', temporaryDirectory]);
    const bin = path.join(temporaryDirectory, dirName, executable);
    const output = execFileSync(bin, ['--version'], { encoding: 'utf8', env: { ...process.env, PATH: '' } });
    if (!/@magnusekdahl\/parallix \d+\.\d+\.\d+/.test(output.trim())) {
      throw new Error(`extracted executable did not report a valid version: ${output.trim()}`);
    }
  } finally {
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  }

  const files = walk(seaDir).sort();
  const evidence = {
    target,
    archive: archiveName,
    archiveSha256: sha256(archivePath),
    sourceCommit: metadata.sourceCommit,
    pinnedNode: metadata.pinnedNode,
    executableSha256: metadata.executableSha256,
    signature: metadata.signature,
    build: 'passed',
    smoke: 'passed',
    install: 'passed',
    files,
    recordedAt: new Date().toISOString(),
  };

  const targetEvidence = path.join(evidenceDir, target);
  fs.mkdirSync(targetEvidence, { recursive: true });
  const evidencePath = path.join(targetEvidence, 'release.json');
  fs.writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);

  console.log(`[package] ${archivePath}`);
  console.log(`[package] evidence: ${evidencePath}`);
}

const target = process.argv[2];
if (!target) {
  throw new Error('usage: tsx scripts/package-native-release.ts <target>');
}
try {
  main(target);
} catch (error) {
  console.error(`[package] FAIL: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
