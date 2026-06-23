const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const { findMissionDir, getMissionYear, findCheckpoints, getFirstLine, missionTitle, missionPathForSlug, missionDirForSlug } = require('../lib/core/mission-utils');

// Resolve REPO_ROOT dynamically so the leak-detention test does not reference
// a concrete absolute path that would be operator-local.
const REPO_ROOT = path.resolve(__dirname, '..');

// ============================================================
// CP-2: External-target resolution — proves a command handler
// can resolve target-repository artifacts from a mktemp -d
// directory, not from the parallix source tree.
// ============================================================

/**
 * Creates a temporary directory via mktemp -d (mimicking the
 * runtime-supplied target-repo path parameter that enterprise
 * runners would use). Returns the temp dir path.
 */
function createTempTargetRepo() {
  const tmpRoot = os.tmpdir();
  const d = fs.mkdtempSync(path.join(tmpRoot, 'workflow-cp2-'));
  return d;
}

function setupMiniTargetRepo(tempDir) {
  const year = new Date().getFullYear().toString();
  const slug = 'task-test-999';

  // Create mission directory structure
  const missionDir = path.join(tempDir, 'docs', 'missions', year, slug);
  fs.mkdirSync(missionDir, { recursive: true });
  fs.writeFileSync(path.join(tempDir, 'workflow.config.json'), JSON.stringify({
    adapters: { missions: { baseDir: 'docs/missions' } },
  }));

  // Write a MISSION.md that references target-repo artifacts
  fs.writeFileSync(path.join(missionDir, 'MISSION.md'), [
    '# Mission: External-target resolution test',
    '',
    '## Goal',
    'Prove workflow resolves artifacts from temp dir not from source tree.',
    '',
    '## Gates',
    '- [ ] ./scripts/verify-local.sh docs',
  ].join('\n'));

  // Write a checkpoint doc
  fs.writeFileSync(path.join(missionDir, 'CP-1.md'), '# CP-1: Boundary inventory\n\nThis is a boundary inventory checkpoint.');

  return { tempDir, year, slug, missionDir };
}

test('findMissionDir resolves MISSION.md from a mktemp -d target repo, not from parallix source tree', () => {
  const tempDir = createTempTargetRepo();
  const setup = setupMiniTargetRepo(tempDir);

  try {
    // findMissionDir with an explicit rootDir must resolve within tempDir
    const resolvedDir = findMissionDir('task-test-999', tempDir);
    assert.equal(
      resolvedDir,
      setup.missionDir,
      'findMissionDir must resolve to the temp-dir mission path, not the parallix source tree path'
    );
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('default mission paths are flat under missions/<slug>', () => {
  const tempDir = createTempTargetRepo();
  const slug = 'task-flat-default';
  const expectedDir = path.join(tempDir, 'missions', slug);
  fs.mkdirSync(expectedDir, { recursive: true });
  fs.writeFileSync(path.join(expectedDir, 'MISSION.md'), '# Flat default\n');

  try {
    assert.equal(missionDirForSlug(tempDir, slug), expectedDir);
    assert.equal(missionPathForSlug(tempDir, slug), path.join(expectedDir, 'MISSION.md'));
    assert.equal(findMissionDir(slug, tempDir), expectedDir);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('missionTitle reads the first line from a temp-dir MISSION.md', () => {
  const tempDir = createTempTargetRepo();
  const setup = setupMiniTargetRepo(tempDir);

  try {
    // Set process.cwd to tempDir so that missionTitle (which defaults to process.cwd) resolves from the temp dir
    const previousCwd = process.cwd();
    process.chdir(tempDir);

    try {
      const title = missionTitle('task-test-999');
      assert.equal(title, 'External-target resolution test', 'missionTitle must read first line from temp-dir MISSION.md');
    } finally {
      process.chdir(previousCwd);
    }
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('findCheckpoints discovers CP-1.md from a temp-dir mission directory', () => {
  const tempDir = createTempTargetRepo();
  const setup = setupMiniTargetRepo(tempDir);

  try {
    const cpFiles = setup.missionDir;
    // findCheckpoints takes missionDir directly, not rootDir
    const checkpoints = findCheckpoints(cpFiles);
    assert.ok(checkpoints.length > 0, 'must find at least one checkpoint file in temp-dir mission');
    assert.ok(checkpoints.some(f => f.includes('CP-1.md')), 'must discover CP-1.md from temp-dir');
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('getFirstLine reads from a checkpoint file within the temp-dir mission', () => {
  const tempDir = createTempTargetRepo();
  const setup = setupMiniTargetRepo(tempDir);

  try {
    const checkpointPath = path.join(setup.missionDir, 'CP-1.md');
    const firstLine = getFirstLine(checkpointPath);
    assert.equal(firstLine, 'CP-1: Boundary inventory', 'getFirstLine must read actual content from temp-dir checkpoint file');
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('missionPathForSlug and missionDirForSlug resolve from temp-dir root', () => {
  const tempDir = createTempTargetRepo();
  const setup = setupMiniTargetRepo(tempDir);

  try {
    const year = new Date().getFullYear().toString();
    const slug = 'task-test-999';

    const expectedPath = path.join(tempDir, 'docs', 'missions', year, slug, 'MISSION.md');
    const expectedDir = path.join(tempDir, 'docs', 'missions', year, slug);

    assert.equal(missionPathForSlug(tempDir, slug), expectedPath, 'missionPathForSlug must construct path under tempDir');
    assert.equal(missionDirForSlug(tempDir, slug), expectedDir, 'missionDirForSlug must construct dir under tempDir');

    // Verify the files actually exist at the resolved paths
    assert.ok(fs.existsSync(expectedPath), 'MISSION.md must exist at resolved path');
    assert.ok(fs.existsSync(expectedDir), 'mission dir must exist at resolved path');
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('node parallix mission-start verify-env resolves from a temp dir without reading parallix source tree', () => {
  // Create a temp dir with a minimal git repo + mission structure
  const tempDir = createTempTargetRepo();

  try {
    const year = new Date().getFullYear().toString();
    const slug = 'task-e2e-test';

    const missionDir = path.join(tempDir, 'docs', 'missions', year, slug);
    fs.mkdirSync(missionDir, { recursive: true });
    fs.writeFileSync(path.join(missionDir, 'MISSION.md'), '# Mission: E2E test\n\n## Gates\n- [ ] ./scripts/verify-local.sh docs\n');

    // Initialize git repo in temp dir so ensureStandaloneGitRepo does not create one
    runCommand('git', ['init', '-b', 'main'], { cwd: tempDir });
    runCommand('git', ['config', 'user.email', 'test@test.com'], { cwd: tempDir });
    runCommand('git', ['config', 'user.name', 'Test'], { cwd: tempDir });

    // Create a workflow.config.json so the test focuses on path resolution, not config validation
    fs.writeFileSync(path.join(tempDir, 'workflow.config.json'), JSON.stringify({
      product: { name: 'Test' },
      adapters: {
        tasks: { provider: 'backlog-md', storage: 'backlog' },
        missions: { baseDir: 'docs/missions' },
        verification: { command: './scripts/verify-local.sh {{area}}' },
        review: { provider: 'none' },
        agents: {},
      },
    }, null, 2));

    // Run mission-start verify-env from a temp directory that does NOT contain parallix source tree
    const result = spawnSync(process.execPath, [path.join(__dirname, '..', 'index.js'), 'mission-start', 'verify-env'], {
      cwd: tempDir,
      encoding: 'utf8',
      timeout: 15000,
    });
    const output = `${result.stdout || ''}${result.stderr || ''}`;
    if (result.error && result.error.code === 'EPERM' && !output) {
      return;
    }
    assert.equal(result.status, 0, output);

    // The output contains environment diagnostics — verify it ran, not crashed
    assert.ok(output.includes('PWD'), 'verify-env should report PWD');
    assert.ok(output.includes('Last commit'), 'verify-env should report last commit');

    // CRUCIAL: The output must NOT contain source tree paths
    assert.ok(!output.includes(path.join(REPO_ROOT, 'docs', 'missions')), 'must not leak source-tree mission paths');

    // The temp dir PWD must appear in output
    assert.ok(output.includes(tempDir), 'verify-env PWD must show the temp directory');
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
function runCommand(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    ...options
  });
  if (result.error && !(result.error.code === 'EPERM' && result.status === 0)) {
    throw result.error;
  }
  assert.equal(result.status, 0, `${command} ${args.join(' ')}\n${result.stderr}${result.stdout}`);
  return result.stdout || '';
}
