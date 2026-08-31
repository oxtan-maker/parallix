import type { WebBoardMetrics } from '../../src/interfaces/web/transport.js';
import { C, DISPLAY } from './palette.js';

const CHART_WIDTH = 430;
const CHART_HEIGHT = 112;
const LANE_COLORS: Readonly<Record<string, string>> = {
  done: C.green, integration: C.cyan, review: C.purple, active: C.amber,
  backlog: '#33404b', refined: '#2c4735',
};

function minutes(value: number | null): string {
  if (value === null) { return 'unavailable'; }
  if (value % 1440 === 0) { return `${value / 1440}d`; }
  if (value % 60 === 0) { return `${value / 60}h`; }
  return `${value}m`;
}

function CumulativeFlow({ metrics }: { readonly metrics: WebBoardMetrics }) {
  const window = metrics.flowWindow;
  const points = window === undefined
    ? metrics.cumulativeFlowByState.series
    : metrics.cumulativeFlowByState.series.filter((point) => point.at.slice(0, 10) >= window.startDate && point.at.slice(0, 10) <= window.endDate);
  if (points.length === 0) {
    return <div style={{ color: C.faint, fontSize: 11 }}>history {metrics.cumulativeFlowByState.missingHistoryFallback}</div>;
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
    <svg aria-label="Cumulative flow chart" width={CHART_WIDTH} height={CHART_HEIGHT} style={{ display: 'block', border: `1px solid ${C.rule}`, borderRadius: 3, background: '#08090b' }}>
      {layers}<line x1="0" y1={CHART_HEIGHT - 0.5} x2={CHART_WIDTH} y2={CHART_HEIGHT - 0.5} stroke={C.cardEdge} />
    </svg>
    <div style={{ display: 'flex', gap: 13, marginTop: 6 }}>
      {[...lanes].reverse().map((lane) => <span key={lane} style={{ color: C.dim, fontSize: 10, whiteSpace: 'nowrap' }}><span style={{ color: LANE_COLORS[lane] ?? C.faint }}>■</span> {lane}</span>)}
    </div>
  </>;
}

export function FlowPanel({ metrics }: { readonly metrics: WebBoardMetrics }) {
  const throughput = metrics.weeklyThroughput.series.at(-1);
  const cycle = metrics.medianCycleTimeByState.series.filter((point) => point.value !== null);
  const longest = Math.max(1, ...cycle.map((point) => point.value!));
  return <section id="flow-metrics" aria-label="FLOW metrics" style={{ display: 'flex', gap: 26, padding: '14px 18px', borderBottom: `1px solid ${C.rule}`, background: C.panel, flexShrink: 0, alignItems: 'flex-start', overflowX: 'auto' }}>
    <div style={{ flexShrink: 0 }}>
      <h2 style={{ color: C.dim, fontFamily: DISPLAY, fontSize: 10, fontWeight: 400, letterSpacing: 2, margin: '0 0 7px' }}>CUMULATIVE FLOW · {metrics.flowWindow?.label ?? 'RECORDED HISTORY'}</h2>
      <CumulativeFlow metrics={metrics} />
    </div>
    <div style={{ minWidth: 270, flexShrink: 0 }}>
      <h2 style={{ color: C.dim, fontFamily: DISPLAY, fontSize: 10, fontWeight: 400, letterSpacing: 2, margin: '0 0 9px' }}>MEDIAN TIME IN STATE</h2>
      {cycle.length === 0 ? <div style={{ color: C.faint, fontSize: 11 }}>history {metrics.medianCycleTimeByState.missingHistoryFallback}</div> : cycle.map((point) => {
        const color = point.value === longest ? C.amber : C.greenEdge;
        return <div key={point.lane} style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 6 }}>
          <span style={{ width: 62, color: C.dim, fontSize: 10, textAlign: 'right' }}>{point.lane}</span>
          <span style={{ display: 'inline-block', height: 9, borderRadius: 2, width: `${Math.round(point.value! / longest * 145)}px`, background: color }} />
          <span style={{ color, fontSize: 10 }}>{minutes(point.value)} (n={point.observationCount ?? 0})</span>
        </div>;
      })}
    </div>
    <div style={{ maxWidth: 300, borderLeft: `1px solid ${C.rule}`, paddingLeft: 16, flexShrink: 0 }}>
      <h2 style={{ color: C.dim, fontFamily: DISPLAY, fontSize: 10, fontWeight: 400, letterSpacing: 2, margin: '0 0 7px' }}>READ</h2>
      <div style={{ color: C.muted, fontSize: 11, lineHeight: 1.6 }}>weekly throughput: {throughput?.value ?? 'unavailable'} (n={throughput?.observationCount ?? 0}) · {metrics.weeklyThroughput.missingHistoryFallback}</div>
      <div style={{ color: C.muted, fontSize: 11, lineHeight: 1.6 }}>{metrics.bottleneck.sentence}</div>
      <div style={{ color: C.faint, fontSize: 10, marginTop: 6 }}>statistics {metrics.health.state} · population n={metrics.provenance.sampleSize}</div>
    </div>
  </section>;
}
