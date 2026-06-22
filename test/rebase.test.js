const test = require('node:test');
const assert = require('node:assert/strict');
const rebase = require('../lib/commands/rebase');

// ---------------------------------------------------------------------------
// parseConflictFilesFromRebaseOutput
// ---------------------------------------------------------------------------

test('parseConflictFilesFromRebaseOutput parses content conflicts', () => {
  const output = [
    'Auto-merging workflow/lib/commands/rebase.js',
    'CONFLICT (content): Merge conflict in workflow/lib/commands/rebase.js',
    'CONFLICT (content): Merge conflict in docs/missions/2026/task-1018/CP-1.md',
    'Automatic merge failed; fix conflicts and then commit the result.',
  ].join('\n');

  const files = rebase.parseConflictFilesFromRebaseOutput(output);
  assert.deepEqual(files, [
    'workflow/lib/commands/rebase.js',
    'docs/missions/2026/task-1018/CP-1.md',
  ]);
});

test('parseConflictFilesFromRebaseOutput parses localized KONFLIKT conflicts', () => {
  const output = [
    'KONFLIKT (innehåll): Sammanslagningskonflikt i backlog/tasks/task-1018.md',
    'Automatic merge failed; fix conflicts and then commit the result.',
  ].join('\n');

  const files = rebase.parseConflictFilesFromRebaseOutput(output);
  assert.deepEqual(files, ['backlog/tasks/task-1018.md']);
});

test('parseConflictFilesFromRebaseOutput returns empty array when no conflicts', () => {
  const output = 'Already up to date.\n';
  assert.deepEqual(rebase.parseConflictFilesFromRebaseOutput(output), []);
});

test('parseConflictFilesFromRebaseOutput deduplicates repeated conflict lines', () => {
  const output = [
    'CONFLICT (content): Merge conflict in workflow/lib/commands/rebase.js',
    'CONFLICT (content): Merge conflict in workflow/lib/commands/rebase.js',
  ].join('\n');

  assert.deepEqual(
    rebase.parseConflictFilesFromRebaseOutput(output),
    ['workflow/lib/commands/rebase.js']
  );
});

// ---------------------------------------------------------------------------
// buildRebasePrompt
// ---------------------------------------------------------------------------

test('buildRebasePrompt contains mission-specific and shared file sections', () => {
  const prompt = rebase.buildRebasePrompt({
    slug: 'task-1018',
    area: 'workflow',
    worktreePath: '/tmp/visualBoard-task-1018',
    missionSpecificFiles: ['docs/missions/2026/task-1018/CP-1.md'],
    sharedFiles: ['workflow/lib/core/git.js'],
  });

  assert.match(prompt, /rebase/i);
  assert.match(prompt, /task-1018/);
  assert.match(prompt, /--theirs/);
  assert.match(prompt, /git rebase --continue/);
  assert.match(prompt, /no verification gate configured/);
  assert.match(prompt, /px integrate task-1018 --dry-run/);
  assert.match(prompt, /git checkout --theirs "docs\/missions\/2026\/task-1018\/CP-1\.md"/);
  assert.match(prompt, /workflow\/lib\/core\/git\.js/);
});

test('buildRebasePrompt omits mission-specific section when empty', () => {
  const prompt = rebase.buildRebasePrompt({
    slug: 'task-1018',
    area: 'docs',
    worktreePath: '/tmp/wt',
    missionSpecificFiles: [],
    sharedFiles: ['some-file.js'],
  });

  assert.match(prompt, /none — all conflicts are shared files/i);
  assert.match(prompt, /some-file\.js/);
});

// ---------------------------------------------------------------------------
// rebase — CLI control flow
// ---------------------------------------------------------------------------

test('rebase exits 1 when no slug can be inferred', async () => {
  let exitCode = null;
  await rebase([], {
    isForgejoReviewEnabledFn: () => false,
    inferSlugFn: () => null,
    exitFn: code => { exitCode = code; },
  });
  assert.equal(exitCode, 1);
});

test('rebase exits 1 when not on the correct branch', async () => {
  let exitCode = null;
  await rebase(['task-1018'], {
    isForgejoReviewEnabledFn: () => false,
    inferSlugFn: () => 'task-1018',
    getCurrentBranchFn: () => 'feature/foo',
    exitFn: code => { exitCode = code; },
  });
  assert.equal(exitCode, 1);
});

test('rebase exits 0 on clean rebase', async () => {
  let exitCode = null;
  await rebase(['task-1018'], {
    inferSlugFn: () => 'task-1018',
    findMissionDirFn: () => '/tmp/docs/missions/2026/task-1018',
    findMissionAreaFn: () => 'docs',
    getCurrentBranchFn: () => 'mission/task-1018',
    isForgejoReviewEnabledFn: () => true,
    gitFn: args => {
      if (args.includes('branch') && args.includes('--list')) return { status: 0, stdout: 'main\n', stderr: '' };
      if (args.includes('rebase') && args.includes('main')) {
        return { status: 0, stdout: '', stderr: '' };
      }
      if (args[0] === 'rebase' && args[1] === '--show-current') {
        return { status: 0, stdout: '', stderr: '' };
      }
      return { status: 0, stdout: '', stderr: '' };
    },
    exitFn: code => { exitCode = code; },
  });
  assert.equal(exitCode, 0);
});

test('rebase uses local main and does not fetch Forgejo even when review is enabled', async () => {
  let exitCode = null;
  let fetchCalled = false;
  await rebase(['task-1018'], {
    inferSlugFn: () => 'task-1018',
    findMissionDirFn: () => '/tmp/docs/missions/2026/task-1018',
    findMissionAreaFn: () => 'docs',
    getCurrentBranchFn: () => 'mission/task-1018',
    isForgejoReviewEnabledFn: () => true,
    fetchReviewBranchFn: () => {
      fetchCalled = true;
      return { status: 0, stdout: '', stderr: '' };
    },
    gitFn: args => {
      if (args.includes('branch') && args.includes('--list')) return { status: 0, stdout: 'main\n', stderr: '' };
      if (args.includes('rebase') && args.includes('main')) {
        return { status: 0, stdout: '', stderr: '' };
      }
      if (args[0] === 'rebase' && args[1] === '--show-current') {
        return { status: 0, stdout: '', stderr: '' };
      }
      return { status: 0, stdout: '', stderr: '' };
    },
    exitFn: code => { exitCode = code; },
  });
  assert.equal(exitCode, 0);
  assert.equal(fetchCalled, false);
});

test('rebase detects non-conflict rebase failure', async () => {
  let exitCode = null;
  await rebase(['task-1018'], {
    isForgejoReviewEnabledFn: () => false,
    inferSlugFn: () => 'task-1018',
    findMissionDirFn: () => '/tmp/docs/missions/2026/task-1018',
    findMissionAreaFn: () => 'docs',
    getCurrentBranchFn: () => 'mission/task-1018',
    gitFn: args => {
      if (args.includes('branch') && args.includes('--list')) return { status: 0, stdout: 'main\n', stderr: '' };
      if (args[0] === 'fetch') return { status: 0, stdout: '', stderr: '' };
      if (args.includes('rebase') && args.includes('main')) {
        return { status: 128, stdout: 'fatal: not a git repository', stderr: '' };
      }
      return { status: 0, stdout: '', stderr: '' };
    },
    exitFn: code => { exitCode = code; },
  });
  assert.equal(exitCode, 1);
});

test('rebase detects localized KONFLIKT in rebase output', async () => {
  let exitCode = null;
  await rebase(['task-1018'], {
    isForgejoReviewEnabledFn: () => false,
    inferSlugFn: () => 'task-1018',
    findMissionDirFn: () => '/tmp/docs/missions/2026/task-1018',
    findMissionAreaFn: () => 'docs',
    getCurrentBranchFn: () => 'mission/task-1018',
    resolveConflictsFn: () => ({
      ok: true,
      conflictFiles: ['backlog/tasks/task-1018.md'],
      missionSpecificFiles: ['backlog/tasks/task-1018.md'],
      sharedFiles: [],
    }),
    gitFn: args => {
      if (args.includes('branch') && args.includes('--list')) return { status: 0, stdout: 'main\n', stderr: '' };
      if (args[0] === 'fetch') return { status: 0, stdout: '', stderr: '' };
      if (args.includes('rebase') && args.includes('main')) {
        return { status: 1, stdout: '', stderr: 'KONFLIKT (innehåll): Sammanslagningskonflikt i backlog/tasks/task-1018.md\n' };
      }
      return { status: 0, stdout: '', stderr: '' };
    },
    exitFn: code => { exitCode = code; },
  });
  assert.equal(exitCode, 0);
});

// ---------------------------------------------------------------------------
// parseConflictFilesFromGitStatus — all unmerged states
// ---------------------------------------------------------------------------

test('parseConflictFilesFromGitStatus handles UU status', () => {
  const status = 'UU\tbacklog/tasks/task-1018.md\n';
  const files = rebase.parseConflictFilesFromGitStatus('/tmp/worktree', () => ({ status: 0, stdout: status, stderr: '' }));
  assert.deepEqual(files, ['backlog/tasks/task-1018.md']);
});

test('parseConflictFilesFromGitStatus handles DU/UD modify/delete', () => {
  const status = 'DU\tbacklog/tasks/task-1018.md\nUD\tdocs/missions/2026/task-1018/CP-1.md\n';
  const files = rebase.parseConflictFilesFromGitStatus('/tmp/worktree', () => ({ status: 0, stdout: status, stderr: '' }));
  assert.deepEqual(files, ['backlog/tasks/task-1018.md', 'docs/missions/2026/task-1018/CP-1.md']);
});

test('parseConflictFilesFromGitStatus handles AU/UA add/add', () => {
  const status = 'AU\tdocs/missions/2026/task-1018/CP-1.md\nUA\tbacklog/tasks/task-1018.md\n';
  const files = rebase.parseConflictFilesFromGitStatus('/tmp/worktree', () => ({ status: 0, stdout: status, stderr: '' }));
  assert.deepEqual(files, ['docs/missions/2026/task-1018/CP-1.md', 'backlog/tasks/task-1018.md']);
});

test('parseConflictFilesFromGitStatus handles AA add/add', () => {
  const status = 'AA\tbacklog/tasks/task-1018.md\n';
  const files = rebase.parseConflictFilesFromGitStatus('/tmp/worktree', () => ({ status: 0, stdout: status, stderr: '' }));
  assert.deepEqual(files, ['backlog/tasks/task-1018.md']);
});

test('parseConflictFilesFromGitStatus skips non-unmerged statuses', () => {
  const status = 'MM\tworkflow/lib/commands/rebase.js\nUU\tbacklog/tasks/task-1018.md\n';
  const files = rebase.parseConflictFilesFromGitStatus('/tmp/worktree', () => ({ status: 0, stdout: status, stderr: '' }));
  assert.deepEqual(files, ['backlog/tasks/task-1018.md']);
});

test('parseConflictFilesFromGitStatus preserves filenames with spaces', () => {
  const status = 'UU\tbacklog/tasks/task 1018 extra.md\n';
  const files = rebase.parseConflictFilesFromGitStatus('/tmp/worktree', () => ({ status: 0, stdout: status, stderr: '' }));
  assert.deepEqual(files, ['backlog/tasks/task 1018 extra.md']);
});

test('parseConflictFilesFromGitStatus strips quotes from filenames', () => {
  const status = 'UU\t"backlog/tasks/task-1018.md"\n';
  const files = rebase.parseConflictFilesFromGitStatus('/tmp/worktree', () => ({ status: 0, stdout: status, stderr: '' }));
  assert.deepEqual(files, ['backlog/tasks/task-1018.md']);
});

// ---------------------------------------------------------------------------
// parseConflictFilesFromRebaseOutput — filenames with spaces
// ---------------------------------------------------------------------------

test('parseConflictFilesFromRebaseOutput preserves filenames with spaces in generic fallback', () => {
  const output = 'CONFLICT (content): backlog/tasks/task 1018 extra.md: some description\n';
  const files = rebase.parseConflictFilesFromRebaseOutput(output);
  assert.deepEqual(files, ['backlog/tasks/task 1018 extra.md']);
});

test('parseConflictFilesFromRebaseOutput preserves full filename after article words', () => {
  const output = 'CONFLICT: the backlog/tasks/task 1018 extra.md: conflict markers\n';
  const files = rebase.parseConflictFilesFromRebaseOutput(output);
  assert.deepEqual(files, ['the backlog/tasks/task 1018 extra.md']);
});

test('parseConflictFilesFromRebaseOutput strips English modify/delete description', () => {
  const output = 'CONFLICT (content): Merge conflict in backlog/tasks/task 1018 extra.md: deleted by main, modified by HEAD\n';
  const files = rebase.parseConflictFilesFromRebaseOutput(output);
  assert.deepEqual(files, ['backlog/tasks/task 1018 extra.md']);
});

test('parseConflictFilesFromRebaseOutput strips Swedish modify/delete description', () => {
  const output = 'CONFLICT (innehåll): Sammanslagningskonflikt i backlog/tasks/task 1018 extra.md: deleted/raderad av main, modified/ändrad av HEAD\n';
  const files = rebase.parseConflictFilesFromRebaseOutput(output);
  assert.deepEqual(files, ['backlog/tasks/task 1018 extra.md']);
});

test('parseConflictFilesFromRebaseOutput strips Swedish raderad/ändrad description', () => {
  const output = 'CONFLICT (innehåll): Sammanslagningskonflikt i docs/missions/2026/task-1018/CP-1.md: raderad av main, ändrad av HEAD\n';
  const files = rebase.parseConflictFilesFromRebaseOutput(output);
  assert.deepEqual(files, ['docs/missions/2026/task-1018/CP-1.md']);
});

test('parseConflictFilesFromRebaseOutput handles Swedish KONFLIKT (ändra/radera) modify/delete', () => {
  const output = 'KONFLIKT (ändra/radera): backlog/tasks/task 1018 extra.md raderad i fa9599e6 (blaj) och ändrad i HEAD.\n';
  const files = rebase.parseConflictFilesFromRebaseOutput(output);
  assert.deepEqual(files, ['backlog/tasks/task 1018 extra.md']);
});

test('parseConflictFilesFromRebaseOutput handles Swedish KONFLIKT (ändra/radera) without trailing period', () => {
  const output = 'KONFLIKT (ändra/radera): backlog/tasks/task 1018 extra.md raderad i fa9599e6 och ändrad i HEAD\n';
  const files = rebase.parseConflictFilesFromRebaseOutput(output);
  assert.deepEqual(files, ['backlog/tasks/task 1018 extra.md']);
});

test('parseConflictFilesFromRebaseOutput handles Swedish KONFLIKT (ändra/radera) with long filename', () => {
  const output = 'KONFLIKT (ändra/radera): backlog/tasks/task-1015 - message-is-in-wrong-place-an-ugly-on-ios-client.md raderad i fa9599e6 (blaj) och ändrad i HEAD.\n';
  const files = rebase.parseConflictFilesFromRebaseOutput(output);
  assert.deepEqual(files, ['backlog/tasks/task-1015 - message-is-in-wrong-place-an-ugly-on-ios-client.md']);
});

test('parseConflictFilesFromRebaseOutput handles Swedish KONFLIKT (ändra/radera) with trailing Versionen HEAD sentence', () => {
  const output = 'KONFLIKT (ändra/radera): backlog/tasks/task-1015 - message-is-in-wrong-place-an-ugly-on-ios-client.md raderad i fa9599e6 (blaj) och ändrad i HEAD. Versionen HEAD av backlog/tasks/task-1015 - message-is-in-wrong-place-an-ugly-on-ios-client.md lämnad i trädet.\n';
  const files = rebase.parseConflictFilesFromRebaseOutput(output);
  assert.deepEqual(files, ['backlog/tasks/task-1015 - message-is-in-wrong-place-an-ugly-on-ios-client.md']);
});

// ---------------------------------------------------------------------------
// CP-1 (task-1057): Swedish tips: advice lines must not be treated as conflict paths
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// CP-3 (task-1057): Flow-level regression — sharedFiles and prompt must omit tips
// ---------------------------------------------------------------------------

test('rebase task-1057 flow: sharedFiles and prompt contain only workflow/docs/agents.md, not tips', async () => {
  const SWEDISH_REBASE_OUTPUT = [
    'KONFLIKT (ändra/radera): workflow/docs/agents.md raderad i fa9599e6 (Uppdatera agenter) och ändrad i HEAD. Versionen HEAD av workflow/docs/agents.md lämnad i trädet.',
    "tips: 'git add' för att lösa KONFLIKT-markören och kör sedan 'git rebase --continue'",
    "tips: 'git rm' för att ta bort filen (KONFLIKT löses då automatiskt)",
  ].join('\n');

  let capturedPrompt = null;
  let exitCode = null;

  await rebase(['task-1057'], {
    isForgejoReviewEnabledFn: () => false,
    inferSlugFn: () => 'task-1057',
    findMissionDirFn: () => '/tmp/missions/docs/missions/2026/task-1057',
    findMissionAreaFn: () => 'workflow',
    getCurrentBranchFn: () => 'mission/task-1057',
    // merge-failed triggers the git status --porcelain fallback
    resolveConflictsFn: () => ({ ok: false, error: 'merge-failed' }),
    startAgentFn: async (_mode, { prompt }) => {
      capturedPrompt = prompt;
      return { agent: 'test-agent', result: { status: 0 } };
    },
    gitFn: (args) => {
      if (args.includes('branch') && args.includes('--list')) return { status: 0, stdout: 'main\n', stderr: '' };
      if (args[0] === 'fetch') return { status: 0, stdout: '', stderr: '' };
      if (args.includes('rebase') && args.includes('main')) {
        return { status: 1, stdout: '', stderr: SWEDISH_REBASE_OUTPUT };
      }
      // git status --porcelain (direct or via -C <worktreePath>)
      const statusIdx = args.indexOf('status');
      if (statusIdx !== -1 && args[statusIdx + 1] === '--porcelain') {
        return { status: 0, stdout: 'UU\tworkflow/docs/agents.md\n', stderr: '' };
      }
      return { status: 0, stdout: '', stderr: '' };
    },
    exitFn: code => { exitCode = code; },
  });

  assert.ok(capturedPrompt !== null, 'agent should have been launched with a prompt');
  assert.match(capturedPrompt, /workflow\/docs\/agents\.md/);
  assert.ok(
    !capturedPrompt.includes('\n  - tips') && !capturedPrompt.includes('  - tips\n'),
    `prompt must not list 'tips' as a shared file but got:\n${capturedPrompt}`
  );
  assert.equal(exitCode, 0);
});

// ---------------------------------------------------------------------------
// CP-1 (task-1057): Swedish tips: advice lines must not be treated as conflict paths
// ---------------------------------------------------------------------------

test('parseConflictFilesFromRebaseOutput task-1057: does not treat tips advice as conflict path', () => {
  // Captured Swedish rebase output: real conflict in workflow/docs/agents.md,
  // followed by tips: advice lines that themselves mention KONFLIKT.
  const output = [
    'KONFLIKT (ändra/radera): workflow/docs/agents.md raderad i fa9599e6 (Uppdatera agenter) och ändrad i HEAD. Versionen HEAD av workflow/docs/agents.md lämnad i trädet.',
    "tips: 'git add' för att lösa KONFLIKT-markören och kör sedan 'git rebase --continue'",
    "tips: 'git rm' för att ta bort filen (KONFLIKT löses då automatiskt)",
  ].join('\n');

  const files = rebase.parseConflictFilesFromRebaseOutput(output);
  assert.ok(!files.includes('tips'), `files must not include 'tips' but got: ${JSON.stringify(files)}`);
  assert.deepEqual(files, ['workflow/docs/agents.md']);
});

test('parseConflictFilesFromRebaseOutput task-1057: does not treat hint advice as conflict path', () => {
  const output = [
    'CONFLICT (content): Merge conflict in workflow/docs/agents.md',
    'hint: After resolving the CONFLICT, run git rebase --continue',
  ].join('\n');

  const files = rebase.parseConflictFilesFromRebaseOutput(output);
  assert.ok(!files.includes('hint'), `files must not include 'hint' but got: ${JSON.stringify(files)}`);
  assert.deepEqual(files, ['workflow/docs/agents.md']);
});

// ---------------------------------------------------------------------------
// CP-1: Staged/no-conflict continuation (task-1033 failure mode)
// ---------------------------------------------------------------------------

test('rebase detects staged-no-conflict continuation after failed git rebase --continue', async () => {
  let exitCode = null;
  let stdoutLines = [];
  let continueCalls = 0;
  const capturedStdout = [];
  const originalLog = console.log;
  console.log = (...args) => { capturedStdout.push(args.join(' ')); };

  await rebase(['task-1035'], {
    isForgejoReviewEnabledFn: () => false,
    inferSlugFn: () => 'task-1035',
    findMissionDirFn: () => '/tmp/docs/missions/2026/task-1035',
    findMissionAreaFn: () => 'docs',
    getCurrentBranchFn: () => 'mission/task-1035',
    resolveConflictsFn: () => ({
      ok: true,
      conflictFiles: ['docs/missions/2026/task-1035/MISSION.md'],
      missionSpecificFiles: ['docs/missions/2026/task-1035/MISSION.md'],
      sharedFiles: [],
    }),
    gitFn: (args, opts) => {
      if (args.includes('branch') && args.includes('--list')) return { status: 0, stdout: 'main\n', stderr: '' };
      if (args[0] === 'fetch') return { status: 0, stdout: '', stderr: '' };
      if (args.includes('rebase') && args.includes('main')) {
        return { status: 1, stdout: '', stderr: 'CONFLICT (content): Merge conflict in docs/missions/2026/task-1035/MISSION.md\n' };
      }
      if (args[0] === 'checkout' && args[2] === 'docs/missions/2026/task-1035/MISSION.md') {
        return { status: 0, stdout: '', stderr: '' };
      }
      if (args[0] === 'add') return { status: 0, stdout: '', stderr: '' };
      if (args.includes('rebase') && args.includes('--continue')) {
        continueCalls += 1;
        // Fail the first call to trigger the retry path
        if (continueCalls > 1) {
          return { status: 0, stdout: '', stderr: '' };
        }
        return { status: 1, stdout: '', stderr: 'hook declined' };
      }
      if (args[0] === 'status' && args[1] === '--porcelain') {
        // No unresolved conflicts — staged but clean
        return { status: 0, stdout: '', stderr: '' };
      }
      if (args.includes('rebase') && args.includes('--show-current')) {
        // Rebase still in progress
        return { status: 0, stdout: 'mission/task-1035', stderr: '' };
      }
      return { status: 0, stdout: '', stderr: '' };
    },
    exitFn: code => { exitCode = code; },
  });

  console.log = originalLog;
  stdoutLines = capturedStdout;

  // Should have retried --continue (second call) and completed
  assert.equal(exitCode, 0);
  const combined = stdoutLines.join('\n');
  assert.match(combined, /Continuing rebase/i);
  assert.match(combined, /No unresolved conflicts|staged|all conflicts resolved/i);
});

test('rebase detects empty/no-op pick and guides operator', async () => {
  let exitCode = null;
  let stdoutLines = [];
  let continueCalls = 0;
  const capturedStdout = [];
  const originalLog = console.log;
  console.log = (...args) => { capturedStdout.push(args.join(' ')); };

  await rebase(['task-1035'], {
    isForgejoReviewEnabledFn: () => false,
    inferSlugFn: () => 'task-1035',
    findMissionDirFn: () => '/tmp/docs/missions/2026/task-1035',
    findMissionAreaFn: () => 'docs',
    getCurrentBranchFn: () => 'mission/task-1035',
    resolveConflictsFn: () => ({
      ok: true,
      conflictFiles: ['docs/missions/2026/task-1035/MISSION.md'],
      missionSpecificFiles: ['docs/missions/2026/task-1035/MISSION.md'],
      sharedFiles: [],
    }),
    gitFn: (args, opts) => {
      if (args.includes('branch') && args.includes('--list')) return { status: 0, stdout: 'main\n', stderr: '' };
      if (args[0] === 'fetch') return { status: 0, stdout: '', stderr: '' };
      if (args.includes('rebase') && args.includes('main')) {
        return { status: 1, stdout: '', stderr: 'CONFLICT (content): Merge conflict in docs/missions/2026/task-1035/MISSION.md\n' };
      }
      if (args.includes('rebase') && args.includes('--continue')) {
        continueCalls += 1;
        // Empty pick — no changes, just drops the commit
        if (continueCalls > 1) {
          return { status: 0, stdout: '', stderr: '' };
        }
        return { status: 1, stdout: '', stderr: 'Aborting commit; try again' };
      }
      if (args[0] === 'status' && args[1] === '--porcelain') {
        return { status: 0, stdout: '', stderr: '' };
      }
      if (args[0] === 'rebase' && args[1] === '--show-current') {
        return { status: 0, stdout: 'mission/task-1035', stderr: '' };
      }
      return { status: 0, stdout: '', stderr: '' };
    },
    exitFn: code => { exitCode = code; },
  });

  console.log = originalLog;
  stdoutLines = capturedStdout;

  // Should detect empty pick and continue
  assert.equal(exitCode, 0);
  const combined = stdoutLines.join('\n');
  assert.match(combined, /Continuing rebase/i);
});

test('rebase caps failed continue retries when rebase remains active', async () => {
  let exitCode = null;
  const capturedStdout = [];
  const capturedStderr = [];
  const originalLog = console.log;
  const originalError = console.error;
  let continueCalls = 0;
  console.log = (...args) => { capturedStdout.push(args.join(' ')); };
  console.error = (...args) => { capturedStderr.push(args.join(' ')); };

  await rebase(['task-1035'], {
    isForgejoReviewEnabledFn: () => false,
    inferSlugFn: () => 'task-1035',
    findMissionDirFn: () => '/tmp/docs/missions/2026/task-1035',
    findMissionAreaFn: () => 'docs',
    getCurrentBranchFn: () => 'mission/task-1035',
    resolveConflictsFn: () => ({
      ok: true,
      conflictFiles: ['docs/missions/2026/task-1035/MISSION.md'],
      missionSpecificFiles: ['docs/missions/2026/task-1035/MISSION.md'],
      sharedFiles: [],
    }),
    gitFn: (args, opts) => {
      if (args.includes('branch') && args.includes('--list')) return { status: 0, stdout: 'main\n', stderr: '' };
      if (args[0] === 'fetch') return { status: 0, stdout: '', stderr: '' };
      if (args.includes('rebase') && args.includes('main')) {
        return { status: 1, stdout: '', stderr: 'CONFLICT (content): Merge conflict in docs/missions/2026/task-1035/MISSION.md\n' };
      }
      if (args[0] === 'checkout' && args[2] === 'docs/missions/2026/task-1035/MISSION.md') {
        return { status: 0, stdout: '', stderr: '' };
      }
      if (args[0] === 'add') return { status: 0, stdout: '', stderr: '' };
      if (args.includes('rebase') && args.includes('--continue')) {
        continueCalls += 1;
        if (args.includes('core.editor=true')) {
          return { status: 1, stdout: '', stderr: 'hook declined again' };
        }
        return { status: 1, stdout: '', stderr: 'hook declined' };
      }
      if (args[0] === 'status' && args[1] === '--porcelain') {
        return { status: 0, stdout: '', stderr: '' };
      }
      if (args[0] === 'rebase' && args[1] === '--show-current') {
        return { status: 0, stdout: 'mission/task-1035', stderr: '' };
      }
      return { status: 0, stdout: '', stderr: '' };
    },
    exitFn: code => { exitCode = code; },
  });

  console.log = originalLog;
  console.error = originalError;

  assert.equal(continueCalls, 3);
  assert.equal(exitCode, 1);
  assert.match(capturedStderr.join('\n'), /after 3 failed --continue attempt/);
  assert.match(capturedStderr.join('\n'), /git rebase --skip/);
});

test('rebase distinguishes hook failure from genuine conflict after --continue', async () => {
  let exitCode = null;
  let stdoutLines = [];
  let continueCalls = 0;
  const capturedStdout = [];
  const originalLog = console.log;
  console.log = (...args) => { capturedStdout.push(args.join(' ')); };

  await rebase(['task-1035'], {
    isForgejoReviewEnabledFn: () => false,
    inferSlugFn: () => 'task-1035',
    findMissionDirFn: () => '/tmp/docs/missions/2026/task-1035',
    findMissionAreaFn: () => 'docs',
    getCurrentBranchFn: () => 'mission/task-1035',
    resolveConflictsFn: () => ({
      ok: true,
      conflictFiles: ['docs/missions/2026/task-1035/MISSION.md'],
      missionSpecificFiles: ['docs/missions/2026/task-1035/MISSION.md'],
      sharedFiles: [],
    }),
    gitFn: (args, opts) => {
      if (args.includes('branch') && args.includes('--list')) return { status: 0, stdout: 'main\n', stderr: '' };
      if (args[0] === 'fetch') return { status: 0, stdout: '', stderr: '' };
      if (args.includes('rebase') && args.includes('main')) {
        return { status: 1, stdout: '', stderr: 'CONFLICT (content): Merge conflict in docs/missions/2026/task-1035/MISSION.md\n' };
      }
      if (args[0] === 'checkout' && args[2] === 'docs/missions/2026/task-1035/MISSION.md') {
        return { status: 0, stdout: '', stderr: '' };
      }
      if (args[0] === 'add') return { status: 0, stdout: '', stderr: '' };
      if (args.includes('rebase') && args.includes('--continue')) {
        continueCalls += 1;
        // First --continue: hook fails
        if (continueCalls > 1) {
          return { status: 0, stdout: '', stderr: '' };
        }
        return { status: 1, stdout: '', stderr: 'pre-commit hook declined' };
      }
      if (args[0] === 'status' && args[1] === '--porcelain') {
        // No unresolved conflicts
        return { status: 0, stdout: '', stderr: '' };
      }
      if (args[0] === 'rebase' && args[1] === '--show-current') {
        return { status: 0, stdout: 'mission/task-1035', stderr: '' };
      }
      return { status: 0, stdout: '', stderr: '' };
    },
    exitFn: code => { exitCode = code; },
  });

  console.log = originalLog;
  stdoutLines = capturedStdout;

  assert.equal(exitCode, 0);
  const combined = stdoutLines.join('\n');
  // Should show "all conflicts resolved" message after retry succeeds
  assert.match(combined, /Mission-specific conflicts resolved/i);
});
