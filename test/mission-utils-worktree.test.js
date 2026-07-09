const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  conventionalWorktreePath,
  conventionalBaseWorktreePath,
  resolveWorktree,
  missionPathForSlug,
  missionDirForSlug,
  getPrimaryBranch,
  resolveMainRepo,
  getPrimaryWorktree,
  detectLaunchBaseBranch,
  parseBaseBranchLine,
  resolveMissionBaseBranch,
  resolveBaseWorktree,
} = require('../lib/core/mission-utils');
const git = require('../lib/core/git');

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
  process.env.PRIMARY_WORKTREE = `/tmp/override-${process.pid}`;
  try {
    assert.equal(resolveMainRepo(), `/tmp/override-${process.pid}`);
    assert.equal(getPrimaryWorktree(), `/tmp/override-${process.pid}`);
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
  process.env.PRIMARY_WORKTREE = `/tmp/primary-main-${process.pid}`;
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
      assert.equal(worktree, `/tmp/primary-main-${process.pid}`);
    } finally {
      if (previousPrimary === undefined) delete process.env.PRIMARY_WORKTREE;
      else process.env.PRIMARY_WORKTREE = previousPrimary;
    }
  });
});

test('resolveBaseWorktree auto-creates a worktree on the base branch when none is checked out', () => {
  const previousPrimary = process.env.PRIMARY_WORKTREE;
  process.env.PRIMARY_WORKTREE = `/tmp/primary-main-${process.pid}`;
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
            return { status: 0, stdout: `worktree /tmp/primary-main-${process.pid}\nbranch refs/heads/main\n\n`, stderr: '' };
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
      const expected = conventionalBaseWorktreePath('feat/x', `/tmp/primary-main-${process.pid}`);
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
  process.env.PRIMARY_WORKTREE = `/tmp/primary-main-${process.pid}`;
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
              stdout: `worktree /tmp/primary-main-${process.pid}\nbranch refs/heads/main\n\nworktree /tmp/feat-y\nbranch refs/heads/feat/y\n\n`,
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
  process.env.PRIMARY_WORKTREE = `/tmp/primary-main-${process.pid}`;
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
              return { status: 0, stdout: `worktree /tmp/primary-main-${process.pid}\nbranch refs/heads/main\n\n`, stderr: '' };
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
