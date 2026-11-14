import type { WebMissionCard } from '../../src/interfaces/web/transport.js';
import { C, SPACE, TRACK, TYPE } from './palette.js';

/** Render the server-owned review progress without reconstructing reviewer policy. */
export function ReviewProgress({ card }: { card: WebMissionCard }) {
  const progress = card.reviewProgress;
  if (!progress) { return null; }
  const approval = `${progress.requiredApprovals}/${progress.requiredApprovals} approval${progress.requiredApprovals === 1 ? '' : 's'}`;
  return (
    <section data-review-progress aria-label={`Review round ${progress.round} progress`}
      style={{ margin: `${SPACE.md}px 0 0`, fontSize: TYPE.micro, lineHeight: 1.45, letterSpacing: TRACK.tight }}>
      <div style={{ color: C.cyan }}>{`Review round ${progress.round} · revision ${progress.revision} · ${approval} · independent ${progress.independentAvailable}`}</div>
      {progress.reviewers.map(reviewer => (
        <div key={`${reviewer.runLabel}:${reviewer.state}`} data-reviewer-state={reviewer.state}
          style={{ color: reviewer.state === 'failed' ? C.red : C.faint }}>
          {`${reviewer.reviewerLabel} · ${reviewer.runLabel} · ${reviewer.state}${reviewer.outcome ? ` · ${reviewer.outcome}` : ''}`}
        </div>
      ))}
      {progress.degradedReason && <div style={{ color: C.amber }}>{`degraded: ${progress.degradedReason}`}</div>}
      {progress.blockers.map(blocker => <div key={blocker} style={{ color: C.red }}>{`blocker: ${blocker}`}</div>)}
      <div style={{ color: C.dim }}>{`next: ${progress.nextAction}`}</div>
    </section>
  );
}
