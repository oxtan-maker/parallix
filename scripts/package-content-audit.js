'use strict';

const { spawnSync } = require('node:child_process');

const REQUIRED_PATHS = [
  'dist/index.js',
  'dist/index.js.map',
  'dist/px.js',
  'dist/px.js.map',
  'package.json',
  'README.md',
  'LICENSE',
  'CHANGELOG.md',
  'tools/setup-forgejo-docker.sh',
];
const REQUIRED_PREFIXES = [
  'config/', 'data/', 'docs/', 'examples/', 'prompts/', 'templates/',
];
const FORBIDDEN_PATHS = new Set([
  'tsconfig.json', 'tsconfig.test.json', 'eslint.config.mjs', 'stryker.conf.json',
]);
const FORBIDDEN_PREFIXES = [
  'test/', '.forgejo-local/', 'sessions/', 'graphify-out/', 'missions/', 'backlog/',
];

function violationsFor(files) {
  const names = new Set(files);
  const violations = [];
  for (const required of REQUIRED_PATHS) {
    if (!names.has(required)) {violations.push(`missing required package file: ${required}`);}
  }
  for (const prefix of REQUIRED_PREFIXES) {
    if (!files.some(file => file.startsWith(prefix))) {violations.push(`missing required package asset directory: ${prefix}`);}
  }
  for (const file of files) {
    if (FORBIDDEN_PATHS.has(file) || file.endsWith('.ts') || file.endsWith('.d.ts')
      || FORBIDDEN_PREFIXES.some(prefix => file.startsWith(prefix))
      || /(^|\/)agents\.local\.json$/.test(file)) {
      violations.push(`forbidden package file: ${file}`);
    }
  }
  if (!files.some(file => /^dist\/.+\.js$/.test(file))) {violations.push('missing emitted dist JavaScript');}
  if (!files.some(file => /^dist\/.+\.js\.map$/.test(file))) {violations.push('missing emitted dist source maps');}
  return violations;
}

function packageFiles(rootDir) {
  const result = spawnSync('npm', ['pack', '--dry-run', '--json'], {
    cwd: rootDir,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (result.status !== 0) {
    throw new Error(`npm pack --dry-run failed (exit ${result.status}): ${result.stderr || result.stdout}`);
  }
  const report = JSON.parse(result.stdout);
  const files = report[0] && Array.isArray(report[0].files) ? report[0].files.map(entry => entry.path) : null;
  if (!files) {throw new Error('npm pack --dry-run --json did not return a file list');}
  return files.sort();
}

function main(rootDir = process.cwd()) {
  const violations = violationsFor(packageFiles(rootDir));
  if (violations.length > 0) {
    process.stderr.write(`Package-content audit failed:\n${violations.map(item => `- ${item}`).join('\n')}\n`);
    return 1;
  }
  process.stdout.write('Package-content audit passed (ADR 0044 §8).\n');
  return 0;
}

if (require.main === module) {process.exitCode = main();}

module.exports = { violationsFor, packageFiles, main };
