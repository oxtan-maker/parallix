const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  conventionalWorktreePath,
  resolveWorktree,
  getMissionYear,
  findMissionDir,
  findCheckpoints,
  missionTitle,
  detectMissionAreaFromContent,
  findMissionArea,
  missionPathForSlug,
  missionDirForSlug,
  normalizeVerifyArea,
  inferSlug,
  getPrimaryBranch,
  resolveMainRepo,
  getPrimaryWorktree,
  graphifyAvailable,
  probeGraphifyAvailability,
  updateGraphifyKnowledgeGraph,
  parseConflictFilesFromMergeOutput,
  getConflictFiles,
  findLastNonNoiseCommit,
  squashTrailingBacklogNoiseIntoPreviousMission,
  softResetTrailingBacklogNoise,
  findMissionDocInBranches,
  isMissionArtifact,
  detectLaunchBaseBranch,
  parseBaseBranchLine,
  resolveMissionBaseBranch,
  resolveBaseWorktree,
  conventionalBaseWorktreePath
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

    // 2. Inference from mission branch
    git.getCurrentBranch = () => 'mission/task-118';
    assert.equal(inferSlug(), 'task-118');

    // 3. Inference from non-mission branch falls back to directory
    git.getCurrentBranch = () => 'main';
    process.cwd = () => `/tmp/anyProject-task-119`;
    assert.equal(inferSlug(), 'task-119');

    // 4. Inference from worktree registry
    git.getCurrentBranch = () => 'detached';
    process.cwd = () => '/tmp/random-dir';
    git.git = (args) => {
      if (args.includes('worktree') && args.includes('list')) {
        return {
          stdout: `worktree ${FAKE_ROOT}\nbranch refs/heads/master\n\nworktree /tmp/random-dir\nbranch refs/heads/mission/task-120\n\n`
        };
      }
      return { stdout: '' };
    };
    assert.equal(inferSlug(), 'task-120');

    // 5. Mixed case branch
    git.getCurrentBranch = () => 'mission/TASK-099';
    process.cwd = () => FAKE_ROOT;
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

test('getPrimaryBranch returns main when main branch exists', () => {
  const originalGit = git.git;
  try {
    git.git = (args) => {
      if (args.includes('branch') && args.includes('--list')) return { stdout: 'main\nmaster\n' };
      return { stdout: '' };
    };
    assert.equal(getPrimaryBranch(), 'main');
  } finally {
    git.git = originalGit;
  }
});

test('getPrimaryBranch falls back to master when config says main but only master exists locally', () => {
  const originalGit = git.git;
  withTempRepo(root => {
    fs.mkdirSync(path.join(root, 'workflow'), { recursive: true });
    fs.writeFileSync(path.join(root, 'workflow', 'index.js'), '// stub\n');
    fs.writeFileSync(path.join(root, 'workflow.config.json'), JSON.stringify({
      adapters: {
        missions: { primaryBranch: 'main' }
      }
    }, null, 2));

    try {
      git.git = (args) => {
        if (args.includes('branch') && args.includes('--list')) {
          return { status: 0, stdout: 'master\n', stderr: '' };
        }
        return { status: 0, stdout: '', stderr: '' };
      };
      assert.equal(getPrimaryBranch(root), 'master');
    } finally {
      git.git = originalGit;
    }
  });
});

test('getPrimaryBranch returns master when only master exists', () => {
  const originalGit = git.git;
  try {
    git.git = (args) => {
      if (args.includes('branch') && args.includes('--list')) return { stdout: 'master\n' };
      return { stdout: '' };
    };
    assert.equal(getPrimaryBranch(), 'master');
  } finally {
    git.git = originalGit;
  }
});

test('getPrimaryBranch throws when neither main nor master exists', () => {
  const originalGit = git.git;
  try {
    git.git = () => ({ stdout: '' });
    assert.throws(() => getPrimaryBranch(), /Could not detect primary branch/);
  } finally {
    git.git = originalGit;
  }
});

test('resolveMainRepo finds the master worktree', () => {
  const originalGit = git.git;
  try {
    git.git = (args) => {
      if (args.includes('branch') && args.includes('--list')) {
        return { stdout: 'master\n' };
      }
      if (args.includes('worktree') && args.includes('list')) {
        return {
          stdout: 'worktree /tmp/main\nbranch refs/heads/master\n\nworktree /tmp/mission-task-1\nbranch refs/heads/mission/task-1\n\n'
        };
      }
      return { stdout: '' };
    };
    assert.equal(resolveMainRepo(), '/tmp/main');
    assert.equal(getPrimaryWorktree(), '/tmp/main');
  } finally {
    git.git = originalGit;
  }
});

test('resolveMainRepo honors PRIMARY_WORKTREE override', () => {
  const previous = process.env.PRIMARY_WORKTREE;
  process.env.PRIMARY_WORKTREE = '/tmp/override';
  try {
    assert.equal(resolveMainRepo(), '/tmp/override');
    assert.equal(getPrimaryWorktree(), '/tmp/override');
  } finally {
    if (previous === undefined) delete process.env.PRIMARY_WORKTREE;
    else process.env.PRIMARY_WORKTREE = previous;
  }
});

test('resolveMainRepo falls back to the current checkout when it is already on the primary branch', () => {
  const originalGit = git.git;
  const originalGetCurrentBranch = git.getCurrentBranch;
  const previousPrimary = process.env.PRIMARY_WORKTREE;
  delete process.env.PRIMARY_WORKTREE;

  try {
    git.git = (args) => {
      if (args.includes('branch') && args.includes('--list')) {
        return { status: 0, stdout: 'main\n', stderr: '' };
      }
      if (args.includes('worktree') && args.includes('list')) {
        return {
          status: 0,
          stdout: 'worktree /tmp/mission-task-1\nbranch refs/heads/mission/task-1\n\n',
          stderr: ''
        };
      }
      if (args.includes('rev-parse') && args.includes('--show-toplevel')) {
        return { status: 0, stdout: '/tmp/testproj\n', stderr: '' };
      }
      return { status: 0, stdout: '', stderr: '' };
    };
    git.getCurrentBranch = () => 'main';

    assert.equal(resolveMainRepo(), '/tmp/testproj');
  } finally {
    git.git = originalGit;
    git.getCurrentBranch = originalGetCurrentBranch;
    if (previousPrimary !== undefined) process.env.PRIMARY_WORKTREE = previousPrimary;
  }
});

test('resolveMainRepo falls back to the standalone repo root when branch metadata is not yet readable', () => {
  const originalGit = git.git;
  const originalGetCurrentBranch = git.getCurrentBranch;
  const previousPrimary = process.env.PRIMARY_WORKTREE;
  delete process.env.PRIMARY_WORKTREE;

  withTempRepo(root => {
    fs.mkdirSync(path.join(root, 'workflow'), { recursive: true });
    fs.writeFileSync(path.join(root, 'workflow', 'index.js'), '#!/usr/bin/env node\n');
    fs.writeFileSync(path.join(root, 'workflow.config.json'), '{}\n');

    try {
      git.git = (args) => {
        if (args.includes('branch') && args.includes('--list')) {
          return { status: 0, stdout: 'main\n', stderr: '' };
        }
        if (args.includes('worktree') && args.includes('list')) {
          return {
            status: 0,
            stdout: 'worktree /tmp/mission-task-1\nbranch refs/heads/mission/task-1\n\n',
            stderr: ''
          };
        }
        if (args.includes('rev-parse') && args.includes('--show-toplevel')) {
          return { status: 0, stdout: `${root}\n`, stderr: '' };
        }
        return { status: 0, stdout: '', stderr: '' };
      };
      git.getCurrentBranch = () => '';

      assert.equal(resolveMainRepo(), root);
    } finally {
      git.git = originalGit;
      git.getCurrentBranch = originalGetCurrentBranch;
      if (previousPrimary !== undefined) process.env.PRIMARY_WORKTREE = previousPrimary;
    }
  });
});

test('resolveMainRepo (regression) throws when primary branch worktree is missing and PRIMARY_WORKTREE is unset', () => {
  const originalGit = git.git;
  const previousPrimary = process.env.PRIMARY_WORKTREE;
  delete process.env.PRIMARY_WORKTREE;

  try {
    git.git = (args) => {
      // branch --list: report master exists so getPrimaryBranch succeeds
      if (args.includes('branch') && args.includes('--list')) {
        return { stdout: 'master\n' };
      }
      if (args.includes('worktree') && args.includes('list')) {
        return {
          stdout: 'worktree /tmp/mission-task-1\nbranch refs/heads/mission/task-1\n\n'
        };
      }
      return { stdout: '' };
    };
    assert.throws(() => resolveMainRepo(), /Could not resolve primary repository/);
  } finally {
    git.git = originalGit;
    if (previousPrimary !== undefined) process.env.PRIMARY_WORKTREE = previousPrimary;
  }
});

test('conventionalWorktreePath, missionDirForSlug, and missionPathForSlug derive paths deterministically', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'workflow-flat-mission-path-'));
  try {
    assert.equal(conventionalWorktreePath('task-130', root), `${root}-task-130`);
    assert.equal(missionDirForSlug(root, 'task-130'), path.join(root, 'missions', 'task-130'));
    assert.equal(missionPathForSlug(root, 'task-130'), path.join(root, 'missions', 'task-130', 'MISSION.md'));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
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

test('resolveWorktree prefers live non-prunable matches and falls back to cwd branch detection', () => {
  const worktreeList = [
    'worktree /tmp/prunable-task-130',
    'branch refs/heads/mission/task-130',
    'prunable gitdir file points to non-existent location',
    '',
    'worktree /tmp/live-task-130',
    'branch refs/heads/mission/task-130',
    '',
  ].join('\n');

  const resolved = resolveWorktree('task-130', {
    cwd: '/tmp/live-task-130/subdir',
    gitFn: () => ({ stdout: worktreeList })
  });
  assert.equal(resolved, '/tmp/live-task-130');

  const originalBranch = git.getCurrentBranch;
  try {
    git.getCurrentBranch = cwd => cwd === '/tmp/fallback' ? 'mission/task-131' : 'main';
    const fallback = resolveWorktree('task-131', {
      cwd: '/tmp/fallback',
      gitFn: () => { throw new Error('git unavailable'); }
    });
    assert.equal(fallback, '/tmp/fallback');
  } finally {
    git.getCurrentBranch = originalBranch;
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

test('probeGraphifyAvailability and graphifyAvailable distinguish missing commands from probe failures', () => {
  const missing = probeGraphifyAvailability({
    commandRunner: () => {
      const error = new Error('missing');
      error.code = 'ENOENT';
      throw error;
    }
  });
  assert.equal(missing.available, false);
  assert.equal(missing.reason, 'missing-command');
  assert.equal(graphifyAvailable({ commandRunner: () => ({ status: 0 }) }), true);

  const failure = probeGraphifyAvailability({
    commandRunner: () => {
      throw new Error('permission denied');
    }
  });
  assert.equal(failure.available, false);
  assert.equal(failure.reason, 'probe-failed');
  assert.match(failure.error.message, /permission denied/);
});

test('updateGraphifyKnowledgeGraph logs missing, probe-failed, update-failed, and success outcomes', () => {
  const logs = [];
  const missing = updateGraphifyKnowledgeGraph({
    log: msg => logs.push(msg),
    commandRunner: () => {
      const error = new Error('missing');
      error.code = 'ENOENT';
      throw error;
    }
  });
  assert.deepEqual(missing, { updated: false, skipped: true, reason: 'missing-command' });

  const probeFailure = updateGraphifyKnowledgeGraph({
    log: msg => logs.push(msg),
    commandRunner: () => {
      throw new Error('boom');
    }
  });
  assert.equal(probeFailure.reason, 'probe-failed');

  let calls = [];
  const updateFailure = updateGraphifyKnowledgeGraph({
    rootDir: '/tmp/graph-root',
    log: msg => logs.push(msg),
    commandRunner: (command, args, options) => {
      calls.push({ command, args, options });
      if (args[0] === '--help') return { status: 0 };
      return { status: 3 };
    }
  });
  assert.equal(updateFailure.reason, 'update-failed');
  assert.equal(calls[1].args.join(' '), 'update .');
  assert.equal(calls[1].options.cwd, '/tmp/graph-root');

  const success = updateGraphifyKnowledgeGraph({
    log: msg => logs.push(msg),
    commandRunner: (_command, args) => ({ status: args[0] === '--help' ? 0 : 0 })
  });
  assert.deepEqual(success, { updated: true, skipped: false });
  assert.ok(logs.some(msg => msg.includes('graphify not found')));
  assert.ok(logs.some(msg => msg.includes('graphify probe failed')));
  assert.ok(logs.some(msg => msg.includes('graphify update failed with status 3')));
});

test('parseConflictFilesFromMergeOutput parses content and modify/delete conflicts and deduplicates paths', () => {
  const output = [
    'CONFLICT (content): Merge conflict in workflow/lib/file.js',
    'CONFLICT (modify/delete): docs/missions/2026/task-132/CP-1.md deleted in HEAD.',
    'CONFLICT (content): Merge conflict in workflow/lib/file.js',
  ].join('\n');

  assert.deepEqual(parseConflictFilesFromMergeOutput(output), [
    'workflow/lib/file.js',
    'docs/missions/2026/task-132/CP-1.md'
  ]);
});

test('getConflictFiles returns conflict paths, empty arrays for clean merges, and throws on non-conflict failures', () => {
  const calls = [];
  const conflicts = getConflictFiles('/tmp/worktree', 'main', {
    gitRunner: args => {
      calls.push(args);
      if (args.includes('--abort')) return { status: 0, stdout: '', stderr: '' };
      return {
        status: 1,
        stdout: '',
        stderr: 'CONFLICT (content): Merge conflict in workflow/lib/file.js\n'
      };
    }
  });
  assert.deepEqual(conflicts, ['workflow/lib/file.js']);
  assert.ok(calls.some(args => args.includes('--abort')));

  const clean = getConflictFiles('/tmp/worktree', 'main', {
    gitRunner: args => ({ status: 0, stdout: '', stderr: '' })
  });
  assert.deepEqual(clean, []);

  assert.throws(
    () => getConflictFiles('/tmp/worktree', 'main', {
      gitRunner: args => {
        if (args.includes('--abort')) return { status: 0, stdout: '', stderr: '' };
        return { status: 2, stdout: '', stderr: 'fatal: index.lock' };
      }
    }),
    /no CONFLICT lines/
  );
});

test('findLastNonNoiseCommit skips trailing backlog noise and stops on shared commits', () => {
  const responses = {
    'rev-parse --symbolic-full-name HEAD': 'refs/heads/mission/task-132',
    'rev-parse HEAD': 'sha-head',
    'rev-parse HEAD^': 'sha-prev',
    'branch -a --contains sha-head --format=%(refname)': 'refs/heads/mission/task-132',
    'branch -a --contains sha-prev --format=%(refname)': 'refs/heads/mission/task-132',
    'log -1 --format=%s HEAD': 'Update task TASK-132',
    'log -1 --format=%s HEAD^': 'mission/task-132: real implementation',
    'diff-tree --no-commit-id --name-only -r HEAD': 'backlog/tasks/task-132 - sample.md',
    'diff-tree --no-commit-id --name-only -r HEAD^': 'workflow/lib/core/runtime-matrix.js'
  };
  const runner = args => ({ status: 0, stdout: responses[args.slice(2).join(' ')] || '', stderr: '' });
  assert.equal(findLastNonNoiseCommit('/tmp/worktree', runner), 'HEAD^');

  const sharedRunner = args => {
    if (args.includes('--contains') && args.includes('sha-head')) {
      return { status: 0, stdout: 'refs/heads/mission/task-132\nrefs/remotes/review/mission/task-132\n', stderr: '' };
    }
    return runner(args);
  };
  assert.equal(findLastNonNoiseCommit('/tmp/worktree', sharedRunner), null);
});

test('squashTrailingBacklogNoiseIntoPreviousMission and softResetTrailingBacklogNoise refuse dirty trees and run resets on clean ones', () => {
  const dirtyLogs = [];
  const originalLog = console.log;
  console.log = msg => dirtyLogs.push(msg);
  try {
    const dirtyRunner = args => ({ status: 0, stdout: args.includes('status') ? ' M backlog/tasks/task.md' : '', stderr: '' });
    assert.equal(squashTrailingBacklogNoiseIntoPreviousMission('/tmp/worktree', dirtyRunner), false);
    assert.equal(softResetTrailingBacklogNoise('/tmp/worktree', dirtyRunner), false);
  } finally {
    console.log = originalLog;
  }
  assert.ok(dirtyLogs.some(msg => msg.includes('worktree is not clean')));

  const calls = [];
  const cleanResponses = {
    'status --porcelain': '',
    'rev-parse --symbolic-full-name HEAD': 'refs/heads/mission/task-132',
    'rev-parse HEAD': 'sha-head',
    'rev-parse HEAD^': 'sha-base',
    'branch -a --contains sha-head --format=%(refname)': 'refs/heads/mission/task-132',
    'branch -a --contains sha-base --format=%(refname)': 'refs/heads/mission/task-132',
    'log -1 --format=%s HEAD': 'Update task TASK-132',
    'log -1 --format=%s HEAD^': 'mission/task-132: real implementation',
    'diff-tree --no-commit-id --name-only -r HEAD': 'backlog/tasks/task.md',
    'diff-tree --no-commit-id --name-only -r HEAD^': 'workflow/lib/tools/backlog.js',
    'log -1 --format=%aD sha-base': 'Thu, 07 May 2026 18:00:00 +0200'
  };
  const cleanRunner = args => {
    calls.push(args);
    const key = args.slice(2).join(' ');
    return { status: 0, stdout: cleanResponses[key] || '', stderr: '' };
  };

  assert.equal(squashTrailingBacklogNoiseIntoPreviousMission('/tmp/worktree', cleanRunner), true);
  assert.ok(calls.some(args => args.includes('--soft')));
  assert.ok(calls.some(args => args.includes('--amend')));

  const resetCalls = [];
  const resetRunner = args => {
    resetCalls.push(args);
    const key = args.slice(2).join(' ');
    return { status: 0, stdout: cleanResponses[key] || '', stderr: '' };
  };
  assert.equal(softResetTrailingBacklogNoise('/tmp/worktree', resetRunner), true);
  assert.ok(resetCalls.some(args => args.includes('--soft')));
});

test('findMissionDocInBranches finds mission docs on slug and base-slug branches and ignores branch lookup failures', () => {
  const runner = args => {
    const key = args.slice(2).join(' ');
    if (key === 'branch -a --format=%(refname:short)') {
      return {
        status: 0,
        stdout: 'mission/task-132\nreview/task-132-refresh\nmain\n',
        stderr: ''
      };
    }
    if (args.includes('ls-tree')) {
      const branch = args[4];
      const file = args[5];
      const match = (branch === 'mission/task-132' && file === 'missions/task-132/MISSION.md')
        || (branch === 'review/task-132-refresh' && file === 'missions/task-132/MISSION.md');
      return { status: 0, stdout: match ? file : '', stderr: '' };
    }
    return { status: 0, stdout: '', stderr: '' };
  };

  const candidates = findMissionDocInBranches('task-132-refresh', '/tmp/root', runner);
  assert.deepEqual(candidates, [
    { branch: 'mission/task-132', path: 'missions/task-132/MISSION.md' },
    { branch: 'review/task-132-refresh', path: 'missions/task-132/MISSION.md' }
  ]);

  const empty = findMissionDocInBranches('task-132', '/tmp/root', () => {
    throw new Error('git failed');
  });
  assert.deepEqual(empty, []);
});

// ============================================================
// Bug reproduction tests (task-1202)
// ============================================================

test('isMissionArtifact respects adapter baseDir instead of hardcoded docs/missions', () => {
  withTempRepo(root => {
    // Create a custom adapter config that sets baseDir to 'missions' (without docs/)
    fs.mkdirSync(path.join(root, 'workflow'), { recursive: true });
    fs.writeFileSync(path.join(root, 'workflow', 'index.js'), '// stub\n');
    fs.writeFileSync(path.join(root, 'workflow.config.json'), JSON.stringify({
      adapters: {
        missions: { baseDir: 'missions' }
      }
    }, null, 2));

    // Create a mission file at the flat adapter-resolved default path.
    const missionFile = 'missions/task-133/CP-1.md';
    fs.mkdirSync(path.join(root, 'missions', 'task-133'), { recursive: true });
    fs.writeFileSync(path.join(root, 'missions', 'task-133', 'CP-1.md'), '# CP-1');

    // With the bug, isMissionArtifact uses hardcoded 'docs/missions' and returns false
    // After fix, it should return true because the adapter baseDir is 'missions'
    assert.ok(isMissionArtifact(missionFile, 'task-133', root), 'should identify mission artifact at adapter baseDir path');
  });
});

test('findMissionDocInBranches uses exact slug matching, not substring', () => {
  const runner = args => {
    const key = args.slice(2).join(' ');
    if (key === 'branch -a --format=%(refname:short)') {
      return {
        status: 0,
        stdout: 'mission/task-101\nmission/task-1010\nmain\n',
        stderr: ''
      };
    }
    if (args.includes('ls-tree')) {
      const branch = args[4];
      const file = args[5];
      // Both branches have the task-101 file (simulating a branch that was renamed from task-101 to task-1010 but still has the old file)
      if (
        (branch === 'mission/task-101' && file === 'missions/task-101/MISSION.md') ||
        (branch === 'mission/task-1010' && file === 'missions/task-101/MISSION.md')
      ) {
        return { status: 0, stdout: file, stderr: '' };
      }
      return { status: 1, stdout: '', stderr: '' };
    }
    return { status: 0, stdout: '', stderr: '' };
  };

  // Query for task-101 should NOT match task-1010 branch (exact match only)
  const candidates = findMissionDocInBranches('task-101', '/tmp/root', runner);
  assert.equal(candidates.length, 1, 'should only find exact slug match, not substring match');
  assert.equal(candidates[0].branch, 'mission/task-101');
  assert.equal(candidates[0].path, 'missions/task-101/MISSION.md');
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

// ============================================================
// Feature-branch base-branch detection/resolution (task-1129)
// ============================================================

test('detectLaunchBaseBranch returns the current feature branch', () => {
  const base = detectLaunchBaseBranch('/tmp/repo', {
    gitFn: args => {
      assert.deepEqual(args, ['-C', '/tmp/repo', 'branch', '--show-current']);
      return { status: 0, stdout: 'feat/x\n', stderr: '' };
    }
  });
  assert.equal(base, 'feat/x');
});

test('detectLaunchBaseBranch returns null for a detached HEAD', () => {
  const base = detectLaunchBaseBranch('/tmp/repo', {
    gitFn: () => ({ status: 0, stdout: '\n', stderr: '' })
  });
  assert.equal(base, null);
});

test('detectLaunchBaseBranch refuses to nest a mission on a mission branch', () => {
  assert.throws(
    () => detectLaunchBaseBranch('/tmp/repo', {
      gitFn: () => ({ status: 0, stdout: 'mission/task-200\n', stderr: '' })
    }),
    /mission/
  );
});

test('parseBaseBranchLine extracts the recorded base branch only on an exact line', () => {
  assert.equal(parseBaseBranchLine('# Mission\n\nBase-Branch: feat/x\n'), 'feat/x');
  assert.equal(parseBaseBranchLine('Base-Branch: develop'), 'develop');
  assert.equal(parseBaseBranchLine('# Mission with no base recorded\n'), null);
});

test('resolveMissionBaseBranch returns the recorded base when MISSION.md records one', () => {
  withTempRepo(root => {
    const year = new Date().getFullYear().toString();
    const missionDir = path.join(root, 'docs', 'missions', year, 'task-201');
    fs.mkdirSync(missionDir, { recursive: true });
    fs.writeFileSync(path.join(missionDir, 'MISSION.md'), '# Mission: Example\n\nBase-Branch: develop\n');

    assert.equal(resolveMissionBaseBranch('task-201', root), 'develop');
  });
});

test('resolveMissionBaseBranch falls back to the primary branch when no base is recorded', () => {
  const originalGit = git.git;
  withTempRepo(root => {
    const year = new Date().getFullYear().toString();
    const missionDir = path.join(root, 'docs', 'missions', year, 'task-202');
    fs.mkdirSync(missionDir, { recursive: true });
    fs.writeFileSync(path.join(missionDir, 'MISSION.md'), '# Mission: Legacy mission with no base line\n');

    try {
      git.git = args => {
        if (args.includes('branch') && args.includes('--list')) {
          return { status: 0, stdout: 'main\n', stderr: '' };
        }
        return { status: 0, stdout: '', stderr: '' };
      };
      assert.equal(resolveMissionBaseBranch('task-202', root), 'main');
    } finally {
      git.git = originalGit;
    }
  });
});

test('resolveBaseWorktree delegates to the primary worktree when base equals primary', () => {
  const previousPrimary = process.env.PRIMARY_WORKTREE;
  process.env.PRIMARY_WORKTREE = '/tmp/primary-main';
  withTempRepo(root => {
    const year = new Date().getFullYear().toString();
    const missionDir = path.join(root, 'docs', 'missions', year, 'task-203');
    fs.mkdirSync(missionDir, { recursive: true });
    // No Base-Branch line -> resolves to primary branch.
    fs.writeFileSync(path.join(missionDir, 'MISSION.md'), '# Mission: Primary path\n');

    try {
      const worktree = resolveBaseWorktree('task-203', {
        rootDir: root,
        gitFn: args => {
          if (args.includes('branch') && args.includes('--list')) {
            return { status: 0, stdout: 'main\n', stderr: '' };
          }
          return { status: 0, stdout: '', stderr: '' };
        }
      });
      assert.equal(worktree, '/tmp/primary-main');
    } finally {
      if (previousPrimary === undefined) delete process.env.PRIMARY_WORKTREE;
      else process.env.PRIMARY_WORKTREE = previousPrimary;
    }
  });
});

test('resolveBaseWorktree auto-creates a worktree on the base branch when none is checked out', () => {
  const previousPrimary = process.env.PRIMARY_WORKTREE;
  process.env.PRIMARY_WORKTREE = '/tmp/primary-main';
  withTempRepo(root => {
    const year = new Date().getFullYear().toString();
    const missionDir = path.join(root, 'docs', 'missions', year, 'task-204');
    fs.mkdirSync(missionDir, { recursive: true });
    fs.writeFileSync(path.join(missionDir, 'MISSION.md'), '# Mission: Feature branch\n\nBase-Branch: feat/x\n');

    const calls = [];
    try {
      const worktree = resolveBaseWorktree('task-204', {
        rootDir: root,
        gitFn: args => {
          calls.push(args.join(' '));
          if (args.includes('branch') && args.includes('--list')) {
            return { status: 0, stdout: 'main\n', stderr: '' };
          }
          if (args.includes('worktree') && args.includes('list')) {
            // No worktree on feat/x yet — only the primary.
            return { status: 0, stdout: 'worktree /tmp/primary-main\nbranch refs/heads/main\n\n', stderr: '' };
          }
          if (args.includes('show-ref')) {
            return { status: 0, stdout: '', stderr: '' };
          }
          if (args.includes('worktree') && args.includes('add')) {
            return { status: 0, stdout: '', stderr: '' };
          }
          return { status: 0, stdout: '', stderr: '' };
        }
      });
      const expected = conventionalBaseWorktreePath('feat/x', '/tmp/primary-main');
      assert.equal(worktree, expected);
      assert.ok(calls.some(c => c.includes('worktree add') && c.includes(expected) && c.endsWith('feat/x')));
    } finally {
      if (previousPrimary === undefined) delete process.env.PRIMARY_WORKTREE;
      else process.env.PRIMARY_WORKTREE = previousPrimary;
    }
  });
});

test('resolveBaseWorktree returns an existing worktree already checked out on the base branch', () => {
  const previousPrimary = process.env.PRIMARY_WORKTREE;
  process.env.PRIMARY_WORKTREE = '/tmp/primary-main';
  withTempRepo(root => {
    const year = new Date().getFullYear().toString();
    const missionDir = path.join(root, 'docs', 'missions', year, 'task-205');
    fs.mkdirSync(missionDir, { recursive: true });
    fs.writeFileSync(path.join(missionDir, 'MISSION.md'), '# Mission: Feature branch\n\nBase-Branch: feat/y\n');

    try {
      const worktree = resolveBaseWorktree('task-205', {
        rootDir: root,
        gitFn: args => {
          if (args.includes('branch') && args.includes('--list')) {
            return { status: 0, stdout: 'main\n', stderr: '' };
          }
          if (args.includes('worktree') && args.includes('list')) {
            return {
              status: 0,
              stdout: 'worktree /tmp/primary-main\nbranch refs/heads/main\n\nworktree /tmp/feat-y\nbranch refs/heads/feat/y\n\n',
              stderr: ''
            };
          }
          return { status: 0, stdout: '', stderr: '' };
        }
      });
      assert.equal(worktree, '/tmp/feat-y');
    } finally {
      if (previousPrimary === undefined) delete process.env.PRIMARY_WORKTREE;
      else process.env.PRIMARY_WORKTREE = previousPrimary;
    }
  });
});

test('resolveBaseWorktree fails fast with a base-branch message when the base does not exist locally', () => {
  const previousPrimary = process.env.PRIMARY_WORKTREE;
  process.env.PRIMARY_WORKTREE = '/tmp/primary-main';
  withTempRepo(root => {
    const year = new Date().getFullYear().toString();
    const missionDir = path.join(root, 'docs', 'missions', year, 'task-206');
    fs.mkdirSync(missionDir, { recursive: true });
    fs.writeFileSync(path.join(missionDir, 'MISSION.md'), '# Mission: Missing base\n\nBase-Branch: gone-branch\n');

    try {
      assert.throws(
        () => resolveBaseWorktree('task-206', {
          rootDir: root,
          gitFn: args => {
            if (args.includes('branch') && args.includes('--list')) {
              return { status: 0, stdout: 'main\n', stderr: '' };
            }
            if (args.includes('worktree') && args.includes('list')) {
              return { status: 0, stdout: 'worktree /tmp/primary-main\nbranch refs/heads/main\n\n', stderr: '' };
            }
            if (args.includes('show-ref')) {
              return { status: 1, stdout: '', stderr: '' };
            }
            return { status: 0, stdout: '', stderr: '' };
          }
        }),
        /base branch/
      );
    } finally {
      if (previousPrimary === undefined) delete process.env.PRIMARY_WORKTREE;
      else process.env.PRIMARY_WORKTREE = previousPrimary;
    }
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
