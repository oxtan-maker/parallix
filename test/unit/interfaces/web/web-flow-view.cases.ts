import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { FlowPanel } from '../../../../web/src/flow-panel.js';
import { toWebBoardSnapshot } from '../../../../src/interfaces/web/transport.js';
import type { WebBoardSnapshot, WebFlowWindow } from '../../../../src/interfaces/web/transport.js';
import { flowReferenceProjection } from '../../../fixtures/flow-reference.js';
import { makeProjection } from '../../../fixtures/board-projection.js';

const snapshot = (): WebBoardSnapshot => toWebBoardSnapshot(flowReferenceProjection());
const renderFlow = (value = snapshot()): string => renderToStaticMarkup(
  React.createElement(FlowPanel, { snapshot: value, onNavigate: () => {} }),
);
const occurrences = (html: string, marker: string) => html.split(marker).length - 1;

test('Mission Flow renders the reference-native regions from the typed projection (TASK-2836)', () => {
  const html = renderFlow();
  assert.equal(occurrences(html, 'data-flow-kpi='), 6);
  for (const text of ['Mission flow', '24 missions landed', '20.6h', '29%', '1.3', '16%', 'You',
    'Flow by actor', 'Observed work per mission', 'MEDIAN TIME IN STATE']) {
    assert.match(html, new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
  assert.equal(occurrences(html, 'data-flow-node='), 11);
  assert.equal(occurrences(html, 'data-flow-lane='), 6);
  assert.equal(occurrences(html, 'data-flow-time-row='), 7);
  assert.equal(occurrences(html, 'data-flow-state='), 5);
  for (const edge of ['gate-failed', 'agent-findings', 'human-changes', 'rebase-conflict', 'rebase-repeat', 'rebase-failed']) {
    assert.match(html, new RegExp(`data-flow-edge-label="[^"]*${edge}`));
  }
  assert.doesNotMatch(html, /#ededed|#257de0/i, 'capture canvas and selection outline are not app surfaces');
  const base = snapshot(), current = base.metrics.flow!.current;
  const withUnrecorded = { ...base, metrics: { ...base.metrics, flow: { ...base.metrics.flow!, current: { ...current, graph: { ...current.graph,
    edges: current.graph.edges.map(edge => edge.from === null ? { ...edge, count: 1 } : edge) } } } } };
  assert.match(renderFlow(withUnrecorded), /data-flow-edge-origin="unrecorded-&gt;implement:workflow-return"/, 'unrecorded returns have an explicit origin');
  const withRebaseRepair = { ...base, metrics: { ...base.metrics, flow: { ...base.metrics.flow!, current: { ...current,
    graph: { ...current.graph, edges: [...current.graph.edges, { id: 'pre-review-rebase->implement:workflow-return',
      from: 'pre-review-rebase' as const, to: 'implement' as const, kind: 'workflow-return' as const,
      count: 1, share: null, percentage: null }] } } } } };
  assert.match(renderFlow(withRebaseRepair), /data-flow-edge="pre-review-rebase-&gt;implement:workflow-return"/,
    'typed pre-review rebase returns have a visible route back to implementation');
  assert.match(html, /data-flow-edge="integration-gates-&gt;implement:gate-failed"[\s\S]*?points="1195,333 1210,333 1210,190 305,190 305,206"/,
    'the integration return enters the top of Implement to the right of the Refined label');
});

test('Mission Flow exposes graph and timing bars as text without replacing missing facts with zero (TASK-2836)', () => {
  const html = renderFlow();
  assert.match(html, /Flow graph as text/);
  assert.match(html, /Implement: 56 including 32 rework; observed for 24 of 24 missions/);
  assert.match(html, /Rebase before review to Resolve before review \(rebase conflict\): 14, 25% of outcomes/);
  assert.match(html, /aria-label="waiting 6m, working 76m"/);
  assert.match(html, /aria-label="held 950m, waiting and hands-on time not split"/);

  const unavailable = toWebBoardSnapshot(makeProjection());
  const emptyHtml = renderFlow(unavailable);
  assert.match(emptyHtml, /FLOW statistics unavailable/);
  assert.match(emptyHtml, /No flow values are shown in place of the missing projection/);
  assert.doesNotMatch(emptyHtml, /data-flow-kpi=/);
});

test('Mission Flow keeps sparse observations explicit without turning them into missing or invented values (TASK-2836 review 3615)', () => {
  const base = snapshot(), current = base.metrics.flow!.current;
  const sparse: WebFlowWindow = { ...current,
    firstPassYield: { numerator: 0, denominator: 12, observed: 12, population: 24, coverage: 0.5, state: 'measured', value: 0 },
    graph: { ...current.graph, edges: current.graph.edges.map(edge => ({ ...edge, count: 0, share: 0, percentage: 0 })) },
    time: { ...current.time, unobservedMs: 60_000 },
  };
  const html = renderFlow({ ...base, metrics: { ...base.metrics, flow: { ...base.metrics.flow!, current: sparse } } });
  assert.match(html, /First-pass yield[\s\S]*?0%[\s\S]*?0\/12 · 12\/24 measured/);
  assert.match(html, /data-flow-edge-label="pre-review-resolve-&gt;declared-gates:flow"[\s\S]*?0% · 0/);
  assert.match(html, /data-flow-edge-label="integration-resolve-&gt;integration-gates:flow"[\s\S]*?0% · 0/);
  assert.match(html, /data-flow-edge-label="integration-rebase-&gt;integration-gates:clean"[\s\S]*?0% · 0<\/span>/);
  assert.match(html, /data-flow-edge-suffix="integration-rebase-&gt;integration-gates:clean"[\s\S]*?>clean<\/span>/);
  assert.match(html, /data-flow-edge-label="declared-gates-&gt;implement:gate-failed"[\s\S]*?0% · 0 returns/);
  assert.match(html, /Observation gaps account for 1m per delivered mission/);
  assert.doesNotMatch(html, /data-flow-time-row="unobserved"/);
  const withoutGateRuns: WebFlowWindow = { ...sparse, graph: { ...sparse.graph,
    nodes: sparse.graph.nodes.map(node => node.id === 'declared-gates' ? { ...node, observedMissions: 0 } : node),
    edges: sparse.graph.edges.map(edge => edge.id === 'declared-gates->implement:gate-failed'
      ? { ...edge, count: 11, share: null, percentage: null } : edge) } };
  const withoutGateRunsHtml = renderFlow({ ...base, metrics: { ...base.metrics,
    flow: { ...base.metrics.flow!, current: withoutGateRuns } } });
  assert.match(withoutGateRunsHtml, /data-flow-edge-label="declared-gates-&gt;implement:gate-failed"[\s\S]*?>11 returns<\/span>/);
  assert.doesNotMatch(withoutGateRunsHtml, /data-flow-edge-label="declared-gates-&gt;implement:gate-failed"[^>]*>[^<]*0%/);
});

test('Mission Flow bounds rebase provenance with incomplete states first (PX-0055.03)', () => {
  const base = snapshot(), current = base.metrics.flow!.current;
  const stages = Array.from({ length: 15 }, (_, index) => ({
    repositoryId: 'repo', missionId: `task-${String(index).padStart(2, '0')}`,
    stage: 'pre-review-rebase' as const, state: index < 2 ? 'interrupted' as const : 'measured' as const,
    operationId: `operation-${index}`, sourceId: `source-${index}`,
    reason: index < 2 ? 'running observation has no terminal outcome' : 'retained terminal rebase outcome',
    outcomes: index < 2 ? [] : ['clean' as const],
  }));
  const flow: WebFlowWindow = { ...current, rebaseStages: { visible: stages.slice(0, 12), omitted: 3 } };
  const html = renderFlow({ ...base, metrics: { ...base.metrics, flow: { ...base.metrics.flow!, current: flow } } });
  assert.equal(occurrences(html, '· pre-review-rebase ·'), 12);
  assert.match(html, /3 additional stage facts not shown; incomplete states are listed first/);
  assert.ok(html.indexOf('task-00') < html.indexOf('task-02'), 'interrupted provenance precedes measured rows');
});

test('Mission Flow renders distinct diagnostics without exposing internal defect records (PX-0055.03)', () => {
  const base = snapshot(), current = base.metrics.flow!.current;
  const defects = ['first-pass missing; inspect review history', 'agent-launch missing; inspect run history'];
  const flow: WebFlowWindow = { ...current, defects };
  const html = renderFlow({ ...base, metrics: { ...base.metrics, flow: { ...base.metrics.flow!, current: flow } } });
  assert.match(html, /first-pass missing; inspect review history/);
  assert.match(html, /agent-launch missing; inspect run history/);
  assert.doesNotMatch(html, /operationId|sourceId|collectionDefect/);
});

test('px lead is a minimal optional lane that distinguishes queue, recovery and human escalation (TASK-2836)', () => {
  const base = snapshot();
  const current = base.metrics.flow!.current;
  const leadLane = { lane: 'lead' as const, families: [], waitingMs: 12 * 60_000, workingMs: 8 * 60_000,
    heldMs: 0, totalMs: 20 * 60_000, share: 20 / 1235 };
  const flow: WebFlowWindow = { ...current,
    graph: { nodes: [...current.graph.nodes, { id: 'lead', lane: 'lead', count: 3, rework: null, observedMissions: 2, population: 24 }],
      edges: [...current.graph.edges, { id: 'lead->human-review:lead-escalation', from: 'lead', to: 'human-review', kind: 'lead-escalation', count: 2, share: null, percentage: null }] },
    time: { ...current.time, lanes: current.time.lanes.map(lane => lane.lane === 'lead' ? leadLane : lane) } };
  const value: WebBoardSnapshot = { ...base, metrics: { ...base.metrics, flow: { ...base.metrics.flow!, current: flow } } };
  const html = renderFlow(value);
  assert.equal(occurrences(html, 'data-flow-lane="lead"'), 1);
  assert.equal(occurrences(html, 'data-flow-node="lead"'), 1);
  assert.match(html, /12m queued · 8m recovering/);
  assert.match(html, /2 escalated/);
  assert.match(html, /px lead: 3; observed for 2 of 24 missions/);
});

test('fixed native graph and table geometry scrolls inside narrow regions instead of squeezing labels (TASK-2836)', () => {
  const html = renderFlow();
  assert.match(html, /width:1230px/);
  assert.match(html, /min-width:1188px/);
  assert.ok(occurrences(html, 'overflow-x:auto') >= 4, 'view controls, graph, table and state cards retain explicit horizontal reachability');
  assert.doesNotMatch(html, /overflow-x:hidden/);
});

test('semantic identities keep sparse, high-activity and long-family cohorts on the same topology (TASK-2836)', () => {
  const base = snapshot();
  const current = base.metrics.flow!.current;
  const changed: WebFlowWindow = { ...current,
    graph: { nodes: current.graph.nodes.map(node => ({ ...node, count: node.id === 'landed' ? 1 : 123_456,
      ...(node.id === 'integration-gates' ? { observedMissions: 1 } : {}) })),
      edges: current.graph.edges.map(edge => ({ ...edge, count: edge.kind === 'rebase-repeat' ? 98_765 : 0 })) },
    time: { ...current.time, lanes: current.time.lanes.map(lane => lane.lane === 'implement-agent'
      ? { ...lane, families: ['a-very-long-configured-agent-family-name'] } : lane) } };
  const value: WebBoardSnapshot = { ...base, metrics: { ...base.metrics, flow: { ...base.metrics.flow!, current: changed } } };
  const html = renderFlow(value);
  assert.equal(occurrences(html, 'data-flow-node='), 11);
  assert.equal(occurrences(html, 'data-flow-lane='), 6);
  assert.match(html, /data-flow-edge="pre-review-resolve-&gt;pre-review-resolve:rebase-repeat"/);
  assert.match(html, /98,765|98765/);
  assert.match(html, /a-very-long-configured-agent-family-name/);
  assert.match(html, /data-flow-node="integration-gates"[^>]*height:65px/, 'partial coverage receives a bounded two-line node');
  assert.match(html, /data-flow-node="declared-gates"[^>]*height:(?:65|80)px/, 'wrapped node titles reserve detail and coverage space');
  assert.match(html, /flex-wrap:nowrap/, 'real family counts retain the reference header row');
  assert.doesNotMatch(html, /data-flow-lane="lead"/);
});
