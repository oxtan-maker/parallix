import test from 'node:test';
import assert from 'node:assert/strict';

import { agentFamily } from '../src/domain/agents.js';
import { PreparedAgentSelection } from '../src/application/services/agent-selection.js';
import { selectPreparedReviewer } from '../src/adapters/review/review-loop.js';

test('review-loop prepared selection skips SQLite-blocked reviewer before any launch (TASK-2351)', async () => {
  const codex = agentFamily('codex');
  const claude = agentFamily('claude');
  let launchCalls = 0;
  const prepared = await PreparedAgentSelection.prepare({
    async load() {
      return {
        capturedAtMs: 1_000,
        defaultPolicy: { eligible: [codex, claude], strategy: 'random' },
        steps: { review: { eligible: [codex, claude], strategy: 'random' } },
        agents: [
          { family: codex, launcherAvailable: true, block: { kind: 'until', untilMs: 2_000, reason: 'SQLite limit' } },
          { family: claude, launcherAvailable: true, block: { kind: 'none' } },
        ],
      };
    },
  });
  const reviewer = selectPreparedReviewer(prepared, new Set());
  if (reviewer === 'codex') { launchCalls += 1; }
  assert.equal(reviewer, 'claude');
  assert.equal(launchCalls, 0, 'blocked codex receives zero launch calls');
});
