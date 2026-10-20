import { handoffEvidencePolicy, handoffBudgetExceeded } from '../../../src/domain/mission-handoff-policy.js';
import { isReviewerPoolExhausted } from '../../../src/domain/reviewer-assignment-policy.js';
// Mission handoff contract: bounce/relaunch ordering, evidence policy and active-lane projection.
// SQLite retry idempotency belongs to the integration/sqlite companion.
//
// Behavior-owned suite (TASK-2622.07). Legacy case names are unchanged; each section keeps its
// historical task provenance and the legacy file it replaced.
//   Handoff bounce: TASK-2377.05
//   Active lane projection: TASK-2392

import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { ExecuteHandoffService } from '../../../src/application/execute-handoff-service.js';
import { classifyError, FailureClass, DispatchAction } from '../../../src/application/failure-classification.js';
import { isRelaunchableError } from '../../../src/adapters/cli/commands/repair-handoff.js';
import { AgentPoolExhaustedError } from '../../../src/domain/agents.js';
import { missionId } from '../../../src/domain/mission.js';
import fs from 'node:fs';
import path from 'node:path';
import { ConcreteMissionReadAdapter } from '../../../src/adapters/backlog/concrete-mission-read-adapter.js';
import { buildBoardMetrics, buildBoardProjection } from '../../../src/application/projections/board.js';
import { projectMissionCard } from '../../../src/application/projections/mission-board.js';
import { repositoryId } from '../../../src/domain/repository.js';
import { mkdtemp as registeredMkdtemp } from '../../helpers/temp-dir.js';

interface HandoffTestOptions {
  readonly taskFile?: string | null;
  readonly onAgentLaunched?: (_agent: string, _phase: 'review' | 'review-response') => Promise<void>;
  readonly onAutonomousStop?: (_reason: string) => Promise<void>;
  readonly validateCheckpointsBeforeHandoffFn?: (_slug: string, _worktree: string, _output: { log?: (_message: string) => void; error?: (_message: string) => void }) => Promise<{ ok: boolean; error?: string; nextCheckpoint?: string }> | { ok: boolean; error?: string; nextCheckpoint?: string };
  readonly performHandoff?: (_slug: string, _request: { forgejoUser: string; worktree: string; force?: boolean }) => Promise<{ ok: boolean; error?: string; gateFailure?: import('../../../src/application/rebound-kernel.js').GateFailureReason; gateOutput?: { stdout?: string; stderr?: string }; gatekeeperPushedBack?: boolean }>;
  readonly repairHandoffFn?: (_slug: string, _worktree: string, _error: string, _options: { taskFile: string | null; log: (_message: string) => void; error: (_message: string) => void }) => Promise<{ repaired: boolean; blocker?: string }>;
  readonly startReviewLoop?: (_slug: string, _options: { implementer: string; worktree: string; skipHandoff: boolean; onAgentLaunched?: (_agent: string, _phase: 'review' | 'review-response') => Promise<void>; onAutonomousStop?: (_reason: string) => Promise<void> }) => Promise<void>;
  readonly startAgentFn?: (_step: string, _options: { prompt: string; worktree: string; agent: string; slug: string; role: string; sessionPolicy?: unknown }) => Promise<{ agent?: string | null; result?: { status?: number | null } } | undefined>;
  readonly workflowLauncherStatusFn?: (_agent: string) => { supported: boolean; detail?: string; reason?: string };
  readonly log?: (_message: string) => void;
  readonly error?: (_message: string) => void;
}

function handoffService(slug: string, worktree: string, agent: string, options: HandoffTestOptions = {}) {
  const validate = options.validateCheckpointsBeforeHandoffFn ?? (async () => ({ ok: true as const }));
  const perform = options.performHandoff ?? (async () => ({ ok: true as const }));
  const repair = options.repairHandoffFn ?? (async () => ({ repaired: false }));
  const review = options.startReviewLoop ?? (async () => {});
  const launch = options.startAgentFn ?? (async () => ({}));
  return new ExecuteHandoffService({
    checkpoints: { async validateBeforeHandoff() { return validate(slug, worktree, { log: options.log, error: options.error }); } },
    handoff: {
      async run(request) { return perform(slug, { forgejoUser: agent, worktree, force: request.force }); },
      async repairHygiene(request) { return repair(slug, worktree, request.error, { taskFile: request.taskFile, log: request.log, error: request.outputError }); },
      classifyFailure: classifyError,
      isRelaunchableFailure: isRelaunchableError,
    },
    review: { async start(request) { await review(slug, { implementer: agent, worktree, skipHandoff: true, onAgentLaunched: request.onAgentLaunched, onAutonomousStop: request.onAutonomousStop }); } },
    repairLaunch: { available: options.workflowLauncherStatusFn ?? (() => ({ supported: true })), readHead() { return null; }, async launch(request) { return launch('active', { prompt: request.prompt, worktree, agent, slug, role: 'implementer', sessionPolicy: request.sessionPolicy }); } },
    output: { log: options.log ?? (() => {}), error: options.error ?? (() => {}), command: (value) => value, formatSlug: (value) => value, formatAgent: (value) => value },
  });
}

async function runHandoffScenario(slug: string, worktree: string, agent: string, options: HandoffTestOptions = {}) {
  return handoffService(slug, worktree, agent, options)
    .run({ slug, worktree, agent, taskFile: options.taskFile ?? null, onAgentLaunched: options.onAgentLaunched, onAutonomousStop: options.onAutonomousStop });
}

// TASK-2377.05 (was test/task-2377.05-handoff-bounce.test.ts)
describe('Handoff bounce', () => {
  // ---------------------------------------------------------------------------
  // TASK-2377.05 — the two `px active` handoff bounces run through the rebound
  // kernel (SC3 checkpoint validation, SC4 handoff failure, SC8 git-only repair).
  //
  // The typed handoff service is exercised with every boundary injected:
  // checkpoint validation, `performHandoff`, `repairHandoff`, the review loop,
  // and the agent launch seam are all mocks. No agent, git, LLM, or Forgejo is
  // involved.
  // ---------------------------------------------------------------------------

  const SLUG = 'task-2377.05';
  const WORKTREE = '/tmp/worktree-task-2377.05';

  /** Checkpoint gap text the validator emits and the guard treats as relaunchable. */
  const CHECKPOINT_GAP =
    'No checkpoint documents found in /tmp/worktree-task-2377.05/missions/task-2377.05. '
    + 'The execute agent must create checkpoint documents (CP-N.md) with a Goal Check table before handoff.';

  /** A relaunchable gate failure: AutoSendBack, not GitBlockers, not HumanOnly. */
  const GATE_FAILURE =
    'Verification gate failed for area all: `./scripts/verify-local.sh all` exited 1.';

  // ── SC3: checkpoint-validation bounce ───────────────────────────────────────

  test('SC3: checkpoint re-validation passing falls through to performHandoff', async () => {
    let validations = 0;
    let launches = 0;
    let handoffCalls = 0;
    const result = await runHandoffScenario(SLUG, WORKTREE, 'codex', {
      validateCheckpointsBeforeHandoffFn: () => {
        validations++;
        return validations === 1 ? { ok: false, error: CHECKPOINT_GAP } : { ok: true };
      },
      startAgentFn: async () => { launches++; return { agent: 'codex', result: { status: 0 } }; },
      performHandoff: async () => { handoffCalls++; return { ok: true as const }; },
      startReviewLoop: async () => {},
      log: () => {},
      error: () => {},
    });

    assert.equal(result, true, 'the mission proceeds once checkpoints validate');
    assert.equal(launches, 1, 'one bounce was enough');
    assert.equal(validations, 2, 'the kernel verify re-ran the exact check that failed');
    assert.equal(handoffCalls, 1, 'the fixed outcome falls through to performHandoff');
  });

  test('SC3: two failed re-validations return false after exactly two launches', async () => {
    let launches = 0;
    let validations = 0;
    let handoffCalls = 0;
    const errors: string[] = [];
    const result = await runHandoffScenario(SLUG, WORKTREE, 'codex', {
      validateCheckpointsBeforeHandoffFn: () => { validations++; return { ok: false as const, error: CHECKPOINT_GAP }; },
      startAgentFn: async () => { launches++; return { agent: 'codex', result: { status: 0 } }; },
      performHandoff: async () => { handoffCalls++; return { ok: true as const }; },
      startReviewLoop: async () => {},
      log: () => {},
      error: (msg: string) => errors.push(msg),
    });

    assert.equal(result, false, 'an exhausted checkpoint bounce strands the mission');
    assert.equal(launches, 2, 'exactly the kernel per-occurrence budget of two launches');
    assert.equal(validations, 4, 'the exhausted bounce performs its final re-validation before operator guidance');
    assert.equal(handoffCalls, 0, 'performHandoff is never reached');
    assert.ok(
      errors.some(msg => msg.includes('Create a checkpoint document')),
      'checkpointValidationNextAction is still emitted on exhaustion',
    );
  });

  test('SC3: a non-relaunchable checkpoint error launches no agent at all', async () => {
    let launches = 0;
    let handoffCalls = 0;
    const errors: string[] = [];
    // A dirty-worktree checkpoint is GitBlockers — not IncompleteEvidence, and no
    // nextCheckpoint — so the guard declines to call the kernel.
    const result = await runHandoffScenario(SLUG, WORKTREE, 'codex', {
      validateCheckpointsBeforeHandoffFn: () => ({
        ok: false as const,
        error: 'Checkpoint documents are uncommitted in the worktree; commit them before handoff.',
      }),
      startAgentFn: async () => { launches++; return { agent: 'codex', result: { status: 0 } }; },
      performHandoff: async () => { handoffCalls++; return { ok: true as const }; },
      startReviewLoop: async () => {},
      log: () => {},
      error: (msg: string) => errors.push(msg),
    });

    assert.equal(result, false, 'a non-relaunchable checkpoint error strands the mission');
    assert.equal(launches, 0, 'no agent is launched');
    assert.equal(handoffCalls, 0, 'performHandoff is never reached');
    assert.ok(errors.length > 0, 'the operator instruction is emitted');
  });

  // ── SC4: handoff-failure bounce ─────────────────────────────────────────────

  test('SC4: a passing performHandoff re-run flows into the gatekeeper-pushback branch', async () => {
    let launches = 0;
    let handoffCalls = 0;
    let reviewLoopStarted = false;
    const result = await runHandoffScenario(SLUG, WORKTREE, 'codex', {
      validateCheckpointsBeforeHandoffFn: () => ({ ok: true as const }),
      performHandoff: async () => {
        handoffCalls++;
        return handoffCalls === 1
          ? { ok: false, error: GATE_FAILURE, gateOutput: { stdout: 'gate stdout', stderr: 'gate stderr' } }
          : { ok: true, gatekeeperPushedBack: true };
      },
      startAgentFn: async () => { launches++; return { agent: 'codex', result: { status: 0 } }; },
      startReviewLoop: async () => { reviewLoopStarted = true; },
      log: () => {},
      error: () => {},
    });

    assert.equal(result, true, 'the refreshed successful handoffResult is carried forward');
    assert.equal(launches, 1, 'one bounce was enough');
    assert.equal(handoffCalls, 2, 'the kernel verify re-ran performHandoff');
    assert.equal(reviewLoopStarted, false, 'the refreshed result reaches the gatekeeper-pushback branch');
  });

  test('incomplete criteria bounce with an actionable completion prompt and reverify (TASK-2631)', async () => {
    let handoffs = 0;
    let launches = 0;
    let reviewed = false;
    const result = await runHandoffScenario(SLUG, WORKTREE, 'codex', {
      validateCheckpointsBeforeHandoffFn: () => ({ ok: true as const }),
      performHandoff: async () => ++handoffs === 1
        ? { ok: false, error: 'Success criteria 1 are incomplete before handoff.' }
        : { ok: true },
      startAgentFn: async (_step: string, opts: { prompt?: unknown }) => {
        launches++;
        const prompt = typeof opts.prompt === 'function' ? opts.prompt('codex') : String(opts.prompt);
        assert.ok(prompt.includes(`px mission mark-complete --slug ${SLUG} --criterion <index>`));
        assert.ok(prompt.includes('actually verified'));
        return { agent: 'codex', result: { status: 0 } };
      },
      startReviewLoop: async () => { reviewed = true; },
      log: () => {}, error: () => {},
    });
    assert.equal(result, true);
    assert.equal(handoffs, 2);
    assert.equal(launches, 1);
    assert.equal(reviewed, true);
  });

  test('SC4: the kernel carries the captured gate output into the bounce', async () => {
    let promptSeen = '';
    await runHandoffScenario(SLUG, WORKTREE, 'codex', {
      validateCheckpointsBeforeHandoffFn: () => ({ ok: true as const }),
      performHandoff: async () => ({
        ok: false as const, error: GATE_FAILURE, gateOutput: { stdout: 'gate stdout', stderr: 'gate stderr' },
      }),
      startAgentFn: async (_step: string, opts: { prompt?: unknown }) => {
        // Only the first attempt's prompt carries the original gate output; the
        // kernel replaces the diagnostic with the verify re-run's fresher one.
        if (!promptSeen) {
          const slot = opts.prompt;
          promptSeen = typeof slot === 'function' ? slot('codex') : String(slot ?? '');
        }
        return { agent: 'codex', result: { status: 0 } };
      },
      startReviewLoop: async () => {},
      log: () => {},
      error: () => {},
    });

    assert.match(promptSeen, /HANDOFF VERIFICATION FAILURE/, 'the kernel builds the fix prompt');
    assert.match(promptSeen, /gate stderr/, 'the captured gate output reaches the prompt');
  });

  test('SC4: two failed performHandoff re-runs give exactly two launches and the failure path', async () => {
    let launches = 0;
    let handoffCalls = 0;
    let reviewLoopStarted = false;
    const errors: string[] = [];
    const result = await runHandoffScenario(SLUG, WORKTREE, 'codex', {
      validateCheckpointsBeforeHandoffFn: () => ({ ok: true as const }),
      performHandoff: async () => { handoffCalls++; return { ok: false as const, error: GATE_FAILURE }; },
      startAgentFn: async () => { launches++; return { agent: 'codex', result: { status: 0 } }; },
      startReviewLoop: async () => { reviewLoopStarted = true; },
      log: () => {},
      error: (msg: string) => errors.push(msg),
    });

    assert.equal(result, false, 'an exhausted handoff bounce strands the mission');
    assert.equal(launches, 2, 'exactly the kernel per-occurrence budget of two launches');
    assert.equal(handoffCalls, 3, 'the initial handoff plus one verify re-run per attempt');
    assert.equal(reviewLoopStarted, false, 'the review loop is never started');
    assert.ok(
      errors.some(msg => msg.includes('Automated handoff failed')),
      'the automated-handoff-failed error path is taken',
    );
  });

  test('SC4: a HumanOnly classification launches no agent and takes the repairHandoffFn branch', async () => {
    let launches = 0;
    let repairCalls = 0;
    await runHandoffScenario(SLUG, WORKTREE, 'codex', {
      validateCheckpointsBeforeHandoffFn: () => ({ ok: true as const }),
      performHandoff: async () => ({
        ok: false as const,
        error: 'ENOSPC: no space left on device while writing the review artifact.',
      }),
      repairHandoffFn: async () => { repairCalls++; return { repaired: false, blocker: 'disk full' }; },
      startAgentFn: async () => { launches++; return { agent: 'codex', result: { status: 0 } }; },
      startReviewLoop: async () => {},
      log: () => {},
      error: () => {},
    });

    assert.equal(launches, 0, 'a HumanOnly failure never bounces');
    assert.equal(repairCalls, 1, 'the git-only repairHandoffFn branch runs instead');
  });

  test('SC4/SC8: a GitBlockers classification takes the git-only repair branch, agent-less', async () => {
    let launches = 0;
    let repairCalls = 0;
    let handoffCalls = 0;
    const logs: string[] = [];
    const result = await runHandoffScenario(SLUG, WORKTREE, 'codex', {
      validateCheckpointsBeforeHandoffFn: () => ({ ok: true as const }),
      performHandoff: async () => {
        handoffCalls++;
        return handoffCalls === 1
          ? { ok: false, error: 'The worktree has uncommitted changes; commit them before handoff.' }
          : { ok: true };
      },
      repairHandoffFn: async () => { repairCalls++; return { repaired: true }; },
      startAgentFn: async () => { launches++; return { agent: 'codex', result: { status: 0 } }; },
      startReviewLoop: async () => {},
      log: (message: string) => logs.push(message),
      error: () => {},
    });

    assert.equal(launches, 0, 'GitBlockers never bounce to an agent');
    assert.equal(repairCalls, 1, 'repairHandoff performs the git-only repair');
    assert.equal(result, true, 'the repaired handoff proceeds');
    assert.ok(logs.some((message) => message.includes('Automated handoff failed')), 'the failed-handoff operator banner is retained');
    assert.ok(logs.some((message) => message.includes('Attempting post-execute repair')), 'the repair attempt remains visible');
    assert.ok(logs.some((message) => message.includes('Repair successful. Retrying automated handoff')), 'the retry remains visible');
  });

  test('SC4: structured gate failure reaches the kernel without losing its reason kind', async () => {
    let prompt = '';
    await runHandoffScenario(SLUG, WORKTREE, 'codex', {
      validateCheckpointsBeforeHandoffFn: () => ({ ok: true as const }),
      performHandoff: async () => ({
        ok: false as const,
        error: GATE_FAILURE,
        gateFailure: { kind: 'gate-failure', area: 'unit', command: 'npm test', exitCode: 1, stdout: 'stdout', stderr: 'stderr' },
      }),
      startAgentFn: async (_step, options) => {
        prompt = options.prompt;
        return { agent: 'codex', result: { status: 0 } };
      },
      startReviewLoop: async () => {}, log: () => {}, error: () => {},
    });
    assert.match(prompt, /PRE-REVIEW GATE FAILURE/, 'the typed gate-failure reason selects the gate recovery contract');
  });

  // ── SC5: the budget is per occurrence and nothing is persisted ──────────────

  test('SC5: a second handoff occurrence in one process starts from a full budget of two', async () => {
    const launchCounts: number[] = [];
    for (const _run of [1, 2]) {
      let launches = 0;
      await runHandoffScenario(SLUG, WORKTREE, 'codex', {
        validateCheckpointsBeforeHandoffFn: () => ({ ok: true as const }),
        performHandoff: async () => ({ ok: false as const, error: GATE_FAILURE }),
        startAgentFn: async () => { launches++; return { agent: 'codex', result: { status: 0 } }; },
        startReviewLoop: async () => {},
        log: () => {},
        error: () => {},
      });
      launchCounts.push(launches);
    }
    assert.deepEqual(launchCounts, [2, 2], 'the second occurrence is not starved by the first');
  });

  // ── A declared checkpoint gap is agent hallucination, not infrastructure ────
  //
  // Regression: `validateCheckpointsBeforeHandoff` emits "Declared checkpoint
  // documents are missing before handoff: CP-2, …" when an agent ends its turn
  // without writing the checkpoints its own mission declared. That text matched no
  // classifier pattern and fell to the catch-all InfraBlocker/HumanOnly default,
  // so the kernel refused to bounce and the mission stranded on manual
  // instructions — even though one relaunch with the named gap fixes it. ADR 0048
  // class 4 ("Incomplete checkpoint evidence") already prescribes auto-send-back;
  // the classifier was simply missing the pattern.

  const DECLARED_GAP =
    'Declared checkpoint documents are missing before handoff: CP-2, CP-3. '
    + 'Create and commit CP-2.md, CP-3.md in /tmp/worktree-task-2377.05/missions/task-2377.05 before handoff.';

  test('a declared checkpoint gap classifies as IncompleteEvidence, not InfraBlocker', () => {
    const classified = classifyError(DECLARED_GAP);
    assert.equal(classified.failureClass, FailureClass.IncompleteEvidence);
    assert.equal(classified.dispatchAction, DispatchAction.AutoSendBack);
  });

  test('a single-checkpoint gap classifies as IncompleteEvidence too', () => {
    const classified = classifyError(
      'Declared checkpoint documents are missing before handoff: CP-2. Create and commit CP-2.md before handoff.',
    );
    assert.equal(classified.dispatchAction, DispatchAction.AutoSendBack);
  });

  test('the new rule does not reclassify real infrastructure blockers', () => {
    for (const infra of [
      'Forgejo authentication failed for the review remote.',
      'connection refused while pushing the review ref',
      'token expired',
    ]) {
      assert.equal(classifyError(infra).dispatchAction, DispatchAction.HumanOnly, infra);
    }
  });

  test('a declared checkpoint gap bounces and continues once the agent writes the checkpoints', async () => {
    let validations = 0;
    let launches = 0;
    let handoffCalls = 0;
    let reviewLoopStarted = false;
    const result = await runHandoffScenario(SLUG, WORKTREE, 'codex', {
      validateCheckpointsBeforeHandoffFn: () => {
        validations++;
        return validations === 1 ? { ok: false, error: DECLARED_GAP, nextCheckpoint: 'CP-2' } : { ok: true };
      },
      startAgentFn: async () => { launches++; return { agent: 'codex', result: { status: 0 } }; },
      performHandoff: async () => { handoffCalls++; return { ok: true as const }; },
      startReviewLoop: async () => { reviewLoopStarted = true; },
      log: () => {},
      error: () => {},
    });

    assert.equal(launches, 1, 'the gap bounces to the implementer instead of stranding');
    assert.equal(handoffCalls, 1, 'the mission continues to handoff after the fix verifies');
    assert.ok(reviewLoopStarted, 'and on into the review loop');
    assert.equal(result, true);
  });
});

// TASK-2392 (was test/task-2392-active-lane-repro.test.ts)
describe('Active lane projection', () => {
  const id = missionId('task-2392');
  const repo = repositoryId('task-2392-repro');

  function task(status: string, title: string, labels: string, assignee: string): string {
    return `---\nid: TASK-2392\ntitle: ${title}\nstatus: ${status}\nassignee: [${assignee}]\nlabels: [${labels}]\n---\n`;
  }

  test('task-2392: active task appears in active stage, not backlog', async () => {
    const root = registeredMkdtemp('px-2392-');
    const base = path.join(root, 'base');
    const worktree = path.join(root, 'worktree');
    const writeTask = (dir: string, content: string) => {
      const file = path.join(dir, 'backlog', 'tasks', 'task-2392 - test.md');
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, content, 'utf8');
      return file;
    };
    writeTask(base, task('active', 'authoritative title', 'bug', 'codex'));
    writeTask(worktree, task('backlog', 'worktree description wins', 'ai_sdlc, bug', 'custom'));

    try {
      const adapter = new ConcreteMissionReadAdapter({
        rootDir: worktree,
        repositoryId: repo,
        getTaskStorage: (dir = worktree) => ({
          tasksDir: path.join(dir, 'backlog', 'tasks'),
          completedDir: path.join(dir, 'backlog', 'completed'),
          archiveTasksDir: path.join(dir, 'backlog', 'archive', 'tasks'),
        }),
        findMissionDir: () => null,
        findCheckpoints: () => [],
        resolveWorktree: () => worktree,
        resolveBaseWorktree: () => base,
      });
      const materialized = await adapter.loadMission(id);
      assert.ok(materialized, 'mission did not materialize');
      assert.equal(materialized.status, 'active');

      const card = projectMissionCard(materialized, {
        latestGate: 'not-run', reviewApproval: null, currentWork: null, blockingReason: null, flags: [],
      });
      const projection = buildBoardProjection(
        repo, [card], [], [],
        buildBoardMetrics({
          cumulativeFlow: { series: [], missingHistoryFallback: 'skip' },
          medianStateTimes: { series: [], missingHistoryFallback: 'skip' },
          throughput: { series: [], missingHistoryFallback: 'skip' },
          reviewBounceRate: { series: [], missingHistoryFallback: 'skip' },
        }), [],
      );

      const idsIn = (lane: 'active' | 'backlog') => projection.stages
        .find((stage) => stage.lane === lane)!.cards
        .filter((candidate) => candidate.id === id);
      assert.equal(idsIn('active').length, 1);
      assert.equal(idsIn('backlog').length, 0);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});

test('handoff evidence and self-review eligibility are pure decisions (TASK-2668.07)', () => {
  const contract = { checkpoints: [], successCriteria: ['one', 'two'], completedSuccessCriteria: [0], draftedInDb: true } satisfies Partial<NonNullable<Parameters<typeof handoffEvidencePolicy>[0]>>;
  // Coverage is distinct success-criterion identities, not a sum of row counts:
  // a row covers the criterion whose identity its `criterion` field equals.
  assert.deepEqual(handoffEvidencePolicy(contract), { source: 'missing', incomplete: [2], insufficientRows: false });
  assert.equal(handoffEvidencePolicy({ ...contract, draftedInDb: false }).source, 'historical');
  assert.deepEqual(handoffEvidencePolicy({ ...contract, checkpoints: [{ goalCheck: [{ criterion: 'two' }] }] }), { source: 'recorded', incomplete: [2], insufficientRows: true });
  assert.equal(handoffEvidencePolicy({ ...contract, checkpoints: [{ goalCheck: [{ criterion: 'one' }, { criterion: 'two' }] }], completedSuccessCriteria: [0, 1] }).insufficientRows, false);
  // Two rows across checkpoints that both name the first criterion do not count
  // as coverage for the second: coverage is distinct criterion identities, not a
  // sum of row counts. The old count-based check wrongly returned false here.
  assert.equal(
    handoffEvidencePolicy({
      ...contract,
      checkpoints: [{ goalCheck: [{ criterion: 'one' }] }, { goalCheck: [{ criterion: 'one' }] }],
      completedSuccessCriteria: [0, 1],
    }).insufficientRows,
    true,
    'repeated rows for one criterion leave another criterion uncovered',
  );
  assert.equal(handoffBudgetExceeded(3), false);
  assert.equal(handoffBudgetExceeded(4), true);
  assert.equal(isReviewerPoolExhausted(new AgentPoolExhaustedError('review', 'pool unavailable')), true);
  assert.equal(isReviewerPoolExhausted(new AgentPoolExhaustedError('active', 'exhausted')), false);
  for (const message of ['exhausted', 'No agents available', 'No eligible agents', 'unreadable configuration', 'no working launcher']) {
    assert.equal(isReviewerPoolExhausted(new Error(message)), false);
    assert.equal(isReviewerPoolExhausted(message), false);
  }
});
