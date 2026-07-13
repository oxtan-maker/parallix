const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  findMissionDir,
  findCheckpoints,
  missionTitle,
  detectMissionAreaFromContent,
  findMissionArea,
  missionPathForSlug,
  missionDirForSlug,
  normalizeVerifyArea,
  inferSlug,
  getMissionYear,
} = require('../lib/core/mission-utils');
const git = require('../lib/core/git');

const FAKE_ROOT = '/tmp/mission';

function withTempRepo(fn) {
  const previous = process.cwd();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'workflow-mission-utils-'));
  process.chdir(root);
  fs.writeFileSync(path.join(root, 'workflow.config.json'), JSON.stringify({
    adapters: { missions: { baseDir: 'docs/missions' } },
  }));

  try {
    fn(root);
  } finally {
    process.chdir(previous);
    fs.rmSync(root, { recursive: true, force: true });
  }
}

test('findCheckpoints supports CP-* and CHECKPOINT_* naming', () => {
  withTempRepo(root => {
    const missionDir = path.join(root, 'docs', 'missions', '2026', 'task-081');
    fs.mkdirSync(missionDir, { recursive: true });
    fs.writeFileSync(path.join(missionDir, 'MISSION.md'), '# Mission: Example\n');
    fs.writeFileSync(path.join(missionDir, 'CP-2.md'), '# CP-2\n');
    fs.writeFileSync(path.join(missionDir, 'CHECKPOINT_10.md'), '# CP-10\n');
    fs.writeFileSync(path.join(missionDir, 'CP-1.md'), '# CP-1\n');

    const resolvedDir = findMissionDir('task-081');
    assert.equal(resolvedDir, missionDir);
    assert.deepEqual(
      findCheckpoints(missionDir).map(file => path.basename(file)),
      ['CP-1.md', 'CP-2.md', 'CHECKPOINT_10.md']
    );
    assert.equal(missionTitle('task-081'), 'Example');
  });
});

test('inferSlug identifies slug from explicit arg, current branch, directory name, or worktree', () => {
  const originalBranch = git.getCurrentBranch;
  const originalGit = git.git;
  const originalCwd = process.cwd;

  try {
    // 1. Explicit arg wins
    assert.equal(inferSlug('task-081'), 'task-081');
    assert.equal(inferSlug('TASK-081'), 'task-081');
    assert.equal(inferSlug('adhoc-hello-world'), 'adhoc-hello-world');

    // 2. Inference from mission branch
    git.getCurrentBranch = () => 'mission/task-118';
    // @ts-expect-error TS2554 Expected 1 arguments, but got 0.
    assert.equal(inferSlug(), 'task-118');

    // 3. Inference from non-mission branch falls back to directory
    git.getCurrentBranch = () => 'main';
    process.cwd = () => `/tmp/anyProject-task-119`;
    // @ts-expect-error TS2554 Expected 1 arguments, but got 0.
    assert.equal(inferSlug(), 'task-119');

    git.getCurrentBranch = () => 'main';
    process.cwd = () => `/tmp/anyProject-adhoc-hello-world`;
    // @ts-expect-error TS2554 Expected 1 arguments, but got 0.
    assert.equal(inferSlug(), 'adhoc-hello-world');

    // 4. Inference from worktree registry
    git.getCurrentBranch = () => 'detached';
    process.cwd = () => '/tmp/random-dir';
    // @ts-expect-error TS2322 Type '(args: string[]) => { stdout: string; }' is not assignable to type '(args:
    git.git = (args) => {
      if (args.includes('worktree') && args.includes('list')) {
        return {
          stdout: `worktree ${FAKE_ROOT}\nbranch refs/heads/master\n\nworktree /tmp/random-dir\nbranch refs/heads/mission/task-120\n\n`
        };
      }
      return { stdout: '' };
    };
    // @ts-expect-error TS2554 Expected 1 arguments, but got 0.
    assert.equal(inferSlug(), 'task-120');

    // 5. Mixed case branch
    git.getCurrentBranch = () => 'mission/TASK-099';
    process.cwd = () => FAKE_ROOT;
    // @ts-expect-error TS2554 Expected 1 arguments, but got 0.
    assert.equal(inferSlug(), 'task-099');
  } finally {
    git.getCurrentBranch = originalBranch;
    git.git = originalGit;
    process.cwd = originalCwd;
  }
});

test('detectMissionAreaFromContent uses repo gates deterministically', () => {
  withTempRepo(root => {
    assert.equal(detectMissionAreaFromContent('- [ ] ./scripts/verify-local.sh docs'), 'docs');
    assert.equal(detectMissionAreaFromContent('- [ ] ./scripts/verify-local.sh auth-server'), 'auth');
    assert.equal(detectMissionAreaFromContent('No explicit gate'), 'docs');
    // Generalized beyond ./scripts/verify-local.sh: any relative-path script works.
    assert.equal(detectMissionAreaFromContent('- [ ] ./scripts/ci.sh server'), 'server');
    assert.equal(detectMissionAreaFromContent('- [ ] ../tools/gate.bash web'), 'web');
    assert.equal(detectMissionAreaFromContent('- [ ] ./gate workflow'), 'workflow');
    // Bare-filename prose must NOT be mistaken for a gate invocation (no ./ or ../ prefix).
    assert.equal(detectMissionAreaFromContent('Please make sure the build is green'), 'docs');
    assert.equal(detectMissionAreaFromContent('make sure to run gate.bash web'), 'docs');
    assert.equal(detectMissionAreaFromContent('using bash tooling/gate.bash web'), 'docs');
    // Regression: prose containing ./-prefixed paths must not yield false-positive areas (task-1297)
    assert.equal(detectMissionAreaFromContent('We should run ./scripts/deploy.sh server before merging'), 'docs');
  });
});

test('normalizeVerifyArea preserves supported gates and remaps auth-server', () => {
  assert.equal(normalizeVerifyArea('auth-server'), 'auth');
  assert.equal(normalizeVerifyArea('docs'), 'docs');
  assert.equal(normalizeVerifyArea('workflow'), 'workflow');
  assert.equal(normalizeVerifyArea('web'), 'web');
  assert.equal(normalizeVerifyArea('server'), 'server');
  assert.equal(normalizeVerifyArea('auth'), 'auth');
  assert.equal(normalizeVerifyArea('android'), 'android');
  assert.equal(normalizeVerifyArea('k8s'), 'k8s');
  assert.equal(normalizeVerifyArea('deps'), 'deps');
  assert.equal(normalizeVerifyArea('all'), 'all');
});

test('findMissionDir and getMissionYear handle year rollover and prior-year missions', () => {
  withTempRepo(root => {
    // Current year is 2026 (based on the session context)
    const currentYear = new Date().getFullYear().toString();
    const priorYear = (parseInt(currentYear) - 1).toString();

    const priorYearDir = path.join(root, 'docs', 'missions', priorYear, 'task-prior');
    fs.mkdirSync(priorYearDir, { recursive: true });
    fs.writeFileSync(path.join(priorYearDir, 'MISSION.md'), '# Mission: Prior Year\n');

    // Should find the mission in the prior year
    assert.equal(getMissionYear('task-prior'), priorYear);
    assert.equal(findMissionDir('task-prior'), priorYearDir);

    // New mission should default to current year
    assert.equal(getMissionYear('task-new'), currentYear);

    // Override should be respected
    process.env.MISSION_YEAR_OVERRIDE = '2025';
    assert.equal(getMissionYear('task-any'), '2025');
    delete process.env.MISSION_YEAR_OVERRIDE;
  });
});

test('missionDirForSlug and missionPathForSlug honor configured year-tier mission paths', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'workflow-mission-path-'));
  try {
    fs.writeFileSync(path.join(root, 'workflow.config.json'), JSON.stringify({
      adapters: {
        missions: { baseDir: 'docs/missions' },
      },
    }));

    assert.equal(missionDirForSlug(root, 'task-130'), path.join(root, 'docs', 'missions', new Date().getFullYear().toString(), 'task-130'));
    assert.equal(missionPathForSlug(root, 'task-130'), path.join(root, 'docs', 'missions', new Date().getFullYear().toString(), 'task-130', 'MISSION.md'));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('findMissionArea returns docs when MISSION.md is missing and parses verify gate when present', () => {
  withTempRepo(root => {
    const missionDir = path.join(root, 'docs', 'missions', '2026', 'task-132');
    fs.mkdirSync(missionDir, { recursive: true });
    assert.equal(findMissionArea(missionDir), 'docs');

    fs.writeFileSync(path.join(missionDir, 'MISSION.md'), 'Gate: ./scripts/verify-local.sh workflow\n');
    assert.equal(findMissionArea(missionDir), 'workflow');
  });
});

test('findMissionDir and missionTitle handle null/undefined slug without throwing', () => {
  withTempRepo(root => {
    // findMissionDir(null) should return null, not throw
    const result1 = findMissionDir(null, root);
    assert.equal(result1, null, 'findMissionDir(null) should return null');

    const result2 = findMissionDir(undefined, root);
    assert.equal(result2, null, 'findMissionDir(undefined) should return null');

    // missionTitle(null) should return null, not throw
    const result3 = missionTitle(null);
    assert.equal(result3, null, 'missionTitle(null) should return null');

    const result4 = missionTitle(undefined);
    assert.equal(result4, null, 'missionTitle(undefined) should return null');
  });
});

test('getMissionYear resolves year from a configured non-default baseDir (task-1209 SC1)', () => {
  withTempRepo(root => {
    // Configure a non-default mission baseDir ('missions') with nested year dirs.
    fs.writeFileSync(
      path.join(root, 'workflow.config.json'),
      JSON.stringify({ product: {}, adapters: { missions: { baseDir: 'missions' } } })
    );
    fs.mkdirSync(path.join(root, 'missions', '2026', 'task-xyz'), { recursive: true });

    // The hardcoded `docs/missions` traversal would never find the mission and
    // would fall back to the current year; baseDir-aware resolution returns 2026.
    assert.equal(getMissionYear('task-xyz', root), '2026');
  });
});

test('getMissionYear ignores year dirs under the default path when baseDir is customized (task-1209 SC1)', () => {
  withTempRepo(root => {
    fs.writeFileSync(
      path.join(root, 'workflow.config.json'),
      JSON.stringify({ product: {}, adapters: { missions: { baseDir: 'missions' } } })
    );
    // A decoy mission under the default docs/missions path must not be consulted.
    fs.mkdirSync(path.join(root, 'docs', 'missions', '2024', 'task-xyz'), { recursive: true });
    fs.mkdirSync(path.join(root, 'missions', '2026', 'task-xyz'), { recursive: true });

    assert.equal(getMissionYear('task-xyz', root), '2026');
  });
});

test('getMissionYear handles non-directory baseDir without throwing', () => {
  withTempRepo(root => {
    // Create baseDir as a file instead of a directory
    const baseDir = path.join(root, 'docs', 'missions');
    fs.mkdirSync(path.dirname(baseDir), { recursive: true });
    fs.writeFileSync(baseDir, 'this is a file, not a directory');

    // With the bug, fs.readdirSync throws ENOTDIR when baseDir is a file
    // After fix, it should return current year string
    const year = getMissionYear('task-any', root);
    assert.equal(typeof year, 'string', 'getMissionYear should return a string year');
    assert.ok(/^\d{4}$/.test(year), 'year should be a 4-digit number');
  });
});
