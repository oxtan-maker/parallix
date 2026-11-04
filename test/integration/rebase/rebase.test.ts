

// ---------------------------------------------------------------------------
// Test-local Git argument normalization
// ---------------------------------------------------------------------------
// Production rebase Git invocations are execution-root-aware: since commit
// 6f401e34a each call is prefixed with `-C <executionRoot>` (and the existing
// `-c <key=value>` config pairs) ahead of the Git subcommand. Strip exactly
// those leading global options so a fake can check the Git subcommand at a
// fixed index again, without loose whole-array matching that would also accept
// a malformed command. Returns the tail whose index 0 is the Git subcommand.

import test from 'node:test';
import assert from 'node:assert/strict';
import { mockModule, installModuleMocks } from '../../lib/module-mock.js';
import { autoResolveMissionConflicts } from '../../../src/application/rebase-continuation.js';
import type { RebaseContext } from '../../../src/application/rebase-context.js';
import type { RebaseWorkflowPort } from '../../../src/application/ports/rebase-workflow.js';
const rebaseModule = mockModule<typeof import('../../../src/adapters/cli/commands/rebase.js')>('../../../src/adapters/cli/commands/rebase.js', import.meta.url);
await installModuleMocks();
const rebase = rebaseModule.default;
function gitSubcommandArgs(args: string[]): string[] {
  let i = 0;
  while (i + 1 < args.length && (args[i] === '-C' || args[i] === '-c')) {
    i += 2; // skip the global option and its required value
  }
  return args.slice(i);
}

// ---------------------------------------------------------------------------
// Unmerged index contract
// ---------------------------------------------------------------------------

test('unmerged status paths are independent of localized conflict diagnostics (TASK-2829)', () => {
  const paths = ['workflow/lib/commands/rebase.js', 'docs/missions/2026/task-1018/CP-1.md',
    'backlog/tasks/task-1018.md', 'backlog/tasks/task 1018 extra.md',
    'the backlog/tasks/task 1018 extra.md',
    'backlog/tasks/task-1015 - message-is-in-wrong-place-an-ugly-on-ios-client.md'];
  for (const diagnostic of ['CONFLICT: wrong-path', 'KONFLIKT: wrong-path', 'tips: resolve CONFLICT']) {
    const stdout = [...paths.map((file, index) => `${index % 2 ? 'DU' : 'UU'} ${file}`), `UU ${paths[0]}`].join('\n');
    assert.deepEqual(rebase.parseConflictFilesFromGitStatus('/tmp/worktree', () => ({ status: 0, stdout, stderr: diagnostic })), paths);
    assert.deepEqual(rebase.parseConflictFilesFromGitStatus('/tmp/worktree', () => ({ status: 0, stdout: '', stderr: diagnostic })), []);
  }
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
  assert.match(prompt, /git add "<file>"/);
  assert.match(prompt, /git rebase --continue/);
  assert.match(prompt, /Execute the listed commands now/);
  assert.match(prompt, /no verification gate configured/);
  assert.doesNotMatch(prompt, /px integrate .*--dry-run/);
  assert.match(prompt, /no rebase in progress and no unmerged files/);
  assert.match(prompt, /repository verification above against the final repaired tree/);
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
  let exitCode: { value: number | null } = { value: null };
  await rebase([], {
    isForgejoReviewEnabledFn: () => false,
    inferSlugFn: () => null,
    exitFn: code => { exitCode.value = code; },
  });
  assert.equal(exitCode.value, 1);
});

test('rebase exits 1 when not on the correct branch', async () => {
  let exitCode: { value: number | null } = { value: null };
  await rebase(['task-1018'], {
    isForgejoReviewEnabledFn: () => false,
    inferSlugFn: () => 'task-1018',
    detectRebaseStateFn: () => ({ inProgress: false, detached: false, unmergedFiles: [] }),
    getCurrentBranchFn: () => 'feature/foo',
    exitFn: code => { exitCode.value = code; },
  });
  assert.equal(exitCode.value, 1);
});

test('rebase exits 1 with recovery guidance when a rebase is already in progress', async () => {
  const capturedStdout: string[] = [];
  const capturedStderr: string[] = [];
  const originalLog = console.log;
  const originalError = console.error;
  console.log = (...args) => { capturedStdout.push(args.join(' ')); };
  console.error = (...args) => { capturedStderr.push(args.join(' ')); };

  let exitCode: { value: number | null } = { value: null };
  let attemptedFreshRebase = false;

  try {
    await rebase(['task-1322'], {
      isForgejoReviewEnabledFn: () => false,
      inferSlugFn: () => 'task-1322',
      findMissionDirFn: () => '/tmp/docs/missions/2026/task-1322',
      findMissionAreaFn: () => 'docs',
      detectRebaseStateFn: target => {
        assert.equal(target, process.cwd());
        return {
          inProgress: true,
          detached: true,
          rebaseHead: 'abc123def456',
          unmergedFiles: [
            'backlog/tasks/task-1322 - prevent-backlog-task-id-recycling-collision.md',
            'missions/task-1322/review-state.json',
            'missions/task-1322/CP-4.md'
          ]
        };
      },
      getCurrentBranchFn: () => 'mission/task-1322',
      gitFn: args => {
        if (args.includes('rebase') && args.includes('main')) {
          attemptedFreshRebase = true;
        }
        return { signal: null,  status: 0, stdout: '', stderr: '' };
      },
      exitFn: code => { exitCode.value = code; },
    });
  } finally {
    console.log = originalLog;
    console.error = originalError;
  }

  const output = [...capturedStderr, ...capturedStdout].join('\n');
  assert.equal(exitCode.value, 1);
  assert.equal(attemptedFreshRebase, false);
  assert.match(output, /Rebase already in progress for mission\/task-1322/);
  assert.match(output, /Current rebase head: abc123def456/);
  assert.match(output, /backlog\/tasks\/task-1322 - prevent-backlog-task-id-recycling-collision\.md/);
  assert.match(output, /git rebase --continue/);
  assert.match(output, /git rebase --abort/);
  assert.match(output, /git rebase --skip/);
});

test('rebase exits 0 on clean rebase', async () => {
  let exitCode: { value: number | null } = { value: null };
  await rebase(['task-1018'], {
    inferSlugFn: () => 'task-1018',
    findMissionDirFn: () => '/tmp/docs/missions/2026/task-1018',
    findMissionAreaFn: () => 'docs',
    detectRebaseStateFn: () => ({ inProgress: false, detached: false, unmergedFiles: [] }),
    getCurrentBranchFn: () => 'mission/task-1018',
    isForgejoReviewEnabledFn: () => true,
    gitFn: args => {
      if (args.includes('branch') && args.includes('--list')) return { signal: null,  status: 0, stdout: 'main\n', stderr: '' };
      if (args.includes('rebase') && args.includes('main')) {
        return { signal: null,  status: 0, stdout: '', stderr: '' };
      }
      if (gitSubcommandArgs(args)[0] === 'rebase' && gitSubcommandArgs(args)[1] === '--show-current') {
        return { signal: null,  status: 0, stdout: '', stderr: '' };
      }
      return { signal: null,  status: 0, stdout: '', stderr: '' };
    },
    exitFn: code => { exitCode.value = code; },
  });
  assert.equal(exitCode.value, 0);
});

test('rebase targets the mission recorded base branch, not the primary branch', async () => {
  let exitCode: { value: number | null } = { value: null };
  let rebaseTarget: { value: string | null } = { value: null };
  await rebase(['task-1350'], {
    inferSlugFn: () => 'task-1350',
    findMissionDirFn: () => '/tmp/docs/missions/2026/task-1350',
    findMissionAreaFn: () => 'docs',
    detectRebaseStateFn: () => ({ inProgress: false, detached: false, unmergedFiles: [] }),
    getCurrentBranchFn: () => 'mission/task-1350',
    isForgejoReviewEnabledFn: () => true,
    resolveMissionBaseBranchFn: () => 'skunkworks',
    gitFn: args => {
      const rebaseIdx = args.indexOf('rebase');
      if (rebaseIdx !== -1 && args[rebaseIdx + 1] && !args[rebaseIdx + 1].startsWith('--')) {
        rebaseTarget.value = args[rebaseIdx + 1];
        return { signal: null,  status: 0, stdout: '', stderr: '' };
      }
      if (gitSubcommandArgs(args)[0] === 'rebase' && gitSubcommandArgs(args)[1] === '--show-current') {
        return { signal: null,  status: 0, stdout: '', stderr: '' };
      }
      return { signal: null,  status: 0, stdout: '', stderr: '' };
    },
    exitFn: code => { exitCode.value = code; },
  });
  assert.equal(exitCode.value, 0);
  assert.equal(rebaseTarget.value, 'skunkworks');
});

test('rebase uses local main and does not fetch Forgejo even when review is enabled', async () => {
  let exitCode: { value: number | null } = { value: null };
  let fetchCalled = false;
  await rebase(['task-1018'], {
    inferSlugFn: () => 'task-1018',
    findMissionDirFn: () => '/tmp/docs/missions/2026/task-1018',
    findMissionAreaFn: () => 'docs',
    detectRebaseStateFn: () => ({ inProgress: false, detached: false, unmergedFiles: [] }),
    getCurrentBranchFn: () => 'mission/task-1018',
    isForgejoReviewEnabledFn: () => true,
    fetchReviewBranchFn: () => {
      fetchCalled = true;
      return { signal: null,  status: 0, stdout: '', stderr: '' };
    },
    gitFn: args => {
      if (args.includes('branch') && args.includes('--list')) return { signal: null,  status: 0, stdout: 'main\n', stderr: '' };
      if (args.includes('rebase') && args.includes('main')) {
        return { signal: null,  status: 0, stdout: '', stderr: '' };
      }
      if (gitSubcommandArgs(args)[0] === 'rebase' && gitSubcommandArgs(args)[1] === '--show-current') {
        return { signal: null,  status: 0, stdout: '', stderr: '' };
      }
      return { signal: null,  status: 0, stdout: '', stderr: '' };
    },
    exitFn: code => { exitCode.value = code; },
  });
  assert.equal(exitCode.value, 0);
  assert.equal(fetchCalled, false);
});

test('rebase detects non-conflict rebase failure', async () => {
  let exitCode: { value: number | null } = { value: null };
  await rebase(['task-1018'], {
    isForgejoReviewEnabledFn: () => false,
    inferSlugFn: () => 'task-1018',
    findMissionDirFn: () => '/tmp/docs/missions/2026/task-1018',
    findMissionAreaFn: () => 'docs',
    detectRebaseStateFn: () => ({ inProgress: false, detached: false, unmergedFiles: [] }),
    getCurrentBranchFn: () => 'mission/task-1018',
    gitFn: args => {
      if (args.includes('branch') && args.includes('--list')) return { signal: null,  status: 0, stdout: 'main\n', stderr: '' };
      if (gitSubcommandArgs(args)[0] === 'fetch') return { signal: null,  status: 0, stdout: '', stderr: '' };
      if (args.includes('rebase') && args.includes('main')) {
        return { signal: null,  status: 128, stdout: 'fatal: not a git repository', stderr: '' };
      }
      return { signal: null,  status: 0, stdout: '', stderr: '' };
    },
    exitFn: code => { exitCode.value = code; },
  });
  assert.equal(exitCode.value, 1);
});

test('rebase detects localized KONFLIKT in rebase output', async () => {
  let exitCode: { value: number | null } = { value: null };
  await rebase(['task-1018'], {
    isForgejoReviewEnabledFn: () => false,
    inferSlugFn: () => 'task-1018',
    findMissionDirFn: () => '/tmp/docs/missions/2026/task-1018',
    findMissionAreaFn: () => 'docs',
    detectRebaseStateFn: () => ({ inProgress: false, detached: false, unmergedFiles: [] }),
    getCurrentBranchFn: () => 'mission/task-1018',
    resolveConflictsFn: () => ({
      ok: true as const,
      conflictFiles: ['backlog/tasks/task-1018.md'],
      missionSpecificFiles: ['backlog/tasks/task-1018.md'],
      sharedFiles: [],
    }),
    gitFn: args => {
      if (args.includes('branch') && args.includes('--list')) return { signal: null,  status: 0, stdout: 'main\n', stderr: '' };
      if (gitSubcommandArgs(args)[0] === 'fetch') return { signal: null,  status: 0, stdout: '', stderr: '' };
      if (args.includes('rebase') && args.includes('main')) {
        return { signal: null,  status: 1, stdout: '', stderr: 'KONFLIKT (innehåll): Sammanslagningskonflikt i backlog/tasks/task-1018.md\n', failureReason: { version: 1, code: 'git-conflict', source: 'git' } };
      }
      return { signal: null,  status: 0, stdout: '', stderr: '' };
    },
    exitFn: code => { exitCode.value = code; },
  });
  assert.equal(exitCode.value, 0);
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
// CP-3 (task-1057): Flow-level regression — sharedFiles and prompt must omit tips
// ---------------------------------------------------------------------------

test('rebase task-1057 flow: sharedFiles and prompt contain only workflow/docs/agents.md, not tips', async () => {
  let paused = false;
  let statusRead = false;
  const SWEDISH_REBASE_OUTPUT = [
    'KONFLIKT (ändra/radera): workflow/docs/agents.md raderad i fa9599e6 (Uppdatera agenter) och ändrad i HEAD. Versionen HEAD av workflow/docs/agents.md lämnad i trädet.',
    "tips: 'git add' för att lösa KONFLIKT-markören och kör sedan 'git rebase --continue'",
    "tips: 'git rm' för att ta bort filen (KONFLIKT löses då automatiskt)",
  ].join('\n');

  const capturedPrompt: { value: string | null } = { value: null };
  let exitCode: { value: number | null } = { value: null };

  await rebase(['task-1057'], {
    // Git is injected below; completion probes must use the same isolated state.
    // TASK-2673: a real detector spawned Git twelve times under coverage.
    detectRebaseStateFn: () => ({ inProgress: paused && statusRead, detached: false,
      unmergedFiles: paused && statusRead ? ['workflow/docs/agents.md'] : [] }),
    isForgejoReviewEnabledFn: () => false,
    inferSlugFn: () => 'task-1057',
    findMissionDirFn: () => '/tmp/missions/docs/missions/2026/task-1057',
    findMissionAreaFn: () => 'workflow',
    getCurrentBranchFn: () => 'mission/task-1057',
    resolveTaskFileFn: () => ({ matches: ['/tmp/task-1057.md'],  ok: true as const, taskFile: '/tmp/task-1057.md' }),
    getTaskImplementerFn: () => 'claude',
    // merge-failed triggers the git status --porcelain fallback
    resolveConflictsFn: () => ({ ok: false as const, error: 'merge-failed', conflictFiles: [], missionSpecificFiles: [], sharedFiles: [] }),
    startAgentFn: async (_mode, { prompt }) => {
      assert.equal(typeof prompt, 'string');
      assert.ok(typeof prompt === 'string');
      capturedPrompt.value = prompt;
      paused = false;
      return { agent: 'test-agent', result: { status: 0 } };
    },
    gitFn: (args) => {
      if (args.includes('branch') && args.includes('--list')) return { signal: null,  status: 0, stdout: 'main\n', stderr: '' };
      if (gitSubcommandArgs(args)[0] === 'fetch') return { signal: null,  status: 0, stdout: '', stderr: '' };
      if (args.includes('rebase') && args.includes('main')) {
        paused = true;
        return { signal: null,  status: 1, stdout: '', stderr: SWEDISH_REBASE_OUTPUT, failureReason: { version: 1, code: 'git-conflict', source: 'git' } };
      }
      // git status --porcelain (direct or via -C <worktreePath>)
      const statusIdx = args.indexOf('status');
      if (statusIdx !== -1 && args[statusIdx + 1] === '--porcelain') {
        statusRead = true;
        return { signal: null,  status: 0, stdout: 'UU\tworkflow/docs/agents.md\n', stderr: '' };
      }
      return { signal: null,  status: 0, stdout: '', stderr: '' };
    },
    exitFn: code => { exitCode.value = code; },
  });

  assert.ok(capturedPrompt.value !== null, 'agent should have been launched with a prompt');
  assert.match(capturedPrompt.value, /workflow\/docs\/agents\.md/);
  assert.ok(
    !capturedPrompt.value.includes('\n  - tips') && !capturedPrompt.value.includes('  - tips\n'),
    `prompt must not list 'tips' as a shared file but got:\n${capturedPrompt.value}`
  );
  assert.equal(exitCode.value, 0);
});

test('unmerged status task-1057: does not treat tips advice as conflict path', () => {
  // Captured Swedish rebase output: real conflict in workflow/docs/agents.md,
  // followed by tips: advice lines that themselves mention KONFLIKT.
  const output = [
    'KONFLIKT (ändra/radera): workflow/docs/agents.md raderad i fa9599e6 (Uppdatera agenter) och ändrad i HEAD. Versionen HEAD av workflow/docs/agents.md lämnad i trädet.',
    "tips: 'git add' för att lösa KONFLIKT-markören och kör sedan 'git rebase --continue'",
    "tips: 'git rm' för att ta bort filen (KONFLIKT löses då automatiskt)",
  ].join('\n');

  const files = rebase.parseConflictFilesFromGitStatus('/tmp/worktree', () => ({ status: 0, stdout: 'UU workflow/docs/agents.md\n', stderr: output }));
  assert.ok(!files.includes('tips'), `files must not include 'tips' but got: ${JSON.stringify(files)}`);
  assert.deepEqual(files, ['workflow/docs/agents.md']);
});

test('unmerged status task-1057: does not treat hint advice as conflict path', () => {
  const output = [
    'CONFLICT (content): Merge conflict in workflow/docs/agents.md',
    'hint: After resolving the CONFLICT, run git rebase --continue',
  ].join('\n');

  const files = rebase.parseConflictFilesFromGitStatus('/tmp/worktree', () => ({ status: 0, stdout: 'UU workflow/docs/agents.md\n', stderr: output }));
  assert.ok(!files.includes('hint'), `files must not include 'hint' but got: ${JSON.stringify(files)}`);
  assert.deepEqual(files, ['workflow/docs/agents.md']);
});

// ---------------------------------------------------------------------------
// CP-1: Staged/no-conflict continuation (task-1033 failure mode)
// ---------------------------------------------------------------------------

test('rebase detects staged-no-conflict continuation after failed git rebase --continue', async () => {
  const exitCode: { value: number | null } = { value: null };
  let continueCalls = 0;
  const capturedStdout: string[] = [];
  const originalLog = console.log;
  console.log = (...args) => { capturedStdout.push(args.join(' ')); };
  const gitFn = (args: string[]) => {
    const command = gitSubcommandArgs(args);
    if (command[0] === 'checkout' || command[0] === 'add' || command[0] === 'status') {
      return { status: 0, stdout: '', stderr: '' };
    }
    if (command[0] === 'rebase' && command[1] === '--continue') {
      continueCalls += 1;
      return continueCalls === 1
        ? { status: 1, stdout: '', stderr: 'hook declined' }
        : { status: 0, stdout: '', stderr: '' };
    }
    return { status: 0, stdout: '', stderr: '' };
  };
  const port = {
    detectRebaseState: () => ({ inProgress: continueCalls === 1, unmergedFiles: [] }),
    getCurrentBranch: () => 'mission/task-1035',
    exit: (code: number) => { exitCode.value = code; },
  } as unknown as RebaseWorkflowPort;
  const context = {
    args: ['task-1035'], port, gitFn, slug: 'task-1035', branch: 'mission/task-1035', area: 'docs',
    executionRoot: '/tmp/worktree', baseBranch: 'main', isPush: false, recordedImplementer: null, movedFrom: null,
  } satisfies RebaseContext;
  let outcome;
  try {
    outcome = await autoResolveMissionConflicts(context, {
      ok: true,
      conflictFiles: ['docs/missions/2026/task-1035/MISSION.md'],
      missionSpecificFiles: ['docs/missions/2026/task-1035/MISSION.md'],
      sharedFiles: [],
    });
  } finally {
    console.log = originalLog;
  }

  // Should have retried --continue (second call) and completed
  assert.equal(outcome, 'completed');
  assert.equal(exitCode.value, null);
  assert.equal(continueCalls, 2);
  const combined = capturedStdout.join('\n');
  assert.match(combined, /Continuing rebase/i);
  assert.match(combined, /No unresolved conflicts|staged|all conflicts resolved/i);
});

test('rebase detects empty/no-op pick and guides operator', async () => {
  let exitCode: { value: number | null } = { value: null };
  let stdoutLines = [];
  let continueCalls = 0;
  const capturedStdout: string[] = [];
  const originalLog = console.log;
  console.log = (...args) => { capturedStdout.push(args.join(' ')); };

  await rebase(['task-1035'], {
    // This fixture finishes on the second --continue; do not probe the host repo.
    detectRebaseStateFn: () => ({ inProgress: continueCalls === 1, detached: false, unmergedFiles: [] }),
    isForgejoReviewEnabledFn: () => false,
    inferSlugFn: () => 'task-1035',
    findMissionDirFn: () => '/tmp/docs/missions/2026/task-1035',
    findMissionAreaFn: () => 'docs',
    getCurrentBranchFn: () => 'mission/task-1035',
    resolveConflictsFn: () => ({
      ok: true as const,
      conflictFiles: ['docs/missions/2026/task-1035/MISSION.md'],
      missionSpecificFiles: ['docs/missions/2026/task-1035/MISSION.md'],
      sharedFiles: [],
    }),
    gitFn: (args, opts) => {
      if (args.includes('branch') && args.includes('--list')) return { signal: null,  status: 0, stdout: 'main\n', stderr: '' };
      if (gitSubcommandArgs(args)[0] === 'fetch') return { signal: null,  status: 0, stdout: '', stderr: '' };
      if (args.includes('rebase') && args.includes('main')) {
        return { signal: null,  status: 1, stdout: '', stderr: 'CONFLICT (content): Merge conflict in docs/missions/2026/task-1035/MISSION.md\n', failureReason: { version: 1, code: 'git-conflict', source: 'git' } };
      }
      if (args.includes('rebase') && args.includes('--continue')) {
        continueCalls += 1;
        // Empty pick — no changes, just drops the commit
        if (continueCalls > 1) {
          return { signal: null,  status: 0, stdout: '', stderr: '' };
        }
        return { signal: null,  status: 1, stdout: '', stderr: 'Aborting commit; try again' };
      }
      if (gitSubcommandArgs(args)[0] === 'status' && gitSubcommandArgs(args)[1] === '--porcelain') {
        return { signal: null,  status: 0, stdout: '', stderr: '' };
      }
      if (gitSubcommandArgs(args)[0] === 'rebase' && gitSubcommandArgs(args)[1] === '--show-current') {
        return { signal: null,  status: 0, stdout: 'mission/task-1035', stderr: '' };
      }
      return { signal: null,  status: 0, stdout: '', stderr: '' };
    },
    exitFn: code => { exitCode.value = code; },
  });

  console.log = originalLog;
  stdoutLines = capturedStdout;

  // Should detect empty pick and continue
  assert.equal(exitCode.value, 0);
  const combined = stdoutLines.join('\n');
  assert.match(combined, /Continuing rebase/i);
});

test('rebase distinguishes hook failure from genuine conflict after --continue', async () => {
  let exitCode: { value: number | null } = { value: null };
  let stdoutLines = [];
  let continueCalls = 0;
  const capturedStdout: string[] = [];
  const originalLog = console.log;
  console.log = (...args) => { capturedStdout.push(args.join(' ')); };

  await rebase(['task-1035'], {
    // This fixture finishes on the second --continue; do not probe the host repo.
    detectRebaseStateFn: () => ({ inProgress: continueCalls === 1, detached: false, unmergedFiles: [] }),
    isForgejoReviewEnabledFn: () => false,
    inferSlugFn: () => 'task-1035',
    findMissionDirFn: () => '/tmp/docs/missions/2026/task-1035',
    findMissionAreaFn: () => 'docs',
    getCurrentBranchFn: () => 'mission/task-1035',
    resolveConflictsFn: () => ({
      ok: true as const,
      conflictFiles: ['docs/missions/2026/task-1035/MISSION.md'],
      missionSpecificFiles: ['docs/missions/2026/task-1035/MISSION.md'],
      sharedFiles: [],
    }),
    gitFn: (args, opts) => {
      if (args.includes('branch') && args.includes('--list')) return { signal: null,  status: 0, stdout: 'main\n', stderr: '' };
      if (gitSubcommandArgs(args)[0] === 'fetch') return { signal: null,  status: 0, stdout: '', stderr: '' };
      if (args.includes('rebase') && args.includes('main')) {
        return { signal: null,  status: 1, stdout: '', stderr: 'CONFLICT (content): Merge conflict in docs/missions/2026/task-1035/MISSION.md\n', failureReason: { version: 1, code: 'git-conflict', source: 'git' } };
      }
      if (gitSubcommandArgs(args)[0] === 'checkout' && gitSubcommandArgs(args)[2] === 'docs/missions/2026/task-1035/MISSION.md') {
        return { signal: null,  status: 0, stdout: '', stderr: '' };
      }
      if (gitSubcommandArgs(args)[0] === 'add') return { signal: null,  status: 0, stdout: '', stderr: '' };
      if (args.includes('rebase') && args.includes('--continue')) {
        continueCalls += 1;
        // First --continue: hook fails
        if (continueCalls > 1) {
          return { signal: null,  status: 0, stdout: '', stderr: '' };
        }
        return { signal: null,  status: 1, stdout: '', stderr: 'pre-commit hook declined', failureReason: { version: 1, code: 'git-hook-failed', source: 'git', context: { hook: 'pre-commit' } } };
      }
      if (gitSubcommandArgs(args)[0] === 'status' && gitSubcommandArgs(args)[1] === '--porcelain') {
        // No unresolved conflicts
        return { signal: null,  status: 0, stdout: '', stderr: '' };
      }
      if (gitSubcommandArgs(args)[0] === 'rebase' && gitSubcommandArgs(args)[1] === '--show-current') {
        return { signal: null,  status: 0, stdout: 'mission/task-1035', stderr: '' };
      }
      return { signal: null,  status: 0, stdout: '', stderr: '' };
    },
    exitFn: code => { exitCode.value = code; },
  });

  console.log = originalLog;
  stdoutLines = capturedStdout;

  assert.equal(exitCode.value, 0);
  const combined = stdoutLines.join('\n');
  // Should show "all conflicts resolved" message after retry succeeds
  assert.match(combined, /Mission-specific conflicts resolved/i);
});

// ---------------------------------------------------------------------------
// task-2323: local-base ancestry postcondition on every success path
// ---------------------------------------------------------------------------

// Recognize the ancestry postcondition call regardless of the leading
// `-C <executionRoot>` global options.
function isAncestryCheck(args: string[]): boolean {
  const tail = gitSubcommandArgs(args);
  return tail[0] === 'merge-base' && tail[1] === '--is-ancestor';
}

test('rebase exits 1 when base is not an ancestor of HEAD', async () => {
  const captured: string[] = [];
  const originalLog = console.log;
  const originalError = console.error;
  console.log = (...args) => { captured.push(args.join(' ')); };
  console.error = (...args) => { captured.push(args.join(' ')); };

  let exitCode: { value: number | null } = { value: null };
  let pushed = false;
  try {
    await rebase(['task-2323'], {
      inferSlugFn: () => 'task-2323',
      findMissionDirFn: () => '/tmp/missions/task-2323',
      findMissionAreaFn: () => 'docs',
      detectRebaseStateFn: () => ({ inProgress: false, detached: false, unmergedFiles: [] }),
      getCurrentBranchFn: () => 'mission/task-2323',
      isForgejoReviewEnabledFn: () => true,
      resolveMissionBaseBranchFn: () => 'skunkworks',
      createPrFn: () => { pushed = true; return { ok: true as const }; },
      gitFn: args => {
        if (isAncestryCheck(args)) return { signal: null,  status: 1, stdout: '', stderr: '' };
        if (gitSubcommandArgs(args)[0] === 'rev-parse') {
          return { signal: null,  status: 0, stdout: 'deadbee1234567\n', stderr: '' };
        }
        return { signal: null,  status: 0, stdout: '', stderr: '' };
      },
      exitFn: code => { exitCode.value = code; },
    });
  } finally {
    console.log = originalLog;
    console.error = originalError;
  }

  const output = captured.join('\n');
  assert.equal(exitCode.value, 1);
  assert.equal(pushed, false, 'must not push a branch that failed the ancestry postcondition');
  assert.doesNotMatch(output, /Rebase completed cleanly/);
  assert.match(output, /skunkworks/);
  assert.match(output, /deadbee1234567/);
  assert.match(output, /git rebase --abort/);
  // Local-base ancestry must not be conflated with origin/mission/* tracking.
  assert.match(output, /origin\/mission/);
});

test('rebase clean rebase verifies ancestry before reporting success', async () => {
  let exitCode: { value: number | null } = { value: null };
  let ancestryArgs: { value: string[] | null } = { value: null };
  await rebase(['task-2323'], {
    inferSlugFn: () => 'task-2323',
    findMissionDirFn: () => '/tmp/missions/task-2323',
    findMissionAreaFn: () => 'docs',
    detectRebaseStateFn: () => ({ inProgress: false, detached: false, unmergedFiles: [] }),
    getCurrentBranchFn: () => 'mission/task-2323',
    isForgejoReviewEnabledFn: () => false,
    resolveMissionBaseBranchFn: () => 'main',
    gitFn: args => {
      if (isAncestryCheck(args)) {
        ancestryArgs.value = gitSubcommandArgs(args);
        return { signal: null,  status: 0, stdout: '', stderr: '' };
      }
      return { signal: null,  status: 0, stdout: '', stderr: '' };
    },
    exitFn: code => { exitCode.value = code; },
  });

  assert.equal(exitCode.value, 0);
  assert.deepEqual(ancestryArgs.value, ['merge-base', '--is-ancestor', 'main', 'HEAD']);
});

test('rebase mission-specific resolution verifies ancestry before reporting success', async () => {
  let exitCode: { value: number | null } = { value: null };
  let ancestryChecked = false;
  await rebase(['task-2323'], {
    inferSlugFn: () => 'task-2323',
    findMissionDirFn: () => '/tmp/missions/task-2323',
    findMissionAreaFn: () => 'docs',
    detectRebaseStateFn: () => ({ inProgress: false, detached: false, unmergedFiles: [] }),
    getCurrentBranchFn: () => 'mission/task-2323',
    isForgejoReviewEnabledFn: () => false,
    resolveMissionBaseBranchFn: () => 'main',
    resolveConflictsFn: () => ({
      ok: true as const,
      conflictFiles: ['missions/task-2323/MISSION.md'],
      missionSpecificFiles: ['missions/task-2323/MISSION.md'],
      sharedFiles: [],
    }),
    gitFn: args => {
      if (isAncestryCheck(args)) {
        ancestryChecked = true;
        return { signal: null,  status: 0, stdout: '', stderr: '' };
      }
      const tail = gitSubcommandArgs(args);
      if (tail[0] === 'rebase' && tail[1] === 'main') {
        return { signal: null,  status: 1, stdout: '', stderr: 'CONFLICT (content): Merge conflict in missions/task-2323/MISSION.md\n', failureReason: { version: 1, code: 'git-conflict', source: 'git' } };
      }
      if (tail[0] === 'rebase' && tail[1] === '--show-current') {
        return { signal: null,  status: 0, stdout: '', stderr: '' };
      }
      return { signal: null,  status: 0, stdout: '', stderr: '' };
    },
    exitFn: code => { exitCode.value = code; },
  });

  assert.equal(exitCode.value, 0);
  assert.equal(ancestryChecked, true, 'auto-resolve success path must verify base ancestry');
});

test('rebase agent-assisted rebase rechecks ancestry after conflict resolution', async () => {
  let exitCode: { value: number | null } = { value: null };
  let ancestryChecked = false;
  let agentLaunched = false;
  await rebase(['task-2323'], {
    resolveTaskFileFn: () => ({ matches: ['/tmp/task-2323.md'],  ok: true as const, taskFile: '/tmp/task-2323.md' }),
    getTaskImplementerFn: () => 'codex',
    inferSlugFn: () => 'task-2323',
    findMissionDirFn: () => '/tmp/missions/task-2323',
    findMissionAreaFn: () => 'docs',
    detectRebaseStateFn: () => ({ inProgress: false, detached: false, unmergedFiles: [] }),
    getCurrentBranchFn: () => 'mission/task-2323',
    isForgejoReviewEnabledFn: () => false,
    resolveMissionBaseBranchFn: () => 'main',
    resolveConflictsFn: () => ({
      ok: true as const,
      conflictFiles: ['src/adapters/git/git.ts'],
      missionSpecificFiles: [],
      sharedFiles: ['src/adapters/git/git.ts'],
    }),
    startAgentFn: async () => {
      agentLaunched = true;
      return { agent: 'test-agent', result: { status: 0 } };
    },
    gitFn: args => {
      if (isAncestryCheck(args)) {
        ancestryChecked = true;
        return { signal: null,  status: 0, stdout: '', stderr: '' };
      }
      const tail = gitSubcommandArgs(args);
      if (tail[0] === 'rebase' && tail[1] === 'main') {
        return { signal: null,  status: 1, stdout: '', stderr: 'CONFLICT (content): Merge conflict in src/adapters/git/git.ts\n', failureReason: { version: 1, code: 'git-conflict', source: 'git' } };
      }
      if (tail[0] === 'rebase' && tail[1] === '--show-current') {
        return { signal: null,  status: 0, stdout: '', stderr: '' };
      }
      return { signal: null,  status: 0, stdout: '', stderr: '' };
    },
    exitFn: code => { exitCode.value = code; },
  });

  assert.equal(agentLaunched, true);
  assert.equal(exitCode.value, 0);
  assert.equal(ancestryChecked, true, 'agent-assisted success path must recheck base ancestry');
});

test('rebase agent-assisted rebase exits 1 when ancestry fails after conflict resolution', async () => {
  const captured: string[] = [];
  const originalLog = console.log;
  const originalError = console.error;
  console.log = (...args) => { captured.push(args.join(' ')); };
  console.error = (...args) => { captured.push(args.join(' ')); };

  let exitCode: { value: number | null } = { value: null };
  try {
    await rebase(['task-2323'], {
      resolveTaskFileFn: () => ({ matches: ['/tmp/task-2323.md'],  ok: true as const, taskFile: '/tmp/task-2323.md' }),
      getTaskImplementerFn: () => 'codex',
      inferSlugFn: () => 'task-2323',
      findMissionDirFn: () => '/tmp/missions/task-2323',
      findMissionAreaFn: () => 'docs',
      detectRebaseStateFn: () => ({ inProgress: false, detached: false, unmergedFiles: [] }),
      getCurrentBranchFn: () => 'mission/task-2323',
      isForgejoReviewEnabledFn: () => false,
      resolveMissionBaseBranchFn: () => 'main',
      resolveConflictsFn: () => ({
        ok: true as const,
        conflictFiles: ['src/adapters/git/git.ts'],
        missionSpecificFiles: [],
        sharedFiles: ['src/adapters/git/git.ts'],
      }),
      startAgentFn: async () => ({ agent: 'test-agent', result: { status: 0 } }),
      gitFn: args => {
        if (isAncestryCheck(args)) return { signal: null,  status: 1, stdout: '', stderr: '' };
        const tail = gitSubcommandArgs(args);
        if (tail[0] === 'rev-parse') return { signal: null,  status: 0, stdout: 'cafe4242\n', stderr: '' };
        if (tail[0] === 'rebase' && tail[1] === 'main') {
          return { signal: null,  status: 1, stdout: '', stderr: 'CONFLICT (content): Merge conflict in src/adapters/git/git.ts\n', failureReason: { version: 1, code: 'git-conflict', source: 'git' } };
        }
        if (tail[0] === 'rebase' && tail[1] === '--show-current') {
          return { signal: null,  status: 0, stdout: '', stderr: '' };
        }
        return { signal: null,  status: 0, stdout: '', stderr: '' };
      },
      exitFn: code => { exitCode.value = code; },
    });
  } finally {
    console.log = originalLog;
    console.error = originalError;
  }

  const output = captured.join('\n');
  assert.equal(exitCode.value, 1);
  assert.doesNotMatch(output, /completed conflict resolution/);
  assert.match(output, /cafe4242/);
  assert.match(output, /git rebase --abort/);
});
