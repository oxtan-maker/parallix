import { reviewLoopReporter } from '../../../../src/adapters/review/review-loop-presentation.js';
// @ts-nocheck -- Retained legacy partial request doubles (TASK-2328).
// review launcher family contract.
// Related scenarios share imports; each contract keeps its own hooks and mutable fixtures.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  selectAgent,
  setLauncherHealthProbe,
  setCommandPathProbe,
  workflowLauncherStatus,
} from '../../../../src/adapters/agents/agents.js';
import { selectReviewer } from '../../../../src/application/review-loop/reviewer-selection.js';
import type { ReviewerRoutingPort } from '../../../../src/application/ports/review-round.js';
import { resolveHandoffReviewAssignment } from '../../../../src/adapters/cli/commands/handoff.js';
import { AgentPoolExhaustedError } from '../../../../src/domain/agents.js';
import { mkdtemp as registeredMkdtemp } from '../../../helpers/temp-dir.js';

// Regression provenance: TASK-2335.
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

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const originalRandom = Math.random;
const originalPath = process.env.PATH;
const originalWorkflowAgent = process.env.WORKFLOW_AGENT;
const originalCodexHome = process.env.CODEX_HOME;

// Exercise the real configured selector with injected external launcher boundaries.
// Each case owns its availability policy; no child process or PATH fixture is needed.
function availableLaunchers(_tmpRoot: string) {
  const available = new Set(['codex', 'claude', 'gemini', 'opencode', 'vibe']);
  setCommandPathProbe((name: string) => available.has(name) ? name : null);
  setLauncherHealthProbe(() => ({ ok: true }));
}

test.afterEach(() => {
  process.env.PATH = originalPath;
  if (originalCodexHome === undefined) delete process.env.CODEX_HOME;
  else process.env.CODEX_HOME = originalCodexHome;
  if (originalWorkflowAgent === undefined) delete process.env.WORKFLOW_AGENT;
  else process.env.WORKFLOW_AGENT = originalWorkflowAgent;
  setCommandPathProbe((name: string) => name);
  setLauncherHealthProbe(() => ({ ok: true }));
  Math.random = originalRandom;
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
      throw new AgentPoolExhaustedError('review', 'cross-family reviewer pool exhausted');
    }
  });

  assert.equal(assignment.implementer, 'codex');
  assert.equal(assignment.reviewer, 'codex');
  assert.deepEqual(assignment.reviewerEligibility.reviewers, ['codex']);
});

// =============================================================================
// CP-1 / CP-3: selectAgent cross-family exclusion (injected launcher probes)
// =============================================================================
// These tests call the real `selectAgent` with the same arguments the
// review-loop uses: selectAgent('review', { exclude: new Set([implementer]) }).
// They do NOT pass a `config` parameter — selectAgent reads from the default
// config/agents.json on disk, matching the production code path.

test('selectAgent review selection excludes the author family and picks a cross-family reviewer (injected launcher probes)', () => {
  const tmpRoot = registeredMkdtemp('task-2335-repro-');
  try {
    availableLaunchers(tmpRoot);
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
  const tmpRoot = registeredMkdtemp('task-2335-repro-multi-');
  try {
    availableLaunchers(tmpRoot);
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
  const tmpRoot = registeredMkdtemp('task-2335-repro-random-');
  try {
    availableLaunchers(tmpRoot);
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
  const tmpRoot = registeredMkdtemp('task-2335-repro-fallback-');
  try {
    availableLaunchers(tmpRoot);
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
// CP-3: Review-loop path — reviewer selection excludes the author family
// =============================================================================
// The application reviewer-selection policy nominates through the routing
// port with the implementer excluded. The port here wraps the real selectAgent
// so the production config-reading and launcher-availability logic is
// exercised.

function routingOver(nominate: (_excluded: ReadonlySet<string>) => string, status: (_agent: string) => { supported: boolean; detail: string }): ReviewerRoutingPort {
  return { eligibleFamilies: () => ['codex', 'claude', 'custom', 'vibe'], launcherStatus: status, nominate, runtimeMatrix: () => [] };
}

function selectFor(implementer: string, routing: ReviewerRoutingPort, logs: string[]) {
  return selectReviewer({ implementer, isContinue: false, persisted: null, maxAttempts: 1, dryRun: true, providerEnabled: false, slug: 'task-999' }, routing, reviewLoopReporter({ log: msg => logs.push(msg), error: msg => logs.push(msg) }));
}

test('review-loop reviewer selection excludes the author family (review-loop path)', () => {
  const tmpRoot = registeredMkdtemp('task-2335-repro-loop-');
  const originalRandom = Math.random;
  try {
    availableLaunchers(tmpRoot);
    delete process.env.WORKFLOW_AGENT;
    const logs: string[] = [];
    let selectAgentCallArgs: { step: string; exclude: string[] } | null = null;
    // Stub Math.random so selectAgent returns a deterministic agent.
    Math.random = () => 0.33;
    const selected = selectFor('codex', routingOver(excluded => {
      selectAgentCallArgs = { step: 'review', exclude: [...excluded] };
      // Real selectAgent — reads config/agents.json from disk.
      return selectAgent('review', { exclude: new Set(excluded), mainWorktreePath: null });
    }, agent => ({ supported: true, detail: agent })), logs);

    assert.ok(selectAgentCallArgs, 'the selector should have been asked during reviewer selection');
    assert.ok(selectAgentCallArgs.exclude.includes('codex'), `exclude set should contain the implementer 'codex'; got: ${JSON.stringify(selectAgentCallArgs.exclude)}`);
    assert.notEqual(selected?.reviewer, 'codex', `selected reviewer must NOT be the implementer family 'codex'; got '${selected?.reviewer}'`);
    assert.ok(['claude', 'custom', 'vibe'].includes(selected!.reviewer), `selected reviewer must be an eligible cross-family agent; got '${selected?.reviewer}'`);
  } finally {
    Math.random = originalRandom;
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});

// =============================================================================
// CP-4: Review-loop single-family fallback path
// =============================================================================
// When no different-family reviewer is runnable, reviewer selection falls back
// to the implementer (single-family-fallback). The selector and the launcher
// status share one availability seam: commandPathProbe only finds codex.

test('review-loop single-family fallback when no cross-family reviewer is runnable', () => {
  const tmpRoot = registeredMkdtemp('task-2335-repro-sff-');
  try {
    setCommandPathProbe((name: string) => name === 'codex' ? name : null);
    setLauncherHealthProbe(() => ({ ok: true }));
    delete process.env.WORKFLOW_AGENT;
    const logs: string[] = [];
    let selectAgentThrew = false;
    const selected = selectFor('codex', routingOver(excluded => {
      try {
        // Real selectAgent: every cross-family launcher is unavailable.
        return selectAgent('review', { exclude: new Set(excluded), worktree: tmpRoot, mainWorktreePath: null });
      } catch (err) {
        selectAgentThrew = true;
        throw err;
      }
    }, agent => workflowLauncherStatus(agent, tmpRoot)), logs);

    assert.ok(selectAgentThrew, 'selectAgent should throw when no cross-family agent has a working launcher');
    assert.equal(selected?.reviewerSource, 'single-family-fallback');
    assert.ok(logs.some(l => l.includes('Single-family fallback')), `Expected single-family fallback log message; logs: ${logs.join(' | ')}`);
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});
