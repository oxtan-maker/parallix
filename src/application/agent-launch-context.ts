import type { MissionStore } from './domain-ports.js';
import { missionId } from '../domain/mission.js';

/** A launch-time read through the same aggregate authority used by status. */
export async function readAgentLaunchContext(store: Pick<MissionStore, 'load'>, slug: string): Promise<string> {
  const loaded = await store.load(missionId(slug));
  if (loaded.kind !== 'found') { throw new Error(`Cannot load launch Mission ${slug}: ${loaded.kind}`); }
  const { mission, version } = loaded;
  return 'Authoritative Mission status snapshot — current as of launch. Use this snapshot to start; no initial px status read is needed.\n'
    + JSON.stringify({ slug, version, title: mission.title, missionStatus: mission.status,
      brief: mission.brief ?? null, successCriteria: mission.successCriteria ?? [],
      completedSuccessCriteria: mission.completedSuccessCriteria ?? [], checkpoints: mission.checkpoints,
      declaredGates: mission.declaredGates ?? [], predictedNelBucket: mission.predictedNelBucket ?? null,
      reproductionTest: mission.reproductionTest ?? null, review: mission.review }, null, 2);
}
