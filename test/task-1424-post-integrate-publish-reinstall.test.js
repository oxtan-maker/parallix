const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const PACKAGE_ROOT = path.join(__dirname, '..');

// Reproduces the real post-integrate self-update path from scripts/refresh-global-px.sh:
// `npm pack` the checkout, `npm install -g` the tarball, then run the *installed*
// package's own build-freshness guard against its own installed tree (the same check
// `npm run publish:guard` runs). This is a packaged-runtime problem, not a stale
// checkout problem: the source checkout here is freshly built and passes its own
// prepack guard; the failure only appears after the tarball round-trip because tar
// extraction assigns each file its own extraction-time mtime, and `<name>.ts` always
// sorts after `<name>.js` in a directory listing, so every compiled pair gets
// extracted .js-then-.ts and the .ts sibling ends up with a *later* mtime than the
// .js it was compiled from -- even though the .js is fresh.
function run(command, args, options = {}) {
  const tempHome = options.tempHome || fs.mkdtempSync(path.join(os.tmpdir(), 'parallix-npm-home-'));
  return spawnSync(command, args, {
    encoding: 'utf8',
    timeout: 120000,
    env: {
      ...process.env,
      HOME: tempHome,
      npm_config_cache: path.join(tempHome, '.npm-cache'),
      npm_config_userconfig: path.join(tempHome, '.npmrc'),
      ...(options.env || {})
    },
    ...options
  });
}

test('installed tarball runtime does not trip the stale-build guard on a fresh, correctly-built checkout', () => {
  // Guard the source checkout itself is fresh before we even pack it -- this is the
  // check `npm run prepack`/`publish:guard` runs against the checkout, and it must
  // already pass here, proving any failure we see below comes from the tarball
  // round-trip, not from an actually-stale checkout.
  const checkoutGuard = run(process.execPath, [
    '-e',
    `require(${JSON.stringify(path.join(PACKAGE_ROOT, 'lib', 'core', 'build-freshness.js'))}).assertBuildFreshness(${JSON.stringify(PACKAGE_ROOT)})`
  ]);
  assert.equal(
    checkoutGuard.status,
    0,
    `source checkout must be freshly built before packing; run npm run build:cjs first.\nstderr:\n${checkoutGuard.stderr}`
  );

  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'parallix-publish-reinstall-'));
  const packDir = path.join(root, 'pack');
  const prefix = path.join(root, 'npm-prefix');
  const npmHome = path.join(root, 'npm-home');
  fs.mkdirSync(packDir, { recursive: true });
  fs.mkdirSync(npmHome, { recursive: true });

  try {
    const packResult = run('npm', [
      'pack',
      PACKAGE_ROOT,
      '--json',
      '--pack-destination',
      packDir
    ], { tempHome: npmHome });
    assert.equal(packResult.status, 0, `npm pack failed\nstdout:\n${packResult.stdout}\nstderr:\n${packResult.stderr}`);
    const packed = JSON.parse(packResult.stdout || '[]');
    if (!packed[0]) {
      return;
    }
    const tarball = path.join(packDir, packed[0].filename);

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

    // No test helper should need to touch installed .js mtimes for the guard to pass:
    // that ad hoc repair is exactly the false-positive behavior this mission removes.
    const installedGuard = run(process.execPath, [
      '-e',
      `require(${JSON.stringify(path.join(installedRoot, 'lib', 'core', 'build-freshness.js'))}).assertBuildFreshness(${JSON.stringify(installedRoot)})`
    ]);
    assert.equal(
      installedGuard.status,
      0,
      'the installed package runtime must not trip its own stale-build guard on a '
      + `freshly packed-and-installed tree.\nstdout:\n${installedGuard.stdout}\nstderr:\n${installedGuard.stderr}`
    );

    // The installed runtime entrypoint must actually run (proves this is a real
    // runnable install, not just a directory that happens to pass the guard).
    const pxVersion = run(path.join(prefix, 'bin', 'px'), ['--version'], {});
    assert.equal(pxVersion.status, 0, `installed px --version failed\nstdout:\n${pxVersion.stdout}\nstderr:\n${pxVersion.stderr}`);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
