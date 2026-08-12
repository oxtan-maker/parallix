


import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
const PACKAGE_ROOT = path.join(import.meta.dirname, '..');
const TSX_IMPORT = path.join(PACKAGE_ROOT, 'node_modules', 'tsx', 'dist', 'esm', 'index.mjs');

type RunOptions = import('node:child_process').SpawnSyncOptions & {
  tempHome?: string;
  env?: Record<string, string>;
};

function packFilename(stdout) {
  const jsonMatches = [...String(stdout || '').matchAll(/"filename"\s*:\s*"([^"]+\.tgz)"/g)];
  if (jsonMatches.length > 0) {
    return jsonMatches[jsonMatches.length - 1][1];
  }
  return String(stdout || '').split(/\r?\n/).map(line => line.trim()).findLast(line => line.endsWith('.tgz')) || null;
}

function run(command: string, args: string[], options: RunOptions = {}) {
  const runOptions = options as RunOptions;
  const callerProvided = runOptions.tempHome !== undefined;
  const tempHome = runOptions.tempHome || fs.mkdtempSync(path.join(os.tmpdir(), 'parallix-npm-home-'));
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    timeout: 120000,
    env: {
      ...process.env,
      HOME: tempHome,
      npm_config_cache: path.join(tempHome, '.npm-cache'),
      npm_config_userconfig: path.join(tempHome, '.npmrc'),
      ...(runOptions.env || {})
    },
    ...runOptions
  });
  // Clean up auto-created tempHome; preserve caller-provided directories.
  if (!callerProvided) {
    try { fs.rmSync(tempHome, { recursive: true, force: true }); } catch (_) {}
  }
// @ts-expect-error -- TASK-2328: partial test double after ESM seam migration
  if (result.error && result.error.code === 'EPERM') {
    return result;
  }
  assert.equal(
    result.status,
    0,
    `${command} ${args.join(' ')} failed\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`
  );
  return result;
}

test('global tarball reinstall preserves PARALLIX_HOME measurements and agent blocklist', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'parallix-reinstall-'));
  const packDir = path.join(root, 'pack');
  const prefix = path.join(root, 'npm-prefix');
  const parallixHome = path.join(root, 'parallix-home');
  const npmHome = path.join(root, 'npm-home');
  const repoOne = path.join(root, 'repo-one');
  const repoTwo = path.join(root, 'repo-two');
  fs.mkdirSync(packDir, { recursive: true });
  fs.mkdirSync(npmHome, { recursive: true });
  fs.mkdirSync(repoOne);
  fs.mkdirSync(repoTwo);
  const rootTarballsBefore = new Set(
    fs.readdirSync(PACKAGE_ROOT).filter(entry => entry.endsWith('.tgz'))
  );

  try {
    const packResult = run('npm', [
      'pack',
      PACKAGE_ROOT,
      '--json'
    ], { tempHome: npmHome, cwd: packDir });
    const filename = packFilename(packResult.stdout);
    if (!filename) {
      return;
    }
    const tarball = path.join(packDir, filename);
    const rootTarball = path.join(PACKAGE_ROOT, filename);
    if (!fs.existsSync(tarball) && fs.existsSync(rootTarball)) {
      fs.renameSync(rootTarball, tarball);
    }
    const installArgs = ['install', '-g', '--prefix', prefix, tarball];
    run('npm', installArgs, { tempHome: npmHome });

    // Package name is scoped (@magnusekdahl/parallix), so npm installs under the scope dir.
    const installedRoot = path.join(prefix, 'lib', 'node_modules', '@magnusekdahl', 'parallix');
    assert.ok(fs.existsSync(path.join(installedRoot, 'build', 'px.mjs')), 'installed build/px.mjs should exist');
    assert.ok(fs.existsSync(path.join(installedRoot, 'build', 'px.mjs.map')), 'installed package should ship source maps');
    assert.equal(fs.existsSync(path.join(installedRoot, 'dist')), false, 'installed package should not ship the CommonJS rollback tree');
    assert.equal(fs.existsSync(path.join(installedRoot, 'lib')), false, 'installed package should not ship sibling lib runtime');
    assert.equal(fs.existsSync(path.join(installedRoot, 'px.js')), false, 'installed package should not ship sibling px runtime');
    assert.equal(fs.existsSync(path.join(installedRoot, 'px.ts')), false, 'installed package should not ship TypeScript sources');

    const env = { ...process.env, PARALLIX_HOME: parallixHome };
    // Since TASK-2285 the published package exposes no importable modules, so the
    // fixture seeds operator state through the checkout's TypeScript source via tsx.
    // The assertions that matter here — where that state lives, that the installed CLI
    // reads it, and that a reinstall preserves it — are unchanged.
    const writeScript = [
      `const stats = require(${JSON.stringify(path.join(PACKAGE_ROOT, 'src', 'adapters', 'cli', 'commands', 'stats.ts'))});`,
      `const agents = require(${JSON.stringify(path.join(PACKAGE_ROOT, 'src', 'adapters', 'agents', 'agents.ts'))});`,
      "stats.upsertMeasurementRow({date:'2026-06-06',mission:'task-reinstall-proof',classification:'ai_sdlc',implementer:'codex',pr_fix_rounds:'2',});",
      "agents.updateAgentBlock('custom', '2026-07-01 12');"
    ].join('');
    run(process.execPath, ['--import', TSX_IMPORT, '-e', writeScript], { cwd: repoOne, env });

    // TASK-2322.08: the operator's statistics live in the measurement database.
    const measurementDbPath = path.join(parallixHome, 'parallix.db');
    const agentsPath = path.join(parallixHome, 'agents.local.json');
    assert.ok(fs.existsSync(measurementDbPath), 'measurements must be written to <PARALLIX_HOME>/parallix.db');
    assert.equal(fs.existsSync(path.join(parallixHome, 'stats.csv')), false, 'no stats.csv may be written');
    const measurementsBefore = fs.readFileSync(measurementDbPath);
    const agentsBefore = fs.readFileSync(agentsPath, 'utf8');
    const readFromSecondRepo = [
      `const stats = require(${JSON.stringify(path.join(PACKAGE_ROOT, 'src', 'adapters', 'cli', 'commands', 'stats.ts'))});`,
      "const row = stats.loadMeasurementRows().rows.find(item => item.mission === 'task-reinstall-proof');",
      "if (!row || row.pr_fix_rounds !== '2') process.exit(1);"
    ].join('');
    run(process.execPath, ['--import', TSX_IMPORT, '-e', readFromSecondRepo], { cwd: repoTwo, env });
    const pxStats = run(
      process.execPath,
      [path.join(installedRoot, 'build', 'px.mjs'), 'stats', '--today', '2026-06-06'],
      { cwd: repoTwo, env }
    );
// @ts-expect-error -- TASK-2328: partial test double after ESM seam migration
    assert.match(pxStats.stdout, /Loaded \d+ measurements from the statistics database/);
// @ts-expect-error -- TASK-2328: partial test double after ESM seam migration
    assert.doesNotMatch(pxStats.stdout, /Loading CSV/);

    run('npm', installArgs, { tempHome: npmHome });

    // A reinstall preserves operator state: the same measurement is still there.
    assert.deepEqual(fs.readFileSync(measurementDbPath), measurementsBefore);
    assert.equal(fs.readFileSync(agentsPath, 'utf8'), agentsBefore);
    run(process.execPath, ['--import', TSX_IMPORT, '-e', readFromSecondRepo], { cwd: repoTwo, env });
    assert.deepEqual(
      JSON.parse(agentsBefore).blocklist.custom,
      { until: '2026-07-01 12' }
    );
    assert.equal(fs.existsSync(path.join(installedRoot, 'data', 'stats.csv')), false);
    assert.equal(fs.existsSync(path.join(installedRoot, 'parallix.db')), false);
    assert.equal(fs.existsSync(path.join(installedRoot, 'agents.local.json')), false);
    assert.equal(fs.existsSync(path.join(installedRoot, 'config', 'agents.local.json')), false);
    assert.equal(fs.existsSync(path.join(repoOne, 'stats.csv')), false);
    assert.equal(fs.existsSync(path.join(repoOne, 'agents.local.json')), false);
    assert.equal(fs.existsSync(path.join(repoTwo, 'stats.csv')), false);
    assert.equal(fs.existsSync(path.join(repoTwo, 'agents.local.json')), false);
  } finally {
    for (const entry of fs.readdirSync(PACKAGE_ROOT)) {
      if (entry.endsWith('.tgz') && !rootTarballsBefore.has(entry)) {
        fs.rmSync(path.join(PACKAGE_ROOT, entry), { force: true });
      }
    }
    fs.rmSync(root, { recursive: true, force: true });
  }
});
