/**
 * Flow by actor: the Mission flow swimlane graph. Node positions and edge
 * routes are fixed by the semantic topology (stable node and edge identities),
 * so variable counts, long labels and sparse history never move a node. Every
 * count and share is the projection's; this module only lays them out. Empty
 * gate and rebase routes remain visible as 0% · 0 so sparse cohorts keep the topology.
 */
import type { WebFlowEdge, WebFlowLane, WebFlowNode, WebFlowNodeId, WebFlowWindow } from '../../src/interfaces/web/transport.js';
import { FLOW, FLOW_TYPE } from './palette.js';
import { LANE_STYLE, NODE_TEXT, laneTitle, minutesText, percentText } from './flow-format.js';

/** Graph canvas geometry in panel pixels at the reference's native desktop size. */
const PANEL_WIDTH = 1232;
const LANE_LEFT = 22;
const LANE_RIGHT = 1195;
const LANE_HEIGHT = 93;
const MAIN_HEIGHT = 65;
const FIRST_LANE_TOP = 101;
const LANE_ORDER: readonly WebFlowLane[] = ['refine-agent', 'implement-agent', 'parallix', 'review-agent', 'human', 'lead', 'main'];

type Box = { readonly x: number; readonly y: number; readonly w: number; readonly h: number };
type Point = readonly [number, number];

/** Node boxes relative to the node's lane top (y) and the panel (x). */
const NODE_BOX: Readonly<Record<WebFlowNodeId, Box>> = {
  refine: { x: 165, y: 14, w: 126, h: 51 },
  implement: { x: 165, y: 12, w: 145, h: 68 },
  'pre-review-resolve': { x: 407, y: 22, w: 107, h: 50 },
  'pre-review-rebase': { x: 310, y: 22, w: 81, h: 50 },
  'declared-gates': { x: 541, y: 22, w: 98, h: 50 },
  'agent-review': { x: 684, y: 22, w: 115, h: 60 },
  'human-review': { x: 810, y: 22, w: 107, h: 50 },
  'integration-rebase': { x: 944, y: 22, w: 83, h: 50 },
  'integration-resolve': { x: 944, y: 22, w: 107, h: 50 },
  'integration-gates': { x: 1066, y: 22, w: 129, h: 50 },
  landed: { x: 1070, y: 16, w: 125, h: 35 },
  lead: { x: 810, y: 22, w: 107, h: 50 },
};
const WRAPPED_NODE_TITLES = new Set<WebFlowNodeId>(['declared-gates', 'agent-review', 'human-review']);

type Layout = { readonly lanes: readonly { lane: WebFlowLane; top: number; height: number }[]; readonly height: number;
  readonly node: (id: WebFlowNodeId) => Box };

function layout(lead: boolean, nodes: readonly WebFlowNode[]): Layout {
  let top = FIRST_LANE_TOP;
  const lanes = LANE_ORDER.filter(lane => lead || lane !== 'lead').map(lane => {
    const height = lane === 'main' ? MAIN_HEIGHT : LANE_HEIGHT;
    const row = { lane, top, height };
    top += height;
    return row;
  });
  const laneTop = (lane: WebFlowLane) => lanes.find(row => row.lane === lane)?.top ?? FIRST_LANE_TOP;
  const byId = new Map(nodes.map(node => [node.id, node]));
  return { lanes, height: top + 29,
    node: id => {
      const box = NODE_BOX[id], node = byId.get(id);
      const covered = node && node.observedMissions < node.population && !['refine', 'implement', 'landed'].includes(id);
      const h = Math.max(box.h, WRAPPED_NODE_TITLES.has(id) ? covered ? 80 : 65 : covered ? 65 : box.h);
      const y = h > LANE_HEIGHT - box.y ? Math.max(6, Math.floor((LANE_HEIGHT - h) / 2)) : box.y;
      return { ...box, h, y: laneTop(NODE_LANE[id]) + y };
    } };
}

const NODE_LANE: Readonly<Record<WebFlowNodeId, WebFlowLane>> = {
  refine: 'refine-agent', implement: 'implement-agent', 'pre-review-resolve': 'implement-agent', 'integration-resolve': 'implement-agent',
  'pre-review-rebase': 'parallix', 'declared-gates': 'parallix', 'integration-rebase': 'parallix', 'integration-gates': 'parallix',
  'agent-review': 'review-agent', 'human-review': 'human', landed: 'main', lead: 'lead',
};

const NODE_ACCENT: Readonly<Record<WebFlowNodeId, string>> = {
  refine: FLOW.refine, implement: FLOW.amber, 'pre-review-resolve': FLOW.amber, 'integration-resolve': FLOW.amber,
  'pre-review-rebase': FLOW.rebase, 'integration-rebase': FLOW.rebase, 'declared-gates': FLOW.cyan, 'integration-gates': FLOW.cyan,
  'agent-review': FLOW.purple, 'human-review': FLOW.red, landed: FLOW.blue, lead: FLOW.lead,
};

const EDGE_STYLE: Readonly<Record<WebFlowEdge['kind'], { readonly color: string; readonly label: string; readonly dash?: string }>> = {
  flow: { color: FLOW.flow, label: FLOW.flowLabel },
  clean: { color: FLOW.flow, label: FLOW.flowLabel },
  'gate-failed': { color: FLOW.cyan, label: FLOW.cyanText },
  'agent-findings': { color: FLOW.purple, label: FLOW.purpleText },
  'human-changes': { color: FLOW.red, label: FLOW.redText },
  'rebase-conflict': { color: FLOW.rebase, label: FLOW.rebase },
  'rebase-repeat': { color: FLOW.rebase, label: FLOW.rebase },
  'rebase-failed': { color: FLOW.rebase, label: FLOW.rebase, dash: '6 5' },
  'workflow-return': { color: FLOW.flow, label: FLOW.control, dash: '3 3' },
  'lead-escalation': { color: FLOW.lead, label: FLOW.leadText, dash: '6 5' },
};

type EdgeRoute = { points: readonly Point[]; label: Point; suffix?: string; suffixLabel?: Point; loop?: boolean };

/** Route and label anchor for each semantic edge, from the node boxes so a moved lane moves its edges. */
function route(edge: WebFlowEdge, at: Layout['node']): EdgeRoute | null {
  const b = (id: WebFlowNodeId) => at(id);
  const id = `${edge.from ?? 'unrecorded'}->${edge.to}:${edge.kind}`;
  return routeBeforeIntegration(id, b) ?? routeIntegration(id, b);
}

function routeBeforeIntegration(id: string, b: Layout['node']): EdgeRoute | null {
  const r = b('refine'), i = b('implement'), pr = b('pre-review-rebase'), ps = b('pre-review-resolve'), dg = b('declared-gates');
  const ar = b('agent-review'), hr = b('human-review'), ir = b('integration-rebase');
  const failedJoin: Point = [894, ps.y + 12];
  switch (id) {
    case 'refine->implement:flow': return { points: [[191, r.y + r.h], [191, i.y]], label: [203, r.y + r.h + 17], suffix: 'refined' };
    case 'implement->pre-review-rebase:flow': return { points: [[i.x + i.w, i.y + 27], [337, i.y + 27], [337, pr.y]], label: [-1, -1] };
    case 'pre-review-rebase->declared-gates:clean': return { points: [[pr.x + pr.w, pr.y + 24], [dg.x, pr.y + 24]], label: [415, pr.y + 8], suffix: 'clean' };
    case 'pre-review-rebase->pre-review-resolve:rebase-conflict': return { points: [[364, pr.y], [364, ps.y + 32], [ps.x, ps.y + 32]], label: [375, ps.y + 49] };
    case 'pre-review-rebase->human-review:rebase-failed': return { points: [[pr.x + 8, pr.y + pr.h], [pr.x + 8, hr.y + 24], [hr.x, hr.y + 24]], label: [pr.x + 14, hr.y + 8] };
    case 'pre-review-resolve->pre-review-resolve:rebase-repeat': return { points: [[ps.x + 35, ps.y], [ps.x + 35, ps.y - 16], [ps.x + 71, ps.y - 16], [ps.x + 71, ps.y]], label: [ps.x + 77, ps.y - 14], loop: true };
    case 'pre-review-resolve->declared-gates:flow': return { points: [[ps.x + ps.w, ps.y + 39], [589, ps.y + 39], [589, dg.y]], label: [600, ps.y + 64] };
    case 'pre-review-resolve->human-review:rebase-failed': return { points: [[ps.x + ps.w, ps.y + 12], failedJoin, [894, hr.y]], label: [648, ps.y - 3] };
    case 'declared-gates->agent-review:flow': return { points: [[dg.x + dg.w, pr.y + 24], [738, pr.y + 24], [738, ar.y]], label: [748, pr.y + 57] };
    case 'declared-gates->implement:gate-failed': return { points: [[589, dg.y + dg.h], [589, dg.y + 60], [245, dg.y + 60], [245, i.y + i.h]], label: [416, dg.y + 46] };
    case 'agent-review->human-review:flow': return { points: [[ar.x + ar.w, ar.y + 25], [863, ar.y + 25], [863, hr.y]], label: [798, ar.y + 63] };
    case 'agent-review->implement:agent-findings': return { points: [[ar.x, ar.y + 25], [218, ar.y + 25], [218, i.y + i.h]], label: [290, ar.y + 7] };
    case 'human-review->integration-rebase:flow': return { points: [[hr.x + hr.w, hr.y + 24], [970, hr.y + 24], [970, ir.y + ir.h]], label: [982, hr.y - 55] };
    case 'human-review->implement:human-changes': return { points: [[hr.x, hr.y + 24], [191, hr.y + 24], [191, i.y + i.h]], label: [290, hr.y + 7] };
    default: return null;
  }
}

function routeIntegration(id: string, b: Layout['node']): EdgeRoute | null {
  const i = b('implement'), ps = b('pre-review-resolve'), dg = b('declared-gates'), hr = b('human-review');
  const ir = b('integration-rebase'), is = b('integration-resolve'), ig = b('integration-gates'), ld = b('landed');
  const failedJoin: Point = [894, ps.y + 12];
  switch (id) {
    case 'integration-rebase->integration-gates:clean': return { points: [[ir.x + ir.w, ir.y + 24], [ig.x, ir.y + 24]],
      label: [1026, ir.y - 11], suffix: 'clean', suffixLabel: [1028, ir.y + 32] };
    case 'integration-rebase->integration-resolve:rebase-conflict': return { points: [[997, ir.y], [997, is.y + is.h]], label: [1008, is.y + 64] };
    case 'integration-rebase->human-review:rebase-failed': return { points: [[ir.x + 8, ir.y + ir.h], [ir.x + 8, hr.y + 12], [hr.x + hr.w, hr.y + 12]], label: [ir.x + 14, hr.y - 8] };
    case 'integration-resolve->integration-resolve:rebase-repeat': return { points: [[is.x + 35, is.y], [is.x + 35, is.y - 16], [is.x + 71, is.y - 16], [is.x + 71, is.y]], label: [is.x + 77, is.y - 14], loop: true };
    case 'integration-resolve->integration-gates:flow': return { points: [[is.x + is.w, is.y + 39], [1104, is.y + 39], [1104, ig.y]], label: [1115, is.y + 64] };
    case 'integration-resolve->human-review:rebase-failed': return { points: [[is.x, is.y + 12], failedJoin], label: [902, is.y - 3] };
    case 'integration-gates->landed:flow': return { points: [[1132, ig.y + ig.h], [1132, ld.y]], label: [1143, ig.y + 159] };
    case 'integration-gates->implement:gate-failed': return { points: [[ig.x + ig.w, ig.y + 24], [1210, ig.y + 24], [1210, i.y - 16], [i.x + i.w - 5, i.y - 16], [i.x + i.w - 5, i.y]], label: [840, i.y - 34] };
    case 'unrecorded->implement:workflow-return': return { points: [[299, dg.y + 79], [299, i.y + i.h]], label: [307, dg.y + 73], suffix: 'stage not recorded' };
    case 'lead->human-review:lead-escalation': { const l = b('lead'); return { points: [[l.x + 54, l.y], [l.x + 54, hr.y + hr.h]], label: [l.x + 62, l.y - 22], suffix: 'escalated' }; }
    default: return null;
  }
}

function edgeText(edge: WebFlowEdge, suffix?: string): string {
  const countSuffix = edge.kind === 'gate-failed' ? 'returns' : suffix;
  const count = `${edge.count}${countSuffix ? ` ${countSuffix}` : ''}`;
  return edge.percentage === null ? count : `${edge.percentage}% · ${count}`;
}

function nodeLines(node: WebFlowNode): { readonly title: string; readonly detail: string; readonly coverage?: string } {
  const text = NODE_TEXT[node.id];
  const coverage = node.observedMissions < node.population ? `${node.observedMissions}/${node.population} obs` : undefined;
  if (node.id === 'refine') { return { title: `${text.title} · ${node.count}`, detail: text.unit, coverage }; }
  if (node.id === 'implement') { return { title: `${text.title} · ${node.count}`, detail: `${node.population} + ${node.rework ?? 0} ${text.unit}` }; }
  if (node.id === 'landed') { return { title: text.title, detail: String(node.count) }; }
  if (node.id === 'integration-gates') { return { title: text.title, detail: `${text.unit} · ${node.count} runs`, coverage }; }
  return { title: text.title, detail: `${node.count} ${text.unit}`, coverage };
}

function Arrow({ points, color, dash, id, empty, origin }: { points: readonly Point[]; color: string; dash?: string; id: string; empty: boolean; origin: boolean }) {
  const [x, y] = points.at(-1)!, [px, py] = points.at(-2)!;
  const angle = Math.atan2(y - py, x - px);
  const head = (spread: number) => `${(x - 7 * Math.cos(angle) + spread * Math.sin(angle)).toFixed(1)},${(y - 7 * Math.sin(angle) - spread * Math.cos(angle)).toFixed(1)}`;
  return <g data-flow-edge={id} opacity={empty ? 0.48 : 1}>
    {origin && <circle data-flow-edge-origin={id} cx={points[0]![0]} cy={points[0]![1]} r={4} fill={FLOW.surface} stroke={color} strokeWidth="1.5" />}
    <polyline points={points.map(([a, b]) => `${a},${b}`).join(' ')} fill="none" stroke={color} strokeWidth="1.5" strokeDasharray={dash} />
    <polygon points={`${x},${y} ${head(4)} ${head(-4)}`} fill={color} />
  </g>;
}

export function FlowGraph({ flow, lanes }: { readonly flow: WebFlowWindow; readonly lanes: readonly WebFlowWindow['time']['lanes'][number][] }) {
  const lead = flow.graph.nodes.some(node => node.id === 'lead') || lanes.some(lane => lane.lane === 'lead' && lane.totalMs > 0);
  const nodes = flow.graph.nodes.filter(node => node.id !== 'lead' || lead);
  const geometry = layout(lead, nodes);
  const keepEmpty = (edge: WebFlowEdge) => edge.kind === 'gate-failed' || edge.kind === 'rebase-conflict'
    || edge.kind === 'rebase-repeat' || edge.kind === 'clean'
    || (edge.kind === 'flow' && (edge.from === 'pre-review-resolve' || edge.from === 'integration-resolve'));
  const drawn = flow.graph.edges.flatMap(edge => {
    const path = edge.count > 0 || keepEmpty(edge) ? route(edge, geometry.node) : null;
    return path ? [{ edge, path }] : [];
  });
  const edgeStyle = (edge: WebFlowEdge) => edge.kind === 'flow'
    && (edge.from === 'pre-review-resolve' || edge.from === 'integration-resolve')
    ? { ...EDGE_STYLE.flow, color: FLOW.rebase, label: FLOW.rebase } : EDGE_STYLE[edge.kind];
  const laneStat = (lane: WebFlowLane) => {
    if (lane === 'main') { return null; }
    const time = lanes.find(row => row.lane === lane);
    if (lane === 'refine-agent') {
      const refined = flow.stateDwell.find(state => state.state === 'refined');
      return refined && refined.n > 0 ? `median ${minutesText(refined.medianMs)} queued` : 'queue not observed';
    }
    if (!time || time.totalMs === 0) { return 'no time observed'; }
    if (lane === 'lead') { return `${minutesText(time.waitingMs)} queued · ${minutesText(time.workingMs)} recovering`; }
    return `avg ${minutesText(time.totalMs)} · ${percentText(time.share)}`;
  };
  return <section aria-labelledby="flow-graph-title" data-flow-region="graph"
    style={{ background: FLOW.surface, border: `1px solid ${FLOW.surfaceEdge}`, borderRadius: 10, marginTop: 21, overflowX: 'auto' }}>
    <div style={{ position: 'relative', width: PANEL_WIDTH - 2, height: geometry.height - 2 }}>
      <h2 id="flow-graph-title" style={{ position: 'absolute', left: 21, top: 18, margin: 0, color: FLOW.text, fontSize: FLOW_TYPE.heading, fontWeight: 700, whiteSpace: 'nowrap' }}>
        Flow by actor · Parallix rebases onto main before every gate run
      </h2>
      <Legend />
      {geometry.lanes.map((row, index) => {
        const time = lanes.find(value => value.lane === row.lane);
        const style = LANE_STYLE[row.lane];
        return <div key={row.lane} data-flow-lane={row.lane} style={{ position: 'absolute', left: LANE_LEFT - 1, top: row.top - 1, width: LANE_RIGHT - LANE_LEFT + 1, height: row.height,
          borderTop: `1px solid ${FLOW.laneRule}`, borderBottom: index === geometry.lanes.length - 1 ? `1px solid ${FLOW.laneRule}` : undefined,
          background: index % 2 === 1 ? FLOW.band : 'transparent' }}>
          <div style={{ position: 'absolute', left: 14, top: 13, width: 118, fontSize: FLOW_TYPE.meta, lineHeight: '17px' }}>
            <div style={{ color: FLOW.text, fontWeight: 700, fontSize: FLOW_TYPE.body }}>{laneTitle(row.lane, time?.families ?? [])}</div>
            <div style={{ color: FLOW.muted }}>{style.role}</div>
            {laneStat(row.lane) && <div style={{ color: style.text }}>{laneStat(row.lane)}</div>}
          </div>
        </div>;
      })}
      <svg aria-hidden="true" width={PANEL_WIDTH - 2} height={geometry.height - 2} style={{ position: 'absolute', left: -1, top: -1, overflow: 'visible' }}>
        {drawn.map(({ edge, path }) => <Arrow key={edge.id} id={edge.id} points={path.points} color={edgeStyle(edge).color} dash={edgeStyle(edge).dash} empty={edge.count === 0} origin={edge.from === null} />)}
        {drawn.some(({ edge }) => edge.kind === 'rebase-failed' && edge.from !== 'pre-review-rebase' && edge.from !== 'integration-rebase')
          && <circle cx={894} cy={geometry.node('pre-review-resolve').y + 12} r={3.5} fill={FLOW.rebase} />}
      </svg>
      {nodes.map(node => {
        const box = geometry.node(node.id), lines = nodeLines(node), landed = node.id === 'landed';
        return <div key={node.id} data-flow-node={node.id} style={{ position: 'absolute', left: box.x - 1, top: box.y - 1, width: box.w, height: box.h, overflow: 'hidden',
          boxSizing: 'border-box', padding: landed ? '8px 10px' : '7px 10px 8px', borderRadius: 6, background: landed ? FLOW.landedNode : FLOW.node,
          border: `1px solid ${FLOW.nodeEdge}`, borderTop: `2px solid ${NODE_ACCENT[node.id]}`, fontSize: FLOW_TYPE.meta, lineHeight: '15px' }}>
          {landed
            ? <div style={{ color: FLOW.bright, fontWeight: 700, fontSize: FLOW_TYPE.heading }}>{lines.title} <span style={{ color: FLOW.blueText, fontWeight: 400, fontSize: FLOW_TYPE.meta }}>· {lines.detail}</span></div>
            : <><div style={{ color: FLOW.bright, fontWeight: 700, fontSize: FLOW_TYPE.heading }}>{lines.title}</div>
              <div style={{ color: FLOW.control, whiteSpace: 'nowrap', fontSize: node.id === 'implement' ? FLOW_TYPE.micro : FLOW_TYPE.meta }}>{lines.detail}</div>
              {lines.coverage && <div style={{ color: FLOW.muted, whiteSpace: 'nowrap', fontSize: FLOW_TYPE.micro }}>{lines.coverage}</div>}</>}
        </div>;
      })}
      {drawn.flatMap(({ edge, path }) => path.label[0] < 0 ? [] : [<span key={`${edge.id}:label`} data-flow-edge-label={edge.id} aria-hidden="true"
        style={{ position: 'absolute', left: path.label[0] - 1, top: path.label[1] - 1, color: edgeStyle(edge).label, fontSize: FLOW_TYPE.meta,
          lineHeight: '15px', whiteSpace: 'nowrap', fontWeight: 700 }}>{path.loop ? '↻ ' : ''}{edgeText(edge, path.suffixLabel ? undefined : path.suffix)}</span>,
        ...(path.suffixLabel && path.suffix ? [<span key={`${edge.id}:suffix`} data-flow-edge-suffix={edge.id} aria-hidden="true"
          style={{ position: 'absolute', left: path.suffixLabel[0] - 1, top: path.suffixLabel[1] - 1, color: edgeStyle(edge).label,
            fontSize: FLOW_TYPE.meta, lineHeight: '15px', whiteSpace: 'nowrap', fontWeight: 700 }}>{path.suffix}</span>] : [])])}
    </div>
    <GraphDescription flow={flow} lead={lead} />
  </section>;
}

function Legend() {
  const items: readonly [string, string, string?][] = [['gate failed', FLOW.cyan], ['agent review findings', FLOW.purple],
    ['human changes requested', FLOW.red], ['rebase conflict', FLOW.rebase], ['rebase failed', FLOW.rebase, 'dash']];
  return <ul aria-label="Edge colours" style={{ position: 'absolute', left: 21, top: 44, margin: 0, padding: 0, listStyle: 'none', display: 'flex', gap: 16,
    color: FLOW.control, fontSize: FLOW_TYPE.meta, whiteSpace: 'nowrap' }}>
    {items.map(([label, color, dash]) => <li key={label} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <span aria-hidden="true" style={{ width: dash ? 14 : 16, borderTop: `${dash ? 1.5 : 2}px ${dash ? 'dashed' : 'solid'} ${color}` }} />{label}
    </li>)}
  </ul>;
}

const NODE_NAMES: Readonly<Record<WebFlowNodeId, string>> = {
  refine: 'Refine', implement: 'Implement', 'pre-review-rebase': 'Rebase before review', 'pre-review-resolve': 'Resolve before review',
  'declared-gates': 'Declared gates', 'agent-review': 'Agent review', 'human-review': 'Human review',
  'integration-rebase': 'Rebase before integration', 'integration-resolve': 'Resolve before integration',
  'integration-gates': 'Integration gates', landed: 'Landed', lead: 'px lead',
};

/** The graph as sentences, for screen readers and for anyone who copies it. */
function GraphDescription({ flow, lead }: { readonly flow: WebFlowWindow; readonly lead: boolean }) {
  return <div className="flow-visually-hidden" style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap' }}>
    <h3>Flow graph as text</h3>
    <ul>{flow.graph.nodes.filter(node => node.id !== 'lead' || lead).map(node => <li key={node.id}>
      {NODE_NAMES[node.id]}: {node.count}{node.rework !== null ? ` including ${node.rework} rework` : ''}; observed for {node.observedMissions} of {node.population} missions.
    </li>)}</ul>
    <ul>{flow.graph.edges.filter(edge => edge.count > 0 || edge.kind === 'gate-failed' || edge.kind === 'rebase-conflict'
      || edge.kind === 'rebase-repeat' || edge.kind === 'clean'
      || (edge.kind === 'flow' && (edge.from === 'pre-review-resolve' || edge.from === 'integration-resolve'))).map(edge => <li key={edge.id}>
      {edge.from ? NODE_NAMES[edge.from] : 'An unrecorded stage'} to {NODE_NAMES[edge.to]} ({edge.kind.replace('-', ' ')}): {edge.count}{edge.kind === 'gate-failed' ? ' typed returns' : ''}{edge.percentage === null ? '' : edge.kind === 'gate-failed' ? `, ${edge.percentage}% of settled gate runs failed` : `, ${edge.percentage}% of outcomes`}.
    </li>)}</ul>
  </div>;
}
