/**
 * Hermetic mocked-port tests for the re-homed handoff workflow (TASK-2332.09).
 *
 * Every collaborator is a plain in-memory stub supplied through
 * `HandoffWorkflowPorts`. No test here touches Forgejo, an agent CLI, a real
 * git repository, or a recursive workflow command.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { HandoffCommandUseCase } from '../src/application/handoff-command-use-case.js';
import { isTransientVerificationFailure } from '../src/adapters/verification/verification.js';
import type { HandoffWorkflowPorts } from '../src/application/ports/handoff-workflow.js';

const SLUG = 'task-2332.09';
const ROOT = '/root';
const MISSION_DIR = '/root/missions/task-2332.09';
const CHECKPOINT = '/root/missions/task-2332.09/CP-1.md';
const BRANCH = 'mission/task-2332.09';

const CHECKPOINT_CONTENT = [
  '# CP-1: Example',
  '',
  '## Goal Check',
  '',
  '| Criterion | Evidence | Status |',
  '|---|---|---|',
  '| Workflow re-homed | src/application/handoff-command-use-case.ts:1 | PASS |',
  '',
  'Next action: hand off.',
  '',
].join('\n');

const MISSION_CONTENT = [
  '# Mission',
  '',
  '## Gates',
  '',
  '- [ ] `npm run typecheck`',
  '',
  '## Stop Rules',
  '',
].join('\n');

interface Recorder {
  readonly log: string[];
  readonly errors: string[];
  readonly relaunches: number[];
  readonly transitions: string[];
  readonly gatekeeperCalls: number[];
  readonly spawned: string[];
}

function makeRecorder(): Recorder {
  return { log: [], errors: [], relaunches: [], transitions: [], gatekeeperCalls: [], spawned: [] };
}

/**
 * A fully stubbed port bag whose defaults drive a successful handoff.
 * Each test overrides only the ports its scenario needs.
 */
function makePorts(recorder: Recorder, overrides: Record<string, unknown> = {}): HandoffWorkflowPorts {
  const files: Record<string, string> = {
    [CHECKPOINT]: CHECKPOINT_CONTENT,
    [`${MISSION_DIR}/MISSION.md`]: MISSION_CONTENT,
  };
  const base = {
    fileSystem: {
      existsSync: () => true,
      readText: (target: string) => files[target] ?? '',
      writeText: (target: string, content: string) => { files[target] = content; },
      listNames: () => [],
      listEntries: () => [],
    },
    git: {
      git: () => ({ status: 0, stdout: '', stderr: '' }),
      run: () => ({ status: 0 }),
      getCurrentBranch: () => BRANCH,
      getWorktreeStatus: () => [] as string[],
    },
    missionUtils: {
      inferSlug: (explicit?: string) => explicit,
      resolveWorktree: () => ROOT,
      findMissionDir: () => MISSION_DIR,
      findMissionArea: () => 'docs',
      missionBranchName: () => BRANCH,
      findCheckpoints: () => [CHECKPOINT],
      getPrimaryBranch: () => 'main',
    },
    backlog: {
      resolveTaskFile: () => ({ ok: true, taskFile: '/root/backlog/tasks/task-2332.09.md' }),
      getTaskImplementer: () => 'claude',
      transitionTask: (_slug: string, status: string) => { recorder.transitions.push(status); return true; },
    },
    forgejo: {
      readToken: () => 'token',
      resolveForgejoSettings: () => ({ url: 'http://localhost', repo: 'human/parallix' }),
      createPr: () => ({ ok: true }),
      authenticatedReviewUrl: () => 'http://localhost/human/parallix.git',
      resolveTrackingBranchSha: () => ({ ok: true, sha: 'abc123' }),
    },
    reviewIdentity: {
      resolveReviewIdentity: async () => ({ forgejoUser: 'claude' }),
    },
    setupReview: {
      bootstrapReviewSurface: async () => ({ ok: true }),
      apiRequest: () => ({ ok: true }),
    },
    rebase: {
      rebaseBeforeReviewRound: async () => ({ ok: true }),
    },
    gatekeeper: {
      runGatekeeper: () => { recorder.gatekeeperCalls.push(1); return { ok: true } },
    },
    repositoryGates: {
      // Default: an unconfigured checkout runs no gate. Task-2457 tests inject
      // a configured gate or a failing runner via overrides.
      loadPhaseGates: () => [],
      runPhaseGates: async () => ({ ok: true, skipped: true, executed: 0, failedGate: null, error: null }) as any,
    },
    verification: {
      formatVerificationCommand: () => 'npm run typecheck',
      createVerificationProofIdentity: () => ({ ok: true, identity: 'proof-1' }),
      readReusableVerificationProof: () => ({ ok: false, error: 'no proof' }),
      writeReusableVerificationProof: () => ({ ok: true, identity: 'proof-1' }),
      runVerificationGate: () => ({ status: 0, stdout: '', stderr: '' }),
      isTransientVerificationFailure,
    },
    nel: {
      computeNELRecord: () => ({ nel: 120, bucket: { label: 'Medium' } }),
    },
    documentWriter: { writeJson: () => undefined },
    productConfig: { isForgejoReviewEnabled: () => false },
    agents: {
      startAgent: async () => { recorder.relaunches.push(1); throw new Error('no launcher'); },
    },
    agentSelection: {
      eligibleAgentsForStep: () => ['claude', 'codex'],
      selectAgent: () => 'codex',
    },
    process: {
      spawnSync: (_cmd: string, args: string[]) => { recorder.spawned.push(args[1]); return { status: 0, stdout: '', stderr: '' }; },
    },
    missionServices: async () => ({
      checkpoints: { record: async () => ({ status: 'completed' }) },
      lifecycle: { transition: async () => ({ status: 'completed', value: { version: 3 } }) },
      store: { load: async () => ({ kind: 'not-found' }) },
      handoff: { recordNel: async () => ({ status: 'completed' }) },
    }),
  };
  return { ...base, ...overrides } as unknown as HandoffWorkflowPorts;
}

function runOptions(recorder: Recorder, extra: Record<string, unknown> = {}) {
  return {
    worktree: ROOT,
    log: (line: string) => recorder.log.push(String(line)),
    error: (line: string) => recorder.errors.push(String(line)),
    ...extra,
  };
}

// --- SC5a: successful handoff over mocked ports ---

test('handoff use case completes the full workflow over mocked ports', async () => {
  const recorder = makeRecorder();
  const useCase = new HandoffCommandUseCase(makePorts(recorder));
  const result = await useCase.performHandoff(SLUG, runOptions(recorder));

  assert.equal(result.ok, true, recorder.errors.join('\n'));
  assert.equal(result.gatekeeperPushedBack, false);
  assert.deepEqual(recorder.transitions, ['review'], 'backlog task transitions to review');
  assert.deepEqual(recorder.spawned, ['npm run typecheck'], 'declared MISSION.md gate ran once');
  assert.ok(recorder.log.some(line => line.includes('Repository verification passed')), 'verification outcome is reported');
});

// TASK-2457 wiring: the pre-handoff gate is invoked from the handoff checkout
// and a non-zero exit blocks the active -> review transition.
test('handoff use case blocks the transition when a pre-handoff gate fails', async () => {
  const recorder = makeRecorder();
  let ran = 0;
  const ports = makePorts(recorder, {
    repositoryGates: {
      loadPhaseGates: () => [{ key: 'smoke', command: 'false', order: 0 }],
      runPhaseGates: async (phase, opts) => {
        ran++;
        assert.equal(phase, 'handoff');
        assert.equal(opts.slug, SLUG);
        assert.equal(opts.checkoutPath, ROOT);
        return { ok: false, skipped: false, executed: 1, failedGate: { key: 'smoke', command: 'false', exitCode: 1, stdout: '', stderr: 'fail' }, error: 'pre-handoff gate failed' };
      },
    },
  });
  const useCase = new HandoffCommandUseCase(ports);
  const result = await useCase.performHandoff(SLUG, runOptions(recorder));

  assert.equal(result.ok, false);
  assert.equal(ran, 1, 'pre-handoff gate runs exactly once');
  assert.deepEqual(recorder.transitions, [], 'mission stays in active, never advances to review');
});

test('handoff use case proceeds when the pre-handoff gate passes', async () => {
  const recorder = makeRecorder();
  const ports = makePorts(recorder, {
    repositoryGates: {
      loadPhaseGates: () => [{ key: 'smoke', command: 'true', order: 0 }],
      runPhaseGates: async () => ({ ok: true, skipped: false, executed: 1, failedGate: null, error: null }),
    },
  });
  const useCase = new HandoffCommandUseCase(ports);
  const result = await useCase.performHandoff(SLUG, runOptions(recorder));

  assert.equal(result.ok, true, recorder.errors.join('\n'));
  assert.deepEqual(recorder.transitions, ['review'], 'mission advances to review after a passing gate');
});

test('handoff use case skips the final verification gate under --no-gate', async () => {
  const recorder = makeRecorder();
  let gateRuns = 0;
  const ports = makePorts(recorder);
  const useCase = new HandoffCommandUseCase(ports);
  const result = await useCase.performHandoff(SLUG, runOptions(recorder, {
    skipGate: true,
    runVerificationGateFn: () => { gateRuns += 1; return { status: 0 }; },
  }));

  assert.equal(result.ok, true, recorder.errors.join('\n'));
  assert.equal(gateRuns, 0);
});

// --- SC5b: gate failure ---

test('handoff use case fails closed when the final verification gate fails', async () => {
  const recorder = makeRecorder();
  const useCase = new HandoffCommandUseCase(makePorts(recorder));
  const result = await useCase.performHandoff(SLUG, runOptions(recorder, {
    recoverGateFailure: false,
    runVerificationGateFn: () => ({ status: 1, stdout: 'out', stderr: 'boom' }),
  }));

  assert.equal(result.ok, false);
  assert.match(result.error ?? '', /Final verification gate failed/);
  assert.deepEqual(result.gateOutput, { stdout: 'out', stderr: 'boom' });
  assert.deepEqual(recorder.transitions, [], 'no backlog transition after a failed gate');
});

test('direct handoff recovers a gate failure through the kernel with its exact process evidence', async () => {
  const recorder = makeRecorder();
  let gateRuns = 0;
  let repairPrompt = '';
  const ports = makePorts(recorder, {
    agents: {
      startAgent: async (_step: string, options: Record<string, unknown>) => {
        recorder.relaunches.push(1);
        repairPrompt = (options.prompt as (agent: string) => string)('claude');
        return { agent: 'claude', result: { status: 0 } };
      },
    },
  });
  const result = await new HandoffCommandUseCase(ports).performHandoff(SLUG, runOptions(recorder, {
    recoverGateFailure: true,
    runVerificationGateFn: () => ++gateRuns === 1
      ? { status: 1, stdout: 'assertion failed in test/example.test.ts', stderr: 'expected 0, received 1' }
      : { status: 0, stdout: '', stderr: '' },
  }));

  assert.equal(result.ok, true, recorder.errors.join('\n'));
  assert.equal(recorder.relaunches.length, 1);
  assert.match(repairPrompt, /PRE-REVIEW GATE FAILURE/);
  assert.match(repairPrompt, /Gate command: npm run typecheck/);
  assert.match(repairPrompt, /Working directory: \/root/);
  assert.match(repairPrompt, /assertion failed in test\/example.test.ts/);
  assert.doesNotMatch(repairPrompt, /GIT HOOK FAILURE/);
});

test('direct handoff retries a slow-test verifier result before it disturbs an agent', async () => {
  const recorder = makeRecorder();
  let gateRuns = 0;
  const ports = makePorts(recorder, {
    agents: { startAgent: async () => { throw new Error('an agent must not launch for a transient verifier retry'); } },
  });
  const result = await new HandoffCommandUseCase(ports).performHandoff(SLUG, runOptions(recorder, {
    recoverGateFailure: true,
    runVerificationGateFn: () => ++gateRuns === 1
      ? { status: 1, stdout: '[unit-test-budget:exceeded] test/example.test.ts was slow', stderr: '' }
      : { status: 0, stdout: '', stderr: '' },
  }));

  assert.equal(result.ok, true, recorder.errors.join('\n'));
  assert.equal(gateRuns, 2);
  assert.equal(recorder.relaunches.length, 0);
});

// --- SC5c: retry/relaunch after gatekeeper pushback ---

test('handoff use case relaunches the agent and succeeds after gatekeeper pushback clears', async () => {
  const recorder = makeRecorder();
  let gatekeeperCall = 0;
  const ports = makePorts(recorder, {
    gatekeeper: {
      runGatekeeper: () => {
        gatekeeperCall += 1;
        recorder.gatekeeperCalls.push(gatekeeperCall);
        return gatekeeperCall === 1
          ? { ok: false, posted: true, missing: ['missions/task-2332.09/CP-1.md'] }
          : { ok: true };
      },
    },
    agents: {
      startAgent: async () => { recorder.relaunches.push(1); return { agent: 'custom', result: { status: 0 } }; },
    },
  });
  const result = await new HandoffCommandUseCase(ports).performHandoff(SLUG, runOptions(recorder));

  assert.equal(result.ok, true, recorder.errors.join('\n'));
  assert.equal(result.gatekeeperPushedBack, true, 'the pushback is reported even on eventual success');
  assert.equal(recorder.relaunches.length, 1, 'exactly one relaunch was needed');
  assert.equal(recorder.gatekeeperCalls.length, 2, 'gatekeeper re-ran on the retry');
});

test('handoff use case forwards the authoritative occurredAt through a recovery handoff', async () => {
  // F1 (round 3): a recovered handoff that represents a review entered earlier
  // must record the caller-provided authoritative occurredAt, not a fresh wall
  // clock. TASK-2379 introduced occurredAt for lifecycle recovery; dropping it
  // in the gatekeeper-bounce migration would have rewritten review-round timing
  // and board lane dwell data on every resumed handoff.
  const recorder = makeRecorder();
  let capturedOccurredAt: string | undefined;
  const ports = makePorts(recorder, {
    missionServices: async () => ({
      checkpoints: { record: async () => ({ status: 'completed' }) },
      lifecycle: {
        transition: async (request: { occurredAt?: string }) => {
          capturedOccurredAt = request.occurredAt;
          return { status: 'completed', value: { version: 3 } };
        },
      },
      store: { load: async () => ({ kind: 'not-found' }) },
      handoff: { recordNel: async () => ({ status: 'completed' }) },
    }),
  });
  const authoritative = '2026-07-24T08:00:00.000Z';
  const result = await new HandoffCommandUseCase(ports).performHandoff(
    SLUG,
    runOptions(recorder, { occurredAt: authoritative }),
  );

  assert.equal(result.ok, true, recorder.errors.join('\n'));
  assert.equal(capturedOccurredAt, authoritative, 'the recovered handoff forwards the authoritative occurredAt');
});

test('handoff use case keeps the wall clock when no occurredAt is supplied', async () => {
  // A genuine handoff passes nothing; the use case keeps the wall clock so a
  // fresh handoff still advances review timing as before.
  const recorder = makeRecorder();
  let capturedOccurredAt: string | undefined;
  const ports = makePorts(recorder, {
    missionServices: async () => ({
      checkpoints: { record: async () => ({ status: 'completed' }) },
      lifecycle: {
        transition: async (request: { occurredAt?: string }) => {
          capturedOccurredAt = request.occurredAt;
          return { status: 'completed', value: { version: 3 } };
        },
      },
      store: { load: async () => ({ kind: 'not-found' }) },
      handoff: { recordNel: async () => ({ status: 'completed' }) },
    }),
  });
  const result = await new HandoffCommandUseCase(ports).performHandoff(SLUG, runOptions(recorder));

  assert.equal(result.ok, true, recorder.errors.join('\n'));
  assert.ok(capturedOccurredAt, 'the wall clock is used when no occurredAt is supplied');
});

test('handoff use case stops after the bounded relaunch budget when pushback persists', async () => {
  const recorder = makeRecorder();
  const ports = makePorts(recorder, {
    gatekeeper: {
      runGatekeeper: () => {
        recorder.gatekeeperCalls.push(1);
        return { ok: false, posted: true, missing: ['MISSION.md'] };
      },
    },
    agents: {
      startAgent: async () => { recorder.relaunches.push(1); return { agent: 'custom', result: { status: 0 } }; },
    },
  });
  const result = await new HandoffCommandUseCase(ports).performHandoff(SLUG, runOptions(recorder));

  assert.equal(result.ok, false);
  assert.equal(result.gatekeeperPushedBack, true);
  assert.match(result.error ?? '', /Gatekeeper pushback persisted after 2 relaunch attempts/);
  assert.ok(recorder.relaunches.length <= 3, 'the recursion guard bounds total relaunches');
  assert.deepEqual(recorder.transitions, [], 'the task never reaches review while artifacts are missing');
});

test('handoff use case blocks handoff when the gatekeeper cannot post its pushback', async () => {
  const recorder = makeRecorder();
  const ports = makePorts(recorder, {
    gatekeeper: {
      runGatekeeper: () => ({ ok: false, posted: false, skipped: true, missing: ['MISSION.md'] }),
    },
  });
  const result = await new HandoffCommandUseCase(ports).performHandoff(SLUG, runOptions(recorder));

  assert.equal(result.ok, false);
  assert.match(result.error ?? '', /could not post pushback/);
  assert.equal(recorder.relaunches.length, 0, 'no relaunch when the pushback was never posted');
});

// --- SC5d: NEL persistence failure ---

test('handoff use case stops before review state advances when NEL persistence fails', async () => {
  const recorder = makeRecorder();
  const ports = makePorts(recorder, {
    missionServices: async () => ({
      checkpoints: { record: async () => ({ status: 'completed' }) },
      lifecycle: { transition: async () => ({ status: 'completed', value: { version: 1 } }) },
      store: { load: async () => ({ kind: 'not-found' }) },
      handoff: { recordNel: async () => ({ status: 'failed', error: { message: 'database is locked' } }) },
    }),
  });
  const result = await new HandoffCommandUseCase(ports).performHandoff(SLUG, runOptions(recorder));

  assert.equal(result.ok, false);
  assert.match(result.error ?? '', /NEL persistence failed; handoff stopped before review state advanced/);
  assert.match(result.error ?? '', /database is locked/);
  assert.deepEqual(recorder.transitions, []);
});

test('handoff use case continues when NEL is merely uncomputable', async () => {
  const recorder = makeRecorder();
  const ports = makePorts(recorder, {
    nel: { computeNELRecord: () => { throw new Error('no merge base'); } },
  });
  const result = await new HandoffCommandUseCase(ports).performHandoff(SLUG, runOptions(recorder));

  assert.equal(result.ok, true, recorder.errors.join('\n'));
  assert.ok(recorder.log.some(line => line.includes('NEL capture skipped')));
});

// --- SC5e: checkpoint recording failure ---

test('handoff use case fails when checkpoint recording is not completed', async () => {
  const recorder = makeRecorder();
  const ports = makePorts(recorder, {
    missionServices: async () => ({
      checkpoints: { record: async () => ({ status: 'rejected', error: { message: 'evidence missing' } }) },
      lifecycle: { transition: async () => ({ status: 'completed', value: { version: 1 } }) },
      store: { load: async () => ({ kind: 'not-found' }) },
      handoff: { recordNel: async () => ({ status: 'completed' }) },
    }),
  });
  const result = await new HandoffCommandUseCase(ports).performHandoff(SLUG, runOptions(recorder));

  assert.equal(result.ok, false);
  assert.match(result.error ?? '', /Recording checkpoint CP-1 failed: evidence missing/);
  assert.deepEqual(recorder.transitions, [], 'backlog is untouched when checkpoint evidence is not durable');
});

test('handoff use case fails when the mission lifecycle transition is rejected', async () => {
  const recorder = makeRecorder();
  const ports = makePorts(recorder, {
    missionServices: async () => ({
      checkpoints: { record: async () => ({ status: 'completed' }) },
      lifecycle: { transition: async () => ({ status: 'rejected', error: { message: 'not in active' } }) },
      store: { load: async () => ({ kind: 'not-found' }) },
      handoff: { recordNel: async () => ({ status: 'completed' }) },
    }),
  });
  const result = await new HandoffCommandUseCase(ports).performHandoff(SLUG, runOptions(recorder));

  assert.equal(result.ok, false);
  assert.match(result.error ?? '', /Mission state transition failed: not in active/);
  assert.deepEqual(recorder.transitions, []);
});

// --- Pre-flight guards over mocked ports ---

test('handoff use case refuses to hand off from the wrong branch', async () => {
  const recorder = makeRecorder();
  const ports = makePorts(recorder, {
    git: { ...makePorts(recorder).git, getCurrentBranch: () => 'main' },
  });
  const result = await new HandoffCommandUseCase(ports).performHandoff(SLUG, runOptions(recorder));

  assert.equal(result.ok, false);
  assert.match(result.error ?? '', /Not on mission branch\. Current: main, Expected: mission\/task-2332\.09/);
});

test('handoff use case rejects a checkpoint whose Goal Check rows cite nothing verifiable', async () => {
  const recorder = makeRecorder();
  const bare = [
    '# CP-1',
    '',
    '## Goal Check',
    '',
    '| Criterion | Evidence | Status |',
    '|---|---|---|',
    '| It works | trust me | PASS |',
    '',
  ].join('\n');
  const ports = makePorts(recorder, {
    fileSystem: {
      existsSync: (target: string) => target.endsWith('MISSION.md'),
      readText: (target: string) => (target === CHECKPOINT ? bare : MISSION_CONTENT),
      writeText: () => undefined,
      listNames: () => [],
      listEntries: () => [],
    },
  });
  const result = await new HandoffCommandUseCase(ports).performHandoff(SLUG, runOptions(recorder));

  assert.equal(result.ok, false);
  assert.match(result.error ?? '', /no evidence rows that cite a verifiable reference/);
});

test('handoff use case refuses when MISSION.md is modified but uncommitted', async () => {
  const recorder = makeRecorder();
  const ports = makePorts(recorder, {
    git: { ...makePorts(recorder).git, getWorktreeStatus: () => [' M missions/task-2332.09/MISSION.md'] },
  });
  const result = await new HandoffCommandUseCase(ports).performHandoff(SLUG, runOptions(recorder));

  assert.equal(result.ok, false);
  assert.match(result.error ?? '', /is modified but uncommitted/);
});

// --- SC2: the use case reaches the outside world only through ports ---

test('handoff use case never creates a Forgejo PR when the review provider is off', async () => {
  const recorder = makeRecorder();
  let prCalls = 0;
  const ports = makePorts(recorder, {
    productConfig: { isForgejoReviewEnabled: () => false },
    forgejo: { ...makePorts(recorder).forgejo, createPr: () => { prCalls += 1; return { ok: true }; } },
  });
  const result = await new HandoffCommandUseCase(ports).performHandoff(SLUG, runOptions(recorder));

  assert.equal(result.ok, true, recorder.errors.join('\n'));
  assert.equal(prCalls, 0);
  assert.ok(!recorder.log.some(line => line.includes('Skipping Forgejo PR')));
});

test('handoff use case creates the Forgejo PR through the port when the provider is on', async () => {
  const recorder = makeRecorder();
  const created: string[] = [];
  const ports = makePorts(recorder, {
    productConfig: { isForgejoReviewEnabled: () => true },
    forgejo: { ...makePorts(recorder).forgejo, createPr: (branch: string) => { created.push(branch); return { ok: true }; } },
  });
  const result = await new HandoffCommandUseCase(ports).performHandoff(SLUG, runOptions(recorder, { force: false }));

  assert.equal(result.ok, true, recorder.errors.join('\n'));
  assert.deepEqual(created, [BRANCH]);
});
test('handoff preserves a publication verifier failure as structured gate evidence', async () => {
  const recorder = makeRecorder();
  const gateFailure = {
    area: 'all', command: './scripts/verify-local.sh all', cwd: ROOT,
    exitCode: 1, stdout: 'specific failing test', stderr: '',
  };
  const ports = makePorts(recorder, {
    productConfig: { isForgejoReviewEnabled: () => true },
    forgejo: {
      ...makePorts(recorder).forgejo,
      createPr: () => ({ ok: false, error: 'verification gate failed', gateFailure }),
    },
  });

  const result = await new HandoffCommandUseCase(ports).performHandoff(SLUG, runOptions(recorder));
  assert.equal(result.ok, false);
  assert.deepEqual(result.gateFailure, gateFailure);
});

// --- TASK-2476: operator-facing handoff story ---
//
// `px active`'s handoff must read as an execution record — repository
// verification, its result, and the start of independent review — not as the
// numbered internal sequence used to obtain them. These are characterization
// tests for that contract; they run over the same mocked ports as the happy
// path above, so they assert presentation only and never a lifecycle change.

const stripStatusColor = (text: string) => text.replace(/\x1B\[[0-9;]*m/g, '');

test('handoff reports repository verification and its result instead of numbered steps', async () => {
  const recorder = makeRecorder();
  const useCase = new HandoffCommandUseCase(makePorts(recorder));
  const result = await useCase.performHandoff(SLUG, runOptions(recorder));

  assert.equal(result.ok, true, recorder.errors.join('\n'));
  const output = stripStatusColor(recorder.log.join('\n'));
  assert.match(output, /Verifying the repository: npm run typecheck/);
  assert.match(output, /Repository verification passed/);
  assert.doesNotMatch(output, /Step \d/, 'no numbered handoff steps on the happy path');
});

test('handoff never nests one status prefix inside another', async () => {
  const recorder = makeRecorder();
  const useCase = new HandoffCommandUseCase(makePorts(recorder));
  await useCase.performHandoff(SLUG, runOptions(recorder));

  const output = stripStatusColor(recorder.log.join('\n'));
  assert.doesNotMatch(output, /\[(INFO|PASS|WARN|FAIL|DEBUG)\]\s+\[(INFO|PASS|WARN|FAIL|DEBUG)\]/);
});

test('handoff keeps proof hashes and lifecycle bookkeeping out of the operator story', async () => {
  const recorder = makeRecorder();
  const useCase = new HandoffCommandUseCase(makePorts(recorder));
  await useCase.performHandoff(SLUG, runOptions(recorder));

  const output = stripStatusColor(recorder.log.join('\n'));
  assert.doesNotMatch(output, /stored proof|reused proof/);
  assert.doesNotMatch(output, /Capturing Net Engineering Lines|NEL captured/);
  assert.doesNotMatch(output, /Mission state transitioned to review/);
  assert.doesNotMatch(output, /Skipping Forgejo PR|gatekeeper pre-review validation/);
});

test('handoff states that independent review is next', async () => {
  const recorder = makeRecorder();
  const useCase = new HandoffCommandUseCase(makePorts(recorder));
  await useCase.performHandoff(SLUG, runOptions(recorder));

  const output = stripStatusColor(recorder.log.join('\n'));
  assert.match(output, /ready for independent review/);
});
