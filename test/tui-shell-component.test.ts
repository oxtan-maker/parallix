/**
 * SC7: Component tests assert rendered semantics using mocked BoardProjection.
 *
 * Uses Ink's renderToString for synchronous rendering without TTY setup.
 * No test launches an agent, contacts Forgejo, or runs a real workflow command.
 *
 * BoardShell is loaded via dynamic import() because ink 6 is ESM-only
 * with top-level await (cannot be statically required from CJS test runner).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { BoardProjection, AttentionItem, BoardMetrics, MetricSeries } from '../src/application/projections/board.js';
import type { MissionCard } from '../src/application/projections/mission-board.js';
import type { AgentFamily } from '../src/domain/agents.js';
import type { MissionId } from '../src/domain/mission.js';
import type { RepositoryId } from '../src/domain/repository.js';

describe('BoardShell component renders with mocked BoardProjection', () => {
  /** Empty metric series used in mocked BoardProjection. */
  const emptySeries: MetricSeries = {
    series: [],
    missingHistoryFallback: 'skip',
  };

  /** Empty BoardMetrics for mocked projection. */
  const emptyMetrics: BoardMetrics = {
    health: { state: 'no-telemetry' },
    provenance: {
      repositoryId: 'test-repo' as RepositoryId,
      evaluatedWindow: { startedAt: null, endedAt: null },
      sampleSize: 0,
      newestEventTimestamp: null,
      rejectedOrMissingIdentityRowCount: 0,
      adapterSucceeded: true,
    },
    cumulativeFlow: emptySeries,
    cumulativeFlowByState: emptySeries as unknown as BoardMetrics['cumulativeFlowByState'],
    medianStateTimes: emptySeries,
    medianAgentRuntime: emptySeries,
    medianCycleTimeByState: emptySeries as unknown as BoardMetrics['medianCycleTimeByState'],
    throughput: emptySeries,
    weeklyThroughput: emptySeries,
    reviewLoopRate: emptySeries,
    medianAgeByLane: emptySeries as unknown as BoardMetrics['medianAgeByLane'],
    agentAvailability: [],
    bottleneck: {
      sentence: 'Bottleneck unavailable: history is missing.',
      inputs: { lane: null, medianAgeMinutes: null, reviewLoopRate: null, weeklyThroughput: null },
    },
  };

  /** Minimal MissionCard for mocked projection (partial, cast to type). */
  const testCard: MissionCard = {
    id: 'task-9999' as MissionId,
    repositoryId: 'test-repo' as RepositoryId,
    title: 'Test task-9999',
    labels: [],
    lane: 'active' as const,
    status: 'active' as const,
    rawStatus: 'active',
    closed: false,
    agent: 'custom' as AgentFamily,
    checkpoint: null,
    checkpointDescription: null,
    nextActionText: null,
    gate: null,
    pullRequest: null,
    reviewApproved: false,
    reviewRound: null,
    reviewPhase: null,
    reviewDisposition: null,
    reviewHistory: [],
    currentWork: null,
    blockingReason: null,
    flags: [],
    commands: [],
  };

  /** Minimal AttentionItem for mocked projection. */
  const testAttention: AttentionItem = {
    missionId: 'task-9999' as MissionId,
    rank: 1,
    reason: { kind: 'review-lane', detail: 'Awaiting review' },
    card: testCard,
  };

  /** Minimal BoardProjection matching the actual data model (all required fields). */
  const mockProjection: BoardProjection = {
    version: 1,
    repositoryId: 'test-repo' as RepositoryId,
    wipCounts: [
      { lane: 'backlog', count: 2 },
      { lane: 'refined', count: 0 },
      { lane: 'active', count: 1 },
      { lane: 'review', count: 0 },
      { lane: 'integration', count: 0 },
      { lane: 'done', count: 0 },
    ],
    attentionQueue: [testAttention],
    stages: [
      { lane: 'backlog', cards: [], count: 2 },
      { lane: 'refined', cards: [], count: 0 },
      { lane: 'active', cards: [testCard], count: 1 },
      { lane: 'review', cards: [], count: 0 },
      { lane: 'integration', cards: [], count: 0 },
      { lane: 'done', cards: [], count: 0 },
    ],
    availableActions: [],
    operationLog: [],
    metrics: emptyMetrics,
    sourceFacts: [],
  };

  /** Empty BoardProjection for edge-case testing. */
  const emptyProjection: BoardProjection = {
    version: 1,
    repositoryId: 'test-empty' as RepositoryId,
    wipCounts: [
      { lane: 'backlog', count: 0 },
      { lane: 'refined', count: 0 },
      { lane: 'active', count: 0 },
      { lane: 'review', count: 0 },
      { lane: 'integration', count: 0 },
      { lane: 'done', count: 0 },
    ],
    attentionQueue: [],
    stages: [
      { lane: 'backlog', cards: [], count: 0 },
      { lane: 'refined', cards: [], count: 0 },
      { lane: 'active', cards: [], count: 0 },
      { lane: 'review', cards: [], count: 0 },
      { lane: 'integration', cards: [], count: 0 },
      { lane: 'done', cards: [], count: 0 },
    ],
    availableActions: [],
    operationLog: [],
    metrics: emptyMetrics,
    sourceFacts: [],
  };

  it('renders the top bar with "px board" label and repositoryId', async () => {
    const ink = await import('ink');
    const React = await import('react');
    const { BoardShell } = await import('../src/interfaces/tui/shell.js');

    const output = ink.renderToString(
      React.createElement(BoardShell, { projection: mockProjection }),
      { columns: 120 },
    );

    assert.ok(
      output.includes('px board'),
      `Top bar must contain "px board" label. Got: ${output.slice(0, 200)}`,
    );
    assert.ok(
      output.includes('test-repo'),
      `Top bar must contain repositoryId. Got: ${output.slice(0, 200)}`,
    );
    assert.ok(
      output.includes('FLOW'),
      `Top bar must contain the FLOW affordance. Got: ${output.slice(0, 200)}`,
    );
  });

  it('renders attention rail with "NEEDS YOU" header', async () => {
    const ink = await import('ink');
    const React = await import('react');
    const { BoardShell } = await import('../src/interfaces/tui/shell.js');

    const output = ink.renderToString(
      React.createElement(BoardShell, { projection: mockProjection }),
      { columns: 120 },
    );

    assert.ok(
      output.includes('NEEDS YOU'),
      `Attention rail must render "NEEDS YOU" header. Got: ${output.slice(0, 300)}`,
    );
  });

  it('renders board column headers with WIP counts', async () => {
    const ink = await import('ink');
    const React = await import('react');
    const { BoardShell } = await import('../src/interfaces/tui/shell.js');

    const output = ink.renderToString(
      React.createElement(BoardShell, { projection: mockProjection }),
      { columns: 120 },
    );

    // Each column header includes the lane name and count
    assert.ok(
      output.includes('ACTIVE 1'),
      `ACTIVE column must show count 1. Got: ${output.slice(0, 300)}`,
    );
    assert.ok(
      output.includes('REVIEW 0'),
      `REVIEW column must show count 0. Got: ${output.slice(0, 300)}`,
    );
  });

  it('renders mission card with task slug in ACTIVE column', async () => {
    const ink = await import('ink');
    const React = await import('react');
    const { BoardShell } = await import('../src/interfaces/tui/shell.js');

    const output = ink.renderToString(
      React.createElement(BoardShell, { projection: mockProjection }),
      { columns: 120 },
    );

    // The card slug appears in the board columns region (right of attention rail)
    assert.ok(
      output.includes('task-9999'),
      `Mission card must contain task slug "task-9999". Got: ${output.slice(0, 300)}`,
    );
    // The card title also appears in the output
    assert.ok(
      output.includes('Test task-9999'),
      `Mission card must contain title. Got: ${output.slice(0, 300)}`,
    );
  });

  it('handles empty projection without crashing', async () => {
    const ink = await import('ink');
    const React = await import('react');
    const { BoardShell } = await import('../src/interfaces/tui/shell.js');

    const output = ink.renderToString(
      React.createElement(BoardShell, { projection: emptyProjection }),
      { columns: 120 },
    );

    assert.ok(
      output.includes('px board'),
      `Empty projection must still render top bar. Got: ${output.slice(0, 200)}`,
    );
    assert.ok(
      typeof output === 'string' && output.length > 0,
      'Empty projection must render non-empty output',
    );
  });

  it('keeps FLOW hidden by default and renders it above the board when opened', async () => {
    const ink = await import('ink');
    const React = await import('react');
    const { BoardShell } = await import('../src/interfaces/tui/shell.js');

    const closed = ink.renderToString(
      React.createElement(BoardShell, { projection: mockProjection }),
      { columns: 120 },
    );
    assert.ok(
      !closed.includes('CUMULATIVE FLOW'),
      `FLOW content must stay hidden by default. Got: ${closed.slice(0, 400)}`,
    );

    const open = ink.renderToString(
      React.createElement(BoardShell, { projection: mockProjection, initialFlowOpen: true }),
      { columns: 120 },
    );
    assert.ok(
      open.includes('CUMULATIVE FLOW'),
      `Open FLOW state must render analytics content. Got: ${open.slice(0, 500)}`,
    );
    assert.ok(
      open.indexOf('CUMULATIVE FLOW') < open.indexOf('▲ NEEDS YOU NEXT'),
      'FLOW region must render above the board and attention rail, not below them',
    );
  });
});
