/**
 * The board composition: it groups the received stages into the reference's
 * three regions and renders nothing itself. Grouping is presentation only —
 * it never reorders, filters or reinterprets what the server sent, and every
 * fact on screen comes from the validated snapshot.
 *
 * Layout, spacing, palette and typography follow the design authority
 * (`Parallix Board GPU.dc.html` in the reference acceptance artifact).
 */
import type { WebBoardSnapshot } from '../../src/interfaces/web/transport.js';
import { AttentionRail } from './attention-rail.js';
import { DoneRail } from './done-rail.js';
import { FlightColumn } from './flight-column.js';
import { IntakeColumn } from './intake-column.js';
import { OperationLog } from './operation-log.js';
import { TopBar } from './top-bar.js';

// Presentation-only grouping: which reference region a received stage sits in.
// These are layout buckets, not lifecycle rules.
const INTAKE_LANES: readonly string[] = ['refined', 'backlog'];
const SHIPPED_LANE = 'done';

export function Board({ snapshot }: { snapshot: WebBoardSnapshot }) {
  // The intake bucket stacks in the reference's order; every other lane keeps
  // the order the server sent.
  const intake = snapshot.stages
    .filter((stage) => INTAKE_LANES.includes(stage.lane))
    .sort((a, b) => INTAKE_LANES.indexOf(a.lane) - INTAKE_LANES.indexOf(b.lane));
  const flight = snapshot.stages.filter((stage) => !INTAKE_LANES.includes(stage.lane) && stage.lane !== SHIPPED_LANE);
  const shipped = snapshot.stages.filter((stage) => stage.lane === SHIPPED_LANE);

  return (
    <>
      <TopBar snapshot={snapshot} />
      <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
        <AttentionRail snapshot={snapshot} />
        <div style={{ flex: 1, display: 'flex', minWidth: 0, minHeight: 0, gap: 14, padding: 14, overflowX: 'auto' }}>
          {intake.length > 0 && (
            <div style={{ width: 222, flexShrink: 0, display: 'flex', flexDirection: 'column', minHeight: 0, gap: 16 }}>
              {intake.map((stage, index) => (
                <IntakeColumn
                  key={stage.lane}
                  stage={stage}
                  style={index === 0
                    ? { minHeight: 80, maxHeight: '44%', flexShrink: 0 }
                    : { flex: 1, minHeight: 0 }}
                />
              ))}
            </div>
          )}
          {flight.map((stage) => (
            <FlightColumn key={stage.lane} stage={stage} style={{ flex: 1, minWidth: 318, minHeight: 0 }} />
          ))}
          {shipped.map((stage) => <DoneRail key={stage.lane} stage={stage} />)}
        </div>
      </div>
      <OperationLog snapshot={snapshot} />
    </>
  );
}
