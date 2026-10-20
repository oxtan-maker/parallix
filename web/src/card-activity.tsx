/**
 * The activity elements of the card design, shared by every card that shows
 * current work. Each prints one server-owned fact verbatim: the actor line
 * states the published work or the blocking reason in the reference's actor
 * tone, and the header's worker label states the family the provider
 * observation names, in the header's agent tone. No card adds an execution
 * count row: the observation shows up as worker identity, not as a row of its
 * own. A card may choose where these elements sit and whether a compact row
 * shows them, but only the elements decide tone, type and wording.
 */
import type { CSSProperties } from 'react';
import type { WebMissionCard } from '../../src/interfaces/web/transport.js';
import { actorLine, familyAccent } from './format.js';
import { SPACE, TRACK, TYPE } from './palette.js';

export function ActorLine({ card, style }: {
  readonly card: WebMissionCard;
  /** Placement only; the dot and type treatment come from the design. */
  readonly style?: CSSProperties;
}) {
  const actor = actorLine(card);
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: SPACE.sm, minWidth: 0, ...style }}>
      <span aria-hidden="true" style={{ color: actor.color, fontSize: 8, flexShrink: 0 }}>●</span>
      <span style={{ color: actor.color, fontSize: TYPE.meta }}>{actor.text}</span>
    </div>
  );
}

/**
 * The header's worker identity. While work is published the observed provider
 * family names the worker; with no published work the assigned implementer
 * does. An observation that names no invocation names nobody, so the label
 * renders nothing instead of guessing a worker.
 */
export function AgentLabel({ agent, liveAgent, style }: {
  readonly agent: WebMissionCard['agent'];
  /** The observed provider family; it decides only the label's wording. */
  readonly liveAgent: WebMissionCard['agent'];
  /** Placement only; the label's tone and type come from the design. */
  readonly style?: CSSProperties;
}) {
  if (agent === null) { return null; }
  return (
    <span
      title={`${liveAgent === null ? 'implementer' : 'active worker'} family: ${agent}`}
      style={{
        color: familyAccent(agent),
        fontSize: TYPE.micro, letterSpacing: TRACK.normal, minWidth: 0,
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        ...style,
      }}
    >
      {agent}
    </span>
  );
}
