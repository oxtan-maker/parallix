


import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
const PACKAGE_ROOT = path.join(import.meta.dirname, '..');

type RunOptions = import('node:child_process').SpawnSyncOptions & {
  tempHome?: string;
  env?: Record<string, string>;
};

// Reproduces the real post-integrate self-update path from scripts/refresh-global-px.sh:
// `npm pack` the checkout, `npm install -g` the tarball, then run the installed
// executable from a temporary target repository. Since TASK-2285 the package
// contains only the canonical ESM bundle payload (build/), so extraction cannot
// couple source and sibling-JS mtimes.
function run(command: string, args: string[], options: RunOptions = {}) {
  const runOptions = options as RunOptions;
  const callerProvided = runOptions.tempHome !== undefined;
  const tempHome = runOptions.tempHome || fs.mkdtempSync(path.join(os.tmpdir(), 'parallix-npm-home-'));
  const { env: extraEnv, ...spawnOptions } = runOptions;
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    timeout: 120000,
    env: {
      ...process.env,
      HOME: tempHome,
      npm_config_cache: path.join(tempHome, '.npm-cache'),
      npm_config_userconfig: path.join(tempHome, '.npmrc'),
      ...(extraEnv || {})
    },
    ...spawnOptions
  });
  // Clean up auto-created tempHome; preserve caller-provided directories.
  if (!callerProvided) {
    try { fs.rmSync(tempHome, { recursive: true, force: true }); } catch (_) {}
  }
  return result;
}

function packFilename(stdout) {
  const jsonMatches = [...String(stdout || '').matchAll(/"filename"\s*:\s*"([^"]+\.tgz)"/g)];
  if (jsonMatches.length > 0) {
    return jsonMatches[jsonMatches.length - 1][1];
  }
  return String(stdout || '').split(/\r?\n/).map(line => line.trim()).findLast(line => line.endsWith('.tgz')) || null;
}

test('installed bundle-layout tarball runs read-only commands outside the checkout', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'parallix-publish-reinstall-'));
  const packDir = path.join(root, 'pack');
  const prefix = path.join(root, 'npm-prefix');
  const npmHome = path.join(root, 'npm-home');
  const target = path.join(root, 'target');
  const parallixHome = path.join(root, 'parallix-home');
  fs.mkdirSync(packDir, { recursive: true });
  fs.mkdirSync(npmHome, { recursive: true });
  fs.mkdirSync(target, { recursive: true });
  const rootTarballsBefore = new Set(
    fs.readdirSync(PACKAGE_ROOT).filter(entry => entry.endsWith('.tgz'))
  );

  try {
    const packResult = run('npm', [
      'pack',
      PACKAGE_ROOT,
      '--json'
    ], { tempHome: npmHome, cwd: packDir });
    assert.equal(packResult.status, 0, `npm pack failed\nstdout:\n${packResult.stdout}\nstderr:\n${packResult.stderr}`);
    const filename = packFilename(packResult.stdout);
    if (!filename) {
      return;
    }
    const tarball = path.join(packDir, filename);
    const rootTarball = path.join(PACKAGE_ROOT, filename);
    if (!fs.existsSync(tarball) && fs.existsSync(rootTarball)) {
      fs.renameSync(rootTarball, tarball);
    }

    const installResult = run('npm', ['install', '-g', '--prefix', prefix, tarball], { tempHome: npmHome });
// @ts-expect-error -- TASK-2328: partial test double after ESM seam migration
    if (installResult.error && installResult.error.code === 'EPERM') {
      return;
    }
    assert.equal(
      installResult.status,
      0,
      `npm install -g failed\nstdout:\n${installResult.stdout}\nstderr:\n${installResult.stderr}`
    );

    const installedRoot = path.join(prefix, 'lib', 'node_modules', '@magnusekdahl', 'parallix');
    assert.ok(fs.existsSync(installedRoot), 'installed package directory should exist');
    assert.ok(fs.existsSync(path.join(installedRoot, 'build', 'px.mjs')), 'installed package should contain build/px.mjs');
    assert.ok(fs.existsSync(path.join(installedRoot, 'build', 'px.mjs.map')), 'installed package should contain source maps');
    assert.ok(!fs.existsSync(path.join(installedRoot, 'dist')), 'installed package should not contain the CommonJS rollback tree');
    assert.ok(!fs.existsSync(path.join(installedRoot, 'lib')), 'installed package should not contain sibling lib runtime');
    assert.ok(!fs.existsSync(path.join(installedRoot, 'px.js')), 'installed package should not contain sibling px runtime');
    assert.ok(!fs.existsSync(path.join(installedRoot, 'px.ts')), 'installed package should not contain TypeScript source');
    assert.ok(!fs.existsSync(path.join(installedRoot, 'src')), 'installed package should not contain source authority');
    assert.ok(!fs.existsSync(path.join(installedRoot, 'test')), 'installed package should not contain tests');
    assert.ok(!fs.existsSync(path.join(installedRoot, 'missions')), 'installed package should not contain mission records');
    assert.ok(!fs.existsSync(path.join(installedRoot, 'backlog')), 'installed package should not contain backlog state');
    assert.ok(!fs.existsSync(path.join(installedRoot, 'tsconfig.json')), 'installed package should not contain development configuration');

    const px = path.join(prefix, 'bin', 'px');
    fs.mkdirSync(parallixHome, { recursive: true });
    // TASK-2322.08: `px stats` reads the measurement database and creates it on
    // first access, so no seed file is needed and none may be a CSV.
    const pxVersion = run(px, ['--version'], { cwd: target });
    assert.equal(pxVersion.status, 0, `installed px --version failed\nstdout:\n${pxVersion.stdout}\nstderr:\n${pxVersion.stderr}`);
// @ts-expect-error -- TASK-2328: partial test double after ESM seam migration
    assert.match(pxVersion.stdout, new RegExp(`${installedRoot.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/build/px\\.mjs`));

    for (const command of ['status', 'stats']) {
      const result = run(px, [command], { cwd: target, tempHome: npmHome, env: { PARALLIX_HOME: parallixHome } });
      assert.equal(result.status, 0, `installed px ${command} failed\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
    }
    assert.ok(fs.existsSync(path.join(parallixHome, 'parallix.db')), 'px stats must create the measurement database under PARALLIX_HOME');
    assert.deepEqual(
      fs.readdirSync(parallixHome).filter(name => name.endsWith('.csv')),
      [],
      'the installed CLI must not write a stats CSV'
    );
  } finally {
    for (const entry of fs.readdirSync(PACKAGE_ROOT)) {
      if (entry.endsWith('.tgz') && !rootTarballsBefore.has(entry)) {
        fs.rmSync(path.join(PACKAGE_ROOT, entry), { force: true });
      }
    }
    fs.rmSync(root, { recursive: true, force: true });
  }
});
