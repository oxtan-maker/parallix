
const test = require('node:test');
const assert = require('node:assert/strict');
const repairHandoff = require('../dist/lib/commands/repair-handoff');
const { classifyError, getDispatchAction, FailureClass, DispatchAction } = repairHandoff;

test('repairHandoff auto-commits safe mission files', async () => {
  const adds = [];
  const commits = [];
  const logs = [];

  const gitFn = (args) => {
    if (args.includes('status')) {
      return { 
        status: 0, 
        stdout: [
          ' M missions/task-1037/MISSION.md',
          '?? missions/task-1037/CP-1.md',
          ' M backlog/tasks/task-1037 - some task.md'
        ].join('\n')
      };
    }
    if (args.includes('add')) {
      adds.push(args[args.length - 1]);
      return { status: 0 };
    }
    if (args.includes('commit')) {
      commits.push(args[args.indexOf('-m') + 1]);
      return { status: 0 };
    }
    return { status: 0 };
  };

  const { repaired, blocker } = await repairHandoff('task-1037', '/tmp/worktree', 'MISSION.md is modified but uncommitted', {
    taskFile: '/tmp/worktree/backlog/tasks/task-1037 - some task.md',
    gitFn,
    log: (msg) => logs.push(msg)
  });

  assert.equal(repaired, true, 'repairHandoff should return repaired:true when it committed files');
  assert.equal(blocker, null);
  assert.equal(adds.length, 3);
  assert.ok(adds.includes('missions/task-1037/MISSION.md'));
  assert.ok(adds.includes('missions/task-1037/CP-1.md'));
  assert.ok(adds.includes('backlog/tasks/task-1037 - some task.md'));
  assert.equal(commits.length, 1);
  assert.match(commits[0], /auto-commit mission artifacts/);
});

test('repairHandoff stages renamed mission files by destination path', async () => {
  const adds = [];
  const commits = [];

  const gitFn = (args) => {
    if (args.includes('status')) {
      return {
        status: 0,
        stdout: [
          'R  missions/task-1037/CP-1.md -> missions/task-1037/CP-1-renamed.md'
        ].join('\n')
      };
    }
    if (args.includes('add')) {
      adds.push(args[args.length - 1]);
      return { status: 0 };
    }
    if (args.includes('commit')) {
      commits.push(true);
      return { status: 0 };
    }
    return { status: 0 };
  };

  const { repaired, blocker } = await repairHandoff('task-1037', '/tmp/worktree', 'MISSION.md is modified but uncommitted', {
    gitFn,
    log: () => {}
  });

  assert.equal(repaired, true);
  assert.equal(blocker, null);
  assert.deepEqual(adds, ['missions/task-1037/CP-1-renamed.md']);
  assert.equal(commits.length, 1);
});

test('repairHandoff refuses to commit when operator-local or generated paths are dirty', async () => {
  const adds = [];
  const logs = [];

  const gitFn = (args) => {
    if (args.includes('status')) {
      return { 
        status: 0, 
        stdout: [
          ' M missions/task-1037/MISSION.md',
          ' M .workflow/codex-home/.codex/logs_2.sqlite',
          ' M .sessions/task-1037-implementer.json',
          ' M .forgejo-local/tokens/codex',
          ' M graphify-out/GRAPH_REPORT.md'
        ].join('\n')
      };
    }
    if (args.includes('add')) {
      adds.push(args[args.length - 1]);
      return { status: 0 };
    }
    return { status: 0 };
  };

  const { repaired, blocker } = await repairHandoff('task-1037', '/tmp/worktree', 'MISSION.md is modified but uncommitted', {
    gitFn,
    log: (msg) => logs.push(msg)
  });

  assert.equal(repaired, false, 'repairHandoff should return repaired:false when unsafe files are dirty');
  assert.ok(blocker && blocker.includes('.workflow/codex-home/.codex/logs_2.sqlite'));
  assert.ok(blocker && blocker.includes('.sessions/task-1037-implementer.json'));
  assert.ok(blocker && blocker.includes('.forgejo-local/tokens/codex'));
  assert.ok(blocker && blocker.includes('graphify-out/GRAPH_REPORT.md'));
  assert.equal(adds.length, 0, 'No files should be added if unsafe files are present');
  assert.ok(logs.some(l => l.includes('dirty files include non-mission paths')));
  assert.ok(logs.some(l => l.includes('.workflow/codex-home/.codex/logs_2.sqlite')));
  assert.ok(logs.some(l => l.includes('.sessions/task-1037-implementer.json')));
  assert.ok(logs.some(l => l.includes('.forgejo-local/tokens/codex')));
  assert.ok(logs.some(l => l.includes('graphify-out/GRAPH_REPORT.md')));
});

test('repairHandoff refuses to commit when arbitrary non-mission repo files are dirty', async () => {
  const adds = [];
  const logs = [];

  const gitFn = (args) => {
    if (args.includes('status')) {
      return {
        status: 0,
        stdout: [
          ' M missions/task-1037/MISSION.md',
          ' M server/src/main/java/visual/App.java',
          ' M .env',
          ' M .claude/settings.local.json'
        ].join('\n')
      };
    }
    if (args.includes('add')) {
      adds.push(args[args.length - 1]);
      return { status: 0 };
    }
    return { status: 0 };
  };

  const { repaired, blocker } = await repairHandoff('task-1037', '/tmp/worktree', 'MISSION.md is modified but uncommitted', {
    gitFn,
    log: (msg) => logs.push(msg)
  });

  assert.equal(repaired, false, 'repairHandoff should return repaired:false when arbitrary repo files fall outside the bounded implementation allowlist');
  assert.ok(blocker && blocker.includes('server/src/main/java/visual/App.java'));
  assert.ok(blocker && blocker.includes('.env'));
  assert.ok(blocker && blocker.includes('.claude/settings.local.json'));
  assert.equal(adds.length, 0, 'No files should be added if arbitrary non-mission files are present');
  assert.ok(logs.some(l => l.includes('dirty files include non-mission paths')));
});

test('repairHandoff reports staging failures and stops before commit', async () => {
  const adds = [];
  const commits = [];
  const errors = [];

  const gitFn = (args) => {
    if (args.includes('status')) {
      return {
        status: 0,
        stdout: [
          ' M missions/task-1037/MISSION.md'
        ].join('\n')
      };
    }
    if (args.includes('add')) {
      adds.push(args[args.length - 1]);
      return { status: 1, stderr: 'permission denied' };
    }
    if (args.includes('commit')) {
      commits.push(true);
      return { status: 0 };
    }
    return { status: 0 };
  };

  const { repaired, blocker } = await repairHandoff('task-1037', '/tmp/worktree', 'MISSION.md is modified but uncommitted', {
    gitFn,
    error: (msg) => errors.push(msg),
    log: () => {}
  });

  assert.equal(repaired, false);
  assert.match(blocker, /failed to stage mission artifacts/);
  assert.match(blocker, /permission denied/);
  assert.equal(commits.length, 0);
  assert.ok(errors.some(line => line.includes('failed to stage mission artifacts')));
});

test('repairHandoff refuses to commit when mission files are conflicted', async () => {
  const adds = [];
  const logs = [];

  const gitFn = (args) => {
    if (args.includes('status')) {
      return { 
        status: 0, 
        stdout: [
          'UU missions/task-1037/MISSION.md'
        ].join('\n')
      };
    }
    return { status: 0 };
  };

  const { repaired, blocker } = await repairHandoff('task-1037', '/tmp/worktree', 'MISSION.md is modified but uncommitted', {
    gitFn,
    log: (msg) => logs.push(msg)
  });

  assert.equal(repaired, false);
  assert.match(blocker, /Conflicted files detected/);
  assert.match(blocker, /missions\/task-1037\/MISSION\.md/);
  assert.equal(adds.length, 0);
  assert.ok(logs.some(l => l.includes('Cannot auto-commit: Conflicted files detected')));
});

test('repairHandoff calls rebase when branch is behind', async () => {
  const logs = [];
  let rebaseCalled = false;

  const gitFn = (args) => {
    if (args.includes('status')) return { status: 0, stdout: '' };
    return { status: 0 };
  };

  const rebaseFn = async (args, opts) => {
    rebaseCalled = true;
    assert.equal(args[0], 'task-1037');
    opts.exitFn(0);
  };

  const { repaired, blocker } = await repairHandoff('task-1037', '/tmp/worktree', 'git push failed: Updates were rejected', {
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
  const logs = [];
  const errors = [];

  const gitFn = (args) => {
    if (args.includes('status')) return { status: 0, stdout: '' };
    return { status: 0 };
  };

  const rebaseFn = async (args, opts) => {
    opts.exitFn(1);
  };

  const { repaired, blocker } = await repairHandoff('task-1037', '/tmp/worktree', 'git push failed: Updates were rejected', {
    gitFn,
    rebaseFn,
    log: (msg) => logs.push(msg),
    error: (msg) => errors.push(msg)
  });

  assert.equal(repaired, false, 'repairHandoff should return repaired:false when rebase failed');
  assert.match(blocker, /Auto-rebase failed: rebase exited with code 1/);
  assert.ok(errors.some(l => l.includes('Auto-rebase failed')));
});

test('repairHandoff auto-commits safe mission files including completed tasks', async () => {
  const adds = [];
  const gitFn = (args) => {
    if (args.includes('status')) {
      return { 
        status: 0, 
        stdout: [
          ' M backlog/completed/task-1037 - some task.md'
        ].join('\n')
      };
    }
    if (args.includes('add')) {
      adds.push(args[args.length - 1]);
      return { status: 0 };
    }
    return { status: 0 };
  };

  const { repaired } = await repairHandoff('task-1037', '/tmp/worktree', 'MISSION.md is modified but uncommitted', {
    taskFile: '/tmp/worktree/backlog/completed/task-1037 - some task.md',
    gitFn,
    log: () => {}
  });

  assert.equal(repaired, true);
  assert.ok(adds.includes('backlog/completed/task-1037 - some task.md'));
});

test('repairHandoff returns repaired:false when rebase fails after successful auto-commit', async () => {
  const gitFn = (args) => {
    if (args.includes('status')) {
      return { status: 0, stdout: ' M missions/task-1037/MISSION.md' };
    }
    if (args.includes('add')) return { status: 0 };
    if (args.includes('commit')) return { status: 0 };
    return { status: 0 };
  };

  const rebaseFn = async (args, opts) => {
    opts.exitFn(1); // Rebase fails
  };

  const { repaired, blocker } = await repairHandoff('task-1037', '/tmp/worktree', 'Updates were rejected', {
    gitFn,
    rebaseFn,
    log: () => {},
    error: () => {}
  });

  assert.equal(repaired, false, 'Should be false because rebase failed');
  assert.match(blocker, /Auto-rebase failed/);
});

test('repairHandoff returns repaired:false for generic git push failed (auth/transport)', async () => {
  const { repaired } = await repairHandoff('task-1037', '/tmp/worktree', 'git push failed with status 128: fatal: Authentication failed', {
    log: () => {}
  });

  assert.equal(repaired, false);
});

// CP-1 tests for isRelaunchableError and buildRelaunchPrompt

test('isRelaunchableError returns true for goal-check table missing evidence rows error', () => {
  const { isRelaunchableError } = repairHandoff;
  const errorMsg = 'The final checkpoint at docs/missions/2026/task-1121/CP-3.md has a "## Goal Check" section but no evidence rows. A goal-check table with real evidence is required before handoff.';
  assert.equal(isRelaunchableError(errorMsg), true);
});

test('isRelaunchableError returns false for non-relaunchable errors', () => {
  const { isRelaunchableError } = repairHandoff;
  
  assert.equal(isRelaunchableError(null), false);
  assert.equal(isRelaunchableError(undefined), false);
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

test('buildRelaunchPrompt returns string containing Goal Check table and mission slug', () => {
  const { buildRelaunchPrompt } = repairHandoff;
  const errorMsg = 'The final checkpoint at docs/missions/2026/task-1121/CP-3.md has a "## Goal Check" section but no evidence rows. A goal-check table with real evidence is required before handoff.';
  const prompt = buildRelaunchPrompt(errorMsg, 'task-1124', '/tmp/worktree');
  
  assert.ok(typeof prompt === 'string', 'Prompt should be a string');
  assert.ok(prompt.includes('Goal Check table'), 'Prompt should contain "Goal Check table"');
  assert.ok(prompt.includes('task-1124'), 'Prompt should contain the mission slug');
  assert.ok(/file:line/i.test(prompt), 'Prompt should mention file:line references');
  assert.ok(/test names/i.test(prompt), 'Prompt should mention test names');
  assert.ok(prompt.includes('px review task-1124 --submit'), 'Prompt should use the supported px re-submit command');
  assert.ok(!prompt.includes('node parallix'), 'Prompt must not suggest a nonexistent node parallix executable');
});

test('buildRelaunchPrompt directs gate-failure repairs back through the supported submit path', () => {
  const { buildRelaunchPrompt } = repairHandoff;
  const prompt = buildRelaunchPrompt('Final verification gate failed. Fix errors before submitting.', 'task-1124', '/tmp/worktree');

  assert.ok(prompt.includes('px review task-1124 --submit'));
  assert.ok(!prompt.includes('node parallix'));
});

test('buildRelaunchPrompt includes example table', () => {
  const { buildRelaunchPrompt } = repairHandoff;
  const errorMsg = 'The final checkpoint at docs/missions/2026/task-1121/CP-3.md has a "## Goal Check" section but no evidence rows. A goal-check table with real evidence is required before handoff.';
  const prompt = buildRelaunchPrompt(errorMsg, 'task-1124', '/tmp/worktree');
  
  assert.ok(prompt.includes('| Criterion | Evidence | Status |'), 'Prompt should include example table header');
  assert.ok(prompt.includes('|---|---|---|'), 'Prompt should include example table separator');
});

test('buildRelaunchPrompt gives actionable replacement guidance for shell-only offending rows', () => {
  const { buildRelaunchPrompt } = repairHandoff;
  const errorMsg = 'The final checkpoint at docs/missions/2026/task-1121/CP-3.md has a "## Goal Check" section but no evidence rows that cite a verifiable reference such as a file:line, ADR, test reference, or recognized repo command/path. A goal-check table with real evidence is required before handoff. Offending row: | `bin/hello.sh` exists as regular file with execute permissions | `stat -c \'%A\' bin/hello.sh` → `-rwxrwxr-x` | PASS |';
  const prompt = buildRelaunchPrompt(errorMsg, 'task-1124', '/tmp/worktree');

  assert.ok(prompt.includes('Offending row:'), 'Prompt should surface the offending row context');
  assert.ok(prompt.includes("`stat -c '%A' bin/hello.sh`"), 'Prompt should include the rejected shell-only evidence');
  assert.ok(prompt.includes('Do not retry with only shell output or file metadata'), 'Prompt should tell the agent what not to repeat');
  assert.ok(prompt.includes('file:line reference'), 'Prompt should point the agent at file:line evidence');
  assert.ok(prompt.includes('ADR reference'), 'Prompt should point the agent at ADR evidence');
  assert.ok(prompt.includes('recognized repo command/path'), 'Prompt should point the agent at accepted repo commands and paths');
  assert.ok(!prompt.includes('wrap it in backticks so the validator recognizes it'), 'Prompt should not repeat the old vague backtick-only advice');
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

test('classifyError returns InfraBlocker(HumanOnly) for unknown error', () => {
  const result = classifyError('Some completely unknown error that does not match any pattern');
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
  assert.equal(isRelaunchableError(null), false);
});

test('isRelaunchableError backward compat: undefined → false', () => {
  const { isRelaunchableError } = repairHandoff;
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
  const adds = [];
  const commits = [];
  const logs = [];

  const gitFn = (args) => {
    if (args.includes('status')) {
      return {
        status: 0,
        stdout: [
          ' M missions/task-1037/MISSION.md',
        ].join('\n')
      };
    }
    if (args.includes('add')) {
      adds.push(args[args.length - 1]);
      return { status: 0 };
    }
    if (args.includes('commit')) {
      commits.push(args[args.indexOf('-m') + 1]);
      return { status: 0 };
    }
    return { status: 0 };
  };

  const { repaired, blocker } = await repairHandoff('task-1037', '/tmp/worktree', 'MISSION.md is modified but uncommitted', {
    taskFile: '/tmp/worktree/backlog/tasks/task-1037 - some task.md',
    gitFn,
    log: (msg) => logs.push(msg)
  });

  assert.equal(repaired, true, 'repairHandoff should return repaired:true when classifyError detects GitBlockers');
  assert.equal(blocker, null);
  assert.ok(adds.includes('missions/task-1037/MISSION.md'));
});

test('repairHandoff uses classifyError internally for behind errors', async () => {
  const logs = [];
  let rebaseCalled = false;

  const gitFn = (args) => {
    if (args.includes('status')) return { status: 0, stdout: '' };
    return { status: 0 };
  };

  const rebaseFn = async (args, opts) => {
    rebaseCalled = true;
    opts.exitFn(0);
  };

  const { repaired, blocker } = await repairHandoff('task-1037', '/tmp/worktree', 'git push failed: Updates were rejected', {
    gitFn,
    rebaseFn,
    log: (msg) => logs.push(msg)
  });

  assert.equal(repaired, true, 'repairHandoff should return repaired:true when classifyError detects GitBlockers behind error');
  assert.equal(blocker, null);
  assert.equal(rebaseCalled, true);
});

test('repairHandoff returns false for non-GitBlocker errors', async () => {
  const { repaired } = await repairHandoff('task-1037', '/tmp/worktree', 'verification gate failed: exit code 1', {
    log: () => {}
  });

  assert.equal(repaired, false, 'repairHandoff should return repaired:false for non-GitBlocker errors');
});

// ── CP-4/CP-6: C6 InfraBlocker blocker message in repairHandoff ──────────────

test('repairHandoff returns InfraBlocker-specific blocker message for infrastructure errors', async () => {
  const logs = [];
  const { repaired, blocker } = await repairHandoff('task-1037', '/tmp/worktree', 'connection timed out', {
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
  const logs = [];
  const { repaired, blocker } = await repairHandoff('task-1037', '/tmp/worktree', 'Authentication failed for Forgejo: token expired', {
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
  const adds = [];
  const commits = [];
  let rebaseCalled = false;

  const gitFn = (args) => {
    if (args.includes('status')) {
      return { status: 0, stdout: ' M missions/task-1037/MISSION.md' };
    }
    if (args.includes('add')) { adds.push(args[args.length - 1]); return { status: 0 }; }
    if (args.includes('commit')) { commits.push(true); return { status: 0 }; }
    return { status: 0 };
  };

  const rebaseFn = async () => { rebaseCalled = true; };

  const { repaired } = await repairHandoff('task-1037', '/tmp/worktree', 'MISSION.md is modified but uncommitted', {
    gitFn,
    rebaseFn,
    log: () => {}
  });

  assert.equal(repaired, true);
  assert.equal(rebaseCalled, false, 'Should NOT call rebase for dirty (non-behind) GitBlockers');
});
