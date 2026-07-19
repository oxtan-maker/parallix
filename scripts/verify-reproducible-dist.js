'use strict';

const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

function listFiles(rootDir, relative = '') {
  const directory = path.join(rootDir, relative);
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const child = path.join(relative, entry.name);
    return entry.isDirectory() ? listFiles(rootDir, child) : [child];
  }).sort();
}

function compareFileLists(first, second) {
  return JSON.stringify(first) === JSON.stringify(second);
}

function buildClean(rootDir) {
  fs.rmSync(path.join(rootDir, 'dist'), { recursive: true, force: true });
  const result = spawnSync('npm', ['run', 'build'], { cwd: rootDir, encoding: 'utf8', stdio: 'inherit' });
  if (result.status !== 0) {throw new Error(`npm run build failed (exit ${result.status})`);}
  return listFiles(path.join(rootDir, 'dist'));
}

function main(rootDir = process.cwd()) {
  const first = buildClean(rootDir);
  const second = buildClean(rootDir);
  if (!compareFileLists(first, second)) {
    process.stderr.write(`Reproducible dist check failed.\nfirst: ${first.join(', ')}\nsecond: ${second.join(', ')}\n`);
    return 1;
  }
  process.stdout.write(`Reproducible dist check passed (${first.length} files).\n`);
  return 0;
}

if (require.main === module) {process.exitCode = main();}

module.exports = { listFiles, compareFileLists, buildClean, main };
