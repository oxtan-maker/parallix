import { missionId } from '../../domain/mission.js';
import { changeRevision } from '../../domain/review.js';
import { applyClassifierReview, type ClassifierReviewSource } from '../../domain/classifier-review.js';
import { buildEvidencePacket, PACKET_VERSION, PROMPT_VERSION } from './evidence-packet.js';
import { classifyRepeatFindings, hasBroaderReviewObligations, ROUTING_POLICY_VERSION } from './routing-policy.js';
import type { LoopContext, ReviewRound } from '../review-loop/round.js';
import type { ClassifierCallMeasurement } from '../ports/review-classification-telemetry.js';

/** Application policy at the verified re-review boundary; failures retain normal review. */
export async function tryRepeatReview(context: LoopContext, round: ReviewRound, cycleStarted?: number): Promise<'APPROVED' | 'REQUEST_CHANGES' | 'stop' | null> {
  const { classification: ports, missionStore: store, lifecycle } = context.ports;
  const humanSources = context.state.metadata.humanFeedbackSources;
  if (!ports || ports.mode === 'disabled' || !store || !lifecycle || !context.ports.provider
    || round.integrationRepair || round.humanFeedback || (Array.isArray(humanSources) ? humanSources.length > 0 : Boolean(humanSources))) { return null; }
  const loaded = await store.load(missionId(context.slug));
  if (loaded.kind !== 'found' || !loaded.mission.review) { return null; }
  const review = loaded.mission.review;
  const current = review.rounds.at(-1)!;
  const prior = review.rounds.at(-2);
  const candidateRevision = round.verifiedRevision ?? String(current.subject.revision);
  if (current.decision || current.number !== context.state.round || !prior || prior.decision?.kind !== 'changes-requested'
    || !prior.response || prior.response.resultingRevision !== current.subject.revision
    || context.ports.preReview.head() !== candidateRevision || review.intervention) { return null; }
  const response = prior.implementerResponseContent || review.reviewEvents.filter(e =>
    e.roundNumber === prior.number && e.eventType === 'implementer_round_summary').at(-1)?.content || '';
  const original = prior.decision;
  const reviewComment = original.comment && !['REQUEST_CHANGES', 'request-changes'].includes(original.comment.trim())
    ? original.comment : review.reviewEvents.filter(e => e.roundNumber === prior.number && e.eventType === 'reviewer_outcome').at(-1)?.content || '';
  const decisionId = ports.hash(JSON.stringify([loaded.mission.repositoryId, context.slug, current.number,
    prior.subject.revision, candidateRevision, original.findings.map(f => f.id).sort((left, right) => left.localeCompare(right)), ROUTING_POLICY_VERSION]));
  const fingerprint = ports.fingerprint();
  const started = cycleStarted ?? ports.clock();
  let telemetry;
  try { telemetry = await ports.telemetry(); } catch { return null; }
  const base = {
    decisionId, fingerprint, repository: String(loaded.mission.repositoryId), mission: context.slug, round: current.number,
    observedAt: ports.now(), priorRevision: String(prior.subject.revision), candidateRevision,
    findingIds: original.findings.map(f => String(f.id)), packetVersion: PACKET_VERSION, promptVersion: PROMPT_VERSION, policyVersion: ROUTING_POLICY_VERSION,
    implementer: context.identities.implementer, reviewer: context.identities.reviewer, shadow: ports.mode === 'shadow',
  };
  let attempt: ClassifierCallMeasurement = { ...base, packetHash: null, provider: null, model: null,
    label: null, score: null, route: 'reviewer', reason: 'unavailable', preparationMs: null, classificationMs: null };
  let published = false;
  let committed: 'APPROVED' | 'REQUEST_CHANGES' | null = null;
  const fallback = async (reason: string) => {
    await telemetry.recordCall({ ...attempt, route: 'reviewer', reason }); return null;
  };
  // Classifier output is never evidence for another classifier decision: the
  // next round must return to the general reviewer and regain human rationale.
  if (prior.decision.classifier) { return await fallback('prior-classifier-review'); }
  try {
    const availability = await ports.decision.available();
    if (availability.status !== 'available') {
      await telemetry.recordCall(attempt); return null;
    }
    attempt = { ...attempt, provider: availability.provider, model: availability.model };
    const packet = await buildEvidencePacket({
      priorRevision: String(prior.subject.revision), candidateRevision,
      findings: original.findings, priorReviewComment: reviewComment, implementerResponse: response,
      resolvedFindingIds: prior.response.resolutions.map(r => String(r.findingId)),
    }, ports.evidence);
    attempt = { ...attempt, preparationMs: ports.clock() - started };
    if ('fallback' in packet) {
      await telemetry.recordCall({ ...attempt, reason: packet.fallback }); return null;
    }
    // New or broader obligations cannot be cleared using the previous scope.
    const allChanged = await ports.evidence.diff(String(prior.subject.revision), candidateRevision, []);
    attempt = { ...attempt, preparationMs: ports.clock() - started };
    if (hasBroaderReviewObligations(allChanged, packet.paths, context.ports.task.task.taskFile?.replace(`${context.ports.worktree}/`, ''))) {
      await telemetry.recordCall({ ...attempt, reason: 'broader-review-obligations' }); return null;
    }
    attempt = { ...attempt, packetHash: ports.hash(JSON.stringify(packet.request)) };
    const classifyStart = ports.clock();
    let result;
    try { result = await ports.decision.decide(packet.request); }
    catch {
      await telemetry.recordCall({ ...attempt, reason: 'classifier-failure', classificationMs: ports.clock() - classifyStart });
      return null;
    }
    const selected = classifyRepeatFindings(result);
    attempt = { ...attempt, ...selected, provider: result.provider, model: result.model, classificationMs: ports.clock() - classifyStart };
    await telemetry.recordCall(attempt);
    if (selected.route === 'reviewer' || ports.mode === 'shadow') { return null; }
    if (context.ports.preReview.head() !== candidateRevision) { return await fallback('candidate-revision-drift'); }
    const source: ClassifierReviewSource = {
      kind: 'classifier', identity: 'jev', decisionId, provider: result.provider, model: result.model,
      packetHash: attempt.packetHash!, priorRevision: String(prior.subject.revision), candidateRevision,
      responseRevision: String(prior.response!.resultingRevision),
      findingIds: base.findingIds, policyVersion: ROUTING_POLICY_VERSION, label: selected.label!, score: selected.score!,
    };
    const at = ports.now();
    const reviewAtCandidate = candidateRevision === current.subject.revision ? review : {
      ...review,
      rounds: [...review.rounds.slice(0, -1), {
        ...current,
        subject: { ...current.subject, revision: changeRevision(candidateRevision) },
      }],
    } as unknown as typeof review;
    const updated = applyClassifierReview(reviewAtCandidate, source, selected.route, at);
    const summary = `${updated.rounds.at(-1)!.decision!.comment}\n\nScope: ${source.findingIds.join(', ')}; revision: ${source.candidateRevision}; policy: ${source.policyVersion}; selected score: ${source.score}.\n[classifier-decision:${decisionId}]`;
    const latest = await store.load(loaded.mission.id);
    if (latest.kind !== 'found' || latest.version !== loaded.version) { return await fallback('stale-review-version'); }
    if (!(await ports.publish(source, selected.route, summary))) { return await fallback('classifier-publication-failed'); }
    published = true;
    if (context.ports.preReview.head() !== candidateRevision) {
      await context.escalateToHumanReview('CLASSIFIER_PUBLISHED_REVISION_DRIFT'); return 'stop';
    }
    const transition = await lifecycle.transition({
      operationId: `classifier:${decisionId}`, missionId: loaded.mission.id, expectedVersion: loaded.version,
      capabilities: new Set(['mission:transition']), command: { type: selected.route === 'clear' ? 'approve' : 'request-changes', review: updated },
      actor: 'jev', occurredAt: at,
    });
    if (transition.status !== 'completed') {
      await context.escalateToHumanReview('CLASSIFIER_REVIEW_PERSIST_FAILURE'); return 'stop';
    }
    committed = selected.route === 'clear' ? 'APPROVED' : 'REQUEST_CHANGES';
    round.blockingFindings = selected.route === 'implementer' ? original.findings.map(f => ({ id: String(f.id), summary: f.summary })) : [];
    await telemetry.recordObservation({ decisionId, revision: source.candidateRevision, findingIds: source.findingIds,
      observedAt: ports.now(), originalFindings: 'unobserved', newFindings: null,
      cycleMs: ports.clock() - started, ordinaryReviewMs: null });
    context.ports.output.log(`Jev: ${selected.route === 'clear' ? 'cleared prior findings' : 'likely unresolved prior findings'} (${source.findingIds.join(', ')}).`);
    return selected.route === 'clear' ? 'APPROVED' : 'REQUEST_CHANGES';
  } catch {
    if (committed) { return committed; }
    if (published) {
      await context.escalateToHumanReview('CLASSIFIER_REVIEW_PERSIST_FAILURE'); return 'stop';
    }
    return null;
  }
}
