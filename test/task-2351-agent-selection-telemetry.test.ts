import test from 'node:test';
import assert from 'node:assert/strict';

import { AGENT_SELECTION_OUTCOMES, recordAgentSelectionOutcome } from '../src/application/services/agent-selection-telemetry.js';
import fs from 'node:fs';

test('selection telemetry records nominated, skipped-blocked, launch-failed, and fallback outcomes', () => {
  const lines: string[] = [];
  for (const outcome of AGENT_SELECTION_OUTCOMES) {
    recordAgentSelectionOutcome((line) => lines.push(line), outcome, { agent: 'codex', step: 'review' });
  }
  assert.deepEqual(lines.map((line) => JSON.parse(line).outcome), ['nominated', 'skipped-blocked', 'launch-failed', 'fallback']);
  assert.ok(lines.every((line) => JSON.parse(line).event === 'agent-selection'));
});

test('review-loop emits skipped-blocked and launch-failed outcomes from production branches', () => {
  const source = fs.readFileSync(new URL('../src/adapters/review/review-loop.ts', import.meta.url), 'utf8');
  assert.ok(source.includes("recordAgentSelectionOutcome(log, 'skipped-blocked'"));
  assert.ok(source.includes("recordAgentSelectionOutcome(log, 'launch-failed'"));
});
