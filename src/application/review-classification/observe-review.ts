import type { LoopContext } from '../review-loop/round.js';
import type { Review } from '../../domain/review.js';
import { missionId } from '../../domain/mission.js';

/** A general review is an observation, never retroactive classifier correctness by merger. */
export async function observeGeneralReview(context: LoopContext, started: number, verdict: unknown, cycleStarted?: number): Promise<void> {
  const ports = context.ports.classification;
  const store = context.ports.missionStore;
  if (!ports || !store) { return; }
  try {
    const loaded = await store.load(missionId(context.slug));
    if (loaded.kind !== 'found' || !loaded.mission.review) { return; }
    const review: Review = loaded.mission.review;
    const current = review.rounds.at(-1)!;
    if (current.subject.revision !== context.ports.preReview.head()) { return; }
    const telemetry = await ports.telemetry();
    const calls = (await telemetry.calls(String(loaded.mission.repositoryId))).filter(sample =>
      sample.mission === context.slug && sample.round === current.number && sample.candidateRevision === current.subject.revision);
    const last = calls.at(-1);
    if (!last) { return; }
    const original = review.rounds.at(-2)?.decision;
    const findings = current.decision?.kind === 'changes-requested' ? current.decision.findings : [];
    const oldSummaries = original?.kind === 'changes-requested' ? original.findings.map(f => f.summary) : [];
    const unresolved = findings.some(f => oldSummaries.includes(f.summary));
    const ordinaryReviewMs = ports.clock() - started;
    const previous = cycleStarted === undefined ? calls : calls.slice(0, -1);
    const complete = previous.every(s => s.preparationMs !== null && (s.packetHash === null || s.classificationMs !== null));
    const previousMs = previous.reduce((n, s) => n + (s.preparationMs ?? 0) + (s.classificationMs ?? 0), 0);
    await telemetry.recordObservation({
      decisionId: last.decisionId, revision: String(current.subject.revision), findingIds: last.findingIds,
      observedAt: ports.now(), originalFindings: verdict === 'APPROVED' ? 'resolved' : unresolved ? 'unresolved' : 'unobserved',
      newFindings: findings.filter(f => !oldSummaries.includes(f.summary)).length,
      cycleMs: complete ? (cycleStarted === undefined ? ordinaryReviewMs : ports.clock() - cycleStarted) + previousMs : null,
      ordinaryReviewMs,
    });
  } catch { context.ports.output.error('Classifier comparison measurement unavailable.'); }
}
