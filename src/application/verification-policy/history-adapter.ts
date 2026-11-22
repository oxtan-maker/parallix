import type { Review, ReviewRound } from '../../domain/review.js'; import type { CheckpointData } from '../../domain/checkpoint.js';
import type { ApprovalCoverage } from '../../domain/approval-coverage.js';
import { isEffectiveReviewerResult } from '../../domain/reviewer-result.js';
import type { MissionStore } from '../domain-ports.js';
import type { GateEvidenceReader, GateEvidenceScope, GateResultEvidence, IntegrationGateEvidence } from '../ports/gate-evidence.js';
import type { LifecycleHistoryEntry, OperationalHistoryEntry } from '../ports/operation-history.js';
import { isSuccessfulRebaseOutcome } from '../ports/rebase-workflow.js';
import type { WorkflowOperation } from '../../domain/workflow-operation.js';
import type { OperationalHistoryService } from '../services/operational-history-service.js';
import { assessApprovalCoverage } from '../../domain/approval-coverage.js';
import { observeLandedChange, type ChangeIdentityPort } from '../approval-coverage.js';
import { observedRebases, type RebaseMeasurement } from '../projections/verification-observation-reader.js';
import { verificationHistoryRecord, type BeliefRecord, type VerificationHistoryEntry } from './belief.js';
/**
 * What the durable integration gate runs say about the current change: `passed` only when every configured gate
 * has a current proof, `failed` on a current failure, `not-current` when the only evidence covers other verification inputs
 * (another revision, change identity or checkout state), and `unobserved` when no gate run exists, so a plan or approval never reads as a pass.
 */
export type IntegrationTestsState = 'passed' | 'failed' | 'not-current' | 'unobserved';
export type PolicyHistory = { readonly ok: true; readonly entries: readonly VerificationHistoryEntry[];
  readonly record: BeliefRecord; readonly tests: IntegrationTestsState }
  | { readonly ok: false; readonly failure: { readonly kind: 'unavailable' | 'invalid' | 'contradiction' | 'unmodelled-history'; readonly message: string } };
type FailureKind = Extract<PolicyHistory, { ok: false }>['failure']['kind'];
type Slot = { readonly at: number; readonly order: number; readonly entry: VerificationHistoryEntry }; type Repair = { readonly occurrence: string; readonly gates: ReadonlySet<string>; readonly at: number; readonly complete: boolean };
type ApprovedDecision = Extract<NonNullable<ReviewRound['decision']>, { readonly kind: 'approved' }>;
export interface VerificationHistoryFacts {
  readonly rebases?: readonly RebaseMeasurement[];
  readonly lifecycle?: readonly LifecycleHistoryEntry[];
  readonly identity?: ChangeIdentityPort;
  readonly approvalCoverage?: ReadonlyMap<number, ApprovalCoverage | null>;
}
class Unmapped extends Error { constructor(readonly kind: FailureKind, message: string) { super(message); } }
const reject = (kind: FailureKind, message: string): never => { throw new Unmapped(kind, message); };
const instant = (value: unknown, label: string): number => { const parsed = typeof value === 'string' ? Date.parse(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : reject('invalid', `${label} has no valid time`); };
function repairGates(checkpoints: readonly CheckpointData[]): Map<string, Set<string>> {
  const gates = new Map<string, Set<string>>();
  for (const checkpoint of checkpoints) {
    const repair = checkpoint.repair;
    if (!repair) { continue; }
    const incidentGates = gates.get(repair.incidentId) ?? new Set<string>();
    if (repair.gateKey) { incidentGates.add(repair.gateKey); }
    gates.set(repair.incidentId, incidentGates);
  }
  return gates;
}
function repairsFrom(rows: readonly OperationalHistoryEntry[], checkpoints: readonly CheckpointData[]): Repair[] {
  const gates = repairGates(checkpoints);
  const repairs = new Map<string, Repair>();
  for (const row of rows) {
    let value = {} as Record<string, unknown>;
    try { value = JSON.parse(row.eventData) as Record<string, unknown>; } catch { reject('invalid', 'a repair record is malformed'); }
    if (typeof value.occurrenceId !== 'string' || typeof value.reasonKind !== 'string'
      || !['pass', 'rescue', 'advance', 'escalate'].includes(String(value.outcome))) {
      reject('invalid', 'a repair record is incomplete');
    }
    if (value.reasonKind !== 'gate-failure') { continue; }
    const candidate: Repair = { occurrence: value.occurrenceId as string, gates: gates.get(value.occurrenceId as string) ?? new Set(), at: instant(row.createdAt, 'repair record'), complete: value.outcome === 'pass' || value.outcome === 'rescue' };
    const prior = repairs.get(candidate.occurrence);
    if (prior && candidate.at < prior.at) { reject('contradiction', 'repair attempts disagree'); }
    if (!prior || candidate.complete) { repairs.set(candidate.occurrence, candidate); }
  }
  return [...repairs.values()];
}
function changeSlots(round: ReviewRound, decided: number, label: string): Slot[] {
  const check = round.decision?.kind === 'changes-requested' && round.decision.source?.kind === 'operator' ? 'human' : 'agent';
  const effective = new Map<string, NonNullable<ReviewRound['reviewerResults']>[number]>();
  if (check === 'human') {
    for (const result of round.reviewerResults ?? []) {
      if (result.revision === round.subject.revision && isEffectiveReviewerResult(result)
        && !effective.has(result.agentFamily)) { effective.set(result.agentFamily, result); }
    }
  }
  const agentResults = [...effective.values()];
  const agentResult = agentResults.length === 0 ? null : {
    passed: agentResults.every(result => result.decision === 'approved'),
    at: Math.max(...agentResults.map(result => instant(result.publishedAt, `${label} agent verdict`))),
  };
  const slots: Slot[] = [
    ...(agentResult ? [{ at: agentResult.at, order: round.number * 10 - 1,
      entry: { kind: 'verdict' as const, check: 'agent' as const, passed: agentResult.passed } }] : []),
    { at: decided, order: round.number * 10, entry: { kind: 'verdict', check, passed: false } },
  ];
  if (!round.response) { return slots; }
  const responded = instant(round.response.respondedAt, `${label} repair`);
  if (responded < decided) { reject('contradiction', `${label} repair predates its verdict`); }
  return [...slots, { at: responded, order: round.number * 10 + 1, entry: { kind: 'repair', check } }];
}
function integrationIncidentGate(round: ReviewRound, decision: ApprovedDecision, label: string): string | null {
  const assessment = round.integrationRepairAssessment, incident = assessment?.repair;
  if (!incident && !decision.revocation) { return null; }
  const revocation = decision.revocation;
  const revokedGate = revocation?.cause?.kind === 'integration-gate-failure'
    && typeof revocation.cause.gate === 'string' ? revocation.cause.gate : null;
  const gate: string | null | undefined = revokedGate ?? incident?.cause.gate;
  if (!gate || !incident || assessment?.failedGate !== gate || incident.cause.gate !== gate) {
    throw new Unmapped('unmodelled-history', `${label} gate failure has no matching repair assessment`);
  }
  return gate;
}
function incidentRepair(gate: string, failed: number, next: ReviewRound | undefined,
  repairs: readonly Repair[]): Repair | undefined {
  const nextDecision = next?.decision ? instant(next.decision.decidedAt, `round ${next.number} decision`) : Number.POSITIVE_INFINITY;
  const nextRepair = next?.integrationRepairAssessment?.repair;
  const nextIncident = next && nextRepair?.startedAt
    ? instant(nextRepair.startedAt, `round ${next.number} gate failure`) : Number.POSITIVE_INFINITY;
  return repairs.find(item => item.complete && item.gates.has(gate)
    && item.at >= failed && item.at <= Math.min(nextDecision, nextIncident));
}
function integrationIncidentSlots(round: ReviewRound, next: ReviewRound | undefined,
  repairs: readonly Repair[], decision: ApprovedDecision, label: string): Slot[] {
  const gate = integrationIncidentGate(round, decision, label);
  if (gate === null) { return []; }
  const incident = round.integrationRepairAssessment!.repair!;
  const failed = instant(incident.startedAt, `${label} gate failure`);
  if (decision.revocation && instant(decision.revocation.revokedAt, `${label} revocation`) < failed) {
    reject('contradiction', `${label} revocation predates its gate failure`);
  }
  const repaired = incidentRepair(gate, failed, next, repairs);
  const slots: Slot[] = [{ at: failed, order: round.number * 10 + 2, entry: { kind: 'verdict', check: 'tests', passed: false } }];
  return repaired
    ? [...slots, { at: repaired.at, order: round.number * 10 + 3, entry: { kind: 'repair', check: 'tests' } }]
    : slots;
}
function approvalSlots(round: ReviewRound, next: ReviewRound | undefined, repairs: readonly Repair[], decided: number, label: string): Slot[] {
  const decision = round.decision!;
  if (decision.kind !== 'approved') { return []; }
  if (decision.source.kind === 'mechanical-restoration') { reject('unmodelled-history', `${label} uses a retained approval without coverage`); }
  const approved: Slot = { at: decided, order: round.number * 10, entry: { kind: 'verdict', check: 'agent', passed: true } };
  if (decision.revocation && decision.revocation.cause?.kind !== 'integration-gate-failure') {
    const revokedAt = instant(decision.revocation.revokedAt, `${label} revocation`);
    return [approved, { at: revokedAt, order: round.number * 10 + 1, entry: { kind: 'unmodelled-change' } }];
  }
  return [approved, ...integrationIncidentSlots(round, next, repairs, decision, label)];
}
function sameChange(left: ReviewRound['subject']['change'], right: ReviewRound['subject']['change']): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}
/**
 * A rebuttal is a response whose resulting revision is the revision under review (recordImplementerResolution
 * accepts that only when every finding is disputed): the same checks apply, so the
 * next round is expected on that revision and its verdict, when there is one, follows the repair. No verdict yet
 * leaves the record at the repair, never a fabricated pass or failure.
 */
function expectedNextRevision(prior: ReviewRound): string | null {
  if (prior.response) { return prior.response.resultingRevision; }
  const repair = prior.integrationRepairAssessment;
  if (repair?.repair) { return repair.candidateRevision; }
  return prior.subject.revision;
}
function hasSameRevisionIdentity(left: string | null, right: string | null, targetBranch: string,
  identity: ChangeIdentityPort | undefined): boolean {
  if (left === right) { return true; }
  if (!left || !right || !identity) { return false; }
  const leftIdentity = identity.changeIdentity(left, targetBranch);
  const rightIdentity = identity.changeIdentity(right, targetBranch);
  if (leftIdentity === null || rightIdentity === null) {
    reject('unavailable', `change identity for ${targetBranch} is unavailable`);
  }
  return leftIdentity === rightIdentity;
}
function validateRoundIdentity(round: ReviewRound, prior: ReviewRound | undefined,
  identity: ChangeIdentityPort | undefined): { slots: Slot[]; decisionMatches: boolean } {
  if (prior && round.number <= prior.number) { reject('invalid', 'review rounds are not strictly ordered'); }
  const slots: Slot[] = [];
  const targetBranch = round.subject.change.targetBranch;
  if (prior && (round.decision || round.response) && (!sameChange(prior.subject.change, round.subject.change)
    || !hasSameRevisionIdentity(expectedNextRevision(prior), round.subject.revision, targetBranch, identity))) {
    slots.push({ at: instant(round.startedAt, `round ${round.number} start`), order: round.number * 10 - 1,
      entry: { kind: 'unmodelled-change' } });
  }
  const revision = round.decision?.revision;
  if (round.decision && !revision) { reject('unmodelled-history', `round ${round.number} decision has no revision`); }
  const decisionMatches = !revision
    || hasSameRevisionIdentity(round.subject.revision, revision, targetBranch, identity);
  if (revision && !decisionMatches) {
    slots.push({ at: instant(round.decision!.decidedAt, `round ${round.number} decision`), order: round.number * 10,
      entry: { kind: 'unmodelled-change' } });
  }
  return { slots, decisionMatches };
}
function retainedApprovalSlot(round: ReviewRound, coverage: ApprovalCoverage | null | undefined, at: number): Slot[] {
  const retained = round.integrationRepairAssessment?.outcome === 'retained'
    || round.decision?.kind === 'approved' && round.decision.source.kind === 'mechanical-restoration';
  if (!retained) { return []; }
  if (!coverage) { throw new Unmapped('unmodelled-history', `round ${round.number} retained approval has no coverage`); }
  if (coverage.kind === 'unverifiable') { reject('unavailable', `round ${round.number} retained approval is unverifiable: ${coverage.reason}`); }
  if (coverage.kind !== 'covers' || coverage.round !== round.number) {
    reject('contradiction', `round ${round.number} retained approval is not covered`);
  }
  return [{ at, order: round.number * 10 + 4, entry: { kind: 'retained-pass', check: 'agent' } }];
}
function roundSlots(rounds: readonly ReviewRound[], repairs: readonly Repair[],
  coverage: ReadonlyMap<number, ApprovalCoverage | null>, identity: ChangeIdentityPort | undefined): Slot[] {
  return rounds.flatMap((round, index) => {
    const prior = rounds[index - 1], next = rounds.slice(index + 1).find(item => item.decision || item.integrationRepairAssessment?.repair), label = `round ${round.number}`;
    const validation = validateRoundIdentity(round, prior, identity);
    const decision = round.decision;
    if (!decision) { return validation.slots; }
    const decided = instant(decision.decidedAt, `${label} decision`);
    if (!validation.decisionMatches) { return validation.slots; }
    if (decision.kind === 'changes-requested') { return [...validation.slots, ...changeSlots(round, decided, label)]; }
    if (decision.source.kind === 'mechanical-restoration') {
      return [...validation.slots, ...retainedApprovalSlot(round, coverage.get(round.number), decided)];
    }
    const approvals = approvalSlots(round, next, repairs, decided, label);
    const repairedAt = approvals.find(item => item.entry.kind === 'repair' && item.entry.check === 'tests')?.at;
    const retainedAt = repairedAt === undefined ? decided
      : Math.max(repairedAt, instant(round.integrationRepairAssessment?.assessedAt, `${label} retention assessment`));
    return [...validation.slots, ...approvals, ...retainedApprovalSlot(round, coverage.get(round.number), retainedAt)];
  });
}
function gateResultMatchesCheckout(revision: string | null, checkoutRevision: string,
  targetBranch: string | undefined, identity: ChangeIdentityPort | undefined): boolean {
  if (revision === checkoutRevision) { return true; }
  return targetBranch ? hasSameRevisionIdentity(revision, checkoutRevision, targetBranch, identity) : false;
}
/** One gate's newest observation wins, as the board's gate state does: a failure only outranks a current proof recorded after it. */
function newestCurrentResult(gate: IntegrationGateEvidence['gates'][number]): IntegrationGateEvidence['gates'][number] {
  const { proof, failure } = gate;
  if (proof.state !== 'current' || failure?.state !== 'current') { return gate; }
  return instant(failure.observedAt, `gate ${gate.key} failure`) <= instant(proof.observedAt, `gate ${gate.key} proof`)
    ? { ...gate, failure: null } : { ...gate, proof: { state: 'absent' } };
}
type GateRow = IntegrationGateEvidence['gates'][number];
/** Current evidence for another change identity is not current for this checkout; it is demoted before any newest-result or aggregate rule runs. */
function currentForCheckout(row: GateRow, covers: (_revision: string | null) => boolean, mismatched: GateResultEvidence[]): GateRow {
  const demote = <T extends GateResultEvidence>(result: T): T => {
    if (result.state !== 'current' || covers(result.revision)) { return result; }
    mismatched.push(result);
    return { ...result, state: 'stale' };
  };
  return newestCurrentResult({ ...row, proof: row.proof.state === 'absent' ? row.proof : demote(row.proof),
    failure: row.failure && demote(row.failure) });
}
function gateSlot(gates: IntegrationGateEvidence | null, testsAlreadyFailed: boolean,
  targetBranch: string | undefined, identity: ChangeIdentityPort | undefined): { slot?: Slot; tests: IntegrationTestsState } {
  if (!gates || gates.checkout.kind !== 'present' || gates.configured.length === 0) { return { tests: 'unobserved' }; }
  const checkoutRevision = gates.checkout.revision;
  const mismatched: GateResultEvidence[] = [];
  const covers = (revision: string | null) => gateResultMatchesCheckout(revision, checkoutRevision, targetBranch, identity);
  // A configured key with no recorded row is an absent result, so rows that do exist still decide failed or not-current as the board does.
  const outcomes = gates.configured.map(key => currentForCheckout(gates.gates.find(item => item.key === key)
    ?? { key, proof: { state: 'absent' }, failure: null }, covers, mismatched));
  const failures = outcomes.flatMap(item => item.failure?.state === 'current' ? [item.failure] : []);
  if (failures.length) {
    return { tests: 'failed', ...(testsAlreadyFailed ? {} : { slot: { at: Math.max(...failures.map(item => instant(item.observedAt, 'gate failure'))), order: 1e6, entry: { kind: 'verdict', check: 'tests', passed: false } } }) };
  }
  if (outcomes.every(item => item.proof.state === 'current')) {
    return { tests: 'passed', slot: { at: Math.max(...outcomes.map(item => instant((item.proof as { observedAt: string }).observedAt, 'gate proof'))), order: 1e6, entry: { kind: 'verdict', check: 'tests', passed: true } } };
  }
  if (mismatched.length) {
    return { tests: 'not-current', slot: { at: Math.max(...mismatched.map(item => instant(item.observedAt, 'gate result'))),
      order: 1e6, entry: { kind: 'unmodelled-change' } } };
  }
  return { tests: outcomes.some(item => item.proof.state === 'stale' || item.failure) ? 'not-current' : 'unobserved' };
}
/**
 * Rebases are outside the model. A completed rebase carries a judgement only when the existing identity owner says
 * the before and after revisions are the same change. A conflicted or failed run may be completed outside the
 * recorded operation; its next observation continues the chain only when that intervening revision has the same
 * identity too. Identity-changing conflict resolution therefore remains an unmodelled change.
 */
function rebaseTransparent(identity: ChangeIdentityPort | undefined, rebases: readonly RebaseMeasurement[]): ChangeIdentityPort | undefined {
  if (!identity) { return identity; }
  const root = new Map<string, string>();
  const ordered = [...rebases].sort((left, right) => instant(left.occurredAt, 'rebase observation') - instant(right.occurredAt, 'rebase observation')
    || left.attempt - right.attempt);
  let unfinished: { readonly id: string; readonly root: string } | null = null;
  for (const rebase of ordered) {
    const before = rebase.revisionBefore;
    if (!before) { continue; }
    const sameIdentity = (left: string, right: string) => {
      if (!rebase.baseBranch) { return false; }
      const leftIdentity = identity.changeIdentity(left, rebase.baseBranch);
      const rightIdentity = identity.changeIdentity(right, rebase.baseBranch);
      return leftIdentity !== null && rightIdentity !== null && leftIdentity === rightIdentity;
    };
    if (unfinished && rebase.id !== unfinished.id && sameIdentity(unfinished.root, before)) {
      root.set(before, unfinished.root);
    }
    const base = root.get(before) ?? before;
    if (isSuccessfulRebaseOutcome(rebase.outcome)) {
      if (rebase.revisionAfter && sameIdentity(base, rebase.revisionAfter)) { root.set(rebase.revisionAfter, base); }
      unfinished = null;
    } else if (rebase.outcome === 'conflict' || rebase.outcome === 'failed') {
      unfinished = { id: rebase.id, root: base };
    }
  }
  if (root.size === 0) { return identity; }
  return Object.assign(Object.create(identity) as ChangeIdentityPort, {
    changeIdentity: (revision: string, targetBranch: string) => identity.changeIdentity(root.get(revision) ?? revision, targetBranch) });
}
function lifecycleSlots(lifecycle: readonly LifecycleHistoryEntry[]): Slot[] {
  return lifecycle.flatMap((event, index) => {
    if (event.returnIdentityDefect) { reject('invalid', event.returnIdentityDefect); }
    return event.returnIdentity?.stage === 'declared-gates'
      ? [{ at: instant(event.occurredAt, 'declared-gates return'), order: 3e6 + index,
        entry: { kind: 'unmodelled-change' } as const }] : [];
  });
}
function normalizeRepairAttempts(slots: Slot[]): Slot[] {
  const pending: Extract<VerificationHistoryEntry, { readonly kind: 'verdict' }>['check'][] = [];
  const retained: Slot[] = [];
  for (const slot of slots) {
    const entry = slot.entry;
    if (entry.kind === 'verdict') {
      const previous = pending.indexOf(entry.check);
      if (entry.passed) {
        if (previous >= 0) { pending.splice(previous, 1); }
        else if (pending.length > 0) { break; }
      } else {
        if (previous >= 0) { pending.splice(previous, 1); }
        pending.push(entry.check);
      }
      retained.push(slot);
      continue;
    }
    if (entry.kind === 'repair') {
      if (pending.length === 0 || !pending.includes(entry.check)) { retained.push(slot); continue; }
      retained.push(...pending.map((check, index) => ({ ...slot, order: slot.order + index / 10,
        entry: { kind: 'repair' as const, check } })));
      pending.splice(0);
      continue;
    }
    if (entry.kind === 'unmodelled-change') { pending.splice(0); retained.push(slot); continue; }
    if (pending.length > 0) { break; }
    retained.push(slot);
  }
  return retained;
}
function mappedHistorySlots(review: Review | null, repairRows: readonly OperationalHistoryEntry[],
  repairCheckpoints: readonly CheckpointData[], facts: VerificationHistoryFacts): Slot[] {
  const repairs = repairsFrom(repairRows, repairCheckpoints);
  const slots = [...roundSlots(review?.rounds ?? [], repairs, facts.approvalCoverage ?? new Map(), facts.identity),
    ...lifecycleSlots(facts.lifecycle ?? [])];
  slots.sort((left, right) => left.at - right.at || left.order - right.order);
  return normalizeRepairAttempts(slots);
}
function withGateSlot(mapped: Slot[], gates: IntegrationGateEvidence | null, review: Review | null,
  identity: ChangeIdentityPort | undefined) {
  const testsFailed = mapped.some(item => item.entry.kind === 'verdict'
    && item.entry.check === 'tests' && !item.entry.passed);
  const targetBranch = review?.rounds.at(-1)?.subject.change.targetBranch;
  const gate = gateSlot(gates, testsFailed, targetBranch, identity);
  const latest = mapped.at(-1)?.entry;
  const pendingFailedVerdict = latest?.kind === 'verdict' && !latest.passed;
  if (gate.slot && (!pendingFailedVerdict || gate.slot.entry.kind === 'unmodelled-change')) { mapped.push(gate.slot); }
  mapped.sort((left, right) => left.at - right.at || left.order - right.order);
  return { mapped, tests: gate.tests };
}
/** Pure mapping of authoritative review, gate and completed-repair facts into ordered policy history. */
export function adaptVerificationHistory(review: Review | null, gates: IntegrationGateEvidence | null,
  repairRows: readonly OperationalHistoryEntry[] = [], repairCheckpoints: readonly CheckpointData[] = [],
  facts: VerificationHistoryFacts = {}): PolicyHistory {
  try {
    const identity = rebaseTransparent(facts.identity, facts.rebases ?? []);
    const { mapped, tests } = withGateSlot(mappedHistorySlots(review, repairRows, repairCheckpoints, { ...facts, identity }),
      gates, review, identity);
    const entries = mapped.map(item => item.entry);
    return { ok: true, entries, record: verificationHistoryRecord(entries), tests };
  } catch (error) {
    const failure = error instanceof Unmapped ? { kind: error.kind, message: error.message }
      : { kind: 'invalid' as const, message: 'recorded facts could not be read' };
    return { ok: false, failure };
  }
}
export interface PolicyHistoryPorts {
  readonly store: Pick<MissionStore, 'load'>;
  readonly gates: Pick<GateEvidenceReader, 'readIntegrationGates'>;
  readonly history: Pick<OperationalHistoryService, 'loadAllByTypeForMission'>;
  readonly lifecycle: { findByMissionId(_missionId: string): Promise<readonly LifecycleHistoryEntry[]> };
  readonly operations: { all(): Promise<readonly WorkflowOperation[]> };
  readonly identity: ChangeIdentityPort & { beginRead?(): void };
}
function coverageByRound(review: Review | null, identity: ChangeIdentityPort): ReadonlyMap<number, ApprovalCoverage | null> {
  const coverage = new Map<number, ApprovalCoverage | null>();
  review?.rounds.forEach((round, index) => {
    if (round.decision?.kind !== 'approved') { return; }
    const prefix = { ...review, rounds: review.rounds.slice(0, index + 1) as unknown as Review['rounds'] };
    const landedRevision = round.integrationRepairAssessment?.candidateRevision
      ?? (round.decision.source.kind === 'mechanical-restoration' ? round.decision.source.candidateRevision : round.decision.revision);
    coverage.set(round.number, assessApprovalCoverage(prefix,
      observeLandedChange(prefix, identity, { landedRevision: landedRevision ?? null })));
  });
  return coverage;
}
/** Read through the existing typed owners only; unavailable facts fail to the fixed policy. */
export async function readVerificationHistory(ports: PolicyHistoryPorts, scope: GateEvidenceScope): Promise<PolicyHistory> {
  try {
    const loaded = await ports.store.load(scope.missionId);
    if (loaded.kind !== 'found') { return { ok: false, failure: { kind: 'unavailable', message: 'the Mission record could not be read' } }; }
    ports.identity.beginRead?.();
    const [gates, repairs, rebaseRows, lifecycle, operations] = await Promise.all([
      ports.gates.readIntegrationGates(scope, null), ports.history.loadAllByTypeForMission('rebound.repair', scope.missionId),
      ports.history.loadAllByTypeForMission('flow.rebase', scope.missionId), ports.lifecycle.findByMissionId(scope.missionId), ports.operations.all(),
    ]);
    if (lifecycle.some(event => event.repositoryId !== scope.repositoryId || event.missionId !== scope.missionId)) {
      return { ok: false, failure: { kind: 'unmodelled-history', message: 'lifecycle history identity does not match the Mission' } };
    }
    const unknowns = new Set<string>(), diagnostics: import('../projections/verification-diagnostic.js').ObservationDiagnostic[] = [];
    const rebases = observedRebases({ repositoryId: scope.repositoryId, history: rebaseRows, operations }, unknowns, diagnostics);
    if (unknowns.size || diagnostics.length) {
      return { ok: false, failure: { kind: 'unmodelled-history', message: [...unknowns, ...diagnostics.map(item => item.message)].join('; ') } };
    }
    const review = loaded.mission.review ?? null;
    return adaptVerificationHistory(review, gates, repairs, loaded.mission.checkpoints,
      { rebases, lifecycle, identity: ports.identity, approvalCoverage: coverageByRound(review, ports.identity) });
  } catch { return { ok: false, failure: { kind: 'unavailable', message: 'verification history could not be read' } }; }
}
