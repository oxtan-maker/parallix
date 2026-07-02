const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

const repoRoot = path.resolve(__dirname, '..');
const pxPath = path.join(repoRoot, 'px.ts');
// Read the version from the manifest so version bumps do not break these tests.
const pkgVersion = require('../package.json').version;
const versionRe = new RegExp(`parallix ${pkgVersion.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`);

function runGit(args, cwd) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  assert.equal(result.status, 0, `${args.join(' ')}\n${result.stderr}${result.stdout}`);
  return result;
}

function makeTargetRepo({ slug = 'task-px-001' } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'px-target-'));
  const year = new Date().getFullYear().toString();
  const missionDir = path.join(root, 'docs', 'missions', year, slug);
  fs.mkdirSync(missionDir, { recursive: true });
  fs.mkdirSync(path.join(root, 'backlog', 'tasks'), { recursive: true });
  fs.mkdirSync(path.join(root, 'scripts'), { recursive: true });

  fs.writeFileSync(path.join(missionDir, 'MISSION.md'), [
    `# Mission: ${slug}`,
    '',
    '## Gates',
    '- [ ] ./scripts/verify-local.sh docs',
    '',
  ].join('\n'));
  fs.writeFileSync(path.join(root, 'backlog', 'tasks', `${slug} - px proof.md`), [
    '---',
    `id: ${slug.toUpperCase()}`,
    'status: active',
    'labels:',
    '  - ai_sdlc',
    '---',
    '',
  ].join('\n'));
  fs.writeFileSync(path.join(root, 'scripts', 'verify-local.sh'), '#!/usr/bin/env bash\nexit 0\n');
  fs.chmodSync(path.join(root, 'scripts', 'verify-local.sh'), 0o755);
  fs.writeFileSync(path.join(root, 'workflow.config.json'), JSON.stringify({
    product: { name: 'Px Target' },
    adapters: {
      tasks: { provider: 'backlog-md', storage: 'backlog' },
      missions: { baseDir: 'docs/missions' },
      verification: { command: './scripts/verify-local.sh {{area}}' },
      review: { provider: 'none' },
      agents: {},
    },
  }, null, 2));

  runGit(['init', '-b', 'main'], root);
  runGit(['config', 'user.email', 'px@example.invalid'], root);
  runGit(['config', 'user.name', 'Px Test'], root);
  runGit(['add', '-A'], root);
  runGit(['commit', '-m', 'initial target repo'], root);

  return { root, slug, year, missionDir };
}

function runPx(args, options = {}) {
  return spawnSync(process.execPath, ['--experimental-strip-types', pxPath, ...args], {
    cwd: options.cwd || repoRoot,
    encoding: 'utf8',
  });
}

function skipIfSandboxBlocked(result) {
  const output = `${result.stdout || ''}${result.stderr || ''}`;
  return Boolean(result.error && result.error.code === 'EPERM' && !output);
}

function stripNodeWarnings(output) {
  return output
    .split('\n')
    .filter(line => !/^\(node:/.test(line) && !/^Reparsing as ES module/.test(line) && !/^To eliminate this warning/.test(line) && !/^\(Use `node --trace-warnings/.test(line))
    .join('\n');
}

test('px verify-env reads repo state from the caller cwd', () => {
  const target = makeTargetRepo();
  try {
    const result = runPx(['verify-env'], { cwd: target.root });
    if (skipIfSandboxBlocked(result)) return;
    const output = stripNodeWarnings(`${result.stdout}${result.stderr}`);

    assert.equal(result.status, 0, output);
    assert.match(output, /Running environment diagnostics/);
    assert.match(output, new RegExp(target.root.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    assert.doesNotMatch(output, new RegExp(repoRoot.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  } finally {
    fs.rmSync(target.root, { recursive: true, force: true });
  }
});

test('px --version reports package version and executing runtime path', () => {
  const caller = fs.mkdtempSync(path.join(os.tmpdir(), 'px-version-cwd-'));
  try {
    const result = runPx(['--version'], { cwd: caller });
    if (skipIfSandboxBlocked(result)) return;
    const output = `${result.stdout}${result.stderr}`;

    assert.equal(result.status, 0, output);
    assert.match(output, versionRe);
    assert.match(output, new RegExp(pxPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    assert.match(output, /package: /);
    assert.match(output, /node: v/);
  } finally {
    fs.rmSync(caller, { recursive: true, force: true });
  }
});

test('px version is equivalent to --version', () => {
  const result = runPx(['version']);
  if (skipIfSandboxBlocked(result)) return;
  const output = `${result.stdout}${result.stderr}`;

  assert.equal(result.status, 0, output);
  assert.match(output, versionRe);
  assert.match(output, /px: /);
});

test('px review-event writes only inside the caller cwd repo mission artifacts', () => {
  const target = makeTargetRepo({ slug: 'task-px-002' });
  try {
    const result = runPx([
      'review-event', target.slug,
      '--type', 'human_note',
      '--actor', 'px-proof',
      '--content', 'px proof content',
      '--timestamp', '2026-01-02T030405',
      '--skip-git',
    ], { cwd: target.root });
    const output = `${result.stdout}${result.stderr}`;

    assert.equal(result.status, 0, output);
    const eventPath = path.join(
      target.missionDir,
      'review-events',
      '2026-01-02T030405-human_note-1-px-proof.md',
    );
    assert.equal(fs.existsSync(eventPath), true);
    assert.match(fs.readFileSync(eventPath, 'utf8'), /px proof content/);

    const sourceTreeMissionDir = path.join(repoRoot, 'docs', 'missions', target.year, target.slug);
    assert.equal(fs.existsSync(sourceTreeMissionDir), false, 'must not write mission artifacts in parallix source tree');
  } finally {
    fs.rmSync(target.root, { recursive: true, force: true });
  }
});

test('px works from a different caller cwd without copying workflow source', () => {
  const target = makeTargetRepo({ slug: 'task-px-003' });
  try {
    const result = runPx([
      'review-event', target.slug,
      '--type', 'human_note',
      '--actor', 'px-proof',
      '--content', 'relative target proof',
      '--timestamp', '2026-01-02T030406',
      '--skip-git',
    ], { cwd: target.root });
    const output = `${result.stdout}${result.stderr}`;

    assert.equal(result.status, 0, output);
    const eventPath = path.join(
      target.missionDir,
      'review-events',
      '2026-01-02T030406-human_note-1-px-proof.md',
    );
    assert.equal(fs.existsSync(eventPath), true);
    assert.match(fs.readFileSync(eventPath, 'utf8'), /relative target proof/);
    assert.equal(fs.existsSync(path.join(target.root, 'parallix')), false);
  } finally {
    fs.rmSync(target.root, { recursive: true, force: true });
  }
});

test('px defaults to the caller cwd when no target option is provided', () => {
  const target = makeTargetRepo({ slug: 'task-px-004' });
  try {
    const result = runPx([
      'review-event', target.slug,
      '--type', 'human_note',
      '--actor', 'px-proof',
      '--content', 'cwd target proof',
      '--timestamp', '2026-01-02T030407',
      '--skip-git',
    ], { cwd: target.root });
    const output = `${result.stdout}${result.stderr}`;

    assert.equal(result.status, 0, output);
    const eventPath = path.join(
      target.missionDir,
      'review-events',
      '2026-01-02T030407-human_note-1-px-proof.md',
    );
    assert.equal(fs.existsSync(eventPath), true);
    assert.match(fs.readFileSync(eventPath, 'utf8'), /cwd target proof/);
  } finally {
    fs.rmSync(target.root, { recursive: true, force: true });
  }
});

test('verify-env exits 0 and prints USABLE verdict on a healthy repo', () => {
  const target = makeTargetRepo({ slug: 'task-px-005' });
  try {
    const result = runPx(['verify-env'], { cwd: target.root });
    if (skipIfSandboxBlocked(result)) return;
    const output = `${result.stdout}${result.stderr}`;

    assert.equal(result.status, 0, output);
    assert.match(output, /Environment verdict: USABLE/);
    assert.match(output, /this repository is ready for workflow commands/);
  } finally {
    fs.rmSync(target.root, { recursive: true, force: true });
  }
});

test('verify-env exits 1 and prints NOT USABLE verdict with remediation on invalid config', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'px-blocked-'));
  const year = new Date().getFullYear().toString();
  const missionDir = path.join(root, 'docs', 'missions', year, 'task-px-006');
  fs.mkdirSync(missionDir, { recursive: true });
  fs.mkdirSync(path.join(root, 'backlog', 'tasks'), { recursive: true });
  fs.mkdirSync(path.join(root, 'scripts'), { recursive: true });

  fs.writeFileSync(path.join(missionDir, 'MISSION.md'), '# Mission: task-px-006\n');
  fs.writeFileSync(path.join(root, 'backlog', 'tasks', 'task-px-006 - proof.md'), [
    '---',
    'id: TASK-PX-006',
    'status: active',
    'labels:',
    '  - ai_sdlc',
    '---',
  ].join('\n'));
  fs.writeFileSync(path.join(root, 'scripts', 'verify-local.sh'), '#!/usr/bin/env bash\nexit 0\n');
  fs.chmodSync(path.join(root, 'scripts', 'verify-local.sh'), 0o755);
  // Write an INVALID workflow.config.json (adapters is a string, not an object)
  fs.writeFileSync(path.join(root, 'workflow.config.json'), JSON.stringify({
    product: { name: 'Blocked Repo' },
    adapters: 'not-an-object',
  }, null, 2));

  runGit(['init', '-b', 'main'], root);
  runGit(['config', 'user.email', 'px@example.invalid'], root);
  runGit(['config', 'user.name', 'Px Test'], root);
  runGit(['add', '-A'], root);
  runGit(['commit', '-m', 'initial target repo'], root);

  try {
    const result = runPx(['verify-env'], { cwd: root });
    if (skipIfSandboxBlocked(result)) return;
    const output = `${result.stdout}${result.stderr}`;

    assert.equal(result.status, 1, `expected exit 1, got ${result.status}: ${output}`);
    assert.match(output, /Environment verdict: NOT USABLE/);
    assert.match(output, /remediation/);
    assert.match(output, /workflow\.config\.json/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
