// @ts-nocheck -- TASK-2328: partial test doubles from ESM seam migration; resolve in follow-up
/**
 * TASK-2335: Reproduce the task-2322.12 reviewer-selection regression.
 *
 * Regression: review selection returns a same-family reviewer (self-review)
 * instead of applying the configured policy and selecting a reviewer from a
 * different agent family than the PR author.
 *
 * This test exercises the actual launch path: the real `selectAgent` function
 * from `launcher-selection.ts` (via `src/adapters/agents/launcher-selection.ts`),
 * called with the same arguments the review-loop uses:
 *   selectAgent('review', { exclude: new Set([implementer]) })
 *
 * The review-loop does NOT pass a `config` parameter — selectAgent reads from
 * the default `config/agents.json` on disk. The test verifies this path
 * correctly excludes the author family and selects a cross-family reviewer.
 * It also covers the documented no-cross-family fallback.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

import { selectAgent, eligibleAgentsForStep, setCommandPathProbe, readAgentConfig, workflowLauncherStatus, } from '../src/adapters/agents/agents.js';
import { startReviewLoop, } from '../src/adapters/review/review-loop.js';
import { resolveHandoffReviewAssignment, } from '../src/adapters/cli/commands/handoff.js';
const originalPath = process.env.PATH;
const originalWorkflowAgent = process.env.WORKFLOW_AGENT;
const originalCodexHome = process.env.CODEX_HOME;

// A POSIX sh stub keeps the real launch path (command resolution + `--help`
// health-probe spawn) intact while the probe itself costs a shell exec
// (~5 ms) instead of a full Node startup (~100 ms) per agent per call.
function writeLauncherStub(binDir: string, name: string) {
  const stub = path.join(binDir, name);
  fs.writeFileSync(stub, '#!/bin/sh\nexit 0\n', 'utf8');
  fs.chmodSync(stub, 0o755);
}

function installPathLaunchers(tmpRoot: string) {
  const binDir = path.join(tmpRoot, 'bin');
  fs.mkdirSync(binDir, { recursive: true });
  for (const name of ['codex', 'claude', 'gemini', 'opencode', 'vibe']) {
    writeLauncherStub(binDir, name);
  }
  process.env.PATH = `${binDir}${path.delimiter}${process.env.PATH}`;
  process.env.CODEX_HOME ||= path.join(tmpRoot, 'glm-codex-home');
  setCommandPathProbe((name: string) => fs.existsSync(path.join(binDir, name)));
}

test.after(() => {
  process.env.PATH = originalPath;
  if (originalCodexHome === undefined) delete process.env.CODEX_HOME;
  else process.env.CODEX_HOME = originalCodexHome;
  setCommandPathProbe(null);
});

// =============================================================================
// CP-1: production regression boundary — handoff persists the first reviewer
// =============================================================================

test('handoff persists a configured cross-family reviewer instead of the PR author', () => {
  const calls: unknown[][] = [];
  const assignment = resolveHandoffReviewAssignment('claude', {
    worktree: '/tmp/task-2335',
    eligibleAgentsForStepFn: (step: string) => {
      calls.push(['eligible', step]);
      return ['codex', 'claude', 'custom', 'vibe'];
    },
    selectAgentFn: (step: string, options: { exclude: Set<string> }) => {
      calls.push(['select', step, [...options.exclude]]);
      return 'custom';
    }
  });

  assert.equal(assignment.implementer, 'claude');
  assert.equal(assignment.reviewer, 'custom');
  assert.deepEqual(assignment.reviewerEligibility.reviewers, ['codex', 'claude', 'custom', 'vibe']);
  assert.deepEqual(calls, [
    ['eligible', 'review'],
    ['select', 'review', ['claude']]
  ]);
});

test('handoff uses same-family reviewer only when cross-family selection is exhausted', () => {
  const assignment = resolveHandoffReviewAssignment('codex', {
    eligibleAgentsForStepFn: () => ['codex'],
    selectAgentFn: () => {
      throw new Error('All eligible agents for step "review" are exhausted');
    }
  });

  assert.equal(assignment.implementer, 'codex');
  assert.equal(assignment.reviewer, 'codex');
  assert.deepEqual(assignment.reviewerEligibility.reviewers, ['codex']);
});

// =============================================================================
// CP-1 / CP-3: selectAgent cross-family exclusion (real launch path)
// =============================================================================
// These tests call the real `selectAgent` with the same arguments the
// review-loop uses: selectAgent('review', { exclude: new Set([implementer]) }).
// They do NOT pass a `config` parameter — selectAgent reads from the default
// config/agents.json on disk, matching the production code path.

test('selectAgent review selection excludes the author family and picks a cross-family reviewer (real launch path)', () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'task-2335-repro-'));
  try {
    installPathLaunchers(tmpRoot);
    delete process.env.WORKFLOW_AGENT;

    // Author/implementer is in family 'codex'.
    // selectAgent('review', { exclude: new Set(['codex']) }) is called WITHOUT
    // a config parameter — it reads config/agents.json from disk, which has
    // review eligible: ['codex', 'claude', 'custom', 'vibe'].
    // The pool after exclusion should be ['claude', 'custom', 'vibe'].
    const implementer = 'codex';
    const selected = selectAgent('review', {
      exclude: new Set([implementer]),
      // Skip the git main-worktree lookup in config scoping (subprocess per call).
      mainWorktreePath: null
    });

    assert.notEqual(
      selected,
      implementer,
      `selectAgent must NOT return the implementer family "${implementer}" as reviewer`
    );
    assert.ok(
      ['claude', 'custom', 'vibe'].includes(selected),
      `selectAgent must return an eligible cross-family reviewer; got "${selected}"`
    );
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});

test('selectAgent review selection with multiple runs always excludes the author family', () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'task-2335-repro-multi-'));
  try {
    installPathLaunchers(tmpRoot);
    delete process.env.WORKFLOW_AGENT;

    const implementer = 'claude';
    // Run multiple times to verify randomness does not accidentally return the implementer.
    // Calls real selectAgent WITHOUT config parameter (production path).
    const iterations = 3;
    for (let i = 0; i < iterations; i++) {
      const selected = selectAgent('review', {
        exclude: new Set([implementer]),
        // Skip the git main-worktree lookup in config scoping (subprocess per call).
        mainWorktreePath: null
      });
      assert.notEqual(
        selected,
        implementer,
        `iteration ${i}: selectAgent must NOT return the implementer family "${implementer}" as reviewer`
      );
      assert.ok(
        ['codex', 'custom', 'vibe'].includes(selected),
        `iteration ${i}: selectAgent must return an eligible cross-family agent; got "${selected}"`
      );
    }
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});

test('selectAgent uses configured random selection over the eligible cross-family set', () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'task-2335-repro-random-'));
  try {
    installPathLaunchers(tmpRoot);
    delete process.env.WORKFLOW_AGENT;

    // Stub Math.random to control which index is selected.
    // With pool = ['codex', 'custom', 'vibe'] (claude excluded),
    // Math.random() * 3 at 0.1 picks index 0 (codex), 0.6 picks index 1 (custom).
    const originalRandom = Math.random;

    // Force index 0 selection
    Math.random = () => 0.1;
    const selected0 = selectAgent('review', {
      exclude: new Set(['claude']),
      mainWorktreePath: null
    });
    assert.equal(selected0, 'codex', 'controlled random should pick first cross-family candidate');

    // Force index 1 selection
    Math.random = () => 0.6;
    const selected1 = selectAgent('review', {
      exclude: new Set(['claude']),
      mainWorktreePath: null
    });
    assert.equal(selected1, 'custom', 'controlled random should pick second cross-family candidate');

    Math.random = originalRandom;
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});

// =============================================================================
// CP-1 / CP-4: No-cross-family fallback
// =============================================================================

test('selectAgent throws when all eligible agents are excluded (no-cross-family fallback)', () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'task-2335-repro-fallback-'));
  try {
    installPathLaunchers(tmpRoot);
    delete process.env.WORKFLOW_AGENT;

    // config/agents.json has review eligible: ['codex', 'claude', 'custom', 'qwen', 'vibe'].
    // Excluding all five should throw "All eligible agents ... are exhausted".
    assert.throws(
      () => selectAgent('review', {
        exclude: new Set(['codex', 'claude', 'custom', 'qwen', 'vibe']),
        mainWorktreePath: null
      }),
      { message: /All eligible agents for step "review" are exhausted/ }
    );
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});

// =============================================================================
// CP-3: Review-loop path — startReviewLoop passes exclude to selectAgentFn
// =============================================================================
// This test verifies that startReviewLoop calls selectAgentFn with the
// implementer in the exclude set, exercising the actual review-launch path.
// It uses the real selectAgent for the injected selectAgentFn so the
// production config-reading and launcher-availability logic is exercised.

test('startReviewLoop reviewer selection excludes the author family (review-loop path)', async () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'task-2335-repro-loop-'));
  try {
    installPathLaunchers(tmpRoot);
    delete process.env.WORKFLOW_AGENT;

    const logs: string[] = [];
    const errors: string[] = [];
    let selectedReviewer: string | null = null;
    let selectAgentCallArgs: { step: string; exclude: string[] } | null = null;

    // Stub Math.random so selectAgent returns a deterministic agent
    const originalRandom = Math.random;
    Math.random = () => 0.33; // picks middle of pool

    await startReviewLoop('task-999', {
      worktree: tmpRoot,
      implementer: 'codex',
      maxAttempts: 1,
      dryRun: true,
      maybeUpdateGraphifyBeforeReviewFn: () => {},
      resolveTaskFileFn: () => ({ ok: true, taskFile: '/tmp/task-999.md' }),
      getTaskImplementerFn: () => 'codex',
      readReviewStateFn: () => null,
      eligibleAgentsForStepFn: () => ['codex', 'claude', 'custom', 'vibe'],
      workflowLauncherStatusFn: (agent: string) => ({ agent, supported: true, detail: 'mock' }),
      // Use the real selectAgent (no custom wrapper) so the production
      // config-reading and launcher-availability path is exercised.
      // The review-loop calls selectAgentFn('review', { exclude: new Set([implementer]) }).
      // We wrap it to capture the call arguments.
      selectAgentFn: (step: string, opts: { exclude: Set<string> }) => {
        selectAgentCallArgs = { step, exclude: opts && opts.exclude ? [...opts.exclude] : [] };
        // Real selectAgent — reads config/agents.json from disk
        const result = selectAgent(step, { exclude: opts && opts.exclude, mainWorktreePath: null });
        selectedReviewer = result;
        return result;
      },
      rebaseBeforeReviewRoundFn: async () => ({ ok: true }),
      startAgentFn: async () => ({ agent: 'codex', result: { status: 0 } }),
      consumeReviewerArtifactsFn: async () => ({ consumed: true, ok: true, reviewState: 'REQUEST_CHANGES' }),
      consumeImplementerArtifactsFn: async () => ({ consumed: true, ok: true, disposition: 'CHANGES_MADE' }),
      transitionTaskFn: () => true,
      transitionVirtualFn: () => true,
      writeReviewStateFn: () => {},
      log: (msg: string) => logs.push(msg),
      error: (msg: string) => errors.push(msg),
      exit: (code: number) => { throw new Error(`exit(${code})`); }
    });

    Math.random = originalRandom;

    // The selectAgentFn should have been called with exclude containing 'codex'
    assert.ok(
      selectAgentCallArgs,
      'selectAgentFn should have been called during reviewer selection'
    );
    assert.ok(
      selectAgentCallArgs.exclude.includes('codex'),
      `selectAgentFn exclude set should contain the implementer 'codex'; got: ${JSON.stringify(selectAgentCallArgs.exclude)}`
    );
    assert.notEqual(
      selectedReviewer,
      'codex',
      `selected reviewer must NOT be the implementer family 'codex'; got '${selectedReviewer}'`
    );
    assert.ok(
      ['claude', 'custom', 'vibe'].includes(selectedReviewer!),
      `selected reviewer must be an eligible cross-family agent; got '${selectedReviewer}'`
    );
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});

// =============================================================================
// CP-4: Review-loop single-family fallback path
// =============================================================================
// When no different-family reviewer is runnable, the review-loop falls back
// to the implementer (single-family-fallback). This test verifies that path.
//
// The review-loop uses a single consistent launcher-status seam:
//   - selectAgentFn calls the real selectAgent, which uses workflowLauncherStatus
//     (backed by commandPathProbe) to check launcher availability.
//   - workflowLauncherStatusFn (injected into the review-loop) uses the SAME
//     underlying launcher availability.
// By setting commandPathProbe to only find 'codex', both selectAgent and the
// review-loop see the same availability: only codex is runnable.

test('startReviewLoop single-family fallback when no cross-family reviewer is runnable', async () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'task-2335-repro-sff-'));
  try {
    // Create launcher symlinks only for codex (the implementer).
    // Cross-family agents have no launcher, so selectAgent will see them
    // as unavailable and throw "No eligible agents have a working launcher".
    const binDir = path.join(tmpRoot, 'bin');
    fs.mkdirSync(binDir, { recursive: true });
    writeLauncherStub(binDir, 'codex');
    process.env.PATH = `${binDir}${path.delimiter}${process.env.PATH}`;
    process.env.CODEX_HOME ||= path.join(tmpRoot, 'glm-codex-home');
    // commandPathProbe returns truthy only for codex — this is the single
    // consistency seam: both real selectAgent and the review-loop fallback
    // check see the same launcher availability.
    setCommandPathProbe((name: string) => name === 'codex' ? fs.existsSync(path.join(binDir, name)) : null);
    delete process.env.WORKFLOW_AGENT;

    const logs: string[] = [];
    const errors: string[] = [];
    let selectAgentThrew = false;

    await startReviewLoop('task-999', {
      worktree: tmpRoot,
      implementer: 'codex',
      maxAttempts: 1,
      dryRun: true,
      maybeUpdateGraphifyBeforeReviewFn: () => {},
      resolveTaskFileFn: () => ({ ok: true, taskFile: '/tmp/task-999.md' }),
      getTaskImplementerFn: () => 'codex',
      readReviewStateFn: () => null,
      eligibleAgentsForStepFn: () => ['codex', 'claude', 'custom', 'vibe'],
      // Inject the real workflowLauncherStatus so the review-loop fallback
      // check uses the same launcher availability as selectAgent.
      workflowLauncherStatusFn: (agent: string) => workflowLauncherStatus(agent, tmpRoot),
      selectAgentFn: (step: string, opts: { exclude: Set<string>; worktree?: string }) => {
        try {
          // Real selectAgent — uses commandPathProbe (only codex found),
          // so cross-family agents are all unavailable. Throws because
          // no eligible cross-family agent has a working launcher.
          return selectAgent(step, { exclude: opts && opts.exclude, worktree: tmpRoot, mainWorktreePath: null });
        } catch (err) {
          selectAgentThrew = true;
          throw err;
        }
      },
      rebaseBeforeReviewRoundFn: async () => ({ ok: true }),
      startAgentFn: async () => ({ agent: 'codex', result: { status: 0 } }),
      consumeReviewerArtifactsFn: async () => ({ consumed: true, ok: true, reviewState: 'REQUEST_CHANGES' }),
      consumeImplementerArtifactsFn: async () => ({ consumed: true, ok: true, disposition: 'CHANGES_MADE' }),
      transitionTaskFn: () => true,
      transitionVirtualFn: () => true,
      writeReviewStateFn: () => {},
      log: (msg: string) => logs.push(msg),
      error: (msg: string) => errors.push(msg),
      exit: (code: number) => { throw new Error(`exit(${code})`); }
    });

    // selectAgent should have thrown (no cross-family launcher available)
    assert.ok(
      selectAgentThrew,
      'selectAgentFn should throw when no cross-family agent has a working launcher'
    );

    // Verify single-family-fallback was triggered
    const fallbackLog = logs.find(l =>
      l.includes('Single-family fallback') || l.includes('single-family-fallback')
    );
    assert.ok(
      fallbackLog,
      `Expected single-family fallback log message; logs: ${JSON.stringify(logs.filter(l => l.includes('fallback') || l.includes('Family') || l.includes('family'))).slice(0, 300)}`
    );
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});
