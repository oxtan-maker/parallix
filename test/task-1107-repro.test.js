const test = require('node:test');
const assert = require('node:assert/strict');
const { rebaseBeforeReviewRound } = require('../lib/review/review');
const { isMissionArtifact, isWorkflowGeneratedArtifact } = require('../lib/core/mission-utils');

function porcelainZ(entries) {
  return `${entries.join('\0')}\0`;
}

test('isMissionArtifact identifies safe mission artifacts', () => {
  const slug = 'task-1107';
  const year = new Date().getFullYear().toString();
  const rootDir = '/tmp/fake';

  assert.ok(isMissionArtifact(`docs/missions/${year}/${slug}/MISSION.md`, slug, rootDir));
  assert.ok(isMissionArtifact(`backlog/tasks/${slug} - title.md`, slug, rootDir));
  assert.ok(isMissionArtifact(`backlog/completed/${slug} - title.md`, slug, rootDir));
  assert.ok(isMissionArtifact(`backlog/tasks/${slug}.md`, slug, rootDir));
  
  assert.ok(!isMissionArtifact('workflow/lib/review/review.js', slug, rootDir));
  assert.ok(!isMissionArtifact(`docs/missions/${year}/task-9999/MISSION.md`, slug, rootDir));
  assert.ok(!isMissionArtifact(`backlog/tasks/task-9999 - title.md`, slug, rootDir));
  assert.ok(!isMissionArtifact(`backlog/tasks/${slug}.md.bak`, slug, rootDir));
  assert.ok(!isMissionArtifact(`backlog/tasks/${slug} - title.md.swp`, slug, rootDir));
  assert.ok(!isMissionArtifact(`backlog/tasks/${slug} - title.md.orig`, slug, rootDir));
});

test('isWorkflowGeneratedArtifact identifies ignorable workflow runtime state', () => {
  assert.ok(isWorkflowGeneratedArtifact('.workflow/codex-home/.codex/logs_2.sqlite'));
  assert.ok(isWorkflowGeneratedArtifact('.workflow/sessions/task-1-reviewer.json'));
  assert.ok(isWorkflowGeneratedArtifact('.sessions/task-1-reviewer.json'));
  assert.ok(isWorkflowGeneratedArtifact('graphify-out/GRAPH_REPORT.md'));
  assert.ok(isWorkflowGeneratedArtifact('graphify-out'));

  assert.ok(!isWorkflowGeneratedArtifact('workflow/lib/review/review.js'));
  assert.ok(!isWorkflowGeneratedArtifact('backlog/tasks/task-1.md'));
});

test('rebaseBeforeReviewRound auto-commits safe mission artifacts before rebase', async () => {
  const logs = [];
  const gitCalls = [];
  const slug = 'task-1107';
  const year = new Date().getFullYear().toString();

  const result = await rebaseBeforeReviewRound(slug, {
    worktree: '/tmp/worktree',
    isForgejoReviewEnabledFn: () => true,
    gitFn: (args) => {
      gitCalls.push(args);
      if (args.includes('status')) {
        return { status: 0, stdout: porcelainZ([` M docs/missions/${year}/${slug}/MISSION.md`, `?? backlog/tasks/${slug} - title.md`]), stderr: '' };
      }
      return { status: 0, stdout: '', stderr: '' };
    },
    runFn: () => ({ status: 0, stdout: 'success', stderr: '' }),
    log: message => logs.push(message),
    error: message => assert.fail(`Should not have errored: ${message}`)
  });

  assert.deepEqual(result, { ok: true, sharedFileConflicts: false });
  assert.ok(logs.some(m => m.includes('Auto-committing safe mission artifacts')), 'Should log auto-commit start');
  assert.ok(logs.some(m => m.includes('Mission artifacts committed')), 'Should log auto-commit success');
  
  // Verify git calls
  assert.ok(gitCalls.some(args => args.includes('add') && args.includes(`docs/missions/${year}/${slug}/MISSION.md`)));
  assert.ok(gitCalls.some(args => args.includes('add') && args.includes(`backlog/tasks/${slug} - title.md`)));
  assert.ok(gitCalls.some(args => args.includes('commit') && args.includes(`workflow(${slug}): auto-commit mission artifacts before pre-review rebase`)));
});

test('rebaseBeforeReviewRound parses rename, copy, and space paths from porcelain z output', async () => {
  const gitCalls = [];
  const slug = 'task-1107';

  const result = await rebaseBeforeReviewRound(slug, {
    worktree: '/tmp/worktree',
    isForgejoReviewEnabledFn: () => true,
    gitFn: (args) => {
      gitCalls.push(args);
      if (args.includes('status')) {
        return {
          status: 0,
          stdout: porcelainZ([
            `R  docs/missions/2026/${slug}/Renamed File.md`,
            `docs/missions/2026/${slug}/Old File.md`,
            `C  backlog/tasks/${slug} - copied title.md`,
            `backlog/tasks/${slug} - original title.md`,
            ` M docs/missions/2026/${slug}/path with space.md`
          ]),
          stderr: ''
        };
      }
      return { status: 0, stdout: '', stderr: '' };
    },
    runFn: () => ({ status: 0, stdout: 'success', stderr: '' }),
    log: () => {},
    error: message => assert.fail(`Should not have errored: ${message}`)
  });

  assert.deepEqual(result, { ok: true, sharedFileConflicts: false });
  assert.ok(gitCalls.some(args => args.includes('add') && args.includes(`docs/missions/2026/${slug}/Renamed File.md`)));
  assert.ok(gitCalls.some(args => args.includes('add') && args.includes(`backlog/tasks/${slug} - copied title.md`)));
  assert.ok(gitCalls.some(args => args.includes('add') && args.includes(`docs/missions/2026/${slug}/path with space.md`)));
});

test('rebaseBeforeReviewRound refuses rename or copy records with unsafe sources', async () => {
  const errors = [];
  const slug = 'task-1107';

  const result = await rebaseBeforeReviewRound(slug, {
    worktree: '/tmp/worktree',
    isForgejoReviewEnabledFn: () => true,
    gitFn: (args) => {
      if (args.includes('status')) {
        return {
          status: 0,
          stdout: porcelainZ([
            `R  docs/missions/2026/${slug}/MISSION.md`,
            'workflow/lib/review/review.js'
          ]),
          stderr: ''
        };
      }
      return { status: 0, stdout: '', stderr: '' };
    },
    runFn: () => assert.fail('Should not have run rebase'),
    log: () => {},
    error: message => errors.push(message)
  });

  assert.deepEqual(result, { ok: false, sharedFileConflicts: false });
  assert.ok(errors.some(m => m.includes('workflow/lib/review/review.js')), 'Should list the unsafe rename source');
});

test('rebaseBeforeReviewRound refuses to auto-commit when unsafe files are present', async () => {
  const logs = [];
  const errors = [];
  const slug = 'task-1107';

  const result = await rebaseBeforeReviewRound(slug, {
    worktree: '/tmp/worktree',
    isForgejoReviewEnabledFn: () => true,
    gitFn: (args) => {
      if (args.includes('status')) {
        return { status: 0, stdout: porcelainZ([` M docs/missions/2026/${slug}/MISSION.md`, ' M workflow/lib/review/review.js']), stderr: '' };
      }
      return { status: 0, stdout: '', stderr: '' };
    },
    runFn: () => assert.fail('Should not have run rebase'),
    log: message => logs.push(message),
    error: message => errors.push(message)
  });

  assert.deepEqual(result, { ok: false, sharedFileConflicts: false });
  assert.ok(errors.some(m => m.includes('Cannot auto-commit: dirty files include non-mission paths')), 'Should report unsafe files');
  assert.ok(errors.some(m => m.includes('workflow/lib/review/review.js')), 'Should list the unsafe file');
});

test('rebaseBeforeReviewRound ignores workflow-generated runtime state when checking for unsafe files', async () => {
  const slug = 'task-1107';

  const result = await rebaseBeforeReviewRound(slug, {
    worktree: '/tmp/worktree',
    isForgejoReviewEnabledFn: () => true,
    gitFn: (args) => {
      if (args.includes('status')) {
        return {
          status: 0,
          stdout: porcelainZ([
            '?? .workflow/codex-home/.codex/logs_2.sqlite',
            '?? .workflow/codex-home/.npm/cache/index.json',
            `?? .workflow/sessions/${slug}-reviewer.json`,
            '?? graphify-out/GRAPH_REPORT.md'
          ]),
          stderr: ''
        };
      }
      return { status: 0, stdout: '', stderr: '' };
    },
    runFn: () => ({ status: 0, stdout: 'success', stderr: '' }),
    log: () => {},
    error: message => assert.fail(`Should not have errored: ${message}`)
  });

  assert.deepEqual(result, { ok: true, sharedFileConflicts: false });
});

test('rebaseBeforeReviewRound refuses to auto-commit when unmerged conflicts exist', async () => {
  const logs = [];
  const errors = [];
  const slug = 'task-1107';

  const result = await rebaseBeforeReviewRound(slug, {
    worktree: '/tmp/worktree',
    isForgejoReviewEnabledFn: () => true,
    gitFn: (args) => {
      if (args.includes('status')) {
        return { status: 0, stdout: porcelainZ([`UU docs/missions/2026/${slug}/MISSION.md`]), stderr: '' };
      }
      return { status: 0, stdout: '', stderr: '' };
    },
    runFn: () => assert.fail('Should not have run rebase'),
    log: message => logs.push(message),
    error: message => errors.push(message)
  });

  assert.deepEqual(result, { ok: false, sharedFileConflicts: false });
  assert.ok(errors.some(m => m.includes('Cannot auto-commit: unmerged/conflicting files detected')), 'Should report unmerged conflicts');
});

test('rebaseBeforeReviewRound reports shared-file rebase conflicts', async () => {
  const logs = [];
  const errors = [];
  const slug = 'task-1107';

  const result = await rebaseBeforeReviewRound(slug, {
    worktree: '/tmp/worktree',
    isForgejoReviewEnabledFn: () => true,
    gitFn: () => ({ status: 0, stdout: '', stderr: '' }),
    runFn: () => ({
      status: 1,
      stdout: '1 shared file(s) require agent-assisted resolution:\n  - workflow/lib/review/review.js',
      stderr: ''
    }),
    log: message => logs.push(message),
    error: message => errors.push(message)
  });

  assert.deepEqual(result, { ok: false, sharedFileConflicts: true });
  assert.ok(errors.some(m => m.includes('Shared-file rebase conflicts detected')), 'Should report shared-file conflicts');
});

test('rebaseBeforeReviewRound reports missing Forgejo token failure from rebase push', async () => {
  const errors = [];
  const slug = 'task-1107';

  const result = await rebaseBeforeReviewRound(slug, {
    worktree: '/tmp/worktree',
    isForgejoReviewEnabledFn: () => true,
    gitFn: () => ({ status: 0, stdout: '', stderr: '' }),
    runFn: () => ({
      status: 1,
      stdout: '',
      stderr: 'FAIL No Forgejo token found for user "codex". Push failed.'
    }),
    log: () => {},
    error: message => errors.push(message)
  });

  assert.deepEqual(result, { ok: false, sharedFileConflicts: false });
  assert.ok(errors.some(m => m.includes('No Forgejo token found for user "codex"')), 'Should surface missing token failure');
  assert.ok(errors.some(m => m.includes('Rebase failed before launching reviewer')), 'Should keep missing-token failure blocking');
});

test('rebaseBeforeReviewRound reports generic rebase failure', async () => {
  const logs = [];
  const errors = [];
  const slug = 'task-1107';

  const result = await rebaseBeforeReviewRound(slug, {
    worktree: '/tmp/worktree',
    isForgejoReviewEnabledFn: () => true,
    gitFn: () => ({ status: 0, stdout: '', stderr: '' }),
    runFn: () => ({
      status: 1,
      stdout: 'error: failed to push some refs',
      stderr: ''
    }),
    log: message => logs.push(message),
    error: message => errors.push(message)
  });

  assert.deepEqual(result, { ok: false, sharedFileConflicts: false });
  assert.ok(errors.some(m => m.includes('Rebase failed before launching reviewer')), 'Should report generic failure');
});
