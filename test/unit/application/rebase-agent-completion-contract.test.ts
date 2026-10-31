import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { sharedConflictHarness, run } from '../../helpers/rebase-conflict-fixture.js';
import { prepareRepairPrompt } from '../../../src/application/rebound-checkpoints.js';
import { FailureClass, DispatchAction } from '../../../src/application/failure-classification.js';
import type { GitCommandResult } from '../../../src/application/ports/rebase-workflow.js';
import { fixtureMission, inMemoryTransitionStore } from '../../fixtures/mission-builders.js';
import { agentFamily } from '../../../src/domain/agents.js';

// Git completion owns branch identity, repository verification and bounded repair.
// Extracted intact from rebase-conflict-recovery-contract to keep that suite below its cap.
describe('rebase agent completion', () => {
  const OK: GitCommandResult = { status: 0, stdout: '', stderr: '' };
  const SHARED_FILE = 'src/adapters/git/git.ts';
  function subcommand(args: string[]): string[] { let index = 0; while (args[index] === '-C' || args[index] === '-c') { index += 2; } return args.slice(index); }
  test('every fresh completion resolver gets Mission intent and refreshed index conflicts (px-0021)', async () => {
    const brief = { goal: 'Keep unique mission edits', why: 'Preserve user behavior', scope: 'shared files', outOfScope: ['changing validation'] };
    const store = inMemoryTransitionStore(fixtureMission('task-2503', { assignee: agentFamily('codex'), brief,
      successCriteria: ['Preserve current base behavior'] }));
    let active = false;
    let files: string[] = [];
    const prompts: string[] = [];
    const h = sharedConflictHarness({ missionServices: async () => ({ store }), findMissionDir: () => null,
      resolveTaskFile: () => assert.fail('database-only mission'),
      resolveMissionBaseBranch: () => 'local-feature',
      git: args => {
        if (subcommand(args).join(' ') === 'rebase local-feature') {
          active = true; files = ['src/first.ts'];
          return { status: 1, stdout: '', stderr: 'CONFLICT (content): Merge conflict in stale-output.ts' };
        }
        return OK;
      },
      detectRebaseState: () => ({ inProgress: active, unmergedFiles: [...files] }),
      startAgent: async (_step, options) => {
        assert.equal(options.sessionPolicy, 'fresh-ephemeral');
        prompts.push(typeof options.prompt === 'function' ? options.prompt('codex') : options.prompt);
        files = prompts.length === 1 ? ['src/later.ts'] : [];
        active = prompts.length < 3;
        return { agent: 'codex', result: { status: 0 } };
      },
    });
    await run(h);
    assert.deepEqual(h.exitCodes, [0], h.lines.join('\n'));
    assert.equal(prompts.length, 3, 'initial resolver plus the unchanged two completion attempts');
    for (const prompt of prompts) {
      for (const text of [...Object.values(brief).flat(), 'Preserve current base behavior', 'Mission worktree: /worktree',
        'Captured mission branch: mission/task-2503', 'Resolved local rebase base: local-feature']) { assert.ok(prompt.includes(text), text); }
      assert.match(prompt, /Preserve unique mission changes/);
      assert.match(prompt, /never apply blanket ours\/theirs/);
      assert.match(prompt, /ambiguous.*stop with the current paths and evidence/);
      assert.match(prompt, /Stage every resolved file with git add before each git rebase --continue/);
      assert.doesNotMatch(prompt, /stale-output\.ts/);
    }
    assert.match(prompts[0], /  - src\/first\.ts/);
    assert.doesNotMatch(prompts[1], /src\/first\.ts/);
    assert.match(prompts[1], /  - src\/later\.ts/);
    assert.doesNotMatch(prompts[2], /src\/later\.ts/);
    assert.match(prompts[2], /Current unmerged paths from Git:\n  \(none\)/);
    assert.match(prompts[2], /Completion diagnostic:\nRebase is still in progress/);
    assert.doesNotMatch(prompts[2], /paused on conflicts|Step 1|Step 2/);
  });
  test('completion becoming clean before prompt construction does not invent conflicts (px-0021 F11)', async () => {
    let active = false;
    let launched = false;
    const prompts: string[] = [];
    const h = sharedConflictHarness({ readReviewState: async () => ({ implementer: 'codex' }),
      detectRebaseState: () => ({ inProgress: active, unmergedFiles: [] }),
      getCurrentBranch: () => { if (launched) { active = false; } return 'mission/task-2503'; },
      startAgent: async (_step, options) => {
        prompts.push(typeof options.prompt === 'function' ? options.prompt('codex') : options.prompt);
        if (!launched) { active = true; launched = true; }
        return { agent: 'codex', result: { status: 0 } };
      } });
    await run(h);
    assert.deepEqual(h.exitCodes, [0], h.lines.join('\n'));
    assert.equal(prompts.length, 2);
    assert.match(prompts[1], /Git completion checks now pass/);
    assert.match(prompts[1], /Current unmerged paths from Git:\n  \(none\)/);
    assert.doesNotMatch(prompts[1], /paused on conflicts|Workflow detected conflicts|Step 1|Step 2|  - src\/adapters\/git\/git.ts/);
  });
  test('known mission path keeps ownership when it conflicts again after a clean index (px-0021 F11)', async () => {
    const owned = 'backlog/tasks/task-2503.md';
    const store = inMemoryTransitionStore(fixtureMission('task-2503', { assignee: agentFamily('codex') }));
    let active = false;
    let files: string[] = [];
    const prompts: string[] = [];
    const h = sharedConflictHarness({ missionServices: async () => ({ store }),
      detectRebaseState: () => ({ inProgress: active, unmergedFiles: [...files] }),
      resolveConflictsForMission: () => {
        active = true; files = [owned, 'shared.ts'];
        return { ok: false, error: 'merge-failed', conflictFiles: [], missionSpecificFiles: [], sharedFiles: [] };
      },
      git: args => subcommand(args).join(' ') === 'status --porcelain'
        ? { ...OK, stdout: files.map(file => `UU ${file}`).join('\n') }
        : subcommand(args).join(' ') === 'rebase main' ? { ...OK, status: 1, stderr: 'CONFLICT (content): Merge conflict in shared.ts' } : OK,
      startAgent: async (_step, options) => {
        prompts.push(typeof options.prompt === 'function' ? options.prompt('codex') : options.prompt);
        files = prompts.length === 2 ? [owned, 'shared.ts'] : [];
        active = prompts.length < 3;
        return { agent: 'codex', result: { status: 0 } };
      } });
    await run(h);
    assert.deepEqual(h.exitCodes, [0], h.lines.join('\n'));
    assert.equal(prompts.length, 3);
    assert.match(prompts[1], /Current unmerged paths from Git:\n  \(none\)/);
    assert.ok(!prompts[1].includes(`git checkout --theirs "${owned}"`));
    assert.ok(prompts[2].includes(`git checkout --theirs "${owned}" && git add "${owned}"`));
    assert.match(prompts[2], /Step 2 — Resolve shared-file conflicts:\n  - shared\.ts\n\n/);
  });
  for (const failure of ['active', 'unmerged', 'wrong-branch', 'detached', 'valid'] as const) {
    test(`rebounces unfinished agent checkout with stable exact target (${failure}, TASK-2728)`, async () => {
      let launches = 0;
      let branch = 'mission/task-2503';
      let active = false;
      let files: string[] = [];
      let targetReads = 0;
      const prompts: string[] = [];
      const h = sharedConflictHarness({
        readReviewState: async () => ({ implementer: 'codex' }),
        missionBranchName: () => { targetReads++; return targetReads === 1 ? 'mission/task-2503' : 'changed-target'; },
        getCurrentBranch: () => branch,
        detectRebaseState: () => ({ inProgress: active, unmergedFiles: files }),
        startAgent: async (_step, options) => {
          prompts.push(typeof options.prompt === 'function' ? options.prompt('codex') : String(options.prompt));
          launches++;
          active = launches === 1 && failure === 'active';
          files = launches === 1 && failure === 'unmerged' ? ['src/shared.ts'] : [];
          branch = launches === 1 && failure === 'detached' ? '' : launches === 1 && failure === 'wrong-branch' ? 'main' : 'mission/task-2503';
          return { agent: 'codex', result: { status: 0 } };
        },
      });
      await run(h);
      assert.deepEqual(h.exitCodes, [0], h.lines.join('\n'));
      assert.equal(launches, failure === 'valid' ? 1 : 2);
      assert.equal(targetReads, 1);
      if (failure !== 'valid') {
        assert.equal(prompts[1].split('\n\n').at(-1), 'complete the rebase, ensuring the checkout ends at mission/task-2503');
        assert.match(prompts[1], /Captured mission branch: mission\/task-2503/);
        if (failure !== 'unmerged') {
          assert.doesNotMatch(prompts[1], /paused on conflicts|Step 1|Step 2/);
          assert.match(prompts[1], failure === 'active' ? /Rebase is still in progress/ : /Expected checkout mission\/task-2503, found (?:main|\(detached HEAD\))/);
        }
      }
    });
  }
  test('exhausted completion recovery blocks push and advancement with one budget (TASK-2728)', async () => {
    let launches = 0;
    let pushes = 0;
    let resumes = 0;
    let branch = 'mission/task-2503';
    const prompts: string[] = [];
    const h = sharedConflictHarness({
      readReviewState: async () => ({ implementer: 'codex' }),
      getCurrentBranch: () => branch,
      startAgent: async (_step, options) => {
        launches++;
        prompts.push(typeof options.prompt === 'function' ? options.prompt('codex') : String(options.prompt));
        branch = 'main';
        return { agent: 'codex', result: { status: 0 } };
      },
      isForgejoReviewEnabled: () => true,
      createPr: () => { pushes++; return { ok: true as const }; },
      resumeReviewAfterRepair: async () => { resumes++; },
    });
    await run(h, ['task-2503', '--push']);
    assert.equal(launches, 3, 'initial resolver plus the existing two repair attempts');
    assert.equal(prompts.slice(1).length, 2);
    assert.deepEqual(prompts.slice(1).map(prompt => prompt.split('\n\n').at(-1)),
      Array(2).fill('complete the rebase, ensuring the checkout ends at mission/task-2503'));
    assert.deepEqual(h.exitCodes, [1]);
    assert.equal(pushes, 0);
    assert.equal(resumes, 0);
    assert.match(h.lines.join('\n'), /Expected checkout mission\/task-2503, found main/);
    assert.match(h.lines.join('\n'), /git rebase --continue/);
  });
  test('Git completion prompt needs no code-repair checkpoint (TASK-2728)', async () => {
    const reason = { kind: 'artifact-incomplete', role: 'implementer', diagnostic: 'Rebase is still in progress.' } as const;
    const prepared = await prepareRepairPrompt({ occurrenceId: 'git-completion', reason, originalReason: reason,
      classification: { failureClass: FailureClass.IncompleteEvidence, dispatchAction: DispatchAction.AutoSendBack,
        isRelaunchable: true, label: 'INCOMPLETE ARTIFACTS' }, diagnostic: reason.diagnostic, originalDiagnostic: reason.diagnostic },
    { slug: 'task-2503', worktree: '/worktree', implementer: 'codex', verify: () => ({ ok: true as const }),
      startAgent: async () => null, repairPrompt: async () => 'complete the rebase, ensuring the checkout ends at mission/task-2503',
      repairCheckpoints: { open: async () => { throw new Error('must not create code-repair evidence for Git completion'); },
        readBlocker: async () => undefined, verify: async () => undefined } }, 1, 2);
    assert.equal(prepared.fixPrompt, 'complete the rebase, ensuring the checkout ends at mission/task-2503');
    assert.equal(prepared.repairCheckpoint, null);
  });
  test('verifies active repaired rebase without APPROVED review (TASK-2673)', async () => {
    let repositoryChecks = 0;
    let integrationChecks = 0;
    const h = sharedConflictHarness({
      readReviewState: async () => ({ implementer: 'codex', status: 'active', metadata: {} }),
      startAgent: async (_step, options) => {
        const prompt = String(options.prompt);
        assert.match(prompt, /npm test/);
        repositoryChecks += 1; // Injected repository verifier succeeds on the repaired tree.
        if (/px integrate .*--dry-run/.test(prompt)) {
          integrationChecks += 1;
          return { agent: 'codex', result: { status: 1 } }; // Active, unapproved mission.
        }
        return { agent: 'codex', result: { status: 0 } };
      },
    });
    await run(h);
    assert.equal(repositoryChecks, 1);
    assert.equal(integrationChecks, 0, 'repair verification must not require integration eligibility');
    assert.deepEqual(h.exitCodes, [0]);
  });
  test('failed repository verification prevents repair completion and push (TASK-2673)', async () => {
    let pushes = 0;
    let resumes = 0;
    const h = sharedConflictHarness({
      readReviewState: async () => ({ implementer: 'codex', status: 'active' }),
      startAgent: async (_step, options) => {
        assert.match(String(options.prompt), /do not report completion until it passes/);
        return { agent: 'codex', result: { status: 1 } };
      },
      isForgejoReviewEnabled: () => true,
      createPr: () => { pushes += 1; return { ok: true as const }; },
      resumeReviewAfterRepair: async () => { resumes += 1; },
    });
    await run(h, ['task-2503', '--push']);
    assert.deepEqual(h.exitCodes, [1]);
    assert.equal(pushes, 0);
    assert.equal(resumes, 0);
    assert.doesNotMatch(h.lines.join('\n'), /completed conflict resolution/);
  });
  test('unfinished Git rebase prevents repair completion and push (TASK-2673)', async () => {
    let launched = false;
    let pushes = 0;
    let resumes = 0;
    const h = sharedConflictHarness({
      readReviewState: async () => ({ implementer: 'codex', status: 'active' }),
      startAgent: async () => {
        launched = true;
        return { agent: 'codex', result: { status: 0 } };
      },
      detectRebaseState: () => ({ inProgress: launched, unmergedFiles: [] }),
      isForgejoReviewEnabled: () => true,
      createPr: () => { pushes += 1; return { ok: true as const }; },
      resumeReviewAfterRepair: async () => { resumes += 1; },
    });
    await run(h, ['task-2503', '--push']);
    assert.deepEqual(h.exitCodes, [1]);
    assert.equal(pushes, 0);
    assert.equal(resumes, 0);
    assert.doesNotMatch(h.lines.join('\n'), /completed conflict resolution/);
  });
  for (const remaining of [
    { name: 'an active rebase', inProgress: true, unmergedFiles: [] },
    { name: 'unmerged files', inProgress: false, unmergedFiles: [SHARED_FILE] },
  ]) {
    test(`successful Git command with ${remaining.name} cannot finalize or publish repair (TASK-2673)`, async () => {
      let rebased = false;
      let pushes = 0;
      let branchMoves = 0;
      let resumes = 0;
      const h = sharedConflictHarness({
        git: (args) => {
          const tail = subcommand(args);
          if (tail[0] === 'rebase' && tail[1] === 'main') { rebased = true; }
          return OK;
        },
        detectRebaseState: () => rebased ? remaining : { inProgress: false, unmergedFiles: [] },
        isForgejoReviewEnabled: () => true,
        createPr: () => { pushes += 1; return { ok: true as const }; },
        recordBranchMove: async () => { branchMoves += 1; return null; },
        resumeReviewAfterRepair: async () => { resumes += 1; },
      });
      await run(h, ['task-2503', '--push']);
      assert.equal(rebased, true);
      assert.deepEqual(h.exitCodes, [1]);
      assert.equal(pushes, 0);
      assert.equal(branchMoves, 0);
      assert.equal(resumes, 0);
      assert.equal(h.agentLaunches.length, 0);
      assert.match(h.lines.join('\n'), /Rebase is unfinished\. Skipping automatic push/);
      assert.doesNotMatch(h.lines.join('\n'), /Rebase completed cleanly/);
    });
  }
});
