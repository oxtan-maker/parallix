const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const childProcess = require('node:child_process');

const repoRoot = path.resolve(__dirname, '..');
const fixtureRootEntries = [
  'package.json',
  'tsconfig.json',
  'index.ts',
  'index.js',
  'px.ts',
  'px.js',
  'lib',
];

function createPublishFixture() {
  const fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), 'parallix-task-1417-'));
  for (const entry of fixtureRootEntries) {
    const source = path.join(repoRoot, entry);
    const target = path.join(fixtureDir, entry);
    fs.cpSync(source, target, { recursive: true });
  }
  fs.symlinkSync(path.join(repoRoot, 'node_modules'), path.join(fixtureDir, 'node_modules'), 'dir');
  return fixtureDir;
}

function runPrepublishOnly(fixtureDir) {
  const result = childProcess.spawnSync('npm', ['run', 'prepublishOnly'], {
    cwd: fixtureDir,
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${path.join(repoRoot, 'node_modules', '.bin')}:${process.env.PATH || ''}`,
    },
    timeout: 120000,
  });
  if (result.error && result.status === null) {
    throw result.error;
  }
  return result;
}

function setMtime(filePath, isoTime) {
  const timestamp = new Date(isoTime);
  fs.utimesSync(filePath, timestamp, timestamp);
}

function setGuardedPairsFresh(fixtureDir) {
  const pairs = [
    [path.join(fixtureDir, 'px.ts'), path.join(fixtureDir, 'px.js')],
    [path.join(fixtureDir, 'index.ts'), path.join(fixtureDir, 'index.js')],
  ];
  const commandsDir = path.join(fixtureDir, 'lib', 'commands');
  for (const entry of fs.readdirSync(commandsDir)) {
    if (!entry.endsWith('.ts')) {
      continue;
    }
    pairs.push([
      path.join(commandsDir, entry),
      path.join(commandsDir, entry.replace(/\.ts$/, '.js')),
    ]);
  }

  for (const [tsPath, jsPath] of pairs) {
    if (!fs.existsSync(tsPath) || !fs.existsSync(jsPath)) {
      continue;
    }
    setMtime(tsPath, '2000-01-01T00:00:00.000Z');
    setMtime(jsPath, '2030-01-01T00:00:00.000Z');
  }
}

test('prepublishOnly fails closed when a guarded compiled file is stale', () => {
  const fixtureDir = createPublishFixture();
  try {
    setGuardedPairsFresh(fixtureDir);

    const tsPath = path.join(fixtureDir, 'lib', 'commands', 'stats.ts');
    const jsPath = path.join(fixtureDir, 'lib', 'commands', 'stats.js');

    assert.ok(fs.existsSync(tsPath), 'fixture must include lib/commands/stats.ts');
    assert.ok(fs.existsSync(jsPath), 'fixture must include lib/commands/stats.js');

    setMtime(jsPath, '2000-01-01T00:00:00.000Z');
    setMtime(tsPath, '2030-01-01T00:00:00.000Z');

    const result = runPrepublishOnly(fixtureDir);
    const output = `${result.stdout || ''}${result.stderr || ''}`;

    assert.equal(
      result.status,
      1,
      `expected npm run prepublishOnly to reject stale compiled output\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`
    );
    assert.match(output, /Stale build detected/);
    assert.match(output, /npm run build:cjs/);
  } finally {
    fs.rmSync(fixtureDir, { recursive: true, force: true });
  }
});

test('prepublishOnly still passes when guarded compiled files are fresh', () => {
  const fixtureDir = createPublishFixture();
  try {
    setGuardedPairsFresh(fixtureDir);

    const result = runPrepublishOnly(fixtureDir);

    assert.equal(
      result.status,
      0,
      `expected npm run prepublishOnly to allow fresh compiled output\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`
    );
  } finally {
    fs.rmSync(fixtureDir, { recursive: true, force: true });
  }
});
