const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const childProcess = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..');
const SCRIPT_SOURCE = path.join(REPO_ROOT, 'scripts', 'refresh-global-px.sh');

function writeExecutable(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, 'utf8');
  fs.chmodSync(filePath, 0o755);
}

function setupFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'task-2206-hook-'));
  const repoRoot = path.join(root, 'repo');
  const binDir = path.join(root, 'bin');
  const logPath = path.join(root, 'calls.log');

  fs.mkdirSync(path.join(repoRoot, 'scripts'), { recursive: true });
  fs.copyFileSync(SCRIPT_SOURCE, path.join(repoRoot, 'scripts', 'refresh-global-px.sh'));
  fs.writeFileSync(path.join(repoRoot, 'package.json'), JSON.stringify({ name: 'fixture', version: '1.0.0' }, null, 2));
  fs.writeFileSync(path.join(repoRoot, 'package-lock.json'), '{}\n');

  writeExecutable(path.join(binDir, 'git'), `#!/usr/bin/env node
const fs = require('node:fs');
fs.appendFileSync(${JSON.stringify(logPath)}, 'git ' + process.argv.slice(2).join(' ') + '\\n');
process.exit(0);
`);

  writeExecutable(path.join(binDir, 'px'), `#!/usr/bin/env node
process.stdout.write('1.0.1\\n');
`);

  writeExecutable(path.join(binDir, 'npm'), `#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const logPath = ${JSON.stringify(logPath)};
const args = process.argv.slice(2);
fs.appendFileSync(logPath, 'npm ' + args.join(' ') + '\\n');

if (args[0] === 'version' && args[1] === 'patch') {
  process.stdout.write('v1.0.1\\n');
  process.exit(0);
}

if (args[0] === 'run' && args[1] === 'build') {
  process.exit(0);
}

if (args[0] === 'pack') {
  process.stdout.write('> fixture@1.0.1 prepack\\n');
  process.stdout.write('> npm run publish:guard\\n');
  process.stdout.write('\\n');
  process.stdout.write('fixture-1.0.1.tgz\\n');
  process.exit(0);
}

if (args[0] === 'install' && args[1] === '-g') {
  const tarballArg = args[2] || '';
  if (/\\n/.test(tarballArg)) {
    process.stderr.write('ENOENT ' + JSON.stringify(tarballArg) + '\\n');
    process.exit(254);
  }
  process.exit(0);
}

process.stderr.write('unexpected npm invocation: ' + args.join(' ') + '\\n');
process.exit(1);
`);

  return { root, repoRoot, binDir, logPath };
}

function runHook(binDir, repoRoot) {
  return childProcess.spawnSync('bash', ['scripts/refresh-global-px.sh'], {
    cwd: repoRoot,
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${binDir}:${process.env.PATH}`,
      INTEGRATE_HOOK_SLUG: 'task-2206',
      INTEGRATE_HOOK_BASE_WORKTREE: repoRoot,
      INTEGRATE_HOOK_BASE_BRANCH: 'main',
      INTEGRATE_HOOK_VARIANT: 'variant-b',
    },
  });
}

test('refresh-global-px.sh passes a real tarball path to npm install even when npm pack prints lifecycle output', () => {
  const fixture = setupFixture();

  try {
    const result = runHook(fixture.binDir, fixture.repoRoot);
    assert.equal(
      result.status,
      0,
      `hook should succeed with lifecycle chatter on npm pack\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`
    );

    const calls = fs.readFileSync(fixture.logPath, 'utf8');
    assert.match(calls, /npm pack/);
    assert.match(calls, /npm install -g \.\/fixture-1\.0\.1\.tgz/);
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test('refresh-global-px.sh still fails closed when npm pack itself fails', () => {
  const fixture = setupFixture();
  writeExecutable(path.join(fixture.binDir, 'npm'), `#!/usr/bin/env node
const args = process.argv.slice(2);
if (args[0] === 'version' && args[1] === 'patch') {
  process.stdout.write('v1.0.1\\n');
  process.exit(0);
}
if (args[0] === 'run' && args[1] === 'build') {
  process.exit(0);
}
if (args[0] === 'pack') {
  process.stderr.write('publish guard rejected stale tree\\n');
  process.exit(1);
}
process.exit(0);
`);

  try {
    const result = runHook(fixture.binDir, fixture.repoRoot);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /publish guard rejected stale tree/);
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});
