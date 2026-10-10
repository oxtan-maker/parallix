import { useEffect, useRef, useState } from 'react';
import type { WebBoardSnapshot } from '../../src/interfaces/web/transport.js';
import type { MissionEditSnapshot } from '../../src/application/mission-edit-service.js';
import { sendEditMission } from './board-data.js';
import { CreateMissionDialog } from './create-mission-dialog.js';

/** Authoritative read happens on opening, never from the truncated board card. */
export function MissionEditor({ snapshot, onRefresh, request, onClose }: { snapshot: WebBoardSnapshot; onRefresh: () => Promise<void>; request: { id: string; control: HTMLButtonElement } | null; onClose: () => void }) {
  const [initial, setInitial] = useState<MissionEditSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, setLoading] = useState(false);
  const reading = useRef(false);
  const opener = useRef<HTMLButtonElement | null>(null);
  const cards = snapshot.stages.flatMap(stage => stage.cards);
  const close = () => { setInitial(null); onClose(); queueMicrotask(() => opener.current?.isConnected && opener.current.focus()); };
  const open = async (id: string, control: HTMLButtonElement) => {
    if (reading.current) { return; }
    reading.current = true; setLoading(true); setError(null); opener.current = control;
    try {
      const result = await sendEditMission({ kind: 'mission:edit-read', missionId: id });
      if (result.status !== 'completed') { setError(result.error?.message ?? 'Could not read mission. Try Edit again.'); return; }
      const value = result.value as MissionEditSnapshot;
      if (!value || value.missionId !== id || !Number.isInteger(value.version) || typeof value.title !== 'string'
        || typeof value.description !== 'string' || typeof value.context !== 'string'
        || ![value.labels, value.successCriteria, value.dependencies].every(list => Array.isArray(list) && list.every(item => typeof item === 'string'))) {
        throw new Error('The host returned invalid planning fields. Try Edit again.');
      }
      setInitial(value);
    } catch (failure) { setError(failure instanceof Error ? failure.message : String(failure)); }
    finally { reading.current = false; setLoading(false); }
  };
  useEffect(() => { if (request) { void open(request.id, request.control); } }, [request]);
  return <section aria-label="Mission editor">
    {error && <p role="alert">{error}</p>}
    {initial && <CreateMissionDialog initial={initial}
      options={cards.filter(card => card.actions.some(action => action.kind === 'mission:edit' && action.state === 'enabled') && card.id !== initial.missionId).map(card => ({ id: card.id, title: card.title }))}
      onClose={close} onCreated={() => { close(); void onRefresh().catch(() => setError('Saved. Board refresh failed; reload to see the changes.')); }} />}
  </section>;
}
