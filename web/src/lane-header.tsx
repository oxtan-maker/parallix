/**
 * The shared lane head: the received lane name, the server's count, and an
 * optional right-hand note. `display` is left to the caller so the done-rail
 * disclosure can reuse the same box inside its <summary>.
 */
import type { CSSProperties, ReactNode } from 'react';
import { C, DISPLAY, RADIUS, SPACE, TRACK, TYPE } from './palette.js';

export const laneHeaderBox: CSSProperties = {
  alignItems: 'baseline',
  gap: SPACE.md,
  padding: `0 ${SPACE.xs}px ${SPACE.md}px`,
  borderBottom: `1px solid ${C.cardEdge}`,
};

export const laneHeading: CSSProperties = {
  fontFamily: DISPLAY, fontWeight: 700, letterSpacing: TRACK.display, fontSize: TYPE.heading,
  color: C.text, margin: 0, display: 'inline',
};

export const laneEmpty: CSSProperties = { color: C.faint, fontSize: TYPE.meta, padding: SPACE.xs };

/** The shared card box for a lane row: same edge, radius and selection accent. */
export function laneCard(selected: boolean): CSSProperties {
  const edge = selected ? C.cyan : C.cardEdge;
  return { borderWidth: 1, borderStyle: 'solid', borderTopColor: edge, borderRightColor: edge, borderBottomColor: edge, borderLeftColor: edge, borderRadius: RADIUS.card };
}

export function LaneHeader({ lane, count, countText, note }: {
  lane: string;
  count: number;
  /** The reference prints intake counts bare and in-flight counts as "N cards". */
  countText?: string;
  note?: ReactNode;
}) {
  return (
    <div style={{ display: 'flex', ...laneHeaderBox }}>
      <h2 style={laneHeading}>{lane.toUpperCase()}</h2>
      <span style={{ color: C.faint, fontSize: TYPE.meta }}>{countText ?? count}</span>
      <div style={{ flex: 1 }} />
      {note}
    </div>
  );
}
