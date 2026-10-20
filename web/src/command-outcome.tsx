import { createContext, useContext } from 'react';
import { MODAL, SPACE, TYPE } from './palette.js';

/** Only outcomes whose owning cards are disclosed belong in card footers. */
export const VisibleCommandOutcomes = createContext<ReadonlyMap<string, string>>(new Map());

export function CommandOutcome({ missionId }: { missionId: string }) {
  const outcome = useContext(VisibleCommandOutcomes).get(missionId);
  return outcome === undefined ? null : (
    <footer style={{ padding: SPACE.md, fontSize: TYPE.meta, color: MODAL.muted, overflowWrap: 'anywhere' }}>
      <p role="status" aria-live="polite" style={{ margin: 0 }}>{outcome}</p>
    </footer>
  );
}
