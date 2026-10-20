import type { WebBoardMetrics } from '../../src/interfaces/web/transport.js';
import { C, DISPLAY, RADIUS, SPACE, TRACK, TYPE } from './palette.js';

const CHART_WIDTH = 430;
const CHART_HEIGHT = 112;
// Lane fills carry lane identity, not status: the shipped lane is a recorded
// fact and the earliest lane has no status of its own, so neither borrows the
// reserved action/gate green.
const LANE_COLORS: Readonly<Record<string, string>> = {
  done: C.done, integration: C.cyan, review: C.purple, active: C.amber,
  backlog: C.chartLane, refined: C.chartQuiet,
};

function minutes(value: number | null): string {
  if (value === null) { return 'unavailable'; }
  value = Math.round(value);
  if (value === 0) { return '0m'; }
  if (value % 1440 === 0) { return `${value / 1440}d`; }
  if (value % 60 === 0) { return `${value / 60}h`; }
  return `${value}m`;
}

function CumulativeFlow({ metrics }: { readonly metrics: WebBoardMetrics }) {
  // The projection owns the reporting week: when it publishes the weekly
  // series, these are exactly the points drawn — no filtering, no subtraction,
  // no lane transition inferred here.
  const flow = metrics.weeklyCumulativeFlow ?? metrics.cumulativeFlowByState;
  const points = flow.series;
  if (points.length === 0) {
    return <div style={{ color: C.faint, fontSize: TYPE.meta }}>history {flow.missingHistoryFallback}</div>;
  }
  const lanes = Object.keys(points[0]!.counts);
  const max = Math.max(1, ...points.map((point) => Object.values(point.counts).reduce((total, count) => total + count, 0)));
  const base = points.map(() => 0);
  const layers = lanes.map((lane) => {
    const top = points.map((point, index) => base[index]! + (point.counts[lane] ?? 0));
    const up = top.map((count, index) => `${(index * CHART_WIDTH / Math.max(1, points.length - 1)).toFixed(1)},${(CHART_HEIGHT - count * CHART_HEIGHT / max).toFixed(1)}`);
    const down = base.map((count, index) => `${(index * CHART_WIDTH / Math.max(1, points.length - 1)).toFixed(1)},${(CHART_HEIGHT - count * CHART_HEIGHT / max).toFixed(1)}`).reverse();
    base.splice(0, base.length, ...top);
    return <polygon key={lane} points={[...up, ...down].join(' ')} fill={LANE_COLORS[lane] ?? C.faint} opacity="0.8" />;
  });
  return <>
    <svg aria-label="Cumulative flow chart" width={CHART_WIDTH} height={CHART_HEIGHT} style={{ display: 'block', border: `1px solid ${C.rule}`, borderRadius: RADIUS.control, background: C.log }}>
      {layers}<line x1="0" y1={CHART_HEIGHT - 0.5} x2={CHART_WIDTH} y2={CHART_HEIGHT - 0.5} stroke={C.cardEdge} />
    </svg>
    <div style={{ display: 'flex', gap: SPACE.xl, marginTop: SPACE.sm }}>
      {[...lanes].reverse().map((lane) => <span key={lane} style={{ color: C.dim, fontSize: TYPE.micro, whiteSpace: 'nowrap' }}><span style={{ color: LANE_COLORS[lane] ?? C.faint }}>■</span> {lane}</span>)}
    </div>
  </>;
}

export function FlowPanel({ metrics }: { readonly metrics: WebBoardMetrics }) {
  const cycle = metrics.medianCycleTimeByState.series.filter((point) => point.value !== null);
  const longest = Math.max(1, ...cycle.map((point) => point.value!));
  const total = cycle.reduce((sum, point) => sum + point.value!, 0);
  return <section id="flow-metrics" aria-label="FLOW metrics" style={{ display: 'flex', gap: 26, padding: `${SPACE.xl}px ${SPACE.xxl}px`, borderBottom: `1px solid ${C.rule}`, background: C.panel, flexShrink: 0, alignItems: 'flex-start', overflowX: 'auto' }}>
    <div style={{ flexShrink: 0 }}>
      <h2 style={{ color: C.dim, fontFamily: DISPLAY, fontSize: TYPE.micro, fontWeight: 400, letterSpacing: TRACK.display, margin: `0 0 ${SPACE.md}px` }}>CUMULATIVE FLOW · {metrics.weeklyCumulativeFlow?.window.label ?? 'RECORDED HISTORY'}</h2>
      {metrics.weeklyCumulativeFlow && <div style={{ color: C.faint, fontSize: TYPE.micro, marginBottom: SPACE.sm }}>Local calendar days · current period live</div>}
      <CumulativeFlow metrics={metrics} />
    </div>
    <div style={{ minWidth: 270, flexShrink: 0 }}>
      <h2 style={{ color: C.dim, fontFamily: DISPLAY, fontSize: TYPE.micro, fontWeight: 400, letterSpacing: TRACK.display, margin: `0 0 ${SPACE.md}px` }}>MEDIAN TIME IN STATE</h2>
      {cycle.length === 0 ? <div style={{ color: C.faint, fontSize: TYPE.meta }}>history {metrics.medianCycleTimeByState.missingHistoryFallback}</div> : cycle.map((point) => {
        const color = point.value === longest ? C.amber : C.dim;
        return <div key={point.lane} style={{ display: 'flex', alignItems: 'center', gap: SPACE.md, marginBottom: SPACE.sm }}>
          <span style={{ width: 62, color: C.dim, fontSize: TYPE.micro, textAlign: 'right' }}>{point.lane}</span>
          <span style={{ display: 'inline-block', height: 9, borderRadius: RADIUS.chip, width: `${Math.round(point.value! / longest * 145)}px`, background: color }} />
          <span style={{ color, fontSize: TYPE.micro }}>{minutes(point.value)} (n={Math.round(point.observationCount ?? 0)})</span>
        </div>;
      })}
      {cycle.length > 0 && <div style={{ display: 'flex', alignItems: 'baseline', gap: SPACE.md, marginTop: SPACE.lg, paddingTop: SPACE.md, borderTop: `1px solid ${C.rule}` }}>
        <span style={{ width: 62, color: C.dim, fontSize: TYPE.micro, textAlign: 'right' }}>cycle time</span>
        <span style={{ color: C.text, fontSize: TYPE.figure, fontWeight: 500 }}>{minutes(total)}</span>
        <span style={{ color: C.faint, fontSize: TYPE.micro }}>refined → done, median</span>
      </div>}
    </div>
  </section>;
}
