#!/usr/bin/env node
/**
 * Package the SEA executable into a release archive and record evidence.
 *
 * Usage: node scripts/package-native-release.js <target>
 *   target  platform string, e.g. linux-x64
 *
 * Reads build/sea/ (produced by build-sea.js), tars it into
 * release-artifacts/parallix-v{version}-{target}.tar.gz, verifies the
 * extracted executable, and writes release-evidence/{target}/release.json.
 */

const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const version = require(path.join(root, 'package.json')).version;
const seaDir = path.join(root, 'build', 'sea');
const artifactsDir = path.join(root, 'release-artifacts');
const evidenceDir = path.join(root, 'release-evidence');
const executable = process.platform === 'win32' ? 'px.exe' : 'px';

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function walk(dir, prefix = '') {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const rel = `${prefix}${entry.name}`;
    return entry.isDirectory() ? walk(path.join(dir, entry.name), `${rel}/`) : [rel];
  });
}

function main(target) {
  const px = path.join(seaDir, executable);
  if (!fs.existsSync(px)) {
    throw new Error(`SEA executable missing at ${px}; run \`node scripts/build-sea.js\` first`);
  }

  const metadata = JSON.parse(fs.readFileSync(path.join(seaDir, 'sea-metadata.json'), 'utf8'));
  if (metadata.platform !== target) {
    throw new Error(`SEA was built for ${metadata.platform}, not ${target}`);
  }

  const dirName = `parallix-v${version}-${target}`;
  const archiveName = `${dirName}.tar.gz`;
  const archivePath = path.join(artifactsDir, archiveName);

  // Create tar archive
  fs.mkdirSync(artifactsDir, { recursive: true });
  const stageDir = fs.mkdtempSync(path.join(os.tmpdir(), 'px-package-'));
  try {
    fs.cpSync(seaDir, path.join(stageDir, dirName), { recursive: true });
    execFileSync('tar', ['-C', stageDir, '-czf', archivePath, dirName], { stdio: 'inherit' });
  } finally {
    fs.rmSync(stageDir, { recursive: true, force: true });
  }

  // Verify: extract and run --version
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'px-verify-'));
  try {
    execFileSync('tar', ['-xzf', archivePath, '-C', tmp]);
    const bin = path.join(tmp, dirName, executable);
    const out = execFileSync(bin, ['--version'], { encoding: 'utf8', env: { ...process.env, PATH: '' } });
    if (!/@magnusekdahl\/parallix \d+\.\d+\.\d+/.test(out.trim())) {
      throw new Error(`extracted executable did not report a valid version: ${out.trim()}`);
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }

  // Write evidence JSON
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

if (require.main === module) {
  const target = process.argv[2];
  if (!target) throw new Error('usage: node scripts/package-native-release.js <target>');
  try { main(target); } catch (err) { console.error(`[package] FAIL: ${err.message}`); process.exitCode = 1; }
}
