import type { WebMissionCard } from '../../src/interfaces/web/transport.js';
import { C } from './palette.js';

/** Draw recorded and planned entries rather than guessing a plan from CP numbers. */
export function CheckpointPips({ card }: { card: WebMissionCard }) {
  const checkpoints = card.checkpointEvidence ?? [];
  if (checkpoints.length === 0) { return null; }
  return (
    <span aria-label="Checkpoint plan" style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
      {checkpoints.map((checkpoint) => (
        <span
          key={checkpoint.name}
          aria-label={checkpoint.name}
          data-checkpoint-state={checkpoint.state}
          className={checkpoint.state === 'current' && card.activity.work.kind === 'working' ? 'review-pip--running' : undefined}
          title={`${checkpoint.name}: ${checkpoint.description}`}
          style={{ width: 16, height: 8, borderRadius: 2, background: checkpoint.state === 'current' || checkpoint.state === 'completed' || checkpoint.goalCheck.length > 0 ? C.green : C.headEdge }}
        />
      ))}
    </span>
  );
}
