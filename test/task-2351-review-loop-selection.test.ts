import test from 'node:test';
import assert from 'node:assert/strict';

import { agentFamily } from '../src/domain/agents.js';
import { PreparedAgentSelection } from '../src/application/services/agent-selection.js';
import { renderReviewVerdict, reviewIndependence, selectPreparedReviewer } from '../src/adapters/review/review-loop.js';

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

test('review presentation classifies different-family and same-family fallback from agent-family identity', () => {
  assert.equal(reviewIndependence('claude', 'custom'), 'different-family review');
  assert.equal(reviewIndependence('claude', 'claude'), 'same-family fallback / self-review');
  assert.doesNotMatch(reviewIndependence('claude', 'claude'), /different-family/);
});

test('review verdict presentation is authoritative and renders blocking findings before follow-up work', () => {
  const logs: string[] = [];
  renderReviewVerdict('REQUEST_CHANGES', ['missing validation', 'unhandled retry'], (line) => logs.push(line));
  assert.match(logs[0], /CHANGES REQUESTED/);
  assert.match(logs[1], /Blocking finding: missing validation/);
  assert.match(logs[2], /Blocking finding: unhandled retry/);

  renderReviewVerdict('COMMENT', ['must not appear'], (line) => logs.push(line));
  assert.equal(logs.length, 3, 'non-authoritative states cannot produce an approval or changes verdict');
});
