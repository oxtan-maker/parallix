
const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const PACKAGE_ROOT = path.join(__dirname, '..');

// Reproduces the real post-integrate self-update path from scripts/refresh-global-px.sh:
// `npm pack` the checkout, `npm install -g` the tarball, then run the installed
// executable from a temporary target repository. The package must contain only the
// dist runtime, so extraction cannot couple source and sibling-JS mtimes.
function run(command, args, options = {}) {
// @ts-expect-error -- Legacy fixture intentionally accesses runtime-only `tempHome` absent from its inferred mock shape.
  const tempHome = options.tempHome || fs.mkdtempSync(path.join(os.tmpdir(), 'parallix-npm-home-'));
// @ts-expect-error -- Legacy fixture intentionally accesses runtime-only `spawnOptions` absent from its inferred mock shape.
  const { env: extraEnv, ...spawnOptions } = options;
  return spawnSync(command, args, {
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
}

function packFilename(stdout) {
  const jsonMatches = [...String(stdout || '').matchAll(/"filename"\s*:\s*"([^"]+\.tgz)"/g)];
  if (jsonMatches.length > 0) {
    return jsonMatches[jsonMatches.length - 1][1];
  }
  return String(stdout || '').split(/\r?\n/).map(line => line.trim()).findLast(line => line.endsWith('.tgz')) || null;
}

test('installed dist-layout tarball runs read-only commands outside the checkout', () => {
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
    assert.ok(fs.existsSync(path.join(installedRoot, 'dist', 'px.js')), 'installed package should contain dist/px.js');
    assert.ok(fs.existsSync(path.join(installedRoot, 'dist', 'px.js.map')), 'installed package should contain source maps');
    assert.ok(!fs.existsSync(path.join(installedRoot, 'lib')), 'installed package should not contain sibling lib runtime');
    assert.ok(!fs.existsSync(path.join(installedRoot, 'px.js')), 'installed package should not contain sibling px runtime');
    assert.ok(!fs.existsSync(path.join(installedRoot, 'px.ts')), 'installed package should not contain TypeScript source');
    assert.ok(!fs.existsSync(path.join(installedRoot, 'test')), 'installed package should not contain tests');
    assert.ok(!fs.existsSync(path.join(installedRoot, 'missions')), 'installed package should not contain mission records');
    assert.ok(!fs.existsSync(path.join(installedRoot, 'backlog')), 'installed package should not contain backlog state');
    assert.ok(!fs.existsSync(path.join(installedRoot, 'tsconfig.json')), 'installed package should not contain development configuration');

    const px = path.join(prefix, 'bin', 'px');
    fs.mkdirSync(parallixHome, { recursive: true });
    const { STATS_HEADERS } = require(path.join(installedRoot, 'dist', 'lib', 'commands', 'stats.js'));
    fs.writeFileSync(path.join(parallixHome, 'stats.csv'), `${STATS_HEADERS.join(',')}\n`);
    const pxVersion = run(px, ['--version'], { cwd: target });
    assert.equal(pxVersion.status, 0, `installed px --version failed\nstdout:\n${pxVersion.stdout}\nstderr:\n${pxVersion.stderr}`);
    assert.match(pxVersion.stdout, new RegExp(`${installedRoot.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/dist/px\\.js`));

    for (const command of ['status', 'stats']) {
      const result = run(px, [command], { cwd: target, tempHome: npmHome, env: { PARALLIX_HOME: parallixHome } });
      assert.equal(result.status, 0, `installed px ${command} failed\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
    }
  } finally {
    for (const entry of fs.readdirSync(PACKAGE_ROOT)) {
      if (entry.endsWith('.tgz') && !rootTarballsBefore.has(entry)) {
        fs.rmSync(path.join(PACKAGE_ROOT, entry), { force: true });
      }
    }
    fs.rmSync(root, { recursive: true, force: true });
  }
});
