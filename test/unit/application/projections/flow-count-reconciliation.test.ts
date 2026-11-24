import assert from 'node:assert/strict';
import test from 'node:test';
import { flowGraph, type FlowGraphFacts } from '../../../../src/application/projections/flow-graph.js';
import type { FlowVerificationRequest, FlowVerificationRound } from '../../../../src/application/projections/flow-verification-round.js';
import { reviewStatistics } from '../../../../src/application/services/review-statistics.js';

function fact(overrides: Partial<FlowGraphFacts> = {}): FlowGraphFacts {
  return { window: { startedAt: '2026-11-03T09:00:00Z', finishedAt: '2026-11-03T12:00:00Z' }, gateRuns: [], rebaseRuns: [],
    lead: { queued: 0, recoveries: 0, escalations: 0 }, reviewStatistics: reviewStatistics(null), ...overrides };
}

function round(number: number, hour: number, failed: 'tests' | 'agent' = 'tests'): FlowVerificationRound {
  const startedAt = `2026-11-03T${hour}:00:00Z`, outcomeAt = `2026-11-03T${hour}:05:00Z`;
  const verification = (action: FlowVerificationRequest['action']): FlowVerificationRequest => ({
    action, startKey: `${number}:${action}`, gateRunId: null, startedAt, outcomeAt, passed: action !== failed, sameRevisionRerun: false,
  });
  const tests = verification('tests');
  return { id: `round-${number}`, changeIdentity: `change-${number}`, operationId: `operation-${number}`, artifactSha256: null,
    round: number, execution: 'pilot', concurrent: true, requests: { tests, agent: verification('agent'), human: verification('human') },
    testRequests: [tests], join: { at: outcomeAt, passed: false, failed: [failed] },
    human: { state: 'ready', answeredAt: outcomeAt, approvedAt: null }, withdrawalAt: null, sameRevisionTestReruns: 0 };
}

test('each implementation return contributes to exactly one incoming arrow in its own mission (PX-0066)', () => {
  const gateReturn = { identity: 'review:1', author: 'codex', at: '2026-11-03T11:09:00Z', origin: {
    actor: 'workflow' as const, stage: 'integration-gates' as const, decisionIdentity: null, revision: null, sender: null,
  } };
  const repair = fact({ verificationRounds: [round(1, 10), round(2, 11)],
    reviewStatistics: { ...reviewStatistics(null), total: 1, returns: [gateReturn] } });
  const other = fact({ reviewStatistics: { ...reviewStatistics(null), total: 1, returns: [{ ...gateReturn,
    origin: { ...gateReturn.origin, actor: 'agent', stage: 'agent-review' } }] } });
  const graph = flowGraph([repair, other]);
  assert.equal(graph.edges.find(edge => edge.kind === 'gate-repair')?.count, 1);
  assert.equal(graph.edges.find(edge => edge.kind === 'agent-findings')?.count, 1);
  assert.equal(graph.nodes.find(node => node.id === 'automated-join')?.parts.find(part =>
    part.label === 'Failed joins without a matched return')?.count, 1);
  assert.equal(graph.edges.filter(edge => edge.to === 'implement').reduce((sum, edge) => sum + edge.count, 0),
    graph.nodes.find(node => node.id === 'implement')?.count);
});

test('a numbered agent decision can return work before the other automated verdict arrives (PX-0066)', () => {
  const graph = flowGraph([fact({ verificationRounds: [round(1, 10, 'agent')], reviewStatistics: {
    ...reviewStatistics(null), returns: [{ identity: 'review:1', author: 'codex', at: '2026-11-03T10:02:00Z', origin: {
      actor: 'agent', stage: 'agent-review', decisionIdentity: 'review:1', revision: null, sender: null,
    } }],
  } })]);
  assert.equal(graph.edges.find(edge => edge.kind === 'agent-repair')?.count, 1);
  assert.equal(graph.edges.find(edge => edge.kind === 'agent-findings')?.count, 0);
});

test('the count breakdown preserves independent observations and explains unplaced rebase runs (PX-0066)', () => {
  const data = fact({ verificationRounds: [round(1, 10)], rebaseRuns: [
    { id: 'one', operationId: 'pre', stage: 'pre-review-rebase', outcomes: ['resolved'] },
    { id: 'two', operationId: 'pre', stage: 'pre-review-rebase', outcomes: ['conflict', 'conflict', 'resolved'] },
    { id: 'landing', operationId: 'land', operationCommand: 'integrate:merge', stage: 'integration-rebase', outcomes: ['clean'] },
    { id: 'unplaced', operationId: 'test-retry', stage: 'integration-rebase', outcomes: ['clean'] },
  ], reviewStatistics: { ...reviewStatistics(null), episodes: [
    { identity: 'review:1', actor: 'human', stage: 'human-review', startedAt: '2026-11-03T10:00:00Z',
      endedAt: '2026-11-03T10:05:00Z', revision: null, sender: 'operator' },
    { identity: 'human-event:after', actor: 'human', stage: 'human-review', startedAt: '2026-11-03T11:10:00Z',
      endedAt: '2026-11-03T11:10:00Z', revision: null, sender: 'operator' },
  ] } });
  const graph = flowGraph([data]);
  const get = (id: string) => graph.nodes.find(node => node.id === id)!;
  for (const node of graph.nodes) { assert.equal(node.parts.reduce((sum, part) => sum + part.count, 0), node.count, node.id); }
  assert.equal(get('rebase').count, 4);
  assert.equal(graph.edges.filter(edge => edge.to === 'rebase').reduce((sum, edge) => sum + edge.count, 0), 3);
  assert.deepEqual(get('rebase').parts.at(-1), { label: 'Other integration rebases', count: 1 });
  assert.equal(get('rebase-resolve').count, 2, 'the first conflict and retry are two observations');
  assert.equal(graph.edges.find(edge => edge.from === 'rebase' && edge.to === 'declared-gates')?.count, 1);
  assert.equal(graph.edges.find(edge => edge.to === 'integration-tests' && edge.kind === 'concurrent-request')?.count, 1);
  assert.equal(get('integration-tests').count, 0, 'a requested test is not an executed batch');
  assert.equal(get('human-review').count, 2, 'the linked decision counts once and the unrelated observation remains');
});
