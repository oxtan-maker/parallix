import test from 'node:test';
import assert from 'node:assert/strict';

import { agentFamily } from '../src/domain/agents.js';
import { PreparedAgentSelection } from '../src/application/services/agent-selection.js';
import { resolveHandoffReviewAssignment } from '../src/adapters/cli/commands/handoff.js';

test('SQLite-blocked reviewer is not nominated when JSON blocklist is stale (TASK-2351 repro)', async () => {
  const codex = agentFamily('codex');
  const claude = agentFamily('claude');
  const prepared = await PreparedAgentSelection.prepare({
    async load() {
      return {
        capturedAtMs: 1_000,
        defaultPolicy: { eligible: [codex, claude], strategy: 'random' },
        steps: { review: { eligible: [codex, claude], strategy: 'random' } },
        agents: [
          { family: codex, launcherAvailable: true, block: { kind: 'until', untilMs: 2_000, reason: 'usage limit' } },
          { family: claude, launcherAvailable: true, block: { kind: 'none' } },
        ],
      };
    },
  });
  const assignment = resolveHandoffReviewAssignment('vibe', {
    eligibleAgentsForStepFn: () => ['codex', 'claude'],
    preparedSelection: prepared,
  });
  assert.equal(assignment.reviewer, 'claude', 'SQLite-blocked codex must be excluded before nomination');
});
