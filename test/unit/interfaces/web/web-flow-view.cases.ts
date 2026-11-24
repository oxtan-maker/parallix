import { webAnalytics, webProjection } from '../../../fixtures/web-projection.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { FlowPanel } from '../../../../web/src/flow-panel.js';
import type { AnalyticsState } from '../../../../web/src/board-data.js';
import type { BoardProjection } from '../../../../src/application/projections/board.js';
import type { WebFlowWindow } from '../../../../src/interfaces/web/transport.js';
import { configuredParallelVerification, flowReferenceProjection } from '../../../fixtures/flow-reference.js';
import { makeProjection } from '../../../fixtures/board-projection.js';
import { analyticsFamilyFreshness } from '../../../../src/interfaces/web/host-support.js';

/**
 * Flow renders from two reads (TASK-2854.04): the current workflow snapshot
 * supplies identity, wip and attention, and the historical analytics family
 * supplies every FLOW value with its own freshness. A test builds one
 * projection and delivers both reads the host would deliver.
 */
const analyticsOf = (projection: BoardProjection): AnalyticsState => ({ kind: 'ready', analytics: webAnalytics(projection) });
const renderFlow = (projection: BoardProjection = flowReferenceProjection()): string => renderToStaticMarkup(
  React.createElement(FlowPanel, {
    snapshot: webProjection.snapshot(projection), analytics: analyticsOf(projection), onReobserve: () => {}, onNavigate: () => {},
  }),
);

/** A flow view rendered from one analytics read state, whatever that state is. */
const renderFlowWith = (state: AnalyticsState, projection: BoardProjection = flowReferenceProjection()): string => renderToStaticMarkup(
  React.createElement(FlowPanel, {
    snapshot: webProjection.snapshot(projection), analytics: state, onReobserve: () => {}, onNavigate: () => {},
  }),
);
const occurrences = (html: string, marker: string) => html.split(marker).length - 1;
const edgePoints = (html: string, id: string): readonly (readonly [number, number])[] => {
  const marker = `data-flow-edge="${id.replaceAll('>', '&gt;')}"`, offset = html.indexOf(marker);
  assert.notEqual(offset, -1, `missing rendered edge ${id}`);
  const points = /<polyline points="([^"]+)"/.exec(html.slice(offset))?.[1];
  assert.ok(points, `missing polyline for ${id}`);
  return points.split(' ').map(point => point.split(',').map(Number) as [number, number]);
};
const renderedEdges = (html: string): readonly { readonly id: string; readonly points: readonly (readonly [number, number])[] }[] =>
  Array.from(html.matchAll(/data-flow-edge="([^"]+)"[^>]*>[\s\S]*?<polyline points="([^"]+)"/g), match => ({
    id: match[1]!.replaceAll('&gt;', '>').replaceAll('&amp;', '&'),
    points: match[2]!.split(' ').map(point => point.split(',').map(Number) as [number, number]),
  }));
const positionedBoxes = (html: string, marker: string): readonly { readonly id: string; readonly x: number; readonly y: number;
  readonly w: number; readonly h: number }[] => Array.from(html.matchAll(new RegExp(`${marker}="([^"]+)"[^>]*style="[^"]*left:([\\d.]+)px;top:([\\d.]+)px;[^"]*width:([\\d.]+)px;height:([\\d.]+)px`, 'g')),
    match => ({ id: match[1]!, x: Number(match[2]), y: Number(match[3]), w: Number(match[4]), h: Number(match[5]) }));
const labelBoxes = (html: string): readonly { readonly id: string; readonly x: number; readonly y: number; readonly w: number; readonly h: number }[] =>
  Array.from(html.matchAll(/data-flow-edge-label="([^"]+)"[^>]*style="[^"]*left:([\d.]+)px;top:([\d.]+)px;[^"]*">([^<]+)</g), match => ({
    id: match[1]!.replaceAll('&gt;', '>').replaceAll('&amp;', '&'), x: Number(match[2]), y: Number(match[3]),
    w: Math.max(24, match[4]!.replaceAll('&amp;', '&').length * 6), h: 12,
  }));
const sharesSegmentOrEndpoint = (left: readonly (readonly [number, number])[], right: readonly (readonly [number, number])[]): boolean => {
  const segments = (points: readonly (readonly [number, number])[]) => points.slice(1).map((point, index) => [points[index], point] as const);
  const contains = ([x, y]: readonly [number, number], [[ax, ay], [bx, by]]: readonly [readonly [number, number], readonly [number, number]]) =>
    ax === bx ? x === ax && y >= Math.min(ay, by) && y <= Math.max(ay, by)
      : y === ay && x >= Math.min(ax, bx) && x <= Math.max(ax, bx);
  if (left.some(point => segments(right).some(segment => contains(point, segment)))
    || right.some(point => segments(left).some(segment => contains(point, segment)))) { return true; }
  return segments(left).some(([[ax, ay], [bx, by]]) => segments(right).some(([[cx, cy], [dx, dy]]) => {
    if (ay === by && cy === dy && ay === cy) { return Math.max(Math.min(ax, bx), Math.min(cx, dx)) < Math.min(Math.max(ax, bx), Math.max(cx, dx)); }
    if (ax === bx && cx === dx && ax === cx) { return Math.max(Math.min(ay, by), Math.min(cy, dy)) < Math.min(Math.max(ay, by), Math.max(cy, dy)); }
    return false;
  }));
};
const hasCloseParallelSegment = (left: readonly (readonly [number, number])[], right: readonly (readonly [number, number])[]): boolean => {
  const segments = (points: readonly (readonly [number, number])[]) => points.slice(1).map((point, index) => [points[index], point] as const);
  return segments(left).some(([[ax, ay], [bx, by]]) => segments(right).some(([[cx, cy], [dx, dy]]) => {
    if (ay === by && cy === dy) {
      const overlap = Math.min(Math.max(ax, bx), Math.max(cx, dx)) - Math.max(Math.min(ax, bx), Math.min(cx, dx));
      return Math.abs(ay - cy) < 4 && overlap > 8;
    }
    if (ax === bx && cx === dx) {
      const overlap = Math.min(Math.max(ay, by), Math.max(cy, dy)) - Math.max(Math.min(ay, by), Math.min(cy, dy));
      return Math.abs(ax - cx) < 4 && overlap > 8;
    }
    return false;
  }));
};

test('an analytics family that was not observed renders no historical value (TASK-2854.04)', () => {
  const html = renderFlowWith({ kind: 'loading' });
  assert.match(html, /data-flow-region="unavailable"/, 'the flow view says the historical family is unavailable');
  assert.ok(!html.includes('data-flow-kpi='), 'no historical KPI stands in for an unobserved family');
  assert.match(html, /being observed on their own read/, 'the reason comes from the analytics family read itself');
  assert.match(html, /data-analytics-reobserve/, 'the browser can ask for its own fresh observation');
});

test('a stale analytics family keeps its values on screen marked stale (TASK-2854.04)', () => {
  const projection = flowReferenceProjection();
  const read = webAnalytics(projection);
  const html = renderFlowWith({
    kind: 'ready',
    analytics: { ...read, freshness: { state: 'stale', revision: 'history-v1', refreshedAt: '2026-11-11T09:00:00.000Z', reason: 'historical analytics refresh is in progress' } },
  });
  assert.match(html, /data-analytics-freshness="stale"/, 'the family reports its own staleness on screen');
  assert.match(html, /historical analytics refresh is in progress/, 'the family carries its own reason');
  assert.match(html, /analytics revision history-v1 · observed 2026-11-11T09:00:00\.000Z/, 'the family carries its own revision and observation time');
  assert.match(html, /24 missions landed/, 'retained historical values stay visible, marked as they are');
  assert.match(html, /data-analytics-reobserve/, 'a stale family can be re-observed without touching the workflow read');
});

test('a stale analytics family without a FLOW series still reports its own state, revision and observation time (TASK-2854.04)', () => {
  const read = webAnalytics(flowReferenceProjection());
  const { flow: _flow, ...metrics } = read.metrics;
  const html = renderFlowWith({
    kind: 'ready',
    analytics: { ...read, metrics, freshness: { state: 'stale', revision: 'history-v2', refreshedAt: '2026-11-11T10:00:00.000Z', reason: 'projection refresh failed' } },
  });
  assert.match(html, /data-analytics-freshness="stale"/, 'staleness is not collapsed into unavailable');
  assert.match(html, /analytics revision history-v2 · observed 2026-11-11T10:00:00\.000Z/);
  assert.match(html, /FLOW statistics unavailable/, 'the missing FLOW series is still explained');
  assert.doesNotMatch(html, /data-flow-kpi=/, 'no historical values are invented');
});

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
  const base = flowReferenceProjection(), current = base.metrics.flow!.current;
  const withUnrecorded = { ...base, metrics: { ...base.metrics, flow: { ...base.metrics.flow!, current: { ...current, graph: { ...current.graph,
    edges: current.graph.edges.map(edge => edge.from === null ? { ...edge, count: 1 } : edge) } } } } };
  assert.match(renderFlow(withUnrecorded), /data-flow-edge-origin="unrecorded-&gt;implement:workflow-return"/, 'unrecorded returns have an explicit origin');
  const withRebaseRepair = { ...base, metrics: { ...base.metrics, flow: { ...base.metrics.flow!, current: { ...current,
    graph: { ...current.graph, edges: [...current.graph.edges, { id: 'rebase->implement:workflow-return:pre-review-rebase',
      from: 'rebase' as const, to: 'implement' as const, kind: 'workflow-return' as const, stage: 'pre-review-rebase' as const,
      count: 1, share: null, percentage: null, observedMissions: 1, population: 24 }] } } } } };
  const rebaseRepair = renderFlow(withRebaseRepair);
  assert.match(rebaseRepair, /data-flow-edge="rebase-&gt;implement"/,
    'typed pre-review rebase returns have a visible route back to implementation');
  assert.match(rebaseRepair, /data-flow-edge-label="rebase-&gt;implement:workflow-return:pre-review-rebase"/);
  assert.match(html, /data-flow-edge="integration-tests-&gt;implement:gate-failed"/,
    'the integration return remains visibly routed to implementation');
});

test('Mission Flow exposes graph and timing bars as text without replacing missing facts with zero (TASK-2836)', () => {
  const html = renderFlow();
  assert.match(html, /Flow graph as text/);
  assert.match(html, /How FLOW counts add up/);
  assert.match(html, /24 initial work from refine \+ 32 distinct returns/);
  assert.match(html, /Implement: 56 including 32 rework; observed for 24 of 24 missions/);
  assert.match(html, /Rebase to Resolve rebase \(rebase conflict\): 14; observed denominator 24 of 24 missions; retained stage pre-review-rebase/);
  assert.match(html, /Declared gates to Implement \(gate failed\): 15; observed denominator 24 of 24 missions/);
  assert.match(html, /Agent review to Implement \(agent findings\): 10; observed denominator 24 of 24 missions/);
  assert.match(html, /Human request to Implement \(human changes\): 5; observed denominator 24 of 24 missions/);
  assert.match(html, /data-flow-node="human-verdict" data-flow-node-lane="human"/);
  assert.match(html, /Integration tests to Verdict and landing \(tests passed\): 24; observed denominator 24 of 24 missions/);
  assert.match(html, /Verdict and landing to Landed \(operator land\): 24; observed denominator 24 of 24 missions/);
  assert.doesNotMatch(html, /Human request to Rebase/);
  assert.doesNotMatch(html, /Integration tests to Landed/);
  assert.doesNotMatch(html, /: [1-9][0-9]*; observed denominator 0 of 24 missions/,
    'an edge carrying observed facts never reports a zero-mission denominator');
  assert.match(html, /aria-label="waiting 6m, working 76m"/);
  assert.match(html, /aria-label="held 950m, waiting and hands-on time not split"/);

  const pending = makeProjection();
  const unavailable: BoardProjection = { ...pending, metrics: { ...pending.metrics, analytics: {
    freshness: 'unavailable', revision: 'flow-v1', refreshedAt: null, reason: 'Historical analytics refresh is in progress.' } } };
  const emptyHtml = renderFlow(unavailable);
  assert.match(emptyHtml, /FLOW statistics unavailable/);
  assert.match(emptyHtml, /Historical analytics refresh is in progress/);
  assert.match(emptyHtml, /No flow values are shown in place of the missing projection/);
  assert.doesNotMatch(emptyHtml, /data-flow-kpi=/);
});

test('Mission Flow renders the shared configured parallel verification facts without exclusive fork shares (PX-0066)', () => {
  const base = flowReferenceProjection(), current = base.metrics.flow!.current;
  const edges = current.graph.edges.map(edge => {
    if (edge.kind === 'concurrent-request') { return { ...edge, count: 2, observedMissions: 2 }; }
    if (edge.kind === 'joint-repair') { return { ...edge, count: 1, percentage: 100, observedMissions: 1 }; }
    if (edge.kind === 'human-ready' || edge.kind === 'human-wait') {
      return { ...edge, count: 1, percentage: 50, observedMissions: 2 };
    }
    return edge;
  });
  const graph = { ...current.graph, edges, verification: {
    ...current.graph.verification,
    configured: configuredParallelVerification,
    executions: { pilot: 2, fallback: 1, shadow: 0, unobserved: 0, historical: 21 },
    observedRounds: 3, concurrentRounds: 2, joinedRounds: 1,
  } };
  const html = renderFlow({ ...base, metrics: { ...base.metrics, flow: { ...base.metrics.flow!, current: { ...current, graph } } } });
  assert.match(html, /one retained rebase · configured parallel verification/);
  assert.match(html, /Configured artifact policy; 2 concurrent rounds of 3 observed, 1 joined/);
  for (const target of ['integration-tests', 'agent-review', 'human-review']) {
    const agent = target === 'agent-review';
    const arrowKind = agent ? '' : ':concurrent-request';
    const label = agent ? 'concurrent' : 'request';
    assert.match(html, new RegExp(`data-flow-edge-label="declared-gates-&gt;${target}:concurrent-request"[^>]*>2 ${label}<`));
    assert.match(html, new RegExp(`data-flow-edge="declared-gates-&gt;${target}${arrowKind}"[\\s\\S]*?<polyline points="639,[^ ]+ 675,[^ ]+ 675,[^ ]+ 730,[^ ]+"`),
      `${target} leaves the shared gate bus and lands on the aligned request column`);
  }
  assert.match(html, /data-flow-edge-label="declared-gates-&gt;agent-review:flow"[^>]*>\d+% · \d+ sequential</);
  assert.equal(occurrences(html, 'data-flow-edge="declared-gates-&gt;agent-review'), 1);
  assert.equal(occurrences(html, 'data-flow-edge="human-review-&gt;human-verdict'), 1);
  assert.equal(occurrences(html, 'data-flow-junction="parallel-verification"'), 1,
    'the concurrent requests share one visible gate junction');
  assert.equal(occurrences(html, 'data-flow-junction="automated-verification"'), 1,
    'the automated verdicts share one visible join junction');
  assert.doesNotMatch(html, /declared-gates-&gt;(integration-tests|agent-review|human-review):concurrent-request[^>]*>[\\s\\S]{0,100}%/,
    'parallel request counts are not rendered as mutually exclusive shares');
  assert.match(html, /data-flow-edge-label="automated-join-&gt;implement:joint-repair"[\s\S]*?>100% · 1 joint repair</);
  assert.match(html, /data-flow-edge-label="automated-join-&gt;implement:gate-repair"[\s\S]*?>0% · 0 gate repair</);
  assert.match(html, /data-flow-edge-label="automated-join-&gt;implement:agent-repair"[\s\S]*?>0% · 0 agent repair</);
  assert.match(html, /data-flow-edge-label="human-review-&gt;human-verdict:human-ready"[\s\S]*?>50% · 1 ready</);
  assert.match(html, /data-flow-edge-label="human-review-&gt;human-verdict:human-wait"[\s\S]*?>50% · 1 later</);
});

test('Mission Flow separates every semantic continuation and label (PX-0066 F11, F13-F21)', () => {
  const base = flowReferenceProjection(), current = base.metrics.flow!.current;
  const graph = { ...current.graph, edges: current.graph.edges.map(edge => ({
    ...edge, count: Math.max(1, edge.count), observedMissions: Math.max(1, edge.observedMissions),
  })) };
  const html = renderFlow({ ...base, metrics: { ...base.metrics,
    flow: { ...base.metrics.flow!, current: { ...current, graph } } } });

  const repair = edgePoints(html, 'automated-join->implement');
  assert.equal(occurrences(html, 'data-flow-edge="automated-join-&gt;implement'), 1);
  assert.deepEqual(repair, [[992, 297], [992, 168], [334, 168], [334, 218], [310, 218]]);
  const legacyPaths = [
    edgePoints(html, 'human-verdict->rebase'),
    edgePoints(html, 'rebase-resolve->integration-tests:flow:integration-rebase'),
  ];
  assert.deepEqual(legacyPaths[0], [[1066, 546], [1048, 546], [1048, 579], [400, 579], [400, 333], [391, 333]]);
  assert.deepEqual(legacyPaths[1], [[514, 240], [700, 240], [700, 270], [760, 270], [760, 302]]);
  const cleanContinuation = edgePoints(html, 'rebase->integration-tests:clean:integration-rebase');
  const sequentialTests = edgePoints(html, 'integration-tests->human-verdict:tests-passed');
  const cleanGateContinuation = edgePoints(html, 'rebase->declared-gates:clean:pre-review-rebase');
  const declaredGateReturn = edgePoints(html, 'declared-gates->implement:gate-failed');
  const conflict = edgePoints(html, 'rebase->rebase-resolve');
  assert.deepEqual(cleanContinuation, [[350.5, 358], [350.5, 371], [787.5, 371], [787.5, 364]]);
  assert.deepEqual(sequentialTests, [[787.5, 302], [787.5, 289], [1210, 289], [1210, 501], [1195, 501]]);
  assert.deepEqual(edgePoints(html, 'human-verdict->landed:operator-land'), [[1130.5, 555], [1130.5, 589]]);
  assert.deepEqual(cleanGateContinuation, [[391, 348], [541, 348]]);
  assert.deepEqual(declaredGateReturn, [[541, 320], [527, 320], [527, 286], [320, 286], [320, 230], [310, 230]]);
  assert.ok(repair.at(-1)![1] < declaredGateReturn.at(-1)![1], 'automated repair enters Implement above the declared-gate return');
  assert.deepEqual(conflict, [[391, 318], [395, 318], [395, 230], [407, 230]]);
  assert.deepEqual(edgePoints(html, 'implement->rebase:flow:pre-review-rebase'), [[310, 248], [350.5, 248], [350.5, 308]]);
  assert.deepEqual(edgePoints(html, 'rebase-resolve->declared-gates:flow:pre-review-rebase'),
    [[514, 230], [518, 230], [518, 336], [541, 336]]);
  assert.deepEqual(edgePoints(html, 'integration-tests->implement:gate-failed'), [[760, 364], [760, 388], [270, 388], [270, 274]]);
  assert.deepEqual(edgePoints(html, 'agent-review->implement:agent-findings'),
    [[730, 420], [690, 420], [690, 462], [245, 462], [245, 274]]);
  assert.deepEqual(edgePoints(html, 'human-review->implement:human-changes'),
    [[730, 535], [700, 535], [700, 570], [215, 570], [215, 274]]);
  assert.deepEqual(edgePoints(html, 'rebase-resolve->human-review'),
    [[514, 222], [650, 222], [650, 500], [730, 500]]);
  assert.deepEqual(edgePoints(html, 'rebase->human-review'),
    [[325, 358], [325, 376], [710, 376], [710, 505], [730, 505]]);
  assert.deepEqual(edgePoints(html, 'rebase-resolve->rebase-resolve'),
    [[427, 215], [427, 197], [455, 197], [455, 215]]);
  assert.match(html, /data-flow-edge-label="rebase-&gt;rebase-resolve:rebase-conflict:pre-review-rebase"[^>]*>Pre-review /);
  assert.match(html, /data-flow-edge-label="rebase-&gt;rebase-resolve:rebase-conflict:integration-rebase"[^>]*>Integration /);
  const collisionSensitivePaths = [...legacyPaths, cleanContinuation, sequentialTests,
    cleanGateContinuation, declaredGateReturn, conflict,
    edgePoints(html, 'agent-review->automated-join:automated-verdict')];
  for (let left = 0; left < collisionSensitivePaths.length; left += 1) {
    for (let right = left + 1; right < collisionSensitivePaths.length; right += 1) {
      assert.equal(sharesSegmentOrEndpoint(collisionSensitivePaths[left], collisionSensitivePaths[right]), false,
        `collision-sensitive paths ${left} and ${right} share no segment or endpoint`);
      assert.equal(hasCloseParallelSegment(collisionSensitivePaths[left], collisionSensitivePaths[right]), false,
        `collision-sensitive paths ${left} and ${right} keep four-pixel parallel clearance`);
    }
  }

  const onRequestBus = (id: string) => id.endsWith(':concurrent-request') || id === 'declared-gates->agent-review';
  const paths = renderedEdges(html), intentionalBus = (left: string, right: string) =>
    onRequestBus(left) && onRequestBus(right)
    || left.endsWith(':automated-verdict') && right.endsWith(':automated-verdict');
  assert.ok(paths.length > 20, 'the clearance guard covers every rendered reference edge');
  assert.equal(new Set(paths.map(({ id }) => id.split(':')[0])).size, paths.length, 'each pair draws one arrow');
  for (let left = 0; left < paths.length; left += 1) {
    for (let right = left + 1; right < paths.length; right += 1) {
      if (intentionalBus(paths[left]!.id, paths[right]!.id)) { continue; }
      assert.equal(sharesSegmentOrEndpoint(paths[left]!.points, paths[right]!.points), false,
        `${paths[left]!.id} and ${paths[right]!.id} share no segment or endpoint`);
      assert.equal(hasCloseParallelSegment(paths[left]!.points, paths[right]!.points), false,
        `${paths[left]!.id} and ${paths[right]!.id} keep four-pixel parallel clearance`);
    }
  }

  const nodes = positionedBoxes(html, 'data-flow-node'), labels = labelBoxes(html);
  assert.equal(nodes.length, 11, 'the label guard covers every reference node');
  assert.ok(labels.length > 20, 'the label guard covers every rendered reference label');
  for (const label of labels) {
    for (const node of nodes) {
      const overlaps = label.x < node.x + node.w && label.x + label.w > node.x
        && label.y < node.y + node.h && label.y + label.h > node.y;
      assert.equal(overlaps, false, `${label.id} label stays outside ${node.id}`);
    }
  }

  const reorderedGraph = { ...graph, edges: [...graph.edges].reverse() };
  const reorderedHtml = renderFlow({ ...base, metrics: { ...base.metrics,
    flow: { ...base.metrics.flow!, current: { ...current, graph: reorderedGraph } } } });
  for (const path of paths) {
    assert.deepEqual(edgePoints(reorderedHtml, path.id), path.points, `${path.id} does not depend on projection order`);
  }
});

test('a deferred analytics build reports its reason on the analytics family alone (TASK-2854.01)', () => {
  const projection = makeProjection();
  const pending: BoardProjection = { ...projection, metrics: { ...projection.metrics, analytics: {
    freshness: 'unavailable', revision: 'history-v1', refreshedAt: null,
    reason: 'Historical analytics refresh is in progress.',
  } } };
  const workflow = webProjection.freshness(pending);
  const analytics = analyticsFamilyFreshness(pending);
  assert.equal(workflow.state, 'fresh', 'the current workflow families are not demoted by a deferred historical refresh');
  assert.equal(analytics.state, 'unavailable');
  assert.equal(analytics.reason, 'Historical analytics refresh is in progress.');
  assert.equal(analytics.revision, 'history-v1');
  assert.equal(analytics.refreshedAt, null);
});

test('a projection with no historical observation reports its analytics family unavailable, never the workflow observation (TASK-2854.04)', () => {
  const projection = makeProjection();
  const { analytics: _stamp, ...metrics } = projection.metrics;
  const unobserved: BoardProjection = { ...projection, metrics };
  assert.equal(webProjection.freshness(unobserved).state, 'fresh');
  const analytics = analyticsFamilyFreshness(unobserved);
  assert.equal(analytics.state, 'unavailable');
  assert.equal(analytics.revision, null);
  assert.match(analytics.reason ?? '', /no historical analytics observation/);
});

test('Mission Flow keeps sparse observations explicit without turning them into missing or invented values (TASK-2836 review 3615)', () => {
  const base = flowReferenceProjection(), current = base.metrics.flow!.current;
  const sparse: WebFlowWindow = { ...current,
    firstPassYield: { numerator: 0, denominator: 12, observed: 12, population: 24, coverage: 0.5, state: 'measured', value: 0 },
    graph: { ...current.graph, edges: current.graph.edges.map(edge => ({ ...edge, count: 0, share: 0, percentage: 0 })) },
    time: { ...current.time, unobservedMs: 60_000 },
  };
  const html = renderFlow({ ...base, metrics: { ...base.metrics, flow: { ...base.metrics.flow!, current: sparse } } });
  assert.match(html, /First-pass yield[\s\S]*?0%[\s\S]*?0\/12 · 12\/24 measured/);
  assert.match(html, /data-flow-edge-label="rebase-resolve-&gt;declared-gates:flow:pre-review-rebase"[\s\S]*?0% · 0/);
  assert.match(html, /data-flow-edge-label="rebase-resolve-&gt;integration-tests:flow:integration-rebase"[\s\S]*?0% · 0/);
  assert.match(html, /data-flow-edge-label="rebase-&gt;integration-tests:clean:integration-rebase"[\s\S]*?0% · 0<\/span>/);
  assert.match(html, /data-flow-edge-label="declared-gates-&gt;implement:gate-failed"[\s\S]*?0% · 0 returns/);
  assert.doesNotMatch(html, /data-flow-edge="agent-review-&gt;human-review:flow"/,
    'an unobserved legacy continuation does not clutter the configured verification segment');
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
  const base = flowReferenceProjection(), current = base.metrics.flow!.current;
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
  const base = flowReferenceProjection(), current = base.metrics.flow!.current;
  const defects = ['first-pass missing; inspect review history', 'agent-launch missing; inspect run history'];
  const flow: WebFlowWindow = { ...current, defects };
  const html = renderFlow({ ...base, metrics: { ...base.metrics, flow: { ...base.metrics.flow!, current: flow } } });
  assert.match(html, /first-pass missing; inspect review history/);
  assert.match(html, /agent-launch missing; inspect run history/);
  assert.doesNotMatch(html, /operationId|sourceId|collectionDefect/);
});

test('px lead is a minimal optional lane that distinguishes queue, recovery and human escalation (TASK-2836)', () => {
  const base = flowReferenceProjection();
  const current = base.metrics.flow!.current;
  const leadLane = { lane: 'lead' as const, families: [], waitingMs: 12 * 60_000, workingMs: 8 * 60_000,
    heldMs: 0, totalMs: 20 * 60_000, share: 20 / 1235 };
  const flow: WebFlowWindow = { ...current,
    graph: { ...current.graph,
      nodes: [...current.graph.nodes, { id: 'lead', lane: 'lead', count: 3, parts: [{ label: 'Observed recoveries', count: 3 }],
        rework: null, observedMissions: 2, population: 24 }],
    edges: [...current.graph.edges, { id: 'lead->human-review:lead-escalation', from: 'lead', to: 'human-review', kind: 'lead-escalation', stage: null,
      count: 2, share: null, percentage: null, observedMissions: 2, population: 24 }] },
    time: { ...current.time, lanes: current.time.lanes.map(lane => lane.lane === 'lead' ? leadLane : lane) } };
  const value: BoardProjection = { ...base, metrics: { ...base.metrics, flow: { ...base.metrics.flow!, current: flow } } };
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
  const base = flowReferenceProjection();
  const current = base.metrics.flow!.current;
  const changed: WebFlowWindow = { ...current,
    graph: { ...current.graph,
      nodes: current.graph.nodes.map(node => ({ ...node, count: node.id === 'landed' ? 1 : 123_456,
      ...(node.id === 'integration-tests' ? { observedMissions: 1 } : {}) })),
      edges: current.graph.edges.map(edge => ({ ...edge, count: edge.kind === 'rebase-repeat' ? 98_765 : 0 })) },
    time: { ...current.time, lanes: current.time.lanes.map(lane => lane.lane === 'implement-agent'
      ? { ...lane, families: ['a-very-long-configured-agent-family-name'] } : lane) } };
  const value: BoardProjection = { ...base, metrics: { ...base.metrics, flow: { ...base.metrics.flow!, current: changed } } };
  const html = renderFlow(value);
  assert.equal(occurrences(html, 'data-flow-node='), 11);
  assert.equal(occurrences(html, 'data-flow-lane='), 6);
  assert.match(html, /data-flow-edge="rebase-resolve-&gt;rebase-resolve"/);
  assert.match(html, /98,765|98765/);
  assert.match(html, /a-very-long-configured-agent-family-name/);
  assert.match(html, /data-flow-node="integration-tests"[^>]*height:72px/, 'partial coverage receives a bounded two-line node');
  assert.match(html, /data-flow-node="declared-gates"[^>]*height:(?:62|72)px/, 'wrapped node titles reserve detail and coverage space');
  assert.match(html, /flex-wrap:nowrap/, 'real family counts retain the reference header row');
  assert.doesNotMatch(html, /data-flow-lane="lead"/);
});
