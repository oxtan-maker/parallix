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
const repositoryReviewPolicy = fs.readFileSync(
  path.resolve(__dirname, '../../../../prompts/review.md'),
  'utf8',
).trimEnd();

import { startAgent } from '../../../../src/adapters/agents/agents.js';
import { agentFamily, AgentPoolExhaustedError } from '../../../../src/domain/agents.js';
import { missionId } from '../../../../src/domain/mission.js';
import type { SessionMarkerPort } from '../../../../src/application/domain-ports.js';
import type { AgentLauncherInput } from '../../../../src/adapters/agents/agent-process-types.js';
import { buildCompactReviewPrompt } from '../../../../src/adapters/review/review-prompts.js';
import { fakeLauncher } from '../../../lib/agent-mock.js';
import { mkdtemp as registeredMkdtemp } from '../../../helpers/temp-dir.js';

test('startAgent tries excluded agents after non-excluded pool exhausts (TASK-2377)', async () => {
  const tmpRoot = registeredMkdtemp('task-2377-repro-');
  try {
    // Simulate: codex and qwen fail, then pool exhausts.
    // Excluded agent 'claude' (the implementer) should be tried as last resort.
    const launched: AgentLauncherInput[] = [];
    let callCount = 0;
    const markerCalls = { find: 0, save: 0, delete: 0, shouldResume: 0 };
    const markerPort: SessionMarkerPort = {
      find: async () => { markerCalls.find++; return { missionId: missionId('px-0046-fallback'), role: 'review', agent: agentFamily('claude'), lastLaunched: '2026-11-01T00:00:00Z', sessionId: 'implementation-session' }; },
      save: async () => { markerCalls.save++; },
      delete: async () => { markerCalls.delete++; },
      shouldResume: async () => { markerCalls.shouldResume++; return true; },
    };

    const selectAgentFn: NonNullable<NonNullable<Parameters<typeof startAgent>[1]>["selectAgentFn"]> = (step, opts = {}) => {
      callCount++;
      const exclude = opts.exclude instanceof Set ? opts.exclude : new Set();

      // First call: exclude has {claude} (pre-seeded). Return codex.
      // Second call: exclude has {claude, codex}. Return qwen.
      // Third call: exclude has {claude, codex, qwen}. Pool exhausted for non-excluded.
      if (callCount === 1) return 'codex';
      if (callCount === 2) return 'qwen';
      // Third call: no more non-excluded agents
      throw new AgentPoolExhaustedError(step, 'pool unavailable');
    };

    const launcherResults = [
      { status: 1, signal: null, stderr: 'Read-only file system', stdout: '' }, // codex fails
      { status: 1, signal: null, stderr: 'An unexpected critical error occurred', stdout: '' }, // qwen fails
      { status: 0, signal: null, stderr: '', stdout: '' }, // claude (excluded, last resort) succeeds
    ];
    let launcherIndex = 0;

    const result = await startAgent('review', {
      prompt: actual => buildCompactReviewPrompt({ reviewer: actual, implementer: 'claude', branch: 'mission/px-0046-fallback', attempt: 1 }),
      worktree: tmpRoot,
      slug: 'px-0046-fallback',
      role: 'reviewer',
      sessionPolicy: 'fresh-ephemeral',
      sessionMarkerPort: markerPort,
      exclude: ['claude'], // implementer excluded for family separation
      isAgentBlockedFn: () => false,
      detectLimitHitFn: () => null,
      updateAgentBlockFn: () => ({}),
      selectAgentFn,
      resolveAgentModelFn: family => `configured-${family}`,
      launchAgentFn: input => {
        launched.push(input);
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
    assert.deepEqual(markerCalls, { find: 0, save: 0, delete: 0, shouldResume: 0 }, 'fresh review attempts never read, replace, or delete the implementer marker');
    for (const input of launched) {
      assert.equal(input.resume, false);
      assert.equal(input.sessionId, null);
      assert.equal(input.model, `configured-${input.env?.FORGEJO_USER}`, 'configured per-family model selection is preserved');
      assert.equal(input.prompt.split(repositoryReviewPolicy).length - 1, 1, 'fallback attempts retain the repository review policy exactly once');
    }
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});

test('startAgent throws exhaustion after both non-excluded and excluded agents fail (TASK-2377)', async () => {
  const tmpRoot = registeredMkdtemp('task-2377-exhaust-');
  try {
    let callCount = 0;

    const selectAgentFn: NonNullable<NonNullable<Parameters<typeof startAgent>[1]>["selectAgentFn"]> = (step, opts = {}) => {
      callCount++;
      if (callCount === 1) return 'codex';
      if (callCount === 2) return 'qwen';
      throw new AgentPoolExhaustedError(step, 'pool unavailable');
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
        updateAgentBlockFn: () => ({}),
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
  const tmpRoot = registeredMkdtemp('task-2377-succeed-');
  try {
    const result = await startAgent('review', {
      prompt: 'Review.',
      worktree: tmpRoot,
      exclude: ['claude'],
      isAgentBlockedFn: () => false,
      detectLimitHitFn: () => null,
      updateAgentBlockFn: () => ({}),
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
