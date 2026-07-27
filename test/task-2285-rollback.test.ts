// task-2285 — the CommonJS rollback artifact must stay executable (SC8).
//
// The rollback is assembled in a temporary directory rather than by mutating the
// checkout, so it never disturbs a concurrent build or pack. The directory is a
// faithful copy of what the rolled-back package would publish: the emitted
// CommonJS tree, the package-root assets, and the rollback manifest, with
// node_modules symlinked to stand in for the install closure the shape requires.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { ROLLBACK_DEPENDENCIES, main, rollbackManifest } = require('../scripts/rollback-commonjs-package.js');

const ROOT = path.resolve(__dirname, '..');
const esmManifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));

let rolledBack: string;
let targetDir: string;

test.before(() => {
  rolledBack = fs.mkdtempSync(path.join(os.tmpdir(), 'px-rollback-'));
  targetDir = path.join(rolledBack, '..', path.basename(rolledBack) + '-target');
  fs.mkdirSync(targetDir, { recursive: true });

  const manifest = rollbackManifest(esmManifest);
  // prepack would rebuild the bundle; the rollback publishes the already-emitted
  // CommonJS tree, so the copied fixture drops that hook.
  manifest.scripts = { ...manifest.scripts };
  delete manifest.scripts.prepack;
  fs.writeFileSync(path.join(rolledBack, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`);

  for (const entry of ['dist', 'config', 'data', 'prompts', 'templates', 'examples', 'tools']) {
    const source = path.join(ROOT, entry);
    if (fs.existsSync(source)) { fs.cpSync(source, path.join(rolledBack, entry), { recursive: true }); }
  }
  for (const file of ['LICENSE', 'README.md', 'CHANGELOG.md', 'NOTICES']) {
    fs.copyFileSync(path.join(ROOT, file), path.join(rolledBack, file));
  }
  fs.mkdirSync(path.join(rolledBack, 'docs'), { recursive: true });
  fs.copyFileSync(
    path.join(ROOT, 'docs', 'npm-package-major-migration.md'),
    path.join(rolledBack, 'docs', 'npm-package-major-migration.md'),
  );
  // The CommonJS tree resolves ink/react from node_modules instead of inlining
  // them, so the fixture borrows the checkout's install closure.
  fs.symlinkSync(path.join(ROOT, 'node_modules'), path.join(rolledBack, 'node_modules'), 'dir');
}, { timeout: 120_000 });

test.after(() => {
  if (rolledBack) { fs.rmSync(rolledBack, { recursive: true, force: true }); }
  if (targetDir) { fs.rmSync(targetDir, { recursive: true, force: true }); }
});

function rolledBackPx(args: string[]) {
  const result = spawnSync(process.execPath, [path.join(rolledBack, 'dist', 'px.js'), ...args], {
    cwd: targetDir,
    encoding: 'utf8',
    input: '',
    env: { ...process.env, PARALLIX_HOME: targetDir, FORCE_COLOR: '0', NO_COLOR: '1' },
    timeout: 60_000,
  });
  return { status: result.status, stdout: result.stdout || '', stderr: result.stderr || '' };
}

test('task-2285 rollback: the manifest restores the CommonJS entry points', () => {
  const manifest = rollbackManifest(esmManifest);
  assert.equal(manifest.type, 'commonjs');
  assert.equal(manifest.bin.px, 'dist/px.js');
  assert.equal(manifest.main, 'dist/index.js');
  assert.deepEqual(manifest.exports, { '.': './dist/index.js', './package.json': './package.json' });
  // The bundle inlines ink/react; the transpiled CommonJS tree does not, so the
  // rollback must restore a real install closure.
  assert.deepEqual(manifest.dependencies, ROLLBACK_DEPENDENCIES);
  assert.equal(Object.hasOwn(manifest, 'peerDependencies'), false);
  for (const name of Object.keys(ROLLBACK_DEPENDENCIES)) {
    assert.equal(Object.hasOwn(manifest.devDependencies, name), false,
      `${name} must not be declared twice`);
  }
  assert.ok(manifest.files.includes('dist/'));
  assert.ok(manifest.files.includes('config/'), 'assets return to the package root in this shape');
  assert.equal(manifest.files.includes('build/'), false);
});

test('task-2285 rollback: SC8 — source authority is untouched by the rollback', () => {
  // Apply the real procedure to a fixture checkout and prove it rewrites nothing
  // but package.json: the rollback is a package-metadata change, and the emitted
  // CommonJS tree is a build product of the same unchanged sources.
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'px-rollback-src-'));
  try {
    fs.writeFileSync(path.join(fixture, 'package.json'), `${JSON.stringify(esmManifest, null, 2)}\n`);
    fs.mkdirSync(path.join(fixture, 'src', 'entry'), { recursive: true });
    const sourceFile = path.join(fixture, 'src', 'entry', 'px.ts');
    const sourceBefore = fs.readFileSync(path.join(ROOT, 'src', 'entry', 'px.ts'));
    fs.writeFileSync(sourceFile, sourceBefore);

    assert.equal(main(['--apply'], fixture), 0);

    assert.equal(JSON.parse(fs.readFileSync(path.join(fixture, 'package.json'), 'utf8')).bin.px, 'dist/px.js');
    assert.equal(fs.readFileSync(sourceFile).equals(sourceBefore), true, 'src/ must be byte-identical');
    assert.deepEqual(fs.readdirSync(fixture).sort(), ['package.json', 'src'],
      'the rollback must create no other files');
  } finally {
    fs.rmSync(fixture, { recursive: true, force: true });
  }
  assert.equal(fs.existsSync(path.join(rolledBack, 'src')), false,
    'the rollback package ships no source tree either');
});

test('task-2285 rollback: the rolled-back package publishes the CommonJS tree', () => {
  const result = spawnSync('npm', ['pack', '--dry-run', '--json'], {
    cwd: rolledBack, encoding: 'utf8', timeout: 120_000,
  });
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout.slice(result.stdout.search(/^\[\s*$/m)));
  const files = report[0].files.map((entry: any) => entry.path);
  for (const required of ['dist/px.js', 'dist/px.js.map', 'dist/index.js', 'config/state-map.json']) {
    assert.ok(files.includes(required), `${required} must be published by the rollback artifact`);
  }
  assert.equal(files.some((file: string) => file.startsWith('build/')), false,
    'the rollback artifact must not ship the canonical bundle');
  assert.equal(files.some((file: string) => file.startsWith('src/') || file.startsWith('test/')), false);
  assert.equal(files.some((file: string) => file.startsWith('node_modules/')), false);
});

test('task-2285 rollback: the CommonJS bin runs version, help and a headless command', () => {
  const version = rolledBackPx(['--version']);
  assert.equal(version.status, 0, version.stderr);
  assert.match(version.stdout, /@magnusekdahl\/parallix \d+\.\d+\.\d+/);
  assert.match(version.stdout, new RegExp(`px: ${rolledBack.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/dist/px\\.js`));
  // packageRoot() resolves to the package root in this shape, not to build/.
  assert.match(version.stdout, new RegExp(`package: ${rolledBack.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'm'));

  const help = rolledBackPx(['--help']);
  assert.equal(help.status, 0, help.stderr);
  assert.match(help.stdout, /Usage: px <command> \[args\]/);

  const config = rolledBackPx(['config']);
  assert.equal(config.status, 0, config.stderr);
  assert.equal(JSON.parse(config.stdout.slice(config.stdout.indexOf('{'))).adapters.tasks.provider, 'backlog-md');
});

test('task-2285 rollback: package-root assets resolve in the CommonJS layout', () => {
  const aliases = rolledBackPx(['aliases']);
  assert.equal(aliases.status, 0, aliases.stderr);
  assert.match(aliases.stdout, /^refined\s+draft$/m);
  assert.ok(fs.existsSync(path.join(rolledBack, 'config', 'state-map.json')));
  assert.ok(fs.existsSync(path.join(rolledBack, 'prompts', 'review.md')));
  assert.ok(fs.existsSync(path.join(rolledBack, 'templates', 'mission-scaffold.md')));
});

test('task-2285 rollback: the programmatic main entry loads again', () => {
  const probe = spawnSync(
    process.execPath,
    ['-e', `process.exit(typeof require(${JSON.stringify(path.join(rolledBack, 'dist', 'index.js'))}).main === 'function' ? 0 : 1)`],
    { cwd: targetDir, encoding: 'utf8', timeout: 60_000 },
  );
  assert.equal(probe.status, 0, `${probe.stdout}${probe.stderr}`);
});

test('task-2285 rollback: the migration notes document the procedure', () => {
  const notes = fs.readFileSync(path.join(ROOT, 'docs', 'npm-package-major-migration.md'), 'utf8');
  assert.match(notes, /^## Rollback/m);
  assert.match(notes, /scripts\/rollback-commonjs-package\.js/);
  assert.match(notes, /"type": "commonjs"/);
  assert.match(notes, /dist\/px\.js/);
});
