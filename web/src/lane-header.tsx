/**
 * The shared lane head: the received lane name, the server's count, and an
 * optional right-hand note. `display` is left to the caller so the done-rail
 * disclosure can reuse the same box inside its <summary>.
 */
import type { CSSProperties, ReactNode } from 'react';
import { C, DISPLAY } from './palette.js';

export const laneHeaderBox: CSSProperties = {
  alignItems: 'baseline',
  gap: 7,
  padding: '0 2px 7px',
  borderBottom: `1px solid ${C.cardEdge}`,
};

export const laneHeading: CSSProperties = {
  fontFamily: DISPLAY, fontWeight: 700, letterSpacing: 2, fontSize: 14,
  color: C.text, margin: 0, display: 'inline',
};

export const laneEmpty: CSSProperties = { color: C.faint, fontSize: 11, padding: 2 };

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
      <span style={{ color: C.faint, fontSize: 11 }}>{countText ?? count}</span>
      <div style={{ flex: 1 }} />
      {note}
    </div>
  );
}
