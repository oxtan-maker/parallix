/**
 * An average mission, refined to landed: per-mission elapsed rows from the
 * shared projection, their queued/working/held bars and the lifecycle state
 * cards. Rows, totals and shares are the projection's; the table only sorts
 * the published rows and scales bars to the widest one.
 */
import type { WebFlowTimeRow, WebFlowWindow } from '../../src/interfaces/web/transport.js';
import { FLOW, FLOW_TYPE } from './palette.js';
import { LANE_STYLE, actorText, compactDuration, hoursText, minutesText, percentText, stepText } from './flow-format.js';

export type FlowSort = 'mission' | 'longest';

const BAR_WIDTH = 570;
const COLUMNS = '219px 110px 1fr 75px 75px 76px 63px';
const STATE_ACCENT: Readonly<Record<string, string>> = {
  backlog: FLOW.refine, refined: FLOW.refine, active: FLOW.amber, review: FLOW.purple, integration: FLOW.cyan,
};

function Bar({ row, widest }: { readonly row: Pick<WebFlowTimeRow, 'waitingMs' | 'workingMs' | 'heldMs' | 'totalMs'> & { readonly color: string }; readonly widest: number }) {
  const scale = (value: number) => widest > 0 ? Math.max(value > 0 ? 3 : 0, value / widest * BAR_WIDTH) : 0;
  const held = row.heldMs > 0;
  const label = held ? `held ${minutesText(row.heldMs)}, waiting and hands-on time not split` : `waiting ${minutesText(row.waitingMs)}, working ${minutesText(row.workingMs)}`;
  return <div role="img" aria-label={label} style={{ display: 'flex', height: 12, borderRadius: 3, overflow: 'hidden', width: 'fit-content' }}>
    {row.waitingMs > 0 && <span style={{ width: scale(row.waitingMs), background: row.color, opacity: 0.42 }} />}
    {row.workingMs > 0 && <span style={{ width: scale(row.workingMs), background: row.color }} />}
    {held && <span style={{ width: scale(row.heldMs), background: `repeating-linear-gradient(135deg, ${row.color} 0 6px, ${FLOW.redStripe} 6px 10px)` }} />}
  </div>;
}

function Cell({ children, align = 'left', strong = false, color = FLOW.control }: { children: React.ReactNode; align?: 'left' | 'right'; strong?: boolean; color?: string }) {
  return <div role="cell" style={{ textAlign: align, color: strong ? FLOW.text : color, fontWeight: strong ? 700 : 400, whiteSpace: 'nowrap' }}>{children}</div>;
}

export function FlowTimeTable({ flow, sort, onSort }: { readonly flow: WebFlowWindow; readonly sort: FlowSort; readonly onSort: (sort: FlowSort) => void }) {
  const rows = [...flow.time.table].sort(sort === 'longest'
    ? (a, b) => b.totalMs - a.totalMs || a.id.localeCompare(b.id)
    : (a, b) => a.order - b.order || a.id.localeCompare(b.id));
  const unobserved = flow.time.unobservedMs;
  const widest = Math.max(0, ...rows.map(row => row.totalMs));
  const totals = flow.time.totals;
  return <section aria-labelledby="flow-time-title" data-flow-region="time"
    style={{ background: FLOW.surface, border: `1px solid ${FLOW.surfaceEdge}`, borderRadius: 10, marginTop: 21, padding: '17px 21px 13px' }}>
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
      <h2 id="flow-time-title" style={{ margin: 0, color: FLOW.text, fontSize: FLOW_TYPE.heading, fontWeight: 700 }}>
        Observed work per mission{totals.totalMs > 0 ? ` · ${minutesText(totals.totalMs)} (${hoursText(totals.totalMs)})` : ' · not observed'}
      </h2>
      <div role="group" aria-label="Sort steps" style={{ display: 'flex', border: `1px solid ${FLOW.controlEdge}`, borderRadius: 8, overflow: 'hidden' }}>
        {([['mission', 'Mission order'], ['longest', 'Longest first']] as const).map(([value, label]) =>
          <button key={value} type="button" aria-pressed={sort === value} onClick={() => onSort(value)} style={segment(sort === value)}>{label}</button>)}
      </div>
    </div>
    <p style={{ margin: '13px 0 0', color: FLOW.muted, fontSize: FLOW_TYPE.meta, lineHeight: '14px' }}>
      Average over {flow.time.measuredMissions} missions with ownership observations. Shares are relative to observed work, not unobserved wall time. Light part = waiting in a queue, solid part = working. Human review is shown as one total (striped) until waiting and hands-on time can be measured apart.
      {unobserved > 0 ? ` Observation gaps account for ${minutesText(unobserved)} per delivered mission and remain listed below.` : ''}
    </p>
    <div role="table" aria-label="Average time per mission by step" style={{ marginTop: 8, fontSize: FLOW_TYPE.body, overflowX: 'auto' }}>
      <div role="row" style={{ ...rowStyle, color: FLOW.label, fontSize: FLOW_TYPE.micro, letterSpacing: 1, textTransform: 'uppercase', paddingBottom: 9, paddingTop: 0 }}>
        {['Step', 'Held by', 'Time', 'Waiting', 'Working', 'Total', 'Share'].map((label, index) =>
          <div key={label} role="columnheader" style={{ textAlign: index > 2 ? 'right' : 'left' }}>{label}</div>)}
      </div>
      {rows.map(row => {
        const style = LANE_STYLE[row.lane];
        return <div key={row.id} role="row" data-flow-time-row={row.id} style={rowStyle}>
          <Cell color={FLOW.text}>{stepText(row.step)}</Cell>
          <Cell color={style.text}>{actorText(row.actor)}</Cell>
          <div role="cell"><Bar row={{ ...row, color: style.accent }} widest={widest} /></div>
          {row.heldMs > 0 && row.waitingMs + row.workingMs === 0
            ? <div role="cell" style={{ gridColumn: 'span 2', textAlign: 'right', color: FLOW.control }}>not split yet</div>
            : <><Cell align="right">{minutesText(row.waitingMs)}</Cell><Cell align="right">{minutesText(row.workingMs)}</Cell></>}
          <Cell align="right" strong>{minutesText(row.totalMs)}</Cell>
          <Cell align="right">{percentText(row.share)}</Cell>
        </div>;
      })}
      <div role="row" style={{ ...rowStyle, borderBottom: 'none', borderTop: `1px solid ${FLOW.controlEdge}`, fontWeight: 700 }}>
        <Cell strong>Observed work</Cell><div role="cell" /><div role="cell" />
        <Cell align="right" strong>{minutesText(totals.waitingMs)}</Cell><Cell align="right" strong>{minutesText(totals.workingMs)}</Cell>
        <Cell align="right" strong>{totals.totalMs > 0 ? minutesText(totals.totalMs) : '—'}</Cell><Cell align="right" strong>{totals.totalMs > 0 ? '100%' : '—'}</Cell>
      </div>
    </div>
    <h3 style={{ margin: '14px 0 0', color: FLOW.control, fontSize: FLOW_TYPE.body, fontWeight: 700, letterSpacing: 2 }}>MEDIAN TIME IN STATE</h3>
    <ul aria-label="Average time in lifecycle state" style={{ listStyle: 'none', margin: '15px 0 0', padding: 0, display: 'grid', gridTemplateColumns: 'repeat(5, minmax(150px, 1fr))', gap: 12, overflowX: 'auto' }}>
      {flow.stateDwell.map(state => <li key={state.state} data-flow-state={state.state} style={{ boxSizing: 'border-box', height: 80, border: `1px solid ${FLOW.surfaceEdge}`, borderTop: `2px solid ${STATE_ACCENT[state.state]}`,
        borderRadius: 8, padding: '10px 12px 9px', minWidth: 0 }}>
        <div style={{ color: FLOW.label, fontSize: FLOW_TYPE.micro, lineHeight: '12px', letterSpacing: 1, textTransform: 'uppercase' }}>{state.state}</div>
        <div style={{ color: FLOW.text, fontSize: FLOW_TYPE.title, lineHeight: '24px', fontWeight: 700, marginTop: 4 }}>{state.n > 0 ? minutesText(state.medianMs) : '—'}</div>
        <div style={{ color: FLOW.muted, fontSize: FLOW_TYPE.meta, lineHeight: '14px', marginTop: 2 }}>{state.n > 0 ? `p90 ${compactDuration(state.p90Ms)} · n=${state.n}` : 'not observed · n=0'}</div>
      </li>)}
    </ul>
  </section>;
}

const rowStyle: React.CSSProperties = {
  display: 'grid', boxSizing: 'border-box', gridTemplateColumns: COLUMNS, alignItems: 'center', minHeight: 35, borderBottom: `1px solid ${FLOW.laneRule}`,
  columnGap: 0, minWidth: 1188,
};

export function segment(pressed: boolean): React.CSSProperties {
  return { background: pressed ? FLOW.pressed : 'transparent', border: 'none', color: pressed ? FLOW.bright : FLOW.control,
    fontFamily: 'inherit', fontSize: FLOW_TYPE.body, padding: '0 12px', height: 38, cursor: 'pointer', whiteSpace: 'nowrap' };
}
