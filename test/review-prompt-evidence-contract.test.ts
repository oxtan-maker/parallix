// review prompt evidence contract.
// Related scenarios share imports; each contract keeps its own hooks and mutable fixtures.
import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  buildCompactReviewPrompt,
  buildCompactActOnReviewPrompt,
  buildReviewPrompt,
  buildCompletedControlsBlock,
  COMPLETED_CONTROLS_MAX_CHARS,
  COMPLETED_CONTROLS_MAX_LINES,
} from '../src/adapters/review/review-prompts.js';
import { reboundPreReviewFailure, gateFailureReason } from '../src/adapters/review/review-loop.js';
import { rebound } from '../src/application/rebound-kernel.js';
import { mkdtemp as registeredMkdtemp } from './helpers/temp-dir.js';

// Regression provenance: TASK-2317.
describe("context compaction", { concurrency: false }, () => {
  const repoRoot = path.resolve(import.meta.dirname, '..');
  const reviewLoopSource = fs.readFileSync(
    path.join(repoRoot, 'src/adapters/review/review-loop.ts'),
    'utf8'
  );

  test('task-2317: successful declared-gate instruction compacts only after success and retains failed-gate diagnostics', () => {
    // The compaction requirement is a lifecycle mechanic, so it lives in the
    // mandatory core half of the split execute prompt (task-2465).
    const executePrompt = fs.readFileSync(path.join(repoRoot, 'prompts/execute-core.md'), 'utf8');

    assert.match(executePrompt, /Immediately after \*\*each successful mission-declared Gate\*\*, compact/i);
    assert.match(executePrompt, /Do not compact for a failed gate: retain its failure diagnostic/i);
    assert.match(executePrompt, /locked mission goal and scope plus committed checkpoint or successful-gate evidence/i);
  });

  test('task-2317: no-declared-gates implementation-to-act-on-review prompt compacts and reloads durable state', () => {
    const prompt = buildCompactActOnReviewPrompt({
      implementer: 'codex',
      branch: 'mission/task-2317-no-gates',
      attempt: 1,
      reviewOutcome: 'REQUEST_CHANGES',
      repoRoot,
    });

    assert.match(prompt, /Before acting on findings, compact the implementation context/i);
    assert.match(prompt, /applies even when the mission declares no gates/i);
    assert.match(prompt, /current review round and disposition; unresolved findings and implementer resolutions; and the exact revision under review/i);
  });

  test('task-2317: reviewer round-2 prompt compacts after rebase and reloads the rewritten baseline', () => {
    const prompt = buildCompactReviewPrompt({
      reviewer: 'claude',
      implementer: 'codex',
      branch: 'mission/task-2317-rebase',
      attempt: 2,
      reviewBaseline: 'post-rebase-baseline-sha',
      repoRoot,
    });

    assert.match(prompt, /When `2` is 2 or later, before beginning this review round compact/i);
    assert.match(prompt, /exact post-rebase revision and review baseline shown by `git diff post-rebase-baseline-sha\.\.HEAD`/i);
    assert.match(prompt, /independent of the mission.s declared gates/i);
  });

  test('task-2317: repairable gate-error bounce compacts before repair and retains diagnostic plus retry state', async () => {
    let repairPrompt = '';
    const result = await reboundPreReviewFailure('task-2317-bounce', repoRoot, gateFailureReason({
      ok: false,
      area: 'workflow',
      command: './scripts/verify-local.sh all',
      exitCode: 1,
      stdout: 'failing test: preserves diagnostic',
      stderr: 'assertion failed',
      error: 'verification gate failed with exit code 1',
    }), 'codex', {
      verifyFn: () => ({ ok: true }),
  // @ts-expect-error -- TASK-2328: partial test double after ESM seam migration
      readReviewStateFn: () => ({ round: 2, disposition: 'REQUEST_CHANGES', metadata: {} }),
  // @ts-expect-error -- TASK-2328: partial test double after ESM seam migration
      writeReviewStateFn: () => {},
  // @ts-expect-error -- TASK-2328: partial test double after ESM seam migration
      transitionTaskFn: async () => {},
  // @ts-expect-error -- TASK-2328: partial test double after ESM seam migration
      applyAgentFallbackFn: ({ original }: { original: string }) => original,
  // @ts-expect-error -- TASK-2328: partial test double after ESM seam migration
      startAgentFn: async (_step: string, options: { prompt: (agent: string) => string }) => {
        repairPrompt = options.prompt('codex');
        return { agent: 'codex', result: { status: 0 } };
      },
      log: () => {}, error: () => {},
    });

    // TASK-2377.03: the bounce is reported fixed only after the kernel's verify
    // callback re-runs the failing check and passes.
    assert.equal(result.bounced, true);
    assert.equal(result.stranded, false);
    assert.equal(result.outcome, 'fixed');
    assert.match(repairPrompt, /Before repair work, compact the aborted working context/i);
    assert.match(repairPrompt, /failing test: preserves diagnostic/);
    assert.match(repairPrompt, /Retry attempt: 1\/2/);
    assert.match(repairPrompt, /current review round and disposition; unresolved findings and implementer resolutions/i);
  });

  test('task-2317: reviewer and implementer recovery relaunches compact before work with their retry state', async () => {
    for (const [role, expectedOutput] of [
      ['reviewer', 'a formal review outcome'],
      ['implementer', 'a disposition'],
    ] as const) {
      let repairPrompt = '';
      await rebound({ kind: 'agent-timeout', role, diagnostic: `${role} timed out`, expectedOutput }, {
        slug: 'task-2317-timeout', worktree: repoRoot, implementer: 'codex',
        startAgent: async (_step, options) => {
          repairPrompt = (options.prompt as (agent: string) => string)('codex');
          return { result: { status: 0 } };
        },
        verify: () => ({ ok: true }), log: () => {}, error: () => {},
      });

      assert.match(repairPrompt, /Before repair work, compact the aborted working context/i);
      assert.match(repairPrompt, new RegExp(`Required output: ${expectedOutput}`));
      assert.match(repairPrompt, /Retry attempt: 1\/2/);
    }
  });

  test('task-2317: reviewer compaction follows successful rebase and baseline recapture before launch', () => {
    const rebaseIndex = reviewLoopSource.indexOf('const rebaseResult = await rebaseBeforeReviewRoundFn');
    // The baseline and its capture now live on the round's scratch record, so the
    // order is asserted on the assignment rather than on one spelling of it.
    const recaptureIndex = reviewLoopSource.search(
      new RegExp('(?:round\\.)?reviewBaseline = (?:round\\.)?captureReviewBaseline\\(\\);'),
    );
    const launchIndex = reviewLoopSource.indexOf("reviewerLaunchResult = await startAgentFn('review'", recaptureIndex);

    assert.ok(rebaseIndex >= 0, 'review loop must rebase before reviewer launch');
    assert.ok(recaptureIndex > rebaseIndex, 'review baseline must be recaptured after successful rebase');
    assert.ok(launchIndex > recaptureIndex, 'reviewer prompt must receive the post-rebase baseline');
  });
});

// Regression provenance: TASK-2359.
describe("repro", { concurrency: false }, () => {
  const reviewArgs = {
    reviewer: 'codex',
    branch: 'mission/task-2359',
    implementer: 'claude',
    focus: 'all',
    attempt: 1,
    reviewBaseline: 'review-baseline-sha',
  };

  function renderedReviewPrompts(): Array<[string, string]> {
    return [
      ['buildReviewPrompt', buildReviewPrompt(reviewArgs)],
      ['buildCompactReviewPrompt', buildCompactReviewPrompt(reviewArgs)],
    ];
  }

  test('task-2359: rendered review prompts treat unrelated PR history as context only (buildReviewPrompt + buildCompactReviewPrompt)', () => {
    for (const [builder, prompt] of renderedReviewPrompts()) {
      assert.match(prompt, /PR metadata, commit ancestry, and historical commits outside `git diff review-baseline-sha\.\.HEAD` are context only/i, builder);
      assert.match(prompt, /must not produce a mission finding, request-changes verdict, or workflow block/i, builder);
    }
  });

  test('task-2359: rendered review prompts ground findings in the mission diff, checkpoint evidence, or unidentified reviewed revision', () => {
    for (const [builder, prompt] of renderedReviewPrompts()) {
      // TASK-2521.03 made `px status` the single Mission reporting surface; the
      // grounding rule itself is unchanged.
      assert.match(prompt, /findings.*grounded in `git diff review-baseline-sha\.\.HEAD`, the Mission context and checkpoint evidence reported by `px status [^`]+`, or inability to identify the reviewed revision/i, builder);
    }
  });

  test('task-2359: rendered review prompts require a finding when the mission materially worsened the inconsistency', () => {
    for (const [builder, prompt] of renderedReviewPrompts()) {
      assert.match(prompt, /mission.*introduced or materially worsened the inconsistency/i, builder);
    }
  });

  test('task-2359: rendered review prompts require a finding for materially false checkpoint evidence', () => {
    for (const [builder, prompt] of renderedReviewPrompts()) {
      assert.match(prompt, /checkpoint evidence.*materially false/i, builder);
    }
  });

  test('task-2359: rendered review prompts require a finding when the review surface cannot identify the reviewed revision', () => {
    for (const [builder, prompt] of renderedReviewPrompts()) {
      assert.match(prompt, /review surface cannot identify the (exact )?reviewed revision/i, builder);
    }
  });

  test('task-2359: rendered review prompts retain rebasing-artifact guidance', () => {
    for (const [builder, prompt] of renderedReviewPrompts()) {
      assert.match(prompt, /Rebasing Artifacts:/, builder);
      assert.match(prompt, /stale-baseline noise as rebasing artifacts, not mission changes/i, builder);
    }
  });
});

// Regression provenance: TASK-2483.
describe("completed controls", { concurrency: false }, () => {
  // task-2483: the review prompt carries a machine-derived "already-executed
  // controls" block so a reviewer does not re-run gates the workflow already ran.
  // Every assertion here pins a mission success criterion (SC2-SC7).

  type Fixture = { repoRoot: string; missionPath: string };

  function makeFixture(options: {
    gateResult?: unknown;
    gates?: unknown;
    missionBody?: string;
  } = {}): Fixture {
    const repoRoot = registeredMkdtemp('task-2483-');
    const missionDir = path.join(repoRoot, 'missions', 'task-2483');
    fs.mkdirSync(missionDir, { recursive: true });
    const missionPath = path.join(missionDir, 'MISSION.md');
    fs.writeFileSync(missionPath, options.missionBody ?? '# Mission\n');
    if (options.gateResult !== undefined) {
      fs.mkdirSync(path.join(missionDir, '.workflow'), { recursive: true });
      fs.writeFileSync(path.join(missionDir, '.workflow', 'gate-result.json'), JSON.stringify(options.gateResult));
    }
    if (options.gates !== undefined) {
      fs.writeFileSync(path.join(repoRoot, 'workflow.config.json'), JSON.stringify({ adapters: { gates: options.gates } }));
    }
    return { repoRoot, missionPath };
  }

  function nonBlankLines(block: string): string[] {
    return block.split('\n').filter(l => l.trim().length > 0);
  }

  function assertWithinBudget(block: string): void {
    assert.ok(nonBlankLines(block).length <= COMPLETED_CONTROLS_MAX_LINES,
      `block exceeded ${COMPLETED_CONTROLS_MAX_LINES} non-blank lines: ${nonBlankLines(block).length}`);
    assert.ok(block.length <= COMPLETED_CONTROLS_MAX_CHARS,
      `block exceeded ${COMPLETED_CONTROLS_MAX_CHARS} characters: ${block.length}`);
  }

  const PASSING_RECORD = {
    area: 'all',
    command: './scripts/verify-local.sh all',
    exitCode: 0,
    status: 'passed',
    recordedAt: '2026-09-11T08:15:00.000Z',
  };

  const MISSION_WITH_GATES = [
    '# Mission: example',
    '',
    '## Gates',
    '- [ ] ./scripts/verify-local.sh all',
    '- [x] `npm run typecheck`',
    '',
    '## Stop Rules',
    '- none',
    '',
  ].join('\n');

  test('task-2483: a recorded passing gate renders its command, status, exit code and timestamp (SC2)', () => {
    const { repoRoot, missionPath } = makeFixture({ gateResult: PASSING_RECORD });
    try {
      const block = buildCompletedControlsBlock(missionPath, repoRoot);
      assert.match(block, /\.\/scripts\/verify-local\.sh all/);
      assert.match(block, /status passed/);
      assert.match(block, /exitCode 0/);
      assert.match(block, /recordedAt 2026-09-11T08:15:00\.000Z/);
      assertWithinBudget(block);
    } finally {
      fs.rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  test('task-2483: a recorded failing gate is never reported as passed (ADR 0048)', () => {
    // The record deliberately lies: status says "passed" while exitCode is 2. The
    // block must trust the exit code, because only an exit code proves a run.
    const { repoRoot, missionPath } = makeFixture({
      gateResult: { ...PASSING_RECORD, exitCode: 2, status: 'passed' },
    });
    try {
      const block = buildCompletedControlsBlock(missionPath, repoRoot);
      assert.match(block, /status failed/);
      assert.match(block, /exitCode 2/);
      assert.doesNotMatch(block, /status passed/);
      assertWithinBudget(block);
    } finally {
      fs.rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  test('task-2483: no gate record, no configured gates and no mission gates degrade to one line (SC5)', () => {
    const { repoRoot, missionPath } = makeFixture();
    try {
      const block = buildCompletedControlsBlock(missionPath, repoRoot);
      assert.equal(nonBlankLines(block).length, 1);
      assert.match(block, /No verification gate result is recorded/);
      assert.match(block, /permitted/);
      assertWithinBudget(block);
    } finally {
      fs.rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  test('task-2483: an unreadable gate-result artifact degrades instead of throwing', () => {
    const { repoRoot, missionPath } = makeFixture({ gateResult: '{ not json', missionBody: MISSION_WITH_GATES });
    try {
      fs.writeFileSync(path.join(path.dirname(missionPath), '.workflow', 'gate-result.json'), '{ not json');
      const block = buildCompletedControlsBlock(missionPath, repoRoot);
      assert.match(block, /No verification gate result is recorded/);
      assert.match(block, /npm run typecheck/);
      assertWithinBudget(block);
    } finally {
      fs.rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  test('task-2483: configured preHandoff and preReview gates render with their phase key (SC3)', () => {
    const { repoRoot, missionPath } = makeFixture({
      gateResult: PASSING_RECORD,
      gates: {
        preHandoff: [{ key: 'unit', command: 'npm test', order: 1 }],
        preReview: [{ key: 'lint', command: 'npm run lint', order: 1 }],
        preIntegration: [{ key: 'e2e', command: 'npm run e2e', order: 1 }],
      },
    });
    try {
      const block = buildCompletedControlsBlock(missionPath, repoRoot);
      assert.match(block, /preHandoff gates executed by handoff: unit `npm test`/);
      assert.match(block, /preReview gates NOT yet run[^\n]*lint `npm run lint`/);
      // preIntegration has not run at review time; claiming it would be a lie.
      assert.doesNotMatch(block, /npm run e2e/);
      assertWithinBudget(block);
    } finally {
      fs.rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  test('task-2483: every mission `## Gates` command line appears in the block (SC4)', () => {
    const { repoRoot, missionPath } = makeFixture({ missionBody: MISSION_WITH_GATES });
    try {
      const block = buildCompletedControlsBlock(missionPath, repoRoot);
      assert.match(block, /\.\/scripts\/verify-local\.sh all/);
      assert.match(block, /npm run typecheck/);
      // Lines from a later section must not be scraped in as gates.
      assert.doesNotMatch(block, /none/);
      assertWithinBudget(block);
    } finally {
      fs.rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  test('task-2483: a declared reproduction test is never reported as an executed gate (SC7)', () => {
    // TASK-2521.03: the block used to tell the reviewer "the red-to-green
    // reproduction gate ... already ran" whenever a `Reproduction-Test:` line was
    // present in the mission document. Nothing ran it — `verifyRedGreenProof` has
    // no production caller — so this block, which is explicitly the set of
    // controls the workflow executed, was asserting a control that never ran on
    // the strength of a string an agent wrote into a file.
    const withRepro = makeFixture({
      missionBody: `${MISSION_WITH_GATES}\nReproduction-Test: test/task-2483-repro.test.ts\n`,
    });
    const withoutRepro = makeFixture({ missionBody: MISSION_WITH_GATES });
    try {
      const present = buildCompletedControlsBlock(withRepro.missionPath, withRepro.repoRoot);
      const absent = buildCompletedControlsBlock(withoutRepro.missionPath, withoutRepro.repoRoot);
      assert.doesNotMatch(present, /reproduction gate/i, 'a declared test is not an executed gate');
      assert.doesNotMatch(absent, /reproduction gate/i);
      assertWithinBudget(present);
      assertWithinBudget(absent);
    } finally {
      fs.rmSync(withRepro.repoRoot, { recursive: true, force: true });
      fs.rmSync(withoutRepro.repoRoot, { recursive: true, force: true });
    }
  });

  test('task-2483: a configured preReview gate is never reported as executed (round 1 F1)', () => {
    // submitReview runs the 'review' phase gates only for an approve outcome
    // (src/adapters/review/review-commands.ts), which is strictly after this
    // prompt is issued. Configuration is not an execution record, so the block
    // must present a preReview gate as pending, never as an already-run control
    // the reviewer may skip.
    const { repoRoot, missionPath } = makeFixture({
      gateResult: PASSING_RECORD,
      gates: {
        preHandoff: [{ key: 'unit', command: 'npm test', order: 1 }],
        preReview: [{ key: 'lint', command: 'npm run lint', order: 1 }],
      },
    });
    try {
      const block = buildCompletedControlsBlock(missionPath, repoRoot);
      const preReviewLine = block.split('\n').find(l => /preReview/.test(l));
      assert.ok(preReviewLine, 'the configured preReview gate must still be listed with its phase key (SC3)');
      assert.match(preReviewLine, /npm run lint/);
      assert.match(preReviewLine, /NOT yet run/);
      assert.doesNotMatch(preReviewLine, /\bexecuted\b/);
      // Only the handoff-phase line may claim execution.
      for (const line of block.split('\n')) {
        if (!/\bexecuted\b/.test(line)) { continue; }
        assert.doesNotMatch(line, /preReview|preIntegration/,
          `a post-review lifecycle phase was reported as executed: ${line}`);
      }
    } finally {
      fs.rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  test('task-2483: the fully-populated block stays within 12 non-blank lines and 900 characters (SC6)', () => {
    const { repoRoot, missionPath } = makeFixture({
      gateResult: PASSING_RECORD,
      gates: {
        preHandoff: [
          { key: 'unit', command: 'npm test', order: 1 },
          { key: 'typecheck', command: 'npm run typecheck', order: 2 },
        ],
        preReview: [{ key: 'lint', command: 'npm run lint -- --max-warnings 0', order: 1 }],
        preIntegration: [{ key: 'e2e', command: 'npm run e2e', order: 1 }],
      },
      missionBody: `${MISSION_WITH_GATES}\nReproduction-Test: test/task-2483-repro.test.ts\n`,
    });
    try {
      const block = buildCompletedControlsBlock(missionPath, repoRoot);
      assertWithinBudget(block);
      // Fully populated means every control family is actually present.
      for (const marker of [/Verification gate/, /Mission `## Gates`/, /preHandoff gates executed by handoff/, /preReview gates NOT yet run/, /Goal Check/]) {
        assert.match(block, marker);
      }
    } finally {
      fs.rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  test('task-2483: a long gate command is truncated rather than blowing the character budget', () => {
    const { repoRoot, missionPath } = makeFixture({
      gateResult: { ...PASSING_RECORD, command: `./scripts/verify-local.sh ${'x'.repeat(400)}` },
    });
    try {
      const block = buildCompletedControlsBlock(missionPath, repoRoot);
      assertWithinBudget(block);
      assert.match(block, /…/);
    } finally {
      fs.rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  test('task-2483: buildCompactReviewPrompt substitutes {{completedControls}} and leaks no placeholder (SC2)', () => {
    const { repoRoot, missionPath } = makeFixture({ gateResult: PASSING_RECORD, missionBody: MISSION_WITH_GATES });
    try {
      const prompt = buildCompactReviewPrompt({
        reviewer: 'codex',
        branch: 'mission/task-2483',
        implementer: 'claude',
        attempt: 1,
        repoRoot,
        missionPath,
      });
      assert.doesNotMatch(prompt, /\{\{completedControls\}\}/);
      assert.doesNotMatch(prompt, /\{\{/);
      assert.match(prompt, /status passed/);
      assert.match(prompt, /exitCode 0/);
      assert.match(prompt, /recordedAt 2026-09-11T08:15:00\.000Z/);
      assert.match(prompt, /\.\/scripts\/verify-local\.sh all/);
    } finally {
      fs.rmSync(repoRoot, { recursive: true, force: true });
    }
  });
});
