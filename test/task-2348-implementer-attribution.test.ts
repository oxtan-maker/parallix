import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

// The helpers this file exercises hang off the default export object rather
// than the module's named exports, so this must be the default import.
import stats from '../src/adapters/cli/commands/stats.js';
import { agentFamily } from '../src/domain/agents.js';
import { reviewFindingId } from '../src/domain/review.js';
import os from 'node:os';
import { seedMissionDatabase } from './fixtures/review-state-db.js';

// ---------------------------------------------------------------------------
// CP 1 (red): Reproduction tests for implementer attribution defects
// ---------------------------------------------------------------------------
// These tests must FAIL at parent commit c06b0ada6 and PASS after CP 2 + CP 3.
// No production file changes in CP 1 — test-only checkpoint.
// ---------------------------------------------------------------------------

test('task-2348: mission with two implementers credits reported implementer not earlier one', () => {
  // Scenario: mission had `claude` as earlier implementer (implementation-stage
  // rows with model), then `custom` took over. Closed rollup row carries
  // `implementer: 'custom'` (the reported implementer from
  // deriveImplementerAndFixRounds).
  //
  // Current bug: computeAgentMissionGroups picks the latest implementation-stage
  // telemetry row as the owner, which is `claude`'s row. The mission is grouped
  // under `claude-opus-5` instead of `custom`.
  //
  // Expected: the closed rollup row's `implementer` field is the authority for
  // completed missions. Display key (model) may still come from stage row, but
  // grouping must use the reported implementer.
  const window = { start: new Date('2026-06-10T00:00:00Z'), end: new Date('2026-06-16T00:00:00Z') };
  const rows = [
    // Earlier implementer: claude ran execution
    {
      date: '2026-06-11',
      repo: '',
      mission: 'task-2348-a',
      implementer: 'claude',
      stage: 'active',
      classification: 'ai_sdlc',
      pr_fix_rounds: '0',
      provider: 'anthropic',
      model: 'claude-opus-5',
      closed: 'no',
    },
    // Review stage (reviewer_agent=vibe, implementer still claude on this row)
    {
      date: '2026-06-12',
      repo: '',
      mission: 'task-2348-a',
      implementer: 'claude',
      stage: 'review',
      classification: 'ai_sdlc',
      pr_fix_rounds: '0',
      provider: 'openai',
      model: 'gpt-5.6-terra',
      reviewer_agent: 'vibe',
      closed: 'no',
    },
    // Closed rollup row: deriveImplementerAndFixRounds reported custom as the
    // implementer who completed the mission
    {
      date: '2026-06-13',
      repo: '',
      mission: 'task-2348-a',
      implementer: 'custom',
      stage: 'default',
      classification: 'ai_sdlc',
      pr_fix_rounds: '2',
      model: '',
      closed: 'yes',
    },
  ];

  // @ts-expect-error -- TASK-2328: runtime-only property/partial test double absent from the inferred type.
  const result = stats._internals.summarizeAgentWindow(rows, window);
  // Mission should be grouped under 'custom' (the reported implementer),
  // not 'claude-opus-5' (the earlier implementer's model).
  const customGroup = result.find(g => g.implementer === 'custom');
  const claudeGroup = result.find(g => g.implementer === 'claude-opus-5');

  assert.ok(customGroup, 'mission should be grouped under "custom" (reported implementer)');
  assert.equal(customGroup.missions, 1, 'custom should have exactly 1 mission');
  assert.ok(
    !claudeGroup || claudeGroup.missions === 0,
    'mission should NOT be grouped under "claude-opus-5" (earlier implementer)',
  );
});

test('task-2348: review-aggregate pr_fix_rounds counts only reported implementer rounds', async () => {
  // Scenario: mission had 3 total `changes-requested` rounds across its lifecycle.
  // 1 round sent back to previous implementer `claude`, 2 rounds sent back to
  // reported implementer `custom`.
  //
  // Current bug: deriveImplementerAndFixRounds review-aggregate path counts ALL
  // changes-requested rounds (3), not filtering by the reported implementer.
  //
  // Expected: pr_fix_rounds should be 2 (only rounds belonging to `custom`).
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'task-2348-'));
  fs.mkdirSync(path.join(root, 'backlog', 'tasks'), { recursive: true });
  fs.mkdirSync(path.join(root, 'docs', 'missions', '2026', 'task-2348-b'), { recursive: true });

  const sentBackTo = (implementer, at) => ({
    decision: {
      kind: 'changes-requested',
      decidedAt: at,
      comment: null,
      findings: [{ id: reviewFindingId('F1'), summary: 'sent back', location: null }],
    },
    disposition: 'REQUEST_CHANGES',
    phase: 'fixing',
    implementer: agentFamily(implementer),
  });

  // Round 1: sent back to claude (previous implementer)
  // Round 2: sent back to custom (reported/final implementer)
  // Round 3: sent back to custom (reported/final implementer)
  // Round 4: approved
  const restoreHome = await seedMissionDatabase(
    path.join(root, 'parallix-home'),
    'task-2348-b',
    root,
    sentBackTo('claude', '2026-06-16T01:00:00.000Z'),
    [
      sentBackTo('custom', '2026-06-16T02:00:00.000Z'),
      sentBackTo('custom', '2026-06-16T03:00:00.000Z'),
      {
        implementer: agentFamily('custom'),
        decision: {
          kind: 'approved',
          decidedAt: '2026-06-16T04:00:00.000Z',
          comment: null,
          source: { kind: 'local' },
        },
        phase: 'approved',
      },
    ],
  );

  try {
    // @ts-expect-error -- TASK-2328: runtime-only property/partial test double absent from the inferred type.
    const info = await stats._internals.deriveImplementerAndFixRounds(
      'task-2348-b',
      root,
      restoreHome.store,
    );
    assert.equal(info.source, 'review-aggregate');
    assert.equal(info.implementer, 'custom', 'reported implementer is custom (last round owner)');
    assert.equal(
      info.prFixRounds,
      2,
      'pr_fix_rounds counts only custom\'s changes-requested rounds (2), not all rounds (3)',
    );
  } finally {
    await restoreHome();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('task-2348: summarizeAgentWindow reads pr_fix_rounds from closed row not max across rows', () => {
  // Scenario: closed rollup row has pr_fix_rounds=2 (authoritative value from
  // deriveImplementerAndFixRounds). An earlier implementation-stage row has
  // pr_fix_rounds=0. A review-stage row has pr_fix_rounds=3 (includes previous
  // implementer's rounds before the fix).
  //
  // Current bug: summarizeAgentWindow takes the MAX across all rows, which
  // picks up the stale review-stage value (3) instead of the closed row's
  // authoritative value (2).
  //
  // Expected: pr_fix_rounds comes from the closed rollup row (2).
  const window = { start: new Date('2026-06-10T00:00:00Z'), end: new Date('2026-06-16T00:00:00Z') };
  const rows = [
    // Implementation stage: pr_fix_rounds=0 (recorded before review complete)
    {
      date: '2026-06-11',
      repo: '',
      mission: 'task-2348-c',
      implementer: 'custom',
      stage: 'active',
      classification: 'ai_sdlc',
      pr_fix_rounds: '0',
      provider: 'openai',
      model: 'gpt-5.6-terra',
      closed: 'no',
    },
    // Review stage: pr_fix_rounds=3 (stale — includes previous implementer's rounds)
    {
      date: '2026-06-12',
      repo: '',
      mission: 'task-2348-c',
      implementer: 'custom',
      stage: 'review',
      classification: 'ai_sdlc',
      pr_fix_rounds: '3',
      provider: 'openai',
      model: 'gpt-5.6-terra',
      closed: 'no',
    },
    // Closed rollup: pr_fix_rounds=2 (authoritative from deriveImplementerAndFixRounds)
    {
      date: '2026-06-13',
      repo: '',
      mission: 'task-2348-c',
      implementer: 'custom',
      stage: 'default',
      classification: 'ai_sdlc',
      pr_fix_rounds: '2',
      model: '',
      closed: 'yes',
    },
  ];

  // @ts-expect-error -- TASK-2328: runtime-only property/partial test double absent from the inferred type.
  const result = stats._internals.summarizeAgentWindow(rows, window);
  assert.equal(result[0].implementer, 'custom');
  assert.equal(
    result[0].averageFixRounds,
    '2.00',
    'fix rounds from closed row (2), not max across rows (3)',
  );
});
