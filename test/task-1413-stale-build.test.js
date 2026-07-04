const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const childProcess = require('node:child_process');
const test = require('node:test');

const packageJson = require('../package.json');

const CLI_ENTRY = path.resolve(__dirname, '..', packageJson.bin.px);

function runCommand(command, args, options = {}) {
  const result = childProcess.spawnSync(command, args, {
    encoding: 'utf8',
    ...options
  });
  if (result.error && result.status === null) {
    throw result.error;
  }
  return result;
}

function touchOld(filePath) {
  const ts = new Date('2000-01-01T00:00:00Z');
  fs.utimesSync(filePath, ts, ts);
}

function buildProject() {
  const result = runCommand('npm', ['run', 'build:cjs'], {
    cwd: path.resolve(__dirname, '..'),
    encoding: 'utf8'
  });
  if (result.error || result.status !== 0) {
    throw new Error(
      `npm run build:cjs failed (status=${result.status})\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`
    );
  }
}

function spawnCli(...args) {
  return childProcess.spawnSync(process.execPath, [CLI_ENTRY, ...args], {
    encoding: 'utf8',
    timeout: 30000
  });
}

function ensureStatsCsv() {
  const statsPath = path.join(process.env.PARALLIX_HOME, 'stats.csv');
  if (!fs.existsSync(statsPath)) {
    fs.writeFileSync(
      statsPath,
      'date,repo,mission,classification,implementer,stage\n',
      'utf8'
    );
  }
}

test('stale generated JS triggers preflight rejection with npm run build:cjs instruction', () => {
  buildProject();
  ensureStatsCsv();

  const statsTs = path.resolve(__dirname, '..', 'lib', 'commands', 'stats.ts');
  const statsJs = path.resolve(__dirname, '..', 'lib', 'commands', 'stats.js');

  assert.ok(fs.existsSync(statsTs), 'stats.ts source must exist');
  assert.ok(fs.existsSync(statsJs), 'stats.js compiled artifact must exist');

  const originalContent = fs.readFileSync(statsJs, 'utf8');
  const originalStat = fs.statSync(statsJs);

  try {
    // Create a deliberately stale JS artifact with an older mtime
    fs.writeFileSync(statsJs, originalContent, 'utf8');
    touchOld(statsJs);

    const tsStat = fs.statSync(statsTs);
    const jsStat = fs.statSync(statsJs);

    assert.ok(
      jsStat.mtimeMs < tsStat.mtimeMs,
      'stale stats.js must have older mtime than stats.ts'
    );

    const result = spawnCli('stats');

    assert.strictEqual(result.status, 1, 'CLI must exit with code 1 for stale build');

    const combinedOutput = (result.stdout || '') + (result.stderr || '');
    assert.ok(
      combinedOutput.includes('npm run build:cjs'),
      'error output must include "npm run build:cjs" instruction; got: ' + combinedOutput
    );
  } finally {
    fs.writeFileSync(statsJs, originalContent, 'utf8');
    fs.utimesSync(statsJs, originalStat.atime, originalStat.mtime);
  }
});

test('fresh generated JS allows normal command dispatch', () => {
  buildProject();
  ensureStatsCsv();

  const statsTs = path.resolve(__dirname, '..', 'lib', 'commands', 'stats.ts');
  const statsJs = path.resolve(__dirname, '..', 'lib', 'commands', 'stats.js');

  assert.ok(fs.existsSync(statsTs), 'stats.ts source must exist');
  assert.ok(fs.existsSync(statsJs), 'stats.js compiled artifact must exist');

  const originalStat = fs.statSync(statsJs);
  const tsStat = fs.statSync(statsTs);

  assert.ok(
    originalStat.mtimeMs >= tsStat.mtimeMs,
    'fresh stats.js must have mtime >= stats.ts mtime'
  );

  const result = spawnCli('stats');

  assert.strictEqual(result.status, 0, 'CLI must exit with code 0 for fresh build');

  const combinedOutput = (result.stdout || '') + (result.stderr || '');
  assert.ok(
    !combinedOutput.includes('npm run build:cjs'),
    'fresh build must not trigger stale-build error'
  );
});
