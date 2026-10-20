import { commitDirtyFiles } from '../../../../../src/adapters/git/commit-dirty-files.js';
import type { GitOptions } from "../../../../../src/adapters/git/git.js";
// Mission handoff repair contract: repairHandoff auto-commit, failure classification, and dispatch.
//
// Behavior-owned suite (TASK-2622.07). Legacy case names are unchanged; each section keeps its
// historical task provenance and the legacy file it replaced.
//   Repair handoff: no task ID in the legacy file
//   Repair handoff auto-commit: TASK-2202
//   Rebase failure classification: TASK-2366

import test, { describe, mock } from 'node:test';
import assert from 'node:assert/strict';
import { hasExplicitHumanOnlyDiagnostic } from '../../../../../src/domain/failure-classification.js';
import { resolveConfiguration } from '../../../../../src/composition/config.js';
import { mockModule, installModuleMocks } from '../../../../lib/module-mock.js';

const repairHandoff = mockModule<typeof import('../../../../../src/adapters/cli/commands/repair-handoff.js')>('../../../../../src/adapters/cli/commands/repair-handoff.js', import.meta.url);
const handoff = mockModule<typeof import('../../../../../src/adapters/cli/commands/handoff.js')>('../../../../../src/adapters/cli/commands/handoff.js', import.meta.url);
const reviewRebase = mockModule<typeof import('../../../../../src/adapters/review/rebase.js')>('../../../../../src/adapters/review/rebase.js', import.meta.url);
const execute = mockModule<typeof import('../../../../../src/adapters/mission/execute-mission-adapters.js')>('../../../../../src/adapters/mission/execute-mission-adapters.js', import.meta.url);
await installModuleMocks();
test.afterEach(() => mock.restoreAll());

// no task ID in the legacy file (was test/repair-handoff.test.ts)
describe('Repair handoff', () => {
  const { classifyError, getDispatchAction, FailureClass, DispatchAction } = repairHandoff;

  test('repairHandoff auto-commits safe mission files', async () => {
    const adds: string[] = [];
    const commits: string[] = [];
    const logs: string[] = [];

    const gitFn: NonNullable<NonNullable<Parameters<typeof repairHandoff.default>[3]>["gitFn"]> = (args) => {
      if (args.includes('status')) {
        return { signal: null, stderr: '', 
          status: 0,
          stdout: [
            ' M missions/task-1037/MISSION.md',
            '?? missions/task-1037/CP-1.md',
            ' M backlog/tasks/task-1037 - some task.md'
          ].join('\0')
        };
      }
      if (args.includes('add')) {
        assert.deepEqual(args.slice(2, 5), ['add', '--all', '--']);
        adds.push(...args.slice(args.indexOf('--') + 1));
        return { signal: null, stdout: '', stderr: '',  status: 0 };
      }
      if (args.includes('commit')) {
        commits.push(args[args.indexOf('-m') + 1]);
        return { signal: null, stdout: '', stderr: '',  status: 0 };
      }
      return { signal: null, stdout: '', stderr: '',  status: 0 };
    };

    const { repaired, blocker } = await repairHandoff.default('task-1037', '/tmp/worktree', 'MISSION.md is modified but uncommitted', {
      gitFn,
      log: (msg) => logs.push(msg)
    });

    assert.equal(repaired, true, 'repairHandoff should return repaired:true when it committed files');
    assert.equal(blocker, null);
    assert.deepEqual(adds, ['.']);
    assert.equal(commits.length, 1);
    assert.match(commits[0], /auto-commit mission artifacts/);
  });

  test('repairHandoff stages the checkout for already staged renames', async () => {
    const adds: string[] = [];
    const commits: true[] = [];

    const gitFn: NonNullable<NonNullable<Parameters<typeof repairHandoff.default>[3]>["gitFn"]> = (args) => {
      if (args.includes('status')) {
        return { signal: null, stderr: '', 
          status: 0,
          stdout: [
            'R  missions/task-1037/CP-1-renamed.md\0missions/task-1037/CP-1.md'
          ].join('\0')
        };
      }
      if (args.includes('add')) {
        assert.deepEqual(args.slice(2, 5), ['add', '--all', '--']);
        adds.push(...args.slice(args.indexOf('--') + 1));
        return { signal: null, stdout: '', stderr: '',  status: 0 };
      }
      if (args.includes('commit')) {
        commits.push(true);
        return { signal: null, stdout: '', stderr: '',  status: 0 };
      }
      return { signal: null, stdout: '', stderr: '',  status: 0 };
    };

    const { repaired, blocker } = await repairHandoff.default('task-1037', '/tmp/worktree', 'MISSION.md is modified but uncommitted', {
      gitFn,
      log: () => {}
    });

    assert.equal(repaired, true);
    assert.equal(blocker, null);
    assert.deepEqual(adds, ['.']);
    assert.equal(commits.length, 1);
  });

  test('repairHandoff commits operator-local and generated paths when they are dirty', async () => {
    const adds: string[] = [];
    const logs: string[] = [];

    const gitFn: NonNullable<NonNullable<Parameters<typeof repairHandoff.default>[3]>["gitFn"]> = (args) => {
      if (args.includes('status')) {
        return { signal: null, stderr: '', 
          status: 0,
          stdout: [
            ' M missions/task-1037/MISSION.md',
            ' M .workflow/codex-home/.codex/logs_2.sqlite',
            ' M .sessions/task-1037-implementer.json',
            ' M .forgejo-local/tokens/codex',
            ' M graphify-out/GRAPH_REPORT.md'
          ].join('\0')
        };
      }
      if (args.includes('add')) {
        assert.deepEqual(args.slice(2, 5), ['add', '--all', '--']);
        adds.push(...args.slice(args.indexOf('--') + 1));
        return { signal: null, stdout: '', stderr: '',  status: 0 };
      }
      return { signal: null, stdout: '', stderr: '',  status: 0 };
    };

    const { repaired, blocker } = await repairHandoff.default('task-1037', '/tmp/worktree', 'MISSION.md is modified but uncommitted', {
      gitFn,
      log: (msg) => logs.push(msg)
    });

    assert.equal(repaired, true);
    assert.equal(blocker, null);
    assert.deepEqual(adds, ['.']);
    assert.ok(logs.some(l => l.includes('Auto-committing dirty files')));
  });

  test('repairHandoff commits arbitrary non-mission repo files when they are dirty', async () => {
    const adds: string[] = [];
    const logs: string[] = [];

    const gitFn: NonNullable<NonNullable<Parameters<typeof repairHandoff.default>[3]>["gitFn"]> = (args) => {
      if (args.includes('status')) {
        return { signal: null, stderr: '', 
          status: 0,
          stdout: [
            ' M missions/task-1037/MISSION.md',
            ' M server/src/main/java/visual/App.java',
            ' M .env',
            ' M .claude/settings.local.json'
          ].join('\0')
        };
      }
      if (args.includes('add')) {
        assert.deepEqual(args.slice(2, 5), ['add', '--all', '--']);
        adds.push(...args.slice(args.indexOf('--') + 1));
        return { signal: null, stdout: '', stderr: '',  status: 0 };
      }
      return { signal: null, stdout: '', stderr: '',  status: 0 };
    };

    const { repaired, blocker } = await repairHandoff.default('task-1037', '/tmp/worktree', 'MISSION.md is modified but uncommitted', {
      gitFn,
      log: (msg) => logs.push(msg)
    });

    assert.equal(repaired, true);
    assert.equal(blocker, null);
    assert.deepEqual(adds, ['.']);
    assert.ok(logs.some(l => l.includes('Auto-committing dirty files')));
  });

  test('repairHandoff reports staging failures and stops before commit', async () => {
    const adds: string[] = [];
    const commits: true[] = [];
    const errors: string[] = [];

    const gitFn: NonNullable<NonNullable<Parameters<typeof repairHandoff.default>[3]>["gitFn"]> = (args) => {
      if (args.includes('status')) {
        return { signal: null, stderr: '', 
          status: 0,
          stdout: [
            ' M missions/task-1037/MISSION.md'
          ].join('\0')
        };
      }
      if (args.includes('add')) {
        assert.deepEqual(args.slice(2, 5), ['add', '--all', '--']);
        adds.push(args[args.length - 1]);
        return { signal: null, stdout: '',  status: 1, stderr: 'permission denied' };
      }
      if (args.includes('commit')) {
        commits.push(true);
        return { signal: null, stdout: '', stderr: '',  status: 0 };
      }
      return { signal: null, stdout: '', stderr: '',  status: 0 };
    };

    const { repaired, blocker } = await repairHandoff.default('task-1037', '/tmp/worktree', 'MISSION.md is modified but uncommitted', {
      gitFn,
      error: (msg) => errors.push(msg),
      log: () => {}
    });

    assert.equal(repaired, false);
    assert.ok(blocker);    assert.match(blocker, /Cannot stage mission changes/);
    assert.ok(blocker);    assert.match(blocker, /permission denied/);
    assert.equal(commits.length, 0);
    assert.ok(errors.some(line => line.includes('Cannot stage mission changes')));
  });

  test('repairHandoff refuses to commit when mission files are conflicted', async () => {
    const adds = [];
    const logs: string[] = [];

    const gitFn: NonNullable<NonNullable<Parameters<typeof repairHandoff.default>[3]>["gitFn"]> = (args) => {
      if (args.includes('status')) {
        return { signal: null, stderr: '', 
          status: 0,
          stdout: [
            'UU missions/task-1037/MISSION.md'
          ].join('\0')
        };
      }
      return { signal: null, stdout: '', stderr: '',  status: 0 };
    };

    const { repaired, blocker } = await repairHandoff.default('task-1037', '/tmp/worktree', 'MISSION.md is modified but uncommitted', {
      gitFn,
      log: (msg) => logs.push(msg),
      error: (msg) => logs.push(msg)
    });

    assert.equal(repaired, false);
    assert.ok(blocker);    assert.match(blocker, /unresolved conflict/);
    assert.ok(blocker);    assert.match(blocker, /missions\/task-1037\/MISSION\.md/);
    assert.equal(adds.length, 0);
    assert.ok(logs.some(l => l.includes('unresolved conflict')));
  });

  test('repairHandoff calls rebase when branch is behind', async () => {
    const logs: string[] = [];
    let rebaseCalled = false;

    const gitFn: NonNullable<NonNullable<Parameters<typeof repairHandoff.default>[3]>["gitFn"]> = (args) => {
      if (args.includes('status')) return { signal: null, stderr: '',  status: 0, stdout: '' };
      return { signal: null, stdout: '', stderr: '',  status: 0 };
    };

    const rebaseFn: NonNullable<NonNullable<Parameters<typeof repairHandoff.default>[3]>["rebaseFn"]> = async (args, opts) => {
      rebaseCalled = true;
      assert.equal(args[0], 'task-1037');
      assert.ok(opts?.exitFn);
      opts.exitFn(0);
    };

    const { repaired, blocker } = await repairHandoff.default('task-1037', '/tmp/worktree', 'git push failed: Updates were rejected', {
      gitFn,
      rebaseFn,
      log: (msg) => logs.push(msg)
    });

    assert.equal(repaired, true, 'repairHandoff should return repaired:true when rebase succeeded');
    assert.equal(blocker, null);
    assert.equal(rebaseCalled, true);
    assert.ok(logs.some(l => l.includes('Branch appears behind primary branch')));
  });

  test('repairHandoff returns false when rebase fails', async () => {
    const logs: string[] = [];
    const errors: string[] = [];

    const gitFn: NonNullable<NonNullable<Parameters<typeof repairHandoff.default>[3]>["gitFn"]> = (args) => {
      if (args.includes('status')) return { signal: null, stderr: '',  status: 0, stdout: '' };
      return { signal: null, stdout: '', stderr: '',  status: 0 };
    };

    const rebaseFn: NonNullable<NonNullable<Parameters<typeof repairHandoff.default>[3]>["rebaseFn"]> = async (args, opts) => {
      assert.ok(opts?.exitFn);
      opts.exitFn(1);
    };

    const { repaired, blocker } = await repairHandoff.default('task-1037', '/tmp/worktree', 'git push failed: Updates were rejected', {
      gitFn,
      rebaseFn,
      log: (msg) => logs.push(msg),
      error: (msg) => errors.push(msg)
    });

    assert.equal(repaired, false, 'repairHandoff should return repaired:false when rebase failed');
    assert.ok(blocker);    assert.match(blocker, /Auto-rebase failed: rebase exited with code 1/);
    assert.ok(errors.some(l => l.includes('Auto-rebase failed')));
  });

  test('repairHandoff auto-commits safe mission files including completed tasks', async () => {
    const adds: string[] = [];
    const gitFn: NonNullable<NonNullable<Parameters<typeof repairHandoff.default>[3]>["gitFn"]> = (args) => {
      if (args.includes('status')) {
        return { signal: null, stderr: '', 
          status: 0,
          stdout: [
            ' M backlog/completed/task-1037 - some task.md'
          ].join('\0')
        };
      }
      if (args.includes('add')) {
        assert.deepEqual(args.slice(2, 5), ['add', '--all', '--']);
        adds.push(args[args.length - 1]);
        return { signal: null, stdout: '', stderr: '',  status: 0 };
      }
      return { signal: null, stdout: '', stderr: '',  status: 0 };
    };

    const { repaired } = await repairHandoff.default('task-1037', '/tmp/worktree', 'MISSION.md is modified but uncommitted', {
      gitFn,
      log: () => {}
    });

    assert.equal(repaired, true);
    assert.deepEqual(adds, ['.']);
  });

  test('repairHandoff returns repaired:false when rebase fails after successful auto-commit', async () => {
    const gitFn: NonNullable<NonNullable<Parameters<typeof repairHandoff.default>[3]>["gitFn"]> = (args) => {
      if (args.includes('status')) {
        return { signal: null, stderr: '',  status: 0, stdout: ' M missions/task-1037/MISSION.md' };
      }
      if (args.includes('add')) return { signal: null, stdout: '', stderr: '',  status: 0 };
      if (args.includes('commit')) return { signal: null, stdout: '', stderr: '',  status: 0 };
      return { signal: null, stdout: '', stderr: '',  status: 0 };
    };

    const rebaseFn: NonNullable<NonNullable<Parameters<typeof repairHandoff.default>[3]>["rebaseFn"]> = async (args, opts) => {
      assert.ok(opts?.exitFn);
      opts.exitFn(1); // Rebase fails
    };

    const { repaired, blocker } = await repairHandoff.default('task-1037', '/tmp/worktree', 'Updates were rejected', {
      gitFn,
      rebaseFn,
      log: () => {},
      error: () => {}
    });

    assert.equal(repaired, false, 'Should be false because rebase failed');
    assert.ok(blocker);    assert.match(blocker, /Auto-rebase failed/);
  });

  test('repairHandoff returns repaired:false for generic git push failed (auth/transport)', async () => {
    const { repaired } = await repairHandoff.default('task-1037', '/tmp/worktree', 'git push failed with status 128: fatal: Authentication failed', {
      log: () => {}
    });

    assert.equal(repaired, false);
  });

  // CP-1 tests for isRelaunchableError

  test('isRelaunchableError returns true for goal-check table missing evidence rows error', () => {
    const { isRelaunchableError } = repairHandoff;
    const errorMsg = 'The final checkpoint at docs/missions/2026/task-1121/CP-3.md has a "## Goal Check" section but no evidence rows. A goal-check table with real evidence is required before handoff.';
    assert.equal(isRelaunchableError(errorMsg), true);
  });

  test('isRelaunchableError returns false for non-relaunchable errors', () => {
    const { isRelaunchableError } = repairHandoff;

    // @ts-expect-error Intentional non-string error-classification input.
    assert.equal(isRelaunchableError(null), false);
    // @ts-expect-error Intentional non-string error-classification input.
    assert.equal(isRelaunchableError(undefined), false);
    // @ts-expect-error Intentional non-string error-classification input.
    assert.equal(isRelaunchableError(123), false);
    assert.equal(isRelaunchableError(''), false);
    assert.equal(isRelaunchableError('Some other error'), false);
    assert.equal(isRelaunchableError('MISSION.md is modified but uncommitted'), false);
    assert.equal(isRelaunchableError('git push failed'), false);
  });

  test('isRelaunchableError returns false for partial match', () => {
    const { isRelaunchableError } = repairHandoff;

    // Missing the second part of the required message
    assert.equal(isRelaunchableError('has a "## Goal Check" section but no evidence rows'), false);
    // Missing the first part
    assert.equal(isRelaunchableError('A goal-check table with real evidence is required before handoff'), false);
  });

  // ── CP-1 tests: FailureClass, DispatchAction, getDispatchAction (SC2) ─────────

  test('getDispatchAction returns AutoRepair for GitBlockers', () => {
    assert.equal(getDispatchAction(FailureClass.GitBlockers), DispatchAction.AutoRepair);
  });

  test('getDispatchAction returns AutoRepair for MalformedGates', () => {
    assert.equal(getDispatchAction(FailureClass.MalformedGates), DispatchAction.AutoRepair);
  });

  test('getDispatchAction returns AutoSendBack for UnverifiableClaims', () => {
    assert.equal(getDispatchAction(FailureClass.UnverifiableClaims), DispatchAction.AutoSendBack);
  });

  test('getDispatchAction returns AutoSendBack for MissingArtifacts', () => {
    assert.equal(getDispatchAction(FailureClass.MissingArtifacts), DispatchAction.AutoSendBack);
  });

  test('getDispatchAction returns AutoSendBack for IncompleteEvidence', () => {
    assert.equal(getDispatchAction(FailureClass.IncompleteEvidence), DispatchAction.AutoSendBack);
  });

  test('getDispatchAction returns AutoSendBack for GateFailure', () => {
    assert.equal(getDispatchAction(FailureClass.GateFailure), DispatchAction.AutoSendBack);
  });

  test('getDispatchAction returns HumanOnly for InfraBlocker', () => {
    assert.equal(getDispatchAction(FailureClass.InfraBlocker), DispatchAction.HumanOnly);
  });

  test('getDispatchAction returns HumanOnly for StateMachineViolation', () => {
    assert.equal(getDispatchAction(FailureClass.StateMachineViolation), DispatchAction.HumanOnly);
  });

  test('classifyError and getDispatchAction are importable named exports', () => {
    assert.ok(typeof classifyError === 'function', 'classifyError should be a function');
    assert.ok(typeof getDispatchAction === 'function', 'getDispatchAction should be a function');
    assert.ok(typeof FailureClass === 'object', 'FailureClass should be an object');
    assert.ok(typeof DispatchAction === 'object', 'DispatchAction should be an object');
  });

  test('classifyError returns HumanOnly for null input', () => {
    // @ts-expect-error Intentional non-string error-classification input.
    const result = classifyError(null);
    assert.equal(result.failureClass, FailureClass.InfraBlocker);
    assert.equal(result.dispatchAction, DispatchAction.HumanOnly);
  });

  test('classifyError returns HumanOnly for empty string', () => {
    const result = classifyError('');
    assert.equal(result.failureClass, FailureClass.InfraBlocker);
    assert.equal(result.dispatchAction, DispatchAction.HumanOnly);
  });

  // ── CP-2 tests: classifyError for all 8 failure classes (SC1) ────────────────

  test('classifyError classifies dirty-artifact error as GitBlockers with reason dirty', () => {
    const result = classifyError('MISSION.md is modified but uncommitted');
    assert.equal(result.failureClass, FailureClass.GitBlockers);
    assert.equal(result.dispatchAction, DispatchAction.AutoRepair);
    assert.equal(result.reason, 'dirty');
  });

  test('classifyError classifies commit-mission-contract error as GitBlockers with reason dirty', () => {
    const result = classifyError('Commit the mission contract before handoff');
    assert.equal(result.failureClass, FailureClass.GitBlockers);
    assert.equal(result.dispatchAction, DispatchAction.AutoRepair);
    assert.equal(result.reason, 'dirty');
  });

  test('classifyError classifies behind-branch error as GitBlockers with reason behind', () => {
    const result = classifyError('git push failed: Updates were rejected');
    assert.equal(result.failureClass, FailureClass.GitBlockers);
    assert.equal(result.dispatchAction, DispatchAction.AutoRepair);
    assert.equal(result.reason, 'behind');
  });

  test('classifyError classifies non-fast-forward error as GitBlockers with reason behind', () => {
    const result = classifyError('error: failed to push some refs to origin\nhint: Updates were rejected because the remote contains work that does not exist locally.\nhint: This may also indicate remote master is behind your local branch.');
    assert.equal(result.failureClass, FailureClass.GitBlockers);
    assert.equal(result.dispatchAction, DispatchAction.AutoRepair);
    assert.equal(result.reason, 'behind');
  });

  test('classifyError classifies goal-check missing-evidence as IncompleteEvidence', () => {
    const result = classifyError('The final checkpoint at docs/missions/2026/task-1121/CP-3.md has a "## Goal Check" section but no evidence rows. A goal-check table with real evidence is required before handoff.');
    assert.equal(result.failureClass, FailureClass.IncompleteEvidence);
    assert.equal(result.dispatchAction, DispatchAction.AutoSendBack);
  });

  test('classifyError classifies verification-gate-failed as GateFailure', () => {
    const result = classifyError('verification gate failed: exit code 1');
    assert.equal(result.failureClass, FailureClass.GateFailure);
    assert.equal(result.dispatchAction, DispatchAction.AutoSendBack);
  });

  test('classifyError classifies declared-gate-failed as GateFailure', () => {
    const result = classifyError('Declared gate "lint" failed with exit code 2');
    assert.equal(result.failureClass, FailureClass.GateFailure);
    assert.equal(result.dispatchAction, DispatchAction.AutoSendBack);
  });

  test('classifyError classifies unverifiable-claims error as UnverifiableClaims', () => {
    const result = classifyError('Tests passed but cannot verify: proof not found');
    assert.equal(result.failureClass, FailureClass.UnverifiableClaims);
    assert.equal(result.dispatchAction, DispatchAction.AutoSendBack);
  });

  test('classifyError classifies malformed-gate error as MalformedGates', () => {
    const result = classifyError('Malformed gate config: syntax error in gate command');
    assert.equal(result.failureClass, FailureClass.MalformedGates);
    assert.equal(result.dispatchAction, DispatchAction.AutoRepair);
  });

  test('classifyError classifies missing-artifacts error as MissingArtifacts', () => {
    const result = classifyError('Missing mandatory artifact: MISSION.md not found');
    assert.equal(result.failureClass, FailureClass.MissingArtifacts);
    assert.equal(result.dispatchAction, DispatchAction.AutoSendBack);
  });

  test('classifyError recognizes auto-remediation failure as MissingArtifacts', () => {
    // Exact message shape emitted by performHandoff when checkpoint auto-remediation
    // fails (task-2215): must bounce back to the implementer, not strand on a human.
    const result = classifyError('No checkpoint documents found in /home/magnus/code/parallix-task-2213/missions/task-2213 even after auto-remediation. Implementation evidence is mandatory for review.');
    assert.equal(result.failureClass, FailureClass.MissingArtifacts);
    assert.equal(result.dispatchAction, DispatchAction.AutoSendBack);
  });

  test('classifyError classifies infra-blocker error as InfraBlocker', () => {
    const result = classifyError('Authentication failed for Forgejo: token expired');
    assert.equal(result.failureClass, FailureClass.InfraBlocker);
    assert.equal(result.dispatchAction, DispatchAction.HumanOnly);
  });

  test('classifyError classifies state-machine-violation error as StateMachineViolation', () => {
    const result = classifyError('State violation: invalid transition from active to review');
    assert.equal(result.failureClass, FailureClass.StateMachineViolation);
    assert.equal(result.dispatchAction, DispatchAction.HumanOnly);
  });

  test('classifyError keeps a missing conflict implementer out of infrastructure failures', () => {
    const result = classifyError('No recorded implementer for task-2497; cannot launch conflict resolution.');
    assert.equal(result.failureClass, FailureClass.StateMachineViolation);
    assert.equal(result.dispatchAction, DispatchAction.HumanOnly);
  });

  test('classifyError returns InfraBlocker(HumanOnly) for unknown error', () => {
    const result = classifyError('Some completely unknown error that does not match any pattern');
    assert.equal(result.failureClass, FailureClass.InfraBlocker);
    assert.equal(result.dispatchAction, DispatchAction.HumanOnly);
  });

  // ── task-2233: reviewer-non-submission classification ─────────────────────

  test('classifyError classifies reviewer-non-submission (formal outcome) as InfraBlocker', () => {
    const result = classifyError('Reviewer custom did not submit a formal review outcome for mission/task-9001.');
    assert.equal(result.failureClass, FailureClass.InfraBlocker);
    assert.equal(result.dispatchAction, DispatchAction.HumanOnly);
  });

  test('classifyError classifies reviewer-non-submission (usable outcome) as InfraBlocker', () => {
    const result = classifyError('Reviewer claude did not submit a usable formal review outcome after 2 recovery retries.');
    assert.equal(result.failureClass, FailureClass.InfraBlocker);
    assert.equal(result.dispatchAction, DispatchAction.HumanOnly);
  });

  test('classifyError classifies reviewer-non-submission (local handoff) as InfraBlocker', () => {
    const result = classifyError('Reviewer custom did not leave a complete local review handoff for mission/task-9001.');
    assert.equal(result.failureClass, FailureClass.InfraBlocker);
    assert.equal(result.dispatchAction, DispatchAction.HumanOnly);
  });

  test('classifyError does not false-positive on partial matches', () => {
    // "tests passed" alone should NOT match UnverifiableClaims (needs verification failure)
    const r1 = classifyError('All tests passed');
    assert.notEqual(r1.failureClass, FailureClass.UnverifiableClaims);

    // "gate failed" alone should NOT match GateFailure if it's about malformed gates
    const r2 = classifyError('gate syntax error: invalid config');
    assert.notEqual(r2.failureClass, FailureClass.GateFailure);
  });

  // ── CP-3 tests: backward compatibility (SC4) ─────────────────────────────────

  test('isRelaunchableError backward compat: goal-check missing evidence → true', () => {
    const { isRelaunchableError } = repairHandoff;
    const msg = 'The final checkpoint at docs/missions/2026/task-1121/CP-3.md has a "## Goal Check" section but no evidence rows. A goal-check table with real evidence is required before handoff.';
    assert.equal(isRelaunchableError(msg), true);
  });

  test('isRelaunchableError backward compat: null → false', () => {
    const { isRelaunchableError } = repairHandoff;
    // @ts-expect-error Intentional non-string error-classification input.
    assert.equal(isRelaunchableError(null), false);
  });

  test('isRelaunchableError backward compat: undefined → false', () => {
    const { isRelaunchableError } = repairHandoff;
    // @ts-expect-error Intentional non-string error-classification input.
    assert.equal(isRelaunchableError(undefined), false);
  });

  test('isRelaunchableError backward compat: empty string → false', () => {
    const { isRelaunchableError } = repairHandoff;
    assert.equal(isRelaunchableError(''), false);
  });

  test('isRelaunchableError backward compat: unknown message → false', () => {
    const { isRelaunchableError } = repairHandoff;
    assert.equal(isRelaunchableError('Some other error'), false);
  });

  test('isRelaunchableError backward compat: dirty error → false', () => {
    const { isRelaunchableError } = repairHandoff;
    assert.equal(isRelaunchableError('MISSION.md is modified but uncommitted'), false);
  });

  test('isRelaunchableError backward compat: behind error → false', () => {
    const { isRelaunchableError } = repairHandoff;
    assert.equal(isRelaunchableError('git push failed: Updates were rejected'), false);
  });

  test('isRelaunchableError backward compat: verification-gate-failed → true', () => {
    const { isRelaunchableError } = repairHandoff;
    assert.equal(isRelaunchableError('verification gate failed: exit code 1'), true);
  });

  test('isRelaunchableError backward compat: declared-gate-failed → true', () => {
    const { isRelaunchableError } = repairHandoff;
    assert.equal(isRelaunchableError('Declared gate "lint" failed with exit code 2'), true);
  });

  test('repairHandoff uses classifyError internally for dirty errors', async () => {
    const adds: string[] = [];
    const commits: string[] = [];
    const logs: string[] = [];

    const gitFn: NonNullable<NonNullable<Parameters<typeof repairHandoff.default>[3]>["gitFn"]> = (args) => {
      if (args.includes('status')) {
        return { signal: null, stderr: '', 
          status: 0,
          stdout: [
            ' M missions/task-1037/MISSION.md',
          ].join('\0')
        };
      }
      if (args.includes('add')) {
        assert.deepEqual(args.slice(2, 5), ['add', '--all', '--']);
        adds.push(args[args.length - 1]);
        return { signal: null, stdout: '', stderr: '',  status: 0 };
      }
      if (args.includes('commit')) {
        commits.push(args[args.indexOf('-m') + 1]);
        return { signal: null, stdout: '', stderr: '',  status: 0 };
      }
      return { signal: null, stdout: '', stderr: '',  status: 0 };
    };

    const { repaired, blocker } = await repairHandoff.default('task-1037', '/tmp/worktree', 'MISSION.md is modified but uncommitted', {
      gitFn,
      log: (msg) => logs.push(msg)
    });

    assert.equal(repaired, true, 'repairHandoff should return repaired:true when classifyError detects GitBlockers');
    assert.equal(blocker, null);
    assert.deepEqual(adds, ['.']);
  });

  test('repairHandoff uses classifyError internally for behind errors', async () => {
    const logs: string[] = [];
    let rebaseCalled = false;

    const gitFn: NonNullable<NonNullable<Parameters<typeof repairHandoff.default>[3]>["gitFn"]> = (args) => {
      if (args.includes('status')) return { signal: null, stderr: '',  status: 0, stdout: '' };
      return { signal: null, stdout: '', stderr: '',  status: 0 };
    };

    const rebaseFn: NonNullable<NonNullable<Parameters<typeof repairHandoff.default>[3]>["rebaseFn"]> = async (args, opts) => {
      rebaseCalled = true;
      assert.ok(opts?.exitFn);
      opts.exitFn(0);
    };

    const { repaired, blocker } = await repairHandoff.default('task-1037', '/tmp/worktree', 'git push failed: Updates were rejected', {
      gitFn,
      rebaseFn,
      log: (msg) => logs.push(msg)
    });

    assert.equal(repaired, true, 'repairHandoff should return repaired:true when classifyError detects GitBlockers behind error');
    assert.equal(blocker, null);
    assert.equal(rebaseCalled, true);
  });

  test('repairHandoff returns false for non-GitBlocker errors', async () => {
    const { repaired } = await repairHandoff.default('task-1037', '/tmp/worktree', 'verification gate failed: exit code 1', {
      log: () => {}
    });

    assert.equal(repaired, false, 'repairHandoff should return repaired:false for non-GitBlocker errors');
  });

  // ── CP-4/CP-6: C6 InfraBlocker blocker message in repairHandoff ──────────────

  test('repairHandoff returns InfraBlocker-specific blocker message for infrastructure errors', async () => {
    const logs: string[] = [];
    const { repaired, blocker } = await repairHandoff.default('task-1037', '/tmp/worktree', 'connection timed out', {
      log: (msg) => logs.push(msg)
    });

    assert.equal(repaired, false, 'repairHandoff should return repaired:false for InfraBlocker');
    assert.ok(blocker, 'repairHandoff should return a non-null blocker for InfraBlocker errors');
    assert.ok(blocker.includes('infrastructure'), 'InfraBlocker blocker should mention infrastructure');
    assert.ok(blocker.toLowerCase().includes('forgejo'), 'InfraBlocker blocker should mention Forgejo');
    assert.ok(blocker.toLowerCase().includes('relaunch'), 'InfraBlocker blocker should state relaunch will not help');
    assert.ok(logs.some(l => l === blocker), 'InfraBlocker blocker should be logged');
  });

  test('repairHandoff returns InfraBlocker-specific blocker for token expired errors', async () => {
    const logs: string[] = [];
    const { repaired, blocker } = await repairHandoff.default('task-1037', '/tmp/worktree', 'Authentication failed for Forgejo: token expired', {
      log: (msg) => logs.push(msg)
    });

    assert.equal(repaired, false);
    assert.ok(blocker, 'repairHandoff should return a non-null blocker for token expired');
    assert.ok(blocker.includes('infrastructure'), 'InfraBlocker blocker should mention infrastructure');
  });

  // ── Finding 1 fix: isBehind derived from classifyError(reason) ────────────────

  test('classifyError returns reason field for GitBlockers (dirty and behind)', () => {
    const dirty = classifyError('MISSION.md is modified but uncommitted');
    assert.equal(dirty.reason, 'dirty');

    const behind = classifyError('git push failed: Updates were rejected');
    assert.equal(behind.reason, 'behind');

    const nonGitBlocker = classifyError('verification gate failed');
    assert.equal(nonGitBlocker.reason, undefined);
  });

  test('repairHandoff derives isBehind from classifyError reason (dirty only, no rebase)', async () => {
    const adds: string[] = [];
    const commits: true[] = [];
    let rebaseCalled = false;

    const gitFn: NonNullable<NonNullable<Parameters<typeof repairHandoff.default>[3]>["gitFn"]> = (args) => {
      if (args.includes('status')) {
        return { signal: null, stderr: '',  status: 0, stdout: ' M missions/task-1037/MISSION.md' };
      }
      if (args.includes('add')) { adds.push(args[args.length - 1]); return { signal: null, stdout: '', stderr: '',  status: 0 }; }
      if (args.includes('commit')) { commits.push(true); return { signal: null, stdout: '', stderr: '',  status: 0 }; }
      return { signal: null, stdout: '', stderr: '',  status: 0 };
    };

    const rebaseFn: NonNullable<NonNullable<Parameters<typeof repairHandoff.default>[3]>["rebaseFn"]> = async () => { rebaseCalled = true; };

    const { repaired } = await repairHandoff.default('task-1037', '/tmp/worktree', 'MISSION.md is modified but uncommitted', {
      gitFn,
      rebaseFn,
      log: () => {}
    });

    assert.equal(repaired, true);
    assert.equal(rebaseCalled, false, 'Should NOT call rebase for dirty (non-behind) GitBlockers');
  });
});

// TASK-2202 (was test/task-2202-repair-handoff-autocommit.test.ts)
describe('Repair handoff auto-commit', () => {
  test('repairHandoff auto-commits bounded implementation files for active-step handoff repair', async () => {
    const adds: string[] = [];
    const commits: string[] = [];
    const logs: string[] = [];

    const gitFn: NonNullable<NonNullable<Parameters<typeof repairHandoff.default>[3]>["gitFn"]> = (args) => {
      if (args.includes('status')) {
        return { signal: null, stderr: '', 
          status: 0,
          stdout: [
            ' M missions/task-2202/MISSION.md',
            ' M backlog/tasks/task-2202 - parallix-autocommit-seems-to-exclude-some-files.md',
            ' M lib/commands/repair-handoff.ts',
            ' M px.ts',
            '?? test/task-2202-repair-handoff-autocommit.test.js'
          ].join('\0')
        };
      }
      if (args.includes('add')) {
        assert.deepEqual(args.slice(2, 5), ['add', '--all', '--']);
        adds.push(...args.slice(args.indexOf('--') + 1));
        return { signal: null, stdout: '', stderr: '',  status: 0 };
      }
      if (args.includes('commit')) {
        commits.push(args[args.indexOf('-m') + 1]);
        return { signal: null, stdout: '', stderr: '',  status: 0 };
      }
      return { signal: null, stdout: '', stderr: '',  status: 0 };
    };

    const { repaired, blocker } = await repairHandoff.default(
      'task-2202',
      '/tmp/worktree',
      'MISSION.md is modified but uncommitted',
      {
        gitFn,
        log: (msg) => logs.push(msg)
      }
    );

    assert.equal(repaired, true, `expected active-step repair to auto-commit bounded implementation files; blocker was: ${blocker}`);
    assert.equal(blocker, null);
    assert.deepEqual(adds, ['.']);
    assert.deepEqual(commits, [
      'workflow(task-2202): auto-commit mission artifacts before handoff'
    ]);
    assert.ok(logs.some(line => line.includes('Auto-committing dirty files')));
  });

  test('repairHandoff auto-commits all non-conflicted dirty files for git-blocker handoff repair', async () => {
    const adds: string[][] = [];
    const commits: string[] = [];

    const gitFn: NonNullable<NonNullable<Parameters<typeof repairHandoff.default>[3]>["gitFn"]> = (args) => {
      if (args.includes('status')) {
        return { signal: null, stderr: '', 
          status: 0,
          stdout: [
            ' M src/adapters/cli/commands/repair-handoff.ts',
            ' M docs/adr/0048-rebound-kernel.md',
            ' M graphify-out/graph.json',
            ' M backlog/completed/task-2480.md'
          ].join('\0')
        };
      }
      if (args.includes('add')) {
        assert.deepEqual(args.slice(2, 5), ['add', '--all', '--']);
        adds.push(args.slice(args.indexOf('--') + 1));
        return { signal: null, stdout: '', stderr: '',  status: 0 };
      }
      if (args.includes('commit')) {
        commits.push(args[args.indexOf('-m') + 1]);
        return { signal: null, stdout: '', stderr: '',  status: 0 };
      }
      return { signal: null, stdout: '', stderr: '',  status: 0 };
    };

    const { repaired, blocker } = await repairHandoff.default(
      'task-2480',
      '/tmp/worktree',
      'MISSION.md is modified but uncommitted',
      { gitFn }
    );

    assert.equal(repaired, true, `expected git-blocker repair to commit all dirty files; blocker was: ${blocker}`);
    assert.equal(blocker, null);
    assert.deepEqual(adds, [['.']]);
    assert.deepEqual(commits, [
      'workflow(task-2480): auto-commit mission artifacts before handoff'
    ]);
  });
});

// TASK-2366 (was test/task-2366-repro.test.ts)
describe('Rebase failure classification', () => {
  const { classifyError, FailureClass, DispatchAction } = repairHandoff;
  test('task-2366 repro: classifyError maps rebase failure to GateFailure/AutoSendBack', () => {
    const result = classifyError(
      'Rebase failed before handoff. Ensure the mission branch can be rebased onto the latest primary branch.',
    );
    assert.equal(result.failureClass, FailureClass.GateFailure,
      'rebase failure must be classified as a relaunchable gate failure, not an infrastructure blocker');
    assert.equal(result.dispatchAction, DispatchAction.AutoSendBack,
      'rebase failure must auto-send-back to the implementer');
  });
});
test('nested handoff preserves configuration and caller rebase seams (TASK-2744)', async () => {
  const configuration = resolveConfiguration({ PATH: '/injected/bin', PARALLIX_HOME: '/injected/home' });
  const gitFn = () => ({ signal: null,  status: 0, stdout: '', stderr: '' });
  const createPrFn = () => ({ ok: true as const });
  const runRebaseWorkflowFn = async () => {};
  mock.method(reviewRebase, 'rebaseBeforeReviewRound', async (slug: Parameters<(typeof reviewRebase)["rebaseBeforeReviewRound"]>[0], options: Parameters<(typeof reviewRebase)["rebaseBeforeReviewRound"]>[1]) => {
    assert.equal(slug, 'task-2744');
    assert.ok(options != null);
    assert.strictEqual(options.gitFn, gitFn);
    assert.strictEqual(options.runRebaseWorkflowFn, runRebaseWorkflowFn);
    assert.ok(options.rebaseWorkflowOptions != null);
    assert.strictEqual(options.rebaseWorkflowOptions.createPrFn, createPrFn);
    assert.strictEqual(options.rebaseWorkflowOptions.configuration, configuration);
    return { ok: true as const, sharedFileConflicts: false, hookFailure: false };
  });
  const options = {
    gitFn, worktree: '/fixture', runRebaseWorkflowFn, rebaseWorkflowOptions: { createPrFn },
    log: () => {}, error: () => {}, isForgejoReviewEnabledFn: () => true,
  };
  const result = await handoff.createHandoffPorts(configuration).rebase.rebaseBeforeReviewRound('task-2744', options);
  assert.equal(result.ok, true);
});
test('default execute runtime preserves configuration through handoff and automatic repair rebase (TASK-2744)', async () => {
  const configuration = resolveConfiguration({ PATH: '/injected/bin', PARALLIX_HOME: '/injected/home' });
  const runtime = execute.createDefaultExecuteMissionRuntime(configuration);
  let handoffs = 0;
  mock.method(handoff, 'performHandoff', async (slug: Parameters<(typeof handoff)["performHandoff"]>[0], options: Parameters<(typeof handoff)["performHandoff"]>[1]) => {
    assert.equal(slug, 'task-2744');
    assert.ok(options != null);
    assert.strictEqual(options.configuration, configuration);
    assert.equal(options.worktree, '/fixture');
    handoffs += 1;
    return { ok: true as const };
  });
  assert.equal((await runtime.performHandoff('task-2744', { worktree: '/fixture' })).ok, true);
  assert.equal(handoffs, 1);
  const gitCalls: { args: string[]; options: GitOptions | undefined; }[] = [];
  const gitFn: NonNullable<NonNullable<Parameters<typeof runtime.repairHandoff>[3]>["gitFn"]> = (args, options) => { gitCalls.push({ args, options }); return { signal: null, stderr: '',  status: 0, stdout: '' }; };
  let rebases = 0;
  const result = await runtime.repairHandoff('task-2744', '/fixture', 'git push failed: Updates were rejected', {
    gitFn, log: () => {}, error: () => {},
    rebaseFn: async (args, options) => {
      assert.deepEqual(args, ['task-2744']);
      assert.ok(options != null);
      assert.strictEqual(options.configuration, configuration);
      assert.ok(options.gitFn);
      options.gitFn(['status'], { cwd: '/wrong', marker: 'preserved' });
      assert.deepEqual(gitCalls.at(-1), { args: ['status'], options: { cwd: '/fixture', marker: 'preserved' } });
      assert.equal(typeof options.getCurrentBranchFn, 'function');
      rebases += 1;
      assert.ok(options.exitFn);
      options.exitFn(0);
    },
  });
  assert.equal(rebases, 1);
  assert.deepEqual(result, { repaired: true, blocker: null });
});
// The repair launcher may succeed without committing its edits (px-0014).
test('successful gate repair commits tracked and untracked edits before handoff rebase (px-0014)', async () => {
  const { HandoffCommandUseCase } = await import('../../../../../src/application/handoff-command-use-case.js');
  const { SLUG, ROOT, makeRecorder, makePorts, runOptions } = await import('../../../../helpers/handoff-ports.js');
  const recorder = makeRecorder();
  const events: string[] = [];
  let dirty = false;
  let gateRuns = 0;
  const ports = makePorts(recorder, {
    git: { git: args => {
      assert.equal(args[1], ROOT, 'Git operations stay in the selected worktree');
      if (args.includes('status')) return { signal: null, status: 0, stderr: '', stdout: dirty ? ' M src/fix.ts\0?? test/fix.test.ts\0' : '' };
      if (args.includes('add')) events.push('stage');
      if (args.includes('commit')) { events.push('commit'); dirty = false; }
      return { signal: null, status: 0, stderr: '', stdout: args.includes('rev-parse') ? 'head' : '' };
    } },
    agents: { startAgent: async () => { dirty = true; events.push('repair'); return { agent: 'claude', result: { status: 0 } }; } },
    rebase: { rebaseBeforeReviewRound: async () => {
      events.push('rebase');
      assert.equal(dirty, false, 'eligible repair changes must be committed before rebase');
      assert.ok(events.includes('commit'));
      return { ok: true, sharedFileConflicts: false, hookFailure: false };
    } },
  });
  ports.git.commitMissionChanges = (root, slug, log, error) =>
    commitDirtyFiles(root, slug, args => ports.git.git(args), log, error);
  const result = await new HandoffCommandUseCase(ports).performHandoff(SLUG, runOptions(recorder, {
    recoverGateFailure: true,
    runVerificationGateFn: () => ({ status: ++gateRuns === 1 ? 1 : 0, stdout: '', stderr: '' }),
  }));
  assert.equal(result.ok, true, result.error ?? "handoff failed");
  assert.deepEqual(events, ['repair', 'stage', 'commit', 'rebase']);
});
for (const operation of ['status', 'commit', 'throw'] as const) {
  test(`automatic Git repair stops before rebase on ${operation} failure (px-0014)`, async () => {
    const calls: string[][] = [];
    const result = await repairHandoff.default('px-0014', '/selected', 'git push failed: Updates were rejected', {
      gitFn: args => {
        calls.push(args);
        assert.equal(args[1], '/selected');
        if (operation === 'throw') throw new Error('Git unavailable');
        return { status: args[2] === operation ? 1 : 0, stderr: 'permission denied',
          stdout: args[2] === 'status' ? ' M file\0' : '' };
      },
      rebaseFn: async () => { assert.fail('must not rebase'); },
      log: () => {}, error: () => {},
    });
    assert.equal(result.repaired, false);
    assert.match(result.blocker ?? '', operation === 'throw' ? /Git unavailable/ : /permission denied/);
    if (operation !== 'commit') assert.equal(calls.length, 1);
  });
}
test('direct and explicit state recognition agree without widening unknown fallback (TASK-2780)', () => {
  for (const diagnostic of ['Task state invalid for review', 'No recorded implementer for task-2780; cannot launch conflict resolution.']) {
    assert.deepEqual(repairHandoff.classifyError(diagnostic), {
      failureClass: 'StateMachineViolation', dispatchAction: 'HumanOnly',
    });
    assert.equal(hasExplicitHumanOnlyDiagnostic(diagnostic), true);
  }
  assert.deepEqual(repairHandoff.classifyError('unrecognized diagnostic'), {
    failureClass: 'InfraBlocker', dispatchAction: 'HumanOnly',
  });
  assert.equal(hasExplicitHumanOnlyDiagnostic('unrecognized diagnostic'), false);
});
test('explicit evidence ignores passing titles and retains capacity precedence (TASK-2780)', () => {
  for (const prefix of ['✔ ', '  ✓ ', 'ok 14 - ']) {
    assert.equal(hasExplicitHumanOnlyDiagnostic(prefix + 'Task state invalid'), false);
    assert.equal(hasExplicitHumanOnlyDiagnostic(prefix + 'forgejo forbidden'), false);
  }
  assert.equal(hasExplicitHumanOnlyDiagnostic('not ok 14 - Task state invalid'), true);
  assert.equal(hasExplicitHumanOnlyDiagnostic('✖ forgejo authentication failed'), true);
  assert.equal(hasExplicitHumanOnlyDiagnostic('quota exhausted'), false);
  assert.equal(repairHandoff.classifyError('quota exhausted').failureClass, 'AgentCapacity');
  assert.equal(hasExplicitHumanOnlyDiagnostic('forgejo quota exhausted'), true);
  assert.equal(repairHandoff.classifyError('forgejo quota exhausted').failureClass, 'InfraBlocker');
});
