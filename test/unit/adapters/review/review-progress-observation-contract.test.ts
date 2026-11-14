// Review-run progress is observational: a failed status projection must not
// turn an already-started reviewer into a failed reviewer launch.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createReviewLoopPorts } from '../../../../src/adapters/review/review-loop.js';
import type { StartAgentOptions } from '../../../../src/adapters/agents/agent-launch-context.js';
import type { AgentProcessResult } from '../../../../src/adapters/agents/agent-process-types.js';
import { missionExecutionContext } from '../../../fixtures/mission-execution-context.js';

test('reviewer progress observation failure cannot terminate an already-started reviewer (PX-0046.06)', async () => {
  const warnings: string[] = [];
  const root = path.resolve(import.meta.dirname, '..', '..', '..', '..');
  const ports = createReviewLoopPorts('task-progress-observation', {
    executionContext: missionExecutionContext({ missionId: 'task-progress-observation', missionWorktree: root }),
  }, {
    isProviderEnabled: () => false,
    log: line => { warnings.push(line); },
    error: () => {},
    startAgent: async (_step: string, options: StartAgentOptions = { prompt: '' }) => {
      const result: AgentProcessResult = { status: 0, runId: 'review-claude-a1-native' };
      await options.onLaunch?.({ agent: 'claude', model: null, invocation: null, startedAtMs: 0, runId: result.runId });
      return { agent: 'claude', invocation: null, result };
    },
  });
  const launch = await ports.agents.launch({ role: 'reviewer', agent: 'claude', exclude: [],
    onStarted: async () => { throw new Error('operator database unavailable'); } });
  assert.equal(launch?.result?.status, 0);
  assert.ok(warnings.some(line => /progress observation unavailable.*continues/i.test(line)), warnings.join(' | '));
});
