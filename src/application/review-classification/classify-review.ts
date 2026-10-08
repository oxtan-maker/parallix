import { missionId } from '../../domain/mission.js';
import { applyClassifierReview, integrationRepairFinding, reviewAtCandidateRevision, successCriteriaFindings, type ClassifierReviewSource } from '../../domain/classifier-review.js';
import { buildEvidencePacket } from './evidence-packet.js';
import { RoundTelemetry } from './round-telemetry.js';
import { classifyFindings, ROUTING_POLICY_VERSION, type ClassificationRoute } from './routing-policy.js';
import type { LoopContext, ReviewRound } from '../review-loop/round.js';
import type { ReviewClassificationTelemetryPort } from '../ports/review-classification-telemetry.js';
import type { ReviewClassificationPorts } from '../ports/review-classification.js';
import type { Review, ReviewFinding, ReviewRevocationCause, ReviewRound as DomainReviewRound } from '../../domain/review.js';
import type { Mission } from '../../domain/mission.js';
import type { MissionStore, MissionVersion } from '../domain-ports.js';

type Outcome = 'APPROVED' | 'REQUEST_CHANGES' | 'stop' | null;

/** Everything the decide and commit steps need, derived once from the stored review. */
interface ReviewScope {
  readonly mission: Mission;
  readonly version: MissionVersion;
  readonly review: Review;
  readonly current: DomainReviewRound;
  /** The earlier round whose findings or withdrawn gate are judged; null when the success criteria are judged instead. */
  readonly prior: DomainReviewRound | null;
  /** Revision the evidence diff starts from: the prior round's, or the target branch for a success-criteria round. */
  readonly baseRevision: string;
  readonly candidateRevision: string;
  readonly original: DomainReviewRound['decision'];
  readonly repairCause: Extract<ReviewRevocationCause, { kind: 'integration-gate-failure' }> | null;
  readonly verifiedRepair: boolean;
  readonly findings: readonly ReviewFinding[];
  readonly evidenceComment: string;
  readonly evidenceResponse: string;
  readonly humanFeedback: string;
}
/** `reason` is the telemetry row reason; `message` is what the operator sees. */
type Eligibility = ReviewScope | { readonly skip: { readonly reason: string; readonly message: string } };
type Loaded = Awaited<ReturnType<MissionStore['load']>>;

const decisionIdFor = (ports: ReviewClassificationPorts, parts: readonly unknown[]) => ports.hash(JSON.stringify([...parts, ROUTING_POLICY_VERSION]));

/** Application policy at the verified review boundary, for any round; failures retain normal review. */
export async function tryClassifyReview(context: LoopContext, round: ReviewRound, cycleStarted?: number): Promise<Outcome> {
  const ports = context.ports.classification;
  const emit = (reason: string) => context.emit({ kind: 'reviewer-classification', reason });
  if (!ports) { emit('unavailable or disabled'); return null; }
  let telemetry: ReviewClassificationTelemetryPort;
  // An unmeasured decision could never be audited, so it stays with the general reviewer.
  try { telemetry = await ports.telemetry(); } catch { emit('telemetry unavailable'); return null; }
  const loaded = context.ports.missionStore ? await context.ports.missionStore.load(missionId(context.slug)) : null;
  const eligible = assessEligibility(context, round, loaded);
  if ('skip' in eligible) {
    const identity = skippedIdentity(context, round, ports, loaded, eligible.skip.reason);
    await new RoundTelemetry(telemetry, ports, context, identity).finish(eligible.skip.reason);
    emit(eligible.skip.message); return null;
  }
  const rows = new RoundTelemetry(telemetry, ports, context, scopeIdentity(context, ports, eligible));
  return await decideAndCommit(context, round, eligible, rows, telemetry, cycleStarted);
}

/** Stored review facts available to a round which ended before its findings were established. */
function storedRounds(loaded: Loaded | null) {
  const found = loaded?.kind === 'found' ? loaded.mission : null;
  return { repository: found ? String(found.repositoryId) : null, rounds: found?.review?.rounds };
}

/** Identity of a round which ended before its findings were established. */
function skippedIdentity(context: LoopContext, round: ReviewRound, ports: ReviewClassificationPorts, loaded: Loaded | null, reason: string) {
  const { repository, rounds } = storedRounds(loaded);
  const number = rounds?.at(-1)?.number ?? context.state.round;
  return { repository, decisionId: decisionIdFor(ports, [repository, context.slug, number, reason]), round: number,
    priorRevision: String(rounds?.at(-2)?.subject.revision ?? ''),
    candidateRevision: String(round.verifiedRevision ?? rounds?.at(-1)?.subject.revision ?? ''), findingIds: [] as string[] };
}

function scopeIdentity(context: LoopContext, ports: ReviewClassificationPorts, scope: ReviewScope) {
  const { current, baseRevision, candidateRevision, findings } = scope;
  return { repository: String(scope.mission.repositoryId), round: current.number, priorRevision: baseRevision,
    candidateRevision, findingIds: findings.map(f => String(f.id)),
    decisionId: decisionIdFor(ports, [scope.mission.repositoryId, context.slug, current.number,
      baseRevision, candidateRevision, findings.map(f => f.id).sort((left, right) => left.localeCompare(right))]) };
}

/** Human corrections for this round, sent to the classifier as evidence rather than used to skip it. */
function humanFeedbackText(context: LoopContext, round: ReviewRound): string {
  const sources = context.state.metadata.humanFeedbackSources;
  const listed = Array.isArray(sources) ? sources.join(', ') : sources ? String(sources) : '';
  return [round.humanFeedback, listed ? `Feedback sources: ${listed}` : ''].filter(Boolean).join('\n\n');
}

/** What the mission is for, sent as context when the round is judged against its success criteria. */
function briefText(mission: Mission): string {
  const { goal, why, scope } = mission.brief ?? { goal: '', why: '', scope: null };
  return [goal && `Mission goal: ${goal}`, why && `Why: ${why}`, scope && `Scope: ${scope}`].filter(Boolean).join('\n');
}

/** Evidence text for the classifier: the prior reviewer outcome and implementer response, the revoked gate, or the mission brief. */
function evidenceText(review: Review, prior: DomainReviewRound | undefined, mission: Mission,
  scope: { verifiedRepair: boolean; repairCause: ReviewScope['repairCause'] }): { comment: string; response: string } {
  if (!prior || !(scope.verifiedRepair || prior.decision?.kind === 'changes-requested')) { return { comment: briefText(mission), response: '' }; }
  const eventContent = (type: string) => review.reviewEvents.filter(e => e.roundNumber === prior.number && e.eventType === type).at(-1)?.content || '';
  if (scope.verifiedRepair) {
    return { comment: `Integration approval was revoked because ${scope.repairCause!.gate} failed: ${scope.repairCause!.log ?? 'no retained gate output'}.`,
      response: 'The repaired revision passed the declared pre-review verification.' };
  }
  const requested = prior.decision?.kind === 'changes-requested' ? prior.decision : null;
  const comment = requested?.comment && !['REQUEST_CHANGES', 'request-changes'].includes(requested.comment.trim())
    ? requested.comment : eventContent('reviewer_outcome');
  return { comment, response: prior.implementerResponseContent || eventContent('implementer_round_summary') };
}

/** What the previous round left open for this round: answered findings, a withdrawn gate, or neither. */
function reviewShape(round: ReviewRound, prior: DomainReviewRound | undefined, candidateRevision: string) {
  const revocation = prior?.decision?.kind === 'approved' ? prior.decision.revocation : undefined;
  const repairCause = revocation?.cause?.kind === 'integration-gate-failure' ? revocation.cause : null;
  const changesRequested = prior?.decision?.kind === 'changes-requested' ? prior.decision : null;
  return {
    repairCause, changesRequested,
    verifiedRepair: Boolean(repairCause && round.integrationRepair && round.verifiedRevision === candidateRevision),
  };
}

/** Why classification cannot even look at this round: opted out or required ports missing. */
function unavailableReason(context: LoopContext): { reason: string; message: string } | null {
  const { classification: ports, missionStore: store, lifecycle } = context.ports;
  if (!ports || ports.mode === 'disabled') { return { reason: 'opted-out', message: 'unavailable or disabled' }; }
  return !store || !lifecycle || !context.ports.provider ? { reason: 'ports-unavailable', message: 'ineligible due to review context' } : null;
}

/** Why the stored round lacks the data its obligations need, or null when it can be judged. */
function dataSkip(context: LoopContext, review: Review, shape: ReturnType<typeof reviewShape>, mission: Mission): { reason: string; message: string } | null {
  const current = review.rounds.at(-1)!;
  if (current.decision || current.number !== context.state.round) {
    return { reason: 'review-evidence-unavailable', message: 'ineligible because review evidence is unavailable' };
  }
  if (shape.repairCause && !shape.verifiedRepair) {
    return { reason: 'integration-repair-unverified', message: 'ineligible integration repair lacks verified revision evidence' };
  }
  if (shape.changesRequested && !review.rounds.at(-2)?.response) {
    return { reason: 'implementer-response-missing', message: 'ineligible because the implementer has not answered the prior findings' };
  }
  return !shape.changesRequested && !shape.repairCause && !mission.successCriteria?.length
    ? { reason: 'no-success-criteria', message: 'ineligible because the mission records no success criteria' } : null;
}

/** The prior findings, the withdrawn gate, or the mission success criteria this round must satisfy. */
function obligations(shape: ReturnType<typeof reviewShape>, mission: Mission): readonly ReviewFinding[] {
  if (shape.changesRequested) { return shape.changesRequested.findings; }
  return shape.repairCause ? [integrationRepairFinding(shape.repairCause)] : successCriteriaFindings(mission.successCriteria ?? []);
}

/** Pure scope derivation: the prior findings, withdrawn gate or success criteria this round is judged against. */
function assessEligibility(context: LoopContext, round: ReviewRound, loaded: Loaded | null): Eligibility {
  const unavailable = unavailableReason(context);
  if (unavailable) { return { skip: unavailable }; }
  if (loaded?.kind !== 'found' || !loaded.mission.review) {
    return { skip: { reason: 'review-evidence-unavailable', message: 'ineligible because review evidence is unavailable' } };
  }
  const { mission, version } = loaded;
  const review = mission.review!;
  const current = review.rounds.at(-1)!;
  const prior = review.rounds.at(-2);
  const candidateRevision = round.verifiedRevision ?? String(current.subject.revision);
  const shape = reviewShape(round, prior, candidateRevision);
  const { repairCause, changesRequested, verifiedRepair } = shape;
  const skip = dataSkip(context, review, shape, mission);
  if (skip) { return { skip }; }
  const answered = Boolean(prior && (changesRequested || repairCause));
  const findings = obligations(shape, mission);
  const text = evidenceText(review, prior, mission, { verifiedRepair, repairCause });
  return {
    mission, version, review, current, prior: answered ? prior! : null, candidateRevision, original: prior?.decision ?? null,
    baseRevision: answered ? String(prior!.subject.revision) : current.subject.change.targetBranch,
    repairCause, verifiedRepair, findings, evidenceComment: text.comment, evidenceResponse: text.response, humanFeedback: humanFeedbackText(context, round),
  };
}

interface Decision {
  readonly selected: ClassificationRoute & { readonly route: 'clear' | 'implementer' };
  readonly provider: string;
  readonly model: string;
  readonly packetHash: string;
}

/** Calls the classifier for the scope; a null decision means the general reviewer decides. */
async function decideAndCommit(context: LoopContext, round: ReviewRound, scope: ReviewScope, rows: RoundTelemetry,
  telemetry: ReviewClassificationTelemetryPort, cycleStarted?: number): Promise<Outcome> {
  const ports = context.ports.classification!;
  const { baseRevision, candidateRevision, findings, original } = scope;
  const emit = (value: string) => context.emit({ kind: 'reviewer-classification', reason: value });
  const fallback = async (why: string, message = why) => { await rows.finish(why); emit(message); return null; };
  const started = cycleStarted ?? ports.clock();
  // Classifier output is never evidence for another classifier decision: the
  // next round must return to the general reviewer and regain human rationale.
  if (original?.classifier) { return await fallback('prior-classifier-review'); }
  let decision: Decision;
  try {
    const availability = await ports.decision.available();
    if (availability.status !== 'available') { return await fallback('provider-unavailable', 'provider unavailable'); }
    rows.note({ provider: availability.provider, model: availability.model });
    const packet = await buildEvidencePacket({
      priorRevision: baseRevision, candidateRevision,
      findings, priorReviewComment: scope.evidenceComment, implementerResponse: scope.evidenceResponse,
      ...(scope.humanFeedback ? { humanFeedback: scope.humanFeedback } : {}),
    }, ports.evidence, context.ports.worktree, request => ports.decision.requestBytes(request));
    const packetHash = ports.hash(JSON.stringify(packet.request));
    rows.note({ preparationMs: ports.clock() - started, packetHash });
    const classifyStart = ports.clock();
    let result;
    try { result = await ports.decision.decide(packet.request); }
    catch {
      rows.note({ classificationMs: ports.clock() - classifyStart });
      return await fallback('classifier-failure');
    }
    const selected = classifyFindings(result);
    rows.note({ label: selected.label, score: selected.score, provider: result.provider, model: result.model, classificationMs: ports.clock() - classifyStart });
    if (selected.route === 'reviewer' || ports.mode === 'shadow') {
      await rows.finish(selected.reason, { route: selected.route });
      emit(selected.route === 'reviewer' ? selected.reason : 'shadow fallback'); return null;
    }
    decision = { selected: { ...selected, route: selected.route }, provider: result.provider, model: result.model, packetHash };
  } catch {
    return await fallback('classifier-exception', 'classifier exception; using general reviewer');
  }
  return await commitDecision(context, round, scope, decision, rows, telemetry, started);
}

/** Typed provenance binding the decision to the exact scope it judged. */
function classifierSource(scope: ReviewScope, decision: Decision, decisionId: string, findingIds: readonly string[]): ClassifierReviewSource {
  const { prior, current, candidateRevision, original } = scope;
  return {
    kind: 'classifier', identity: 'jev', decisionId, provider: decision.provider, model: decision.model,
    packetHash: decision.packetHash, priorRevision: prior ? String(prior.subject.revision) : candidateRevision, candidateRevision,
    ...(prior ? { responseRevision: String(scope.verifiedRepair ? current.subject.revision : prior.response!.resultingRevision) }
      : { successCriteria: { baseRef: scope.baseRevision } }),
    ...(scope.verifiedRepair && original?.kind === 'approved'
      ? { integrationRepair: { revokedAt: original.revocation!.revokedAt, gate: scope.repairCause!.gate } } : {}),
    findingIds: [...findingIds], policyVersion: ROUTING_POLICY_VERSION, label: decision.selected.label!, score: decision.selected.score!,
  };
}

/** Publish first, then persist; persistence failure after publication escalates to a human. */
async function commitDecision(context: LoopContext, round: ReviewRound, scope: ReviewScope, decision: Decision, rows: RoundTelemetry,
  telemetry: ReviewClassificationTelemetryPort, started: number): Promise<Outcome> {
  const ports = context.ports.classification!;
  const { missionStore: store, lifecycle } = context.ports;
  const { prior, candidateRevision, findings } = scope;
  const { selected } = decision;
  const firstReview = prior === null;
  const decisionId = rows.current.decisionId;
  const fallback = async (why: string) => { await rows.finish(why); context.emit({ kind: 'reviewer-classification', reason: why }); return null; };
  let published = false;
  let committed: 'APPROVED' | 'REQUEST_CHANGES' | null = null;
  try {
    const source = classifierSource(scope, decision, decisionId, rows.current.findingIds);
    const at = ports.now();
    // Mission events move the version while the classifier runs; decide on the latest record rather than discard the decision.
    const latest = await store!.load(scope.mission.id);
    if (latest.kind !== 'found' || !latest.mission.review) { return await fallback('review-evidence-unavailable'); }
    const updated = applyClassifierReview(reviewAtCandidateRevision(latest.mission.review, candidateRevision), source, selected.route, at, firstReview ? findings : []);
    const summary = `${updated.rounds.at(-1)!.decision!.comment}\n\nScope: ${source.findingIds.join(', ')}; revision: ${source.candidateRevision}; policy: ${source.policyVersion}; selected score: ${source.score}.\n[classifier-decision:${decisionId}]`;
    if (!(await ports.publish(source, selected.route, summary))) { return await fallback('classifier-publication-failed'); }
    published = true;
    await rows.finish(selected.reason, { route: selected.route });
    const transition = await lifecycle!.transition({
      operationId: `classifier:${decisionId}`, missionId: scope.mission.id, expectedVersion: latest.version,
      capabilities: new Set(['mission:transition']), command: { type: selected.route === 'clear' ? 'approve' : 'request-changes', review: updated },
      actor: 'jev', occurredAt: at,
    });
    if (transition.status !== 'completed') {
      await context.escalateToHumanReview('CLASSIFIER_REVIEW_PERSIST_FAILURE'); return 'stop';
    }
    committed = selected.route === 'clear' ? 'APPROVED' : 'REQUEST_CHANGES';
    round.blockingFindings = selected.route === 'implementer' ? findings.map(f => ({ id: String(f.id), summary: f.summary })) : [];
    await telemetry.recordObservation({ decisionId, revision: source.candidateRevision, findingIds: source.findingIds,
      observedAt: ports.now(), originalFindings: 'unobserved', newFindings: null,
      cycleMs: ports.clock() - started, ordinaryReviewMs: null });
    context.ports.output.log(`Classifier: ${selected.route === 'clear' ? 'cleared the findings' : 'likely unresolved findings'} (${source.findingIds.join(', ')}).`);
    return committed;
  } catch {
    if (committed) { return committed; }
    if (published) {
      await context.escalateToHumanReview('CLASSIFIER_REVIEW_PERSIST_FAILURE'); return 'stop';
    }
    return await fallback('classifier-exception');
  }
}
