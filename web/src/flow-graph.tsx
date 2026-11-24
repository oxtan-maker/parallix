/** The browser lays out the shared FLOW graph; all counts and classifications come from the application projection. */
import type { WebFlowEdge, WebFlowLane, WebFlowNode, WebFlowNodeId, WebFlowWindow } from '../../src/interfaces/web/transport.js';
import { FLOW, FLOW_TYPE } from './palette.js';
import { LANE_STYLE, NODE_TEXT, laneTitle, minutesText, percentText } from './flow-format.js';

const PANEL_WIDTH = 1232, LANE_LEFT = 22, LANE_RIGHT = 1195, LANE_HEIGHT = 93, MAIN_HEIGHT = 65, FIRST_LANE_TOP = 101;
const LANE_ORDER: readonly WebFlowLane[] = ['refine-agent', 'implement-agent', 'parallix', 'review-agent', 'human', 'lead', 'main'];
type Box = { readonly x: number; readonly y: number; readonly w: number; readonly h: number };
type Point = readonly [number, number];

const NODE_BOX: Readonly<Record<WebFlowNodeId, Omit<Box, 'y'>>> = {
  refine: { x: 165, w: 126, h: 51 }, implement: { x: 165, w: 145, h: 68 },
  rebase: { x: 310, w: 81, h: 50 }, 'rebase-resolve': { x: 407, w: 107, h: 50 },
  'declared-gates': { x: 541, w: 98, h: 50 }, 'integration-tests': { x: 730, w: 115, h: 60 },
  'agent-review': { x: 730, w: 115, h: 60 }, 'human-review': { x: 730, w: 115, h: 50 },
  'automated-join': { x: 930, w: 112, h: 60 }, 'human-verdict': { x: 1066, w: 129, h: 64 },
  landed: { x: 1066, w: 129, h: 46 }, lead: { x: 810, w: 107, h: 50 },
};
const WRAPPED_NODE_TITLES = new Set<WebFlowNodeId>(['declared-gates', 'integration-tests', 'agent-review',
  'human-review', 'automated-join', 'human-verdict']);
const NODE_LANE: Readonly<Record<WebFlowNodeId, WebFlowLane>> = {
  refine: 'refine-agent', implement: 'implement-agent', rebase: 'parallix', 'rebase-resolve': 'implement-agent',
  'declared-gates': 'parallix', 'integration-tests': 'parallix', 'agent-review': 'review-agent',
  'human-review': 'human', 'automated-join': 'parallix', 'human-verdict': 'human', landed: 'main', lead: 'lead',
};
const NODE_ACCENT: Readonly<Record<WebFlowNodeId, string>> = {
  refine: FLOW.refine, implement: FLOW.amber, rebase: FLOW.rebase, 'rebase-resolve': FLOW.amber,
  'declared-gates': FLOW.cyan, 'integration-tests': FLOW.cyan, 'agent-review': FLOW.purple,
  'human-review': FLOW.red, 'automated-join': FLOW.cyan, 'human-verdict': FLOW.red, landed: FLOW.blue, lead: FLOW.lead,
};
const EDGE_STYLE: Readonly<Record<WebFlowEdge['kind'], { readonly color: string; readonly dash?: string }>> = {
  flow: { color: FLOW.flow }, clean: { color: FLOW.flow }, 'gate-failed': { color: FLOW.cyan },
  'agent-findings': { color: FLOW.purple }, 'human-changes': { color: FLOW.red },
  'rebase-conflict': { color: FLOW.rebase }, 'rebase-repeat': { color: FLOW.rebase },
  'rebase-failed': { color: FLOW.rebase, dash: '6 5' }, 'workflow-return': { color: FLOW.flow, dash: '3 3' },
  'lead-escalation': { color: FLOW.lead, dash: '6 5' }, 'concurrent-request': { color: FLOW.cyan },
  'automated-verdict': { color: FLOW.cyan }, 'automated-pass': { color: FLOW.cyan },
  'gate-repair': { color: FLOW.cyan }, 'agent-repair': { color: FLOW.purple }, 'joint-repair': { color: FLOW.red },
  'human-ready': { color: FLOW.red }, 'human-wait': { color: FLOW.red }, 'human-pending': { color: FLOW.red, dash: '6 5' },
  'human-withdrawn': { color: FLOW.muted, dash: '6 5' }, 'timing-unavailable': { color: FLOW.muted, dash: '3 3' },
  'tests-passed': { color: FLOW.flow }, 'landing-rebase': { color: FLOW.rebase }, 'operator-land': { color: FLOW.blue },
};
type Layout = { readonly lanes: readonly { lane: WebFlowLane; top: number; height: number }[];
  readonly height: number; readonly node: (_id: WebFlowNodeId) => Box };
type EdgeRoute = { readonly points: readonly Point[]; readonly label: Point };
const PARALLEL_BUS_X = 675, AUTOMATED_BUS_X = 885;
const isSequentialAgentReview = (edge: WebFlowEdge) =>
  edge.from === 'declared-gates' && edge.to === 'agent-review' && edge.kind === 'flow';

function layout(lead: boolean, nodes: readonly WebFlowNode[]): Layout {
  let top = FIRST_LANE_TOP;
  const lanes = LANE_ORDER.filter(lane => lead || lane !== 'lead').map(lane => {
    const height = lane === 'main' ? MAIN_HEIGHT : LANE_HEIGHT, row = { lane, top, height }; top += height; return row;
  });
  const laneTop = (lane: WebFlowLane) => lanes.find(row => row.lane === lane)?.top ?? FIRST_LANE_TOP;
  const byId = new Map(nodes.map(node => [node.id, node]));
  return { lanes, height: top + 29, node: id => {
    const base = NODE_BOX[id], observed = byId.get(id);
    const covered = observed && observed.observedMissions < observed.population && !['refine', 'implement', 'landed'].includes(id);
    const h = Math.max(base.h, covered ? 72 : 0, WRAPPED_NODE_TITLES.has(id) ? 62 : 0);
    return { x: base.x, w: base.w, h, y: laneTop(observed?.lane ?? NODE_LANE[id]) + Math.max(7, Math.floor((LANE_HEIGHT - h) / 2)) };
  } };
}

function midpoint(box: Box): number { return box.y + box.h / 2; }

/** The configured round reads as one fork: one gate trunk, then three simultaneous requests. */
function verificationRoute(edge: WebFlowEdge, at: Layout['node']): EdgeRoute | null {
  const sequentialAgentReview = isSequentialAgentReview(edge);
  if (edge.from === 'declared-gates' && (edge.kind === 'concurrent-request' || sequentialAgentReview)) {
    const from = at(edge.from), to = at(edge.to), sourceY = midpoint(from), targetY = midpoint(to);
    const labelOffset = sequentialAgentReview ? 165 : edge.to === 'integration-tests' ? -40 : edge.to === 'agent-review' ? 40 : 0;
    return { points: [[from.x + from.w, sourceY], [PARALLEL_BUS_X, sourceY], [PARALLEL_BUS_X, targetY], [to.x, targetY]],
      label: [to.x + labelOffset, to.y - 17] };
  }
  if (edge.kind === 'automated-verdict' && (edge.from === 'integration-tests' || edge.from === 'agent-review')) {
    const from = at(edge.from), to = at(edge.to), sourceY = midpoint(from), targetY = midpoint(to);
    return { points: [[from.x + from.w, sourceY], [AUTOMATED_BUS_X, sourceY], [AUTOMATED_BUS_X, targetY], [to.x, targetY]],
      label: [from.x + from.w + 7, sourceY - 17] };
  }
  if (edge.kind === 'automated-pass' && edge.from === 'automated-join' && edge.to === 'human-verdict') {
    const from = at(edge.from), to = at(edge.to), x = from.x + from.w - 18, targetX = to.x + to.w / 2;
    return { points: [[x, from.y + from.h], [x, to.y - 12], [targetX, to.y - 12], [targetX, to.y]],
      label: [x + 7, to.y - 29] };
  }
  return null;
}

const REPAIR_KINDS = ['gate-repair', 'agent-repair', 'joint-repair'] as const;
const isJoinRepair = (edge: WebFlowEdge) => edge.from === 'automated-join' && edge.to === 'implement'
  && REPAIR_KINDS.some(kind => edge.kind === kind);

function joinRepairRoute(edge: WebFlowEdge, at: Layout['node']): EdgeRoute | null {
  if (!isJoinRepair(edge)) { return null; }
  const branch = REPAIR_KINDS.findIndex(kind => edge.kind === kind);
  const from = at('automated-join'), to = at('implement');
  const sourceX = from.x + 62, approachX = to.x + to.w + 24, corridorY = FIRST_LANE_TOP + LANE_HEIGHT - 26;
  const targetY = to.y + 12;
  return { points: [[sourceX, from.y], [sourceX, corridorY], [approachX, corridorY],
    [approachX, targetY], [to.x + to.w, targetY]], label: [505 + branch * 145, corridorY - 15] };
}

function sequentialRoute(edge: WebFlowEdge, at: Layout['node']): EdgeRoute | null {
  const from = edge.from ? at(edge.from) : null, to = at(edge.to);
  if (edge.from === 'agent-review' && edge.to === 'human-review' && edge.kind === 'flow') {
    const x = from!.x + from!.w / 2;
    return { points: [[x, from!.y + from!.h], [x, to.y]], label: [x + 8, (from!.y + from!.h + to.y) / 2 - 14] };
  }
  if (edge.from === 'human-verdict' && edge.to === 'rebase') {
    const sourceY = from!.y + from!.h - 9, turnX = from!.x - 18;
    const approachX = to.x + to.w + 9, corridorY = from!.y + from!.h + 24;
    return { points: [[from!.x, sourceY], [turnX, sourceY], [turnX, corridorY], [approachX, corridorY],
      [approachX, midpoint(to)], [to.x + to.w, midpoint(to)]],
    label: [approachX + (edge.kind === 'landing-rebase' ? 185 : 14), corridorY + 3] };
  }
  return null;
}

/** Rebase and declared-gate lifecycle paths use stable ports, independent of projection edge order. */
function gateLifecycleRoute(edge: WebFlowEdge, at: Layout['node']): EdgeRoute | null {
  const from = edge.from ? at(edge.from) : null, to = at(edge.to);
  if (edge.from === 'rebase' && edge.to === 'declared-gates' && edge.kind === 'clean'
    && edge.stage === 'pre-review-rebase') {
    const y = from!.y + from!.h - 10;
    return { points: [[from!.x + from!.w, y], [to.x, y]], label: [(from!.x + from!.w + to.x) / 2 - 28, y - 17] };
  }
  if (edge.from === 'declared-gates' && edge.to === 'implement' && edge.kind === 'gate-failed') {
    const sourceY = from!.y + 18, corridorY = FIRST_LANE_TOP + LANE_HEIGHT * 2 - 1;
    const approachX = to.x + to.w + 10, targetY = to.y + 24;
    return { points: [[from!.x, sourceY], [from!.x - 14, sourceY], [from!.x - 14, corridorY],
      [approachX, corridorY], [approachX, targetY], [to.x + to.w, targetY]],
    label: [from!.x - 131, corridorY - 17] };
  }
  return null;
}

function rebaseConflictRoute(edge: WebFlowEdge, at: Layout['node']): EdgeRoute | null {
  if (edge.from !== 'rebase' || edge.to !== 'rebase-resolve' || edge.kind !== 'rebase-conflict') { return null; }
  const from = at(edge.from), to = at(edge.to), integration = edge.stage === 'integration-rebase';
  const sourceY = from.y + 10, corridorX = from.x + from.w + 4, targetY = to.y + 15;
  return { points: [[from.x + from.w, sourceY], [corridorX, sourceY], [corridorX, targetY], [to.x, targetY]],
    label: [integration ? 597 : 465, to.y - 18] };
}

function fixedIntegrationRoute(edge: WebFlowEdge, at: Layout['node']): EdgeRoute | null {
  const from = edge.from ? at(edge.from) : null, to = at(edge.to);
  if (edge.from === 'rebase-resolve' && edge.to === 'integration-tests' && edge.kind === 'flow') {
    const sourceY = midpoint(from!), corridorY = to.y - 32, targetX = to.x + 30, approachX = PARALLEL_BUS_X + 25;
    return { points: [[from!.x + from!.w, sourceY], [approachX, sourceY], [approachX, corridorY],
      [targetX, corridorY], [targetX, to.y]], label: [approachX + 7, sourceY - 17] };
  }
  if (edge.from === 'rebase' && edge.to === 'integration-tests' && edge.kind === 'clean') {
    const y = Math.max(from!.y + from!.h, to.y + to.h) + 7, x = to.x + to.w / 2;
    return { points: [[from!.x + from!.w / 2, from!.y + from!.h], [from!.x + from!.w / 2, y], [x, y], [x, to.y + to.h]],
      label: [432, y - 13] };
  }
  if (edge.kind === 'tests-passed') {
    const sourceX = from!.x + from!.w / 2, top = from!.y - 13;
    const right = LANE_RIGHT + 15, targetY = to.y + 18;
    return { points: [[sourceX, from!.y], [sourceX, top], [right, top], [right, targetY], [to.x + to.w, targetY]],
      label: [1048, top - 17] };
  }
  return null;
}

function baseLifecycleRoute(edge: WebFlowEdge, at: Layout['node']): EdgeRoute | null {
  const from = edge.from ? at(edge.from) : null, to = at(edge.to);
  if (edge.from === 'refine' && edge.to === 'implement' && edge.kind === 'flow') {
    const sourceX = from!.x + from!.w / 2, targetX = to.x + to.w / 2, corridorY = to.y - 12;
    return { points: [[sourceX, from!.y + from!.h], [sourceX, corridorY], [targetX, corridorY], [targetX, to.y]],
      label: [sourceX + 8, corridorY - 16] };
  }
  if (edge.from === 'implement' && edge.to === 'rebase' && edge.kind === 'flow') {
    const sourceY = to.y - 60, targetX = to.x + to.w / 2;
    return { points: [[from!.x + from!.w, sourceY], [targetX, sourceY], [targetX, to.y]], label: [targetX - 10, sourceY - 16] };
  }
  if (edge.from === 'rebase' && edge.to === 'implement' && edge.kind === 'workflow-return') {
    const corridorY = to.y + to.h + 8, targetX = to.x + to.w - 25;
    return { points: [[from!.x, from!.y + from!.h - 12], [from!.x - 10, from!.y + from!.h - 12],
      [from!.x - 10, corridorY], [targetX, corridorY], [targetX, to.y + to.h]], label: [from!.x + 7, corridorY + 3] };
  }
  if (edge.from === 'rebase-resolve' && edge.to === 'declared-gates' && edge.kind === 'flow') {
    const sourceY = from!.y + 15, corridorX = from!.x + from!.w + 4, targetY = to.y + to.h - 28;
    return { points: [[from!.x + from!.w, sourceY], [corridorX, sourceY], [corridorX, targetY], [to.x, targetY]],
      label: [from!.x + 25, to.y + 4] };
  }
  return null;
}

function rebaseFirstFailureRoute(edge: WebFlowEdge, at: Layout['node']): EdgeRoute | null {
  const from = edge.from ? at(edge.from) : null, to = at(edge.to);
  if (edge.from === 'rebase' && edge.to === 'human-review' && edge.kind === 'rebase-failed') {
    const sourceX = from!.x + 15, corridorY = from!.y + from!.h + 18, approachX = to.x - 20;
    const targetY = to.y + 17;
    return { points: [[sourceX, from!.y + from!.h], [sourceX, corridorY], [approachX, corridorY],
      [approachX, targetY], [to.x, targetY]],
    label: [edge.stage === 'integration-rebase' ? 540 : 405, corridorY + 33] };
  }
  return null;
}

function rebaseRepeatRoute(edge: WebFlowEdge, at: Layout['node']): EdgeRoute | null {
  const from = edge.from ? at(edge.from) : null;
  if (edge.from === 'rebase-resolve' && edge.to === 'rebase-resolve' && edge.kind === 'rebase-repeat') {
    const left = from!.x + 20, right = left + 28, top = from!.y - 18;
    return { points: [[left, from!.y], [left, top], [right, top], [right, from!.y]],
      label: [edge.stage === 'integration-rebase' ? right + 24 : left - 82, top - 14] };
  }
  return null;
}

function rebaseResolutionFailureRoute(edge: WebFlowEdge, at: Layout['node']): EdgeRoute | null {
  const from = edge.from ? at(edge.from) : null, to = at(edge.to);
  if (edge.from === 'rebase-resolve' && edge.to === 'human-review' && edge.kind === 'rebase-failed') {
    const sourceY = from!.y + 7, corridorX = 650, targetY = to.y + 12;
    return { points: [[from!.x + from!.w, sourceY], [corridorX, sourceY], [corridorX, targetY], [to.x, targetY]],
      label: [from!.x + from!.w + 20, sourceY + (edge.stage === 'integration-rebase' ? 42 : 26)] };
  }
  return null;
}

function implementationReturnRoute(edge: WebFlowEdge, at: Layout['node']): EdgeRoute | null {
  const from = edge.from ? at(edge.from) : null, to = at(edge.to);
  if (edge.from === 'integration-tests' && edge.to === 'implement' && edge.kind === 'gate-failed') {
    const sourceX = from!.x + 30, corridorY = from!.y + from!.h + 24, targetX = to.x + to.w - 40;
    return { points: [[sourceX, from!.y + from!.h], [sourceX, corridorY], [targetX, corridorY],
      [targetX, to.y + to.h]], label: [from!.x - 174, corridorY + 3] };
  }
  if (edge.from === 'agent-review' && edge.to === 'implement' && edge.kind === 'agent-findings') {
    const sourceY = from!.y + 25, corridorX = from!.x - 40, corridorY = from!.y + from!.h + 5, targetX = to.x + 80;
    return { points: [[from!.x, sourceY], [corridorX, sourceY], [corridorX, corridorY], [targetX, corridorY],
      [targetX, to.y + to.h]], label: [from!.x - 225, corridorY - 16] };
  }
  if (edge.from === 'human-review' && edge.to === 'implement' && edge.kind === 'human-changes') {
    const sourceY = from!.y + 47, corridorX = from!.x - 30, corridorY = from!.y + from!.h + 20, targetX = to.x + 50;
    return { points: [[from!.x, sourceY], [corridorX, sourceY], [corridorX, corridorY], [targetX, corridorY],
      [targetX, to.y + to.h]], label: [from!.x - 250, corridorY - 16] };
  }
  return null;
}

function leadRoute(edge: WebFlowEdge, at: Layout['node']): EdgeRoute | null {
  if (edge.from === 'lead' && edge.to === 'human-review' && edge.kind === 'lead-escalation') {
    const from = at(edge.from), to = at(edge.to), sourceX = from.x + from.w / 2, targetX = to.x + to.w - 20;
    return { points: [[sourceX, from.y], [sourceX, to.y + to.h + 12], [targetX, to.y + to.h + 12],
      [targetX, to.y + to.h]], label: [sourceX + 8, from!.y - 18] };
  }
  return null;
}

function semanticRoute(edge: WebFlowEdge, at: Layout['node']): EdgeRoute | null {
  return verificationRoute(edge, at) ?? joinRepairRoute(edge, at) ?? sequentialRoute(edge, at)
    ?? gateLifecycleRoute(edge, at) ?? rebaseConflictRoute(edge, at) ?? fixedIntegrationRoute(edge, at)
    ?? baseLifecycleRoute(edge, at) ?? rebaseFirstFailureRoute(edge, at) ?? rebaseRepeatRoute(edge, at)
    ?? rebaseResolutionFailureRoute(edge, at) ?? implementationReturnRoute(edge, at) ?? leadRoute(edge, at);
}

function route(edge: WebFlowEdge, at: Layout['node']): EdgeRoute {
  if (!edge.from) {
    const target = at(edge.to); return { points: [[target.x - 38, target.y + target.h / 2], [target.x, target.y + target.h / 2]],
      label: [target.x - 120, target.y + target.h / 2 - 15] };
  }
  const semantic = semanticRoute(edge, at);
  if (semantic) { return semantic; }
  const from = at(edge.from), to = at(edge.to);
  if (edge.from === 'human-review' && edge.to === 'human-verdict') {
    const offsets: Partial<Record<WebFlowEdge['kind'], Point>> = {
      'human-ready': [10, 10], 'human-wait': [105, 10], 'human-pending': [10, 33],
      'human-withdrawn': [105, 33], 'timing-unavailable': [10, 49],
    };
    const [labelX, labelY] = offsets[edge.kind] ?? [10, 10], y = from.y + 27;
    return { points: [[from.x + from.w, y], [to.x, y]], label: [from.x + from.w + labelX, from.y + labelY] };
  }
  if (edge.kind === 'operator-land') {
    const x = to.x + to.w / 2, y = from.y + from.h;
    return { points: [[x, y], [x, to.y]], label: [x + 9, (y + to.y) / 2 - 8] };
  }
  if (edge.from === edge.to) {
    throw new Error(`FLOW self-loop lacks a semantic route: ${edge.id}`);
  }
  throw new Error(`FLOW edge lacks a semantic route: ${edge.id}`);
}

function edgeText(edge: WebFlowEdge, showStage: boolean): string {
  const labels: Partial<Record<WebFlowEdge['kind'], string>> = { 'gate-failed': 'returns', 'concurrent-request': 'request', 'automated-verdict': 'verdict',
    'automated-pass': 'pass', 'gate-repair': 'gate repair', 'agent-repair': 'agent repair', 'joint-repair': 'joint repair',
    'human-ready': 'ready', 'human-wait': 'later', 'human-pending': 'pending', 'human-withdrawn': 'withdrawn',
    'timing-unavailable': 'timing unavailable', 'tests-passed': 'sequential pass', 'landing-rebase': 'landing rebases',
    'operator-land': 'landed', 'lead-escalation': 'escalated' };
  const label = edge.from === 'implement' && edge.to === 'rebase' ? 'runs' : isSequentialAgentReview(edge) ? 'sequential'
    : edge.kind === 'concurrent-request' && edge.to === 'agent-review' ? 'concurrent'
      : edge.kind === 'flow' && edge.stage === 'integration-rebase' && edge.from === 'human-verdict' ? 'sequential rebase checks'
        : labels[edge.kind];
  const count = `${edge.count}${label ? ` ${label}` : ''}`;
  const text = edge.percentage === null ? count : `${edge.percentage}% · ${count}`;
  if (showStage && edge.stage && ['rebase-conflict', 'rebase-repeat', 'rebase-failed'].includes(edge.kind)) {
    return `${edge.stage === 'integration-rebase' ? 'Integration' : 'Pre-review'} ${text}`;
  }
  return text;
}

function nodeLines(node: WebFlowNode) {
  const text = NODE_TEXT[node.id], coverage = node.observedMissions < node.population ? `${node.observedMissions}/${node.population} obs` : undefined;
  if (node.id === 'refine') { return { title: `${text.title} · ${node.count}`, detail: text.unit, coverage }; }
  if (node.id === 'implement') { return { title: `${text.title} · ${node.count}`, detail: `${node.population} + ${node.rework ?? 0} ${text.unit}` }; }
  if (node.id === 'landed') { return { title: text.title, detail: String(node.count) }; }
  return { title: text.title, detail: `${node.count} ${text.unit}`, coverage };
}

function Arrow({ points, color, dash, id, empty }: { readonly points: readonly Point[]; readonly color: string;
  readonly dash?: string; readonly id: string; readonly empty: boolean }) {
  const [x, y] = points.at(-1)!, [px, py] = points.at(-2)!, angle = Math.atan2(y - py, x - px);
  const head = (spread: number) => `${(x - 7 * Math.cos(angle) + spread * Math.sin(angle)).toFixed(1)},${(y - 7 * Math.sin(angle) - spread * Math.cos(angle)).toFixed(1)}`;
  return <g data-flow-edge={id} data-flow-edge-origin={id} opacity={empty ? 0.45 : 1}><polyline points={points.map(([a, b]) => `${a},${b}`).join(' ')}
    fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" strokeDasharray={dash} />
    <polygon points={`${x},${y} ${head(4)} ${head(-4)}`} fill={color} /></g>;
}
const keepEmpty = (edge: WebFlowEdge) => ['clean', 'gate-failed', 'concurrent-request', 'automated-verdict',
  'automated-pass', 'operator-land', 'rebase-conflict'].includes(edge.kind)
  || edge.kind === 'flow' && edge.from === 'rebase-resolve';
const labelEmpty = (edge: WebFlowEdge) => ['clean', 'gate-failed', 'rebase-conflict'].includes(edge.kind)
  || edge.kind === 'flow' && edge.from === 'rebase-resolve';

function visibleConnections(edges: readonly WebFlowEdge[], at: Layout['node']) {
  const connections = new Map<string, WebFlowEdge[]>();
  for (const edge of edges) {
    const id = `${edge.from ?? 'unrecorded'}->${edge.to}`;
    const existing = connections.get(id);
    if (existing) { existing.push(edge); } else { connections.set(id, [edge]); }
  }
  return [...connections].flatMap(([id, members]) => {
    const visible = members.filter(edge => edge.count > 0 || keepEmpty(edge));
    if (!visible.length) { return []; }
    const observed = visible.filter(edge => edge.count > 0).sort((a, b) => a.id.localeCompare(b.id));
    const primary = observed.find(edge => ['concurrent-request', 'human-ready', 'human-wait'].includes(edge.kind))
      ?? observed[0] ?? visible[0]!;
    const style = isJoinRepair(primary) ? { color: FLOW.flow } : EDGE_STYLE[primary.kind];
    const labeled = isJoinRepair(primary) ? members
      : visible.filter(edge => edge.count > 0 || edge.observedMissions > 0 || labelEmpty(edge));
    const showStage = members.some(edge => edge.stage === 'integration-rebase');
    return [{ id: members.length === 1 ? primary.id : id, points: route(primary, at).points,
      style, empty: observed.length === 0,
      labels: labeled.map(edge => ({ edge, position: route(edge, at).label, text: edgeText(edge, showStage),
        color: EDGE_STYLE[edge.kind].color === FLOW.flow ? FLOW.flowLabel : EDGE_STYLE[edge.kind].color })) }];
  });
}

export function FlowGraph({ flow, lanes }: { readonly flow: WebFlowWindow;
  readonly lanes: readonly WebFlowWindow['time']['lanes'][number][] }) {
  const lead = flow.graph.nodes.some(node => node.id === 'lead') || lanes.some(lane => lane.lane === 'lead' && lane.totalMs > 0);
  const nodes = flow.graph.nodes.filter(node => node.id !== 'lead' || lead), geometry = layout(lead, nodes);
  const connections = visibleConnections(flow.graph.edges, geometry.node);
  const labels = connections.flatMap(connection => connection.labels);
  const refined = flow.stateDwell.find(state => state.state === 'refined');
  const laneStat = (lane: WebFlowLane) => {
    if (lane === 'main') { return null; } const time = lanes.find(row => row.lane === lane);
    if (lane === 'refine-agent') {
      return refined?.n ? `median ${minutesText(refined.medianMs)} queued` : 'queue not observed'; }
    if (!time?.totalMs) { return 'no time observed'; }
    return lane === 'lead' ? `${minutesText(time.waitingMs)} queued · ${minutesText(time.workingMs)} recovering`
      : `avg ${minutesText(time.totalMs)} · ${percentText(time.share)}`;
  };
  return <section aria-labelledby="flow-graph-title" data-flow-region="graph"
    style={{ background: FLOW.surface, border: `1px solid ${FLOW.surfaceEdge}`, borderRadius: 10, marginTop: 21, overflowX: 'auto' }}>
    <div style={{ position: 'relative', width: PANEL_WIDTH - 2, height: geometry.height - 2 }}>
      <h2 id="flow-graph-title" style={{ position: 'absolute', left: 21, top: 18, margin: 0, color: FLOW.text,
        fontSize: FLOW_TYPE.heading, fontWeight: 700, whiteSpace: 'nowrap' }}>Flow by actor · one retained rebase · configured parallel verification</h2>
      <Legend />
      {geometry.lanes.map((row, index) => { const time = lanes.find(value => value.lane === row.lane), style = LANE_STYLE[row.lane];
        return <div key={row.lane} data-flow-lane={row.lane} style={{ position: 'absolute', left: LANE_LEFT - 1, top: row.top - 1,
          width: LANE_RIGHT - LANE_LEFT + 1, height: row.height, borderTop: `1px solid ${FLOW.laneRule}`,
          borderBottom: index === geometry.lanes.length - 1 ? `1px solid ${FLOW.laneRule}` : undefined,
          background: index % 2 === 1 ? FLOW.band : 'transparent' }}><div style={{ position: 'absolute', left: 14, top: 13, width: 118, fontSize: FLOW_TYPE.meta, lineHeight: '17px' }}>
            <div style={{ color: FLOW.text, fontWeight: 700, fontSize: FLOW_TYPE.body }}>{laneTitle(row.lane, time?.families ?? [])}</div>
            <div style={{ color: FLOW.muted }}>{style.role}</div><div style={{ color: style.text }}>{laneStat(row.lane)}</div></div></div>; })}
      <svg aria-hidden="true" width={PANEL_WIDTH - 2} height={geometry.height - 2} style={{ position: 'absolute', left: -1, top: -1, overflow: 'visible' }}>
        {connections.map(({ id, points, style, empty }) => <Arrow key={id} id={id} points={points} color={style.color}
          dash={style.dash} empty={empty} />)}
        {flow.graph.edges.some(edge => edge.kind === 'concurrent-request') && <circle data-flow-junction="parallel-verification"
          cx={PARALLEL_BUS_X} cy={midpoint(geometry.node('declared-gates'))} r="3.5" fill={FLOW.surface} stroke={FLOW.cyan} strokeWidth="1.5" />}
        {flow.graph.edges.some(edge => edge.kind === 'automated-verdict') && <circle data-flow-junction="automated-verification"
          cx={AUTOMATED_BUS_X} cy={midpoint(geometry.node('automated-join'))} r="3.5" fill={FLOW.surface} stroke={FLOW.cyan} strokeWidth="1.5" />}
      </svg>
      {nodes.map(node => { const box = geometry.node(node.id), lines = nodeLines(node), landed = node.id === 'landed';
        const countDetails = countPartsText(node);
        return <div key={node.id} data-flow-node={node.id} data-flow-node-lane={node.lane} title={countDetails || undefined}
          style={{ position: 'absolute', left: box.x - 1, top: box.y - 1, width: box.w,
          height: box.h, overflow: 'hidden', boxSizing: 'border-box', padding: '7px 10px', borderRadius: 6,
          background: landed ? FLOW.landedNode : FLOW.node, border: `1px solid ${FLOW.nodeEdge}`,
          borderTop: `2px solid ${NODE_ACCENT[node.id]}`, fontSize: FLOW_TYPE.meta, lineHeight: '15px' }}>
          <div style={{ color: FLOW.bright, fontWeight: 700, fontSize: FLOW_TYPE.heading }}>{lines.title}</div>
          <div style={{ color: landed ? FLOW.blueText : FLOW.control, whiteSpace: 'nowrap' }}>{lines.detail}</div>
          {lines.coverage && <div style={{ color: FLOW.muted, whiteSpace: 'nowrap', fontSize: FLOW_TYPE.micro }}>{lines.coverage}</div>}</div>; })}
      {labels.map(({ edge, position, text, color }) => <span key={edge.id} data-flow-edge-label={edge.id} aria-hidden="true"
        style={{ position: 'absolute', left: position[0], top: position[1], color,
          fontSize: FLOW_TYPE.micro, whiteSpace: 'nowrap', fontWeight: 700, textShadow: `0 0 3px ${FLOW.surface}` }}>{text}</span>)}
    </div><CountBreakdown nodes={nodes} /><GraphDescription flow={flow} lead={lead} /></section>;
}

function CountBreakdown({ nodes }: { readonly nodes: readonly WebFlowNode[] }) {
  return <details data-flow-count-breakdown style={{ margin: '0 21px 16px', color: FLOW.control, fontSize: FLOW_TYPE.meta }}>
    <summary style={{ cursor: 'pointer', color: FLOW.text }}>How FLOW counts add up</summary>
    <p>One implementation can trigger multiple rebase runs. Each automated join uses both verdicts from the same round.
      Test requests are counted on the fork. Test batches are counted in the box.</p>
    <dl style={{ display: 'grid', gridTemplateColumns: 'max-content 1fr', gap: '5px 14px', margin: 0 }}>
      {nodes.map(node => <div key={node.id} style={{ display: 'contents' }}>
        <dt>{NODE_NAMES[node.id]} · {node.count}</dt>
        <dd style={{ margin: 0 }}>{countPartsText(node) || 'No counted observations'}</dd>
      </div>)}
    </dl>
  </details>;
}

function countPartsText(node: WebFlowNode): string {
  return node.parts.filter(part => part.count > 0).map(part => `${part.count} ${part.label.toLowerCase()}`).join(' + ');
}

function Legend() {
  const items = [['parallel request', FLOW.cyan], ['agent finding', FLOW.purple], ['human decision', FLOW.red], ['rebase', FLOW.rebase]] as const;
  return <ul aria-label="Edge colours" style={{ position: 'absolute', left: 21, top: 44, margin: 0, padding: 0, listStyle: 'none',
    display: 'flex', gap: 16, color: FLOW.control, fontSize: FLOW_TYPE.meta }}>{items.map(([label, color]) => <li key={label}
      style={{ display: 'flex', alignItems: 'center', gap: 6 }}><span aria-hidden="true" style={{ width: 16, borderTop: `2px solid ${color}` }} />{label}</li>)}</ul>;
}
const NODE_NAMES: Readonly<Record<WebFlowNodeId, string>> = {
  refine: 'Refine', implement: 'Implement', rebase: 'Rebase', 'rebase-resolve': 'Resolve rebase',
  'declared-gates': 'Declared gates', 'integration-tests': 'Integration tests', 'agent-review': 'Agent review',
  'human-review': 'Human request', 'automated-join': 'Automated join', 'human-verdict': 'Verdict and landing', landed: 'Landed', lead: 'px lead',
};
function GraphDescription({ flow, lead }: { readonly flow: WebFlowWindow; readonly lead: boolean }) {
  const verification = flow.graph.verification;
  return <div className="flow-visually-hidden" style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>
    <h3>Flow graph as text</h3>{verification && <p>{`Configured ${verification.configured?.kind ?? 'unobserved'} policy${verification.configured?.kind === 'fixed' ? ` (${verification.configured.fallbackReason ?? 'reason unavailable'})` : ''}; ${verification.concurrentRounds} concurrent rounds of ${verification.observedRounds} observed, ${verification.joinedRounds} joined. ${verification.pilotApprovedMissions} delivered missions with a verified pilot approval. Exceptions: ${verification.exceptions.interrupted} interrupted, ${verification.exceptions.revisionDrift} revision drift, ${verification.exceptions.handoff} handoff, ${verification.exceptions.humanCorrection} recognized human correction.`}</p>}
    <ul>{flow.graph.nodes.filter(node => node.id !== 'lead' || lead).map(node => <li key={node.id}>{NODE_NAMES[node.id]}: {node.count}{node.rework === null ? '' : ` including ${node.rework} rework`}; observed for {node.observedMissions} of {node.population} missions.</li>)}</ul>
    <ul>{flow.graph.edges.filter(edge => edge.count > 0 || keepEmpty(edge)).map(edge => <li key={edge.id}>
      {edge.from ? NODE_NAMES[edge.from] : 'Unrecorded stage'} to {NODE_NAMES[edge.to]} ({isSequentialAgentReview(edge) ? 'sequential' : edge.kind.replaceAll('-', ' ')}): {edge.count}; observed denominator {edge.observedMissions} of {edge.population} missions{edge.stage ? `; retained stage ${edge.stage}` : ''}.</li>)}</ul>
  </div>;
}
