/**
 * Mission flow: the board's Flow view. It renders the shared typed FLOW
 * projection (`metrics.flow`) for one visible cohort — every agent or one
 * concrete implementer family, the current or the previous delivery window —
 * and never recomputes a count, rate, interval or attribution. Missing data
 * stays visible: an unavailable projection, unobserved nodes and the
 * projection's collection defects are shown, never zeroed or hidden.
 */
import { useState } from 'react';
import type { WebBoardSnapshot, WebFlowWindow } from '../../src/interfaces/web/transport.js';
import { FLOW, FLOW_TYPE } from './palette.js';
import { FlowGraph } from './flow-graph.js';
import { FlowTimeTable, segment, type FlowSort } from './flow-time-table.js';
import { hoursText, laneTitle, percentText, windowText } from './flow-format.js';
import { ViewNav, type BoardView } from './top-bar.js';

const CONTENT_WIDTH = 1232;

function FlowHeader({ snapshot, chip, onNavigate }: { readonly snapshot: WebBoardSnapshot; readonly chip: string; readonly onNavigate: (view: BoardView) => void }) {
  const throughput = snapshot.metrics.weeklyCompletedMissions;
  return <header style={{ display: 'flex', alignItems: 'center', height: 62, boxSizing: 'border-box', padding: '0 31px 0 28px', background: FLOW.header,
    borderBottom: `1px solid ${FLOW.surfaceEdge}`, flexShrink: 0, gap: 0, whiteSpace: 'nowrap', overflowX: 'auto' }}>
    <h1 style={{ margin: 0, color: FLOW.bright, fontSize: FLOW_TYPE.wordmark, fontWeight: 700, letterSpacing: 3, textTransform: 'uppercase' }}>Parallix</h1>
    <div style={{ marginLeft: 23, color: FLOW.muted, fontSize: FLOW_TYPE.meta }}>
      @ {snapshot.repositoryId} · wip {snapshot.inFlightWip} · {throughput === undefined ? 'missions/wk unknown' : `${throughput} missions/wk`} · attention <span style={{ color: FLOW.amberText }}>{snapshot.attentionQueue.length}</span>
    </div>
    <div style={{ flex: 1, minWidth: 16 }} />
    <ViewNav view="flow" onNavigate={onNavigate} />
    <span data-flow-provenance style={{ marginLeft: 23, padding: '0 8px', height: 22, display: 'inline-flex', alignItems: 'center', borderRadius: 11,
      border: `1px dashed ${FLOW.controlEdge}`, color: FLOW.control, fontSize: FLOW_TYPE.meta }}>{chip}</span>
  </header>;
}

interface KpiProps { readonly label: string; readonly value: string; readonly unit?: string;
  readonly detail: string; readonly detailColor?: string }

function Kpi({ label, value, unit, detail, detailColor = FLOW.muted }: KpiProps) {
  return <li data-flow-kpi={label} style={{ boxSizing: 'border-box', height: 92, background: FLOW.surface, border: `1px solid ${FLOW.surfaceEdge}`, borderRadius: 8, padding: '14px 14px 12px', minWidth: 0 }}>
    <div style={{ color: FLOW.label, fontSize: FLOW_TYPE.micro, lineHeight: '12px', letterSpacing: 1, textTransform: 'uppercase', whiteSpace: 'nowrap' }}>{label}</div>
    <div style={{ marginTop: 8, lineHeight: '27px', color: FLOW.text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
      <span style={{ fontSize: FLOW_TYPE.figure, fontWeight: 700 }}>{value}</span>
      {unit && <span style={{ color: FLOW.muted, fontSize: FLOW_TYPE.body, marginLeft: 6 }}>{unit}</span>}
    </div>
    <div style={{ marginTop: 4, color: detailColor, fontSize: FLOW_TYPE.micro, lineHeight: '14px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{detail}</div>
  </li>;
}

const HOLDER: Readonly<Record<string, string>> = { human: 'You', parallix: 'Parallix', lead: 'px lead', external: 'Handoffs',
  'refine-agent': 'Refiners', 'implement-agent': 'Implementers', 'review-agent': 'Reviewers', main: 'main' };

function throughputKpi(flow: WebFlowWindow, previous: boolean): KpiProps {
  const change = flow.throughputChange;
  const detail = change === null ? (previous ? 'previous week' : 'no earlier week')
    : `${change >= 0 ? '▲' : '▼'} ${Math.abs(change)} vs prev`;
  return { label: 'Throughput', value: String(flow.completedMissions), unit: '/wk', detail,
    detailColor: change !== null && change > 0 ? FLOW.rise : FLOW.muted };
}

function cycleKpi(flow: WebFlowWindow): KpiProps {
  const cycle = flow.cycleTime;
  if (!cycle) { return { label: 'Cycle time', value: '—', detail: 'no refined-to-done interval' }; }
  return { label: 'Cycle time', value: hoursText(cycle.meanMs),
    detail: cycle.n < flow.completedMissions ? `average of ${cycle.n}, refined → done` : 'average, refined → done' };
}

function rateKpi(label: string, rate: WebFlowWindow['firstPassYield'], measured: string, empty: string, missing: string): KpiProps {
  if (rate.state === 'measured') {
    const detail = rate.coverage < 1
      ? `${rate.numerator}/${rate.denominator} · ${rate.observed}/${rate.population} measured` : measured;
    return { label, value: percentText(rate.value ?? 0), detail };
  }
  return { label, value: '—', detail: rate.state === 'no-eligible-population' ? empty : missing };
}

function extraJobsKpi(flow: WebFlowWindow): KpiProps {
  const extra = flow.extraAgentLaunches;
  return { label: 'Rework jobs', value: extra.reworkMeanPerMission === null ? '—' : extra.reworkMeanPerMission.toFixed(1),
    ...(extra.reworkMeanPerMission === null ? {} : { unit: '/mission' }),
    detail: extra.reworkJobs === null ? 'no return observations' : `${extra.reworkJobs} returns${extra.reworkN < flow.completedMissions ? ` · ${extra.reworkN}/${flow.completedMissions} measured` : ''}` };
}

function holderKpi(flow: WebFlowWindow): KpiProps {
  const holder = flow.time.lanes.find(lane => lane.lane === flow.time.largestLane);
  if (!holder) { return { label: 'Largest holder', value: '—', detail: 'no elapsed observations' }; }
  const value = holder.families.length === 1 ? laneTitle(holder.lane, holder.families) : HOLDER[holder.lane] ?? holder.lane;
  return { label: 'Largest holder', value, unit: `· ${percentText(holder.share)}`, detail: 'of observed work' };
}

function Kpis({ flow, previous }: { readonly flow: WebFlowWindow; readonly previous: boolean }) {
  const fpy = flow.firstPassYield, human = flow.sendBacks.human;
  const items = [throughputKpi(flow, previous), cycleKpi(flow),
    rateKpi('First-pass yield', fpy, `${fpy.numerator}/${fpy.denominator} first pass`, 'no deliveries', `${percentText(fpy.coverage)} of missions observed`),
    extraJobsKpi(flow),
    rateKpi('Human send-back', human, `${human.numerator} of ${human.denominator} reviews`, 'no human reviews', 'review provenance missing'),
    holderKpi(flow)];
  return <ul aria-label="Flow summary" style={{ listStyle: 'none', margin: '19px 0 0', padding: 0, display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
    {items.map(item => <Kpi key={item.label} {...item} />)}
  </ul>;
}

function Unavailable({ reason }: { readonly reason: string }) {
  return <section role="status" data-flow-region="unavailable" style={{ marginTop: 19, background: FLOW.surface, border: `1px solid ${FLOW.surfaceEdge}`,
    borderTop: `2px solid ${FLOW.red}`, borderRadius: 8, padding: '14px 16px', color: FLOW.control, fontSize: FLOW_TYPE.body }}>
    <h2 style={{ margin: 0, color: FLOW.text, fontSize: FLOW_TYPE.heading }}>FLOW statistics unavailable</h2>
    <p style={{ margin: '8px 0 0' }}>{reason}</p>
    <p style={{ margin: '4px 0 0', color: FLOW.muted }}>No flow values are shown in place of the missing projection.</p>
  </section>;
}

export function FlowPanel({ snapshot, onNavigate }: { readonly snapshot: WebBoardSnapshot; readonly onNavigate: (view: BoardView) => void }) {
  const [family, setFamily] = useState<string | null>(null);
  const [previous, setPrevious] = useState(false);
  const [sort, setSort] = useState<FlowSort>('mission');
  const statistics = snapshot.metrics.flow;
  const cohort = (family === null ? undefined : statistics?.families.find(item => item.family === family)) ?? statistics;
  const selected = cohort === statistics ? null : family;
  const flow = cohort ? previous ? cohort.previous : cohort.current : undefined;
  const chip = !flow ? 'unavailable' : flow.completedMissions > 0 && flow.observation.complete === flow.completedMissions ? 'measured'
    : `${flow.observation.complete} of ${flow.completedMissions} measured`;
  return <div data-flow-view style={{ flex: 1, minHeight: 0, minWidth: 0, display: 'flex', flexDirection: 'column', background: FLOW.page, color: FLOW.text }}>
    <FlowHeader snapshot={snapshot} chip={chip} onNavigate={onNavigate} />
    <div style={{ flex: 1, overflow: 'auto' }}>
      <div role="region" aria-label="Mission flow" style={{ boxSizing: 'border-box', maxWidth: CONTENT_WIDTH + 56, padding: '0 28px 82px' }}>
        <div data-flow-region="controls" style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'nowrap', gap: 12,
          paddingTop: 30, maxWidth: '100%', overflowX: 'auto' }}>
          <div style={{ minWidth: 0 }}>
            <h2 style={{ margin: 0, color: FLOW.text, fontSize: FLOW_TYPE.title, fontWeight: 700, lineHeight: '26px' }}>Mission flow</h2>
            <p style={{ margin: '4px 0 0', color: FLOW.muted, fontSize: FLOW_TYPE.meta }}>
              {flow ? `${flow.completedMissions} missions landed · ${windowText(flow.startDate, flow.endDate)} · every arrow shows how many attempts pass it` : 'no FLOW projection'}
            </p>
          </div>
          {statistics && <div style={{ display: 'flex', gap: 6, marginTop: 1, flexShrink: 0 }}>
            <div role="group" aria-label="Agent filter" style={{ display: 'flex', border: `1px solid ${FLOW.controlEdge}`, borderRadius: 8, overflow: 'hidden' }}>
              <button type="button" aria-pressed={selected === null} onClick={() => setFamily(null)} style={{ ...segment(selected === null), padding: '0 13px' }}>All agents</button>
              {statistics.families.map(item => <button key={item.family} type="button" aria-pressed={selected === item.family}
                onClick={() => setFamily(item.family)} style={{ ...segment(selected === item.family), padding: statistics.families.length > 4 ? '0 10px' : '0 13px' }}>{item.family}</button>)}
            </div>
            <button type="button" aria-pressed={previous} onClick={() => setPrevious(value => !value)}
              style={{ ...segment(previous), padding: '0 7px', border: `1px solid ${FLOW.controlEdge}`, borderRadius: 8, height: 40 }}>Compare: previous week</button>
          </div>}
        </div>
        {!flow ? <Unavailable reason={snapshot.metrics.flowUnavailable ?? 'The board projection carries no FLOW statistics.'} />
          : <>
            <Kpis flow={flow} previous={previous} />
            <FlowGraph flow={flow} lanes={flow.time.lanes} />
            <FlowTimeTable flow={flow} sort={sort} onSort={setSort} />
            {flow.defects.length > 0 && <details data-flow-region="defects" style={{ marginTop: 16, color: FLOW.muted, fontSize: FLOW_TYPE.meta }}>
              <summary style={{ cursor: 'pointer', color: FLOW.control }}>{flow.defects.length} collection gaps reported for this cohort</summary>
              <ul style={{ margin: '8px 0 0', paddingLeft: 18, lineHeight: '17px' }}>{flow.defects.map(defect => <li key={defect}>{defect}</li>)}</ul>
            </details>}
          </>}
      </div>
    </div>
  </div>;
}
