// @ts-nocheck -- TASK-2328: partial test doubles from ESM seam migration; resolve in follow-up
/**
 * TASK-2377: Reproduce reviewer fallback missing when all agents exhausted.
 *
 * Bug: startAgent throws "All eligible agents exhausted" when all non-excluded
 * agents fail, without trying excluded agents (like the implementer) as a
 * last-resort self-reviewer.
 *
 * Fix: startAgent tries excluded agents after non-excluded pool exhausts.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

import { startAgent } from '../src/adapters/agents/agents.js';
// @ts-expect-error -- TASK-2328: partial test double after ESM seam migration
import { fakeLauncher } from './lib/agent-mock.js';

test('startAgent tries excluded agents after non-excluded pool exhausts (TASK-2377)', async () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'task-2377-repro-'));
  try {
    // Simulate: codex and qwen fail, then pool exhausts.
    // Excluded agent 'claude' (the implementer) should be tried as last resort.
    const launched = [];
    let callCount = 0;

    const selectAgentFn = (step, opts = {}) => {
      callCount++;
      const exclude = opts.exclude instanceof Set ? opts.exclude : new Set();

      // First call: exclude has {claude} (pre-seeded). Return codex.
      // Second call: exclude has {claude, codex}. Return qwen.
      // Third call: exclude has {claude, codex, qwen}. Pool exhausted for non-excluded.
      if (callCount === 1) return 'codex';
      if (callCount === 2) return 'qwen';
      // Third call: no more non-excluded agents
      throw new Error('All eligible agents for step "review" are exhausted (limit-hit or excluded). Tried: claude, codex, qwen.');
    };

    const launcherResults = [
      { status: 1, signal: null, stderr: 'Read-only file system', stdout: '' }, // codex fails
      { status: 1, signal: null, stderr: 'An unexpected critical error occurred', stdout: '' }, // qwen fails
      { status: 0, signal: null, stderr: '', stdout: '' }, // claude (excluded, last resort) succeeds
    ];
    let launcherIndex = 0;

    const result = await startAgent('review', {
      prompt: 'Review the changes.',
      worktree: tmpRoot,
      exclude: ['claude'], // implementer excluded for family separation
      isAgentBlockedFn: () => false,
      detectLimitHitFn: () => null,
      updateAgentBlockFn: () => ({ path: tmpRoot }),
      selectAgentFn,
      launchAgentFn: () => {
        launched.push(launcherIndex);
        const r = launcherResults[launcherIndex];
        launcherIndex++;
        return {
          invocation: { command: 'mock', args: [], options: { cwd: tmpRoot } },
          resultPromise: Promise.resolve(r),
        };
      },
      assertAgentSupportedFn: () => {},
      log: () => {}
    });

    assert.equal(result.agent, 'claude', 'excluded agent (implementer) should be tried as last resort');
    assert.equal(launched.length, 3, 'should have launched 3 agents: codex, qwen, then claude');
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});

test('startAgent throws exhaustion after both non-excluded and excluded agents fail (TASK-2377)', async () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'task-2377-exhaust-'));
  try {
    let callCount = 0;

    const selectAgentFn = (step, opts = {}) => {
      callCount++;
      if (callCount === 1) return 'codex';
      if (callCount === 2) return 'qwen';
      throw new Error('All eligible agents for step "review" are exhausted (limit-hit or excluded). Tried: claude, codex, qwen.');
    };

    // All agents fail, including the excluded one
    const launched = [];
    const launcherResults = [
      { status: 1, signal: null, stderr: 'error1', stdout: '' }, // codex
      { status: 1, signal: null, stderr: 'error2', stdout: '' }, // qwen
      { status: 1, signal: null, stderr: 'error3', stdout: '' }, // claude (excluded, last resort)
    ];
    let launcherIndex = 0;

    await assert.rejects(
      startAgent('review', {
        prompt: 'Review.',
        worktree: tmpRoot,
        exclude: ['claude'],
        isAgentBlockedFn: () => false,
        detectLimitHitFn: () => null,
        updateAgentBlockFn: () => ({ path: tmpRoot }),
        selectAgentFn,
        launchAgentFn: () => {
          launched.push(launcherIndex);
          const r = launcherResults[launcherIndex];
          launcherIndex++;
          return {
            invocation: { command: 'mock', args: [], options: { cwd: tmpRoot } },
            resultPromise: Promise.resolve(r),
          };
        },
        assertAgentSupportedFn: () => {},
        log: () => {}
      }),
      /All eligible agents exhausted/
    );
    assert.equal(launched.length, 3, 'all agents including excluded should be tried before throwing');
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});

test('startAgent does not try excluded agents when non-excluded agent succeeds (TASK-2377)', async () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'task-2377-succeed-'));
  try {
    const result = await startAgent('review', {
      prompt: 'Review.',
      worktree: tmpRoot,
      exclude: ['claude'],
      isAgentBlockedFn: () => false,
      detectLimitHitFn: () => null,
      updateAgentBlockFn: () => ({ path: tmpRoot }),
      selectAgentFn: () => 'codex', // succeeds on first try
      launchAgentFn: fakeLauncher({ exitCode: 0 }),
      assertAgentSupportedFn: () => {},
      log: () => {}
    });

    assert.equal(result.agent, 'codex', 'should succeed with non-excluded agent');
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});
