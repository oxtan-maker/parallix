import type { MissionStore } from './domain-ports.js';
import { missionId } from '../domain/mission.js';
import { reviewObligations } from '../domain/review-obligations.js';
import type { PromptArtifactPort } from './ports/prompt-artifacts.js';

/** A launch-time read through the same aggregate authority used by status. */
export async function readAgentLaunchContext(store: Pick<MissionStore, 'load'>, slug: string, artifacts?: PromptArtifactPort): Promise<string> {
  const loaded = await store.load(missionId(slug));
  if (loaded.kind !== 'found') { throw new Error(`Cannot load launch Mission ${slug}: ${loaded.kind}`); }
  const { mission, version } = loaded;
  let review: unknown = mission.review;
  if (mission.review && artifacts) {
    const current = mission.review.rounds.at(-1)!;
    const inherited = reviewObligations(mission.review);
    review = {
      currentRound: current,
      intervention: mission.review.intervention,
      inheritedObligations: inherited ? { sourceRound: inherited.general.number,
        sourceRevision: inherited.general.subject, findings: inherited.findings } : null,
      currentEvents: mission.review.reviewEvents.filter(event => event.roundNumber === current.number),
      fullReviewArtifact: await artifacts.retain(JSON.stringify(mission.review, null, 2)),
      instruction: 'Read fullReviewArtifact before assessing prior findings, resolutions, human notes or outstanding obligations. It contains the complete unabridged review and audit trail; this view contains only the current round and inherited obligations.',
    };
  }
  const header = 'Authoritative Mission status snapshot — current as of launch. Use this snapshot to start; no initial px status read is needed.\n';
  const snapshot = { slug, version, title: mission.title, missionStatus: mission.status,
      brief: mission.brief ?? null, successCriteria: mission.successCriteria ?? [],
      completedSuccessCriteria: mission.completedSuccessCriteria ?? [], checkpoints: mission.checkpoints,
      declaredGates: mission.declaredGates ?? [], predictedNelBucket: mission.predictedNelBucket ?? null,
      reproductionTest: mission.reproductionTest ?? null, review };
  return header + JSON.stringify(snapshot, null, 2);
}
