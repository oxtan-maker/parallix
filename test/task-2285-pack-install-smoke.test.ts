// task-2285 — pack-and-install smoke for the canonical ESM bundle distribution.
//
// Builds the real tarball and installs it into two disposable prefixes (global
// layout and local layout), then exercises the published CLI end to end. This is
// an integration test: it crosses the process and packaging boundary on purpose.
//
// It is the falsifiable evidence for SC3 (install-and-run), SC4 (no runtime
// node_modules) and SC7 (the bin target is the bundler's SEA-shared entry point).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const PACKAGE_NAME = '@magnusekdahl/parallix';

let work: string;
let tarball: string;
let globalPrefix: string;
let localPrefix: string;
let installedPackage: string;
let targetDir: string;
let parallixHome: string;

/** Run the installed CLI with a disposable operator home and target directory. */
function px(binary: string, args: string[], options: { cwd?: string } = {}) {
  const result = spawnSync(binary, args, {
    cwd: options.cwd || targetDir,
    encoding: 'utf8',
    // stdin is a pipe and closed: every invocation below is a non-TTY run.
    input: '',
    env: {
      ...process.env,
      PARALLIX_HOME: parallixHome,
      FORCE_COLOR: '0',
      NO_COLOR: '1',
    },
    timeout: 60_000,
  });
  return { status: result.status, stdout: result.stdout || '', stderr: result.stderr || '' };
}

test.before(() => {
  work = fs.mkdtempSync(path.join(os.tmpdir(), 'px-pack-install-'));
  targetDir = path.join(work, 'target');
  parallixHome = path.join(work, 'home');
  fs.mkdirSync(targetDir, { recursive: true });
  fs.mkdirSync(parallixHome, { recursive: true });

  // `npm pack` runs prepack, so this packs a freshly built bundle.
  execFileSync('npm', ['pack', '--pack-destination', work], { cwd: ROOT, encoding: 'utf8' });
  const packed = fs.readdirSync(work).filter(file => file.endsWith('.tgz'));
  assert.equal(packed.length, 1, `expected exactly one tarball, got ${packed.join(', ')}`);
  tarball = path.join(work, packed[0]);

  globalPrefix = path.join(work, 'global-prefix');
  localPrefix = path.join(work, 'local-prefix');
  fs.mkdirSync(localPrefix, { recursive: true });
  execFileSync('npm', ['install', '--global', '--prefix', globalPrefix, tarball, '--no-audit', '--no-fund'],
    { cwd: work, encoding: 'utf8' });
  execFileSync('npm', ['install', '--prefix', localPrefix, tarball, '--no-audit', '--no-fund'],
    { cwd: work, encoding: 'utf8' });
  installedPackage = path.join(globalPrefix, 'lib', 'node_modules', ...PACKAGE_NAME.split('/'));
}, { timeout: 300_000 });

test.after(() => {
  if (work) { fs.rmSync(work, { recursive: true, force: true }); }
});

test('task-2285 install: the tarball contains only the bundle payload and release metadata', () => {
  const entries = fs.readdirSync(installedPackage).sort();
  assert.deepEqual(entries, ['CHANGELOG.md', 'LICENSE', 'NOTICES', 'README.md', 'build', 'package.json']);
  for (const absent of ['dist', 'src', 'test', 'config', 'prompts', 'templates', 'docs', 'examples', 'tools']) {
    assert.equal(fs.existsSync(path.join(installedPackage, absent)), false,
      `${absent}/ must not be published`);
  }
});

test('task-2285 install: SC4 — no node_modules anywhere in the installed package', () => {
  const walk = (dir: string): string[] => fs.readdirSync(dir, { withFileTypes: true })
    .flatMap((entry: any) => (entry.isDirectory()
      ? [path.join(dir, entry.name), ...walk(path.join(dir, entry.name))]
      : []));
  const nested = walk(installedPackage).filter(dir => path.basename(dir) === 'node_modules');
  assert.deepEqual(nested, [], 'the installed package must carry no dependency tree');
  // The optional peer SDK is deliberately not installed, proving the CLI does not
  // need it to run any of the surfaces exercised below.
  assert.equal(
    fs.existsSync(path.join(globalPrefix, 'lib', 'node_modules', '@earendil-works')),
    false,
  );
});

test('task-2285 install: SC3 — px --version reports the bundle as the payload root', () => {
  const result = px(path.join(globalPrefix, 'bin', 'px'), ['--version']);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, new RegExp(`${PACKAGE_NAME.replace('/', '\\/')} \\d+\\.\\d+\\.\\d+`));
  assert.match(result.stdout, /px: .*[/\\]build[/\\]px\.mjs$/m);
  assert.match(result.stdout, /package: .*[/\\]build$/m);
});

test('task-2285 install: SC3 — px --help prints the command surface', () => {
  const result = px(path.join(globalPrefix, 'bin', 'px'), ['--help']);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Usage: px <command> \[args\]/);
  assert.match(result.stdout, /px stats --help/);
});

test('task-2285 install: SC3 — representative headless JSON command emits parseable JSON', () => {
  const result = px(path.join(globalPrefix, 'bin', 'px'), ['config']);
  assert.equal(result.status, 0, result.stderr);
  // `px config` prefixes an [INFO] line; the payload is the JSON document after it.
  const document = result.stdout.slice(result.stdout.indexOf('{'));
  const parsed = JSON.parse(document);
  assert.equal(typeof parsed.product.name, 'string');
  assert.equal(parsed.adapters.tasks.provider, 'backlog-md');
  // A headless command must not initialise the terminal UI.
  assert.doesNotMatch(result.stdout, /\[\?25[lh]/, 'no cursor control on a headless surface');
});

test('task-2285 install: SC3 — embedded assets load from the bundle payload root', () => {
  // `px aliases` reads config/state-map.json through the runtime AssetStore, so a
  // pass proves packageRoot() resolved to build/ inside the installed package.
  const result = px(path.join(globalPrefix, 'bin', 'px'), ['aliases']);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^alias\s+canonical$/m);
  assert.match(result.stdout, /^refined\s+draft$/m);
  const manifest = JSON.parse(fs.readFileSync(path.join(installedPackage, 'build', 'asset-manifest.json'), 'utf8'));
  for (const asset of manifest.assets) {
    assert.ok(fs.existsSync(path.join(installedPackage, 'build', asset.key)),
      `${asset.key} must be installed under build/`);
  }
});

test('task-2285 install: SC3 — explicit TUI falls back cleanly on a non-TTY stdin/stdout', () => {
  const result = px(path.join(globalPrefix, 'bin', 'px'), ['ui']);
  assert.equal(result.status, 0, result.stderr);
});

test('task-2285 install: SC3 — node:sqlite resolves at startup from the installed bundle', () => {
  // esbuild keeps `node:sqlite` as a preserved builtin specifier and hoists it to
  // the top level of the ESM output, so it is loaded on every invocation. A
  // successful `px --version` from the installed prefix is therefore proof that
  // node:sqlite started; a missing or mis-bundled builtin would abort startup.
  const bundle = fs.readFileSync(path.join(installedPackage, 'build', 'px.mjs'), 'utf8');
  const sqliteImport = /^import \{ DatabaseSync \} from "node:sqlite";$/m;
  assert.match(bundle, sqliteImport, 'node:sqlite must remain a top-level builtin import');
  assert.equal(px(path.join(globalPrefix, 'bin', 'px'), ['--version']).status, 0);
});

test('task-2285 install: the local (non-global) install layout runs the same bundle', () => {
  const binary = path.join(localPrefix, 'node_modules', '.bin', 'px');
  assert.ok(fs.existsSync(binary), 'npm must link bin/px in a local install');
  const result = px(binary, ['--version']);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /px: .*[/\\]build[/\\]px\.mjs$/m);
});

test('task-2285 install: SC7 — the installed bin is byte-identical to the built bundle', () => {
  const installedBundle = fs.readFileSync(path.join(installedPackage, 'build', 'px.mjs'));
  const builtBundle = fs.readFileSync(path.join(ROOT, 'build', 'px.mjs'));
  assert.equal(installedBundle.equals(builtBundle), true,
    'the published bin is the same artifact TASK-2286 consumes as SEA input');
  const manifest = JSON.parse(fs.readFileSync(path.join(installedPackage, 'package.json'), 'utf8'));
  assert.equal(manifest.bin.px, 'build/px.mjs');
});

test('task-2285 install: bare `px` on a non-TTY prints help (SC3)', () => {
  // ADR 0044: without a command or interactive TTY, `px` prints normal help.
  // Fixed in src/platform/runtime/px.ts — returns empty command and prints usage
  // before the target-path check.
  const result = px(path.join(globalPrefix, 'bin', 'px'), []);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /Usage|COMMANDS|COMMAND/i);
  // No UI initialisation occurs on a non-TTY.
  assert.doesNotMatch(result.stdout + result.stderr, /\[\?25[lh]/);
});
