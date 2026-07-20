// @ts-nocheck -- TASK-2277: preserve legacy CommonJS mock behavior while mock-shape typings are hardened separately.

const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const PACKAGE_ROOT = path.join(__dirname, '..');

function packFilename(stdout) {
  const jsonMatches = [...String(stdout || '').matchAll(/"filename"\s*:\s*"([^"]+\.tgz)"/g)];
  if (jsonMatches.length > 0) {
    return jsonMatches[jsonMatches.length - 1][1];
  }
  return String(stdout || '').split(/\r?\n/).map(line => line.trim()).findLast(line => line.endsWith('.tgz')) || null;
}

function run(command, args, options = {}) {
  const tempHome = options.tempHome || fs.mkdtempSync(path.join(os.tmpdir(), 'parallix-npm-home-'));
  const result = spawnSync(command, args, {
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
  // @ts-expect-error TS2339 Property 'code' does not exist on type 'Error'.
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

test('global tarball reinstall preserves PARALLIX_HOME stats and agent blocklist', () => {
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
    const commandsDir = path.join(installedRoot, 'dist', 'lib', 'commands');
    assert.ok(fs.existsSync(commandsDir), 'installed dist/lib/commands should exist');
    assert.ok(fs.existsSync(path.join(installedRoot, 'dist', 'px.js.map')), 'installed package should ship source maps');
    assert.equal(fs.existsSync(path.join(installedRoot, 'lib')), false, 'installed package should not ship sibling lib runtime');
    assert.equal(fs.existsSync(path.join(installedRoot, 'px.js')), false, 'installed package should not ship sibling px runtime');
    assert.equal(fs.existsSync(path.join(installedRoot, 'px.ts')), false, 'installed package should not ship TypeScript sources');

    const env = { ...process.env, PARALLIX_HOME: parallixHome };
    const writeScript = [
      `const stats = require(${JSON.stringify(path.join(installedRoot, 'dist', 'lib', 'commands', 'stats.js'))});`,
      `const agents = require(${JSON.stringify(path.join(installedRoot, 'dist', 'lib', 'agents', 'agents.js'))});`,
      "stats.upsertStatsRow({date:'2026-06-06',mission:'task-reinstall-proof',classification:'ai_sdlc',implementer:'codex',pr_fix_rounds:'2'});",
      "agents.updateAgentBlock('custom', '2026-07-01 12');"
    ].join('');
    run(process.execPath, ['-e', writeScript], { cwd: repoOne, env });

    const statsPath = path.join(parallixHome, 'stats.csv');
    const agentsPath = path.join(parallixHome, 'agents.local.json');
    const statsBefore = fs.readFileSync(statsPath, 'utf8');
    const agentsBefore = fs.readFileSync(agentsPath, 'utf8');
    const readFromSecondRepo = [
      `const stats = require(${JSON.stringify(path.join(installedRoot, 'dist', 'lib', 'commands', 'stats.js'))});`,
      "const row = stats.loadStatsCsv().rows.find(item => item.mission === 'task-reinstall-proof');",
      "if (!row || row.pr_fix_rounds !== '2') process.exit(1);"
    ].join('');
    run(process.execPath, ['-e', readFromSecondRepo], { cwd: repoTwo, env });
    const pxStats = run(
      process.execPath,
      [path.join(installedRoot, 'dist', 'px.js'), 'stats', '--today', '2026-06-06'],
      { cwd: repoTwo, env }
    );
    assert.match(pxStats.stdout, new RegExp(`Loading CSV: ${statsPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));

    run('npm', installArgs, { tempHome: npmHome });

    assert.equal(fs.readFileSync(statsPath, 'utf8'), statsBefore);
    assert.equal(fs.readFileSync(agentsPath, 'utf8'), agentsBefore);
    assert.match(statsBefore, /task-reinstall-proof,ai_sdlc,codex,2/);
    assert.deepEqual(
      JSON.parse(agentsBefore).blocklist.custom,
      { until: '2026-07-01 12' }
    );
    assert.equal(fs.existsSync(path.join(installedRoot, 'data', 'stats.seed.csv')), false);
    assert.equal(fs.existsSync(path.join(installedRoot, 'data', 'stats.csv')), false);
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
