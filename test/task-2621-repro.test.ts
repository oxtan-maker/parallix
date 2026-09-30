import test from 'node:test';
import assert from 'node:assert/strict';
import childProcess from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const REPO_ROOT = path.join(import.meta.dirname, '..');
const REFRESH_SCRIPT = path.join(REPO_ROOT, 'scripts', 'refresh-global-px.sh');

function executable(file: string, source: string) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, source, 'utf8');
  fs.chmodSync(file, 0o755);
}

function packageJson(version: string) {
  return JSON.stringify({ name: 'brace-expansion', version }, null, 2);
}

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'task-2621-'));
  const repo = path.join(root, 'repo');
  const bin = path.join(root, 'bin');
  const calls = path.join(root, 'calls.log');
  const nested = 'node_modules/@earendil-works/pi-coding-agent/node_modules/brace-expansion';
  const rootBrace = path.join(repo, 'node_modules/brace-expansion');
  const nestedBrace = path.join(repo, nested);

  fs.mkdirSync(path.join(repo, 'scripts'), { recursive: true });
  fs.copyFileSync(REFRESH_SCRIPT, path.join(repo, 'scripts/refresh-global-px.sh'));
  fs.writeFileSync(path.join(repo, 'package.json'), JSON.stringify({ name: 'fixture', version: '1.0.0' }));
  fs.writeFileSync(path.join(repo, 'package-lock.json'), JSON.stringify({
    lockfileVersion: 3,
    packages: {
      '': { name: 'fixture', version: '1.0.0' },
      'node_modules/brace-expansion': { version: '5.0.12' },
      [nested]: { version: '5.0.12' },
    },
  }, null, 2));
  fs.mkdirSync(rootBrace, { recursive: true });
  fs.mkdirSync(nestedBrace, { recursive: true });
  fs.writeFileSync(path.join(rootBrace, 'package.json'), packageJson('5.0.9'));
  fs.writeFileSync(path.join(nestedBrace, 'package.json'), packageJson('5.0.9'));

  executable(path.join(bin, 'px'), '#!/usr/bin/env bash\necho 1.0.0\n');
  executable(path.join(bin, 'npm'), `#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const args = process.argv.slice(2);
const root = process.cwd();
const calls = ${JSON.stringify(calls)};
const nested = ${JSON.stringify(nested)};
fs.appendFileSync(calls, args.join(' ') + '\\n');
const packageJson = version => JSON.stringify({ name: 'brace-expansion', version });
if (args[0] === 'ci') {
  for (const target of ['node_modules/brace-expansion', nested]) {
    fs.mkdirSync(path.join(root, target), { recursive: true });
    fs.writeFileSync(path.join(root, target, 'package.json'), packageJson('5.0.12'));
  }
  process.exit(0);
}
if (args[0] === 'run' && args[1] === 'build') process.exit(0);
if (args[0] === 'pack') {
  for (const target of ['node_modules/brace-expansion', nested]) {
    if (JSON.parse(fs.readFileSync(path.join(root, target, 'package.json'))).version !== '5.0.12') {
      process.stderr.write('prepare rejected stale brace-expansion\\n'); process.exit(1);
    }
  }
  process.stdout.write('fixture-1.0.0.tgz\\n'); process.exit(0);
}
if (args[0] === 'install' && args[1] === '-g') process.exit(0);
process.exit(1);
`);
  return { root, repo, bin, calls };
}

test('task-2621: refresh reconciles the landed lockfile before npm pack prepare without a real global install', () => {
  const setup = fixture();
  try {
    const result = childProcess.spawnSync('bash', ['scripts/refresh-global-px.sh'], {
      cwd: setup.repo,
      encoding: 'utf8',
      env: { ...process.env, PATH: `${setup.bin}:${process.env.PATH}` },
    });
    assert.equal(result.status, 0, `refresh should reconcile stale dependencies before pack prepare\n${result.stderr}`);
    assert.match(fs.readFileSync(setup.calls, 'utf8'), /^ci$/m);
  } finally {
    fs.rmSync(setup.root, { recursive: true, force: true });
  }
});
