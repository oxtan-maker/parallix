import type { Review, ReviewRound } from '../../domain/review.js'; import type { CheckpointData } from '../../domain/checkpoint.js';
import type { MissionStore } from '../domain-ports.js';
import type { GateEvidenceReader, GateEvidenceScope, IntegrationGateEvidence } from '../ports/gate-evidence.js';
import type { OperationalHistoryEntry } from '../ports/operation-history.js';
import type { OperationalHistoryService } from '../services/operational-history-service.js';
import type { VerificationHistoryEntry } from './belief.js';
export type PolicyHistory = { readonly ok: true; readonly entries: readonly VerificationHistoryEntry[]; readonly tests: 'observed' | 'unobserved' } | { readonly ok: false; readonly failure: { readonly kind: 'unavailable' | 'invalid' | 'contradiction' | 'unmodelled-history'; readonly message: string } };
type FailureKind = Extract<PolicyHistory, { ok: false }>['failure']['kind'];
type Slot = { readonly at: number; readonly order: number; readonly entry: VerificationHistoryEntry }; type Repair = { readonly occurrence: string; readonly gates: ReadonlySet<string>; readonly at: number; readonly complete: boolean };
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
  const slots: Slot[] = [{ at: decided, order: round.number * 10, entry: { kind: 'verdict', check, passed: false } }];
  if (!round.response) { return slots; }
  const responded = instant(round.response.respondedAt, `${label} repair`);
  if (responded < decided) { reject('contradiction', `${label} repair predates its verdict`); }
  return [...slots, { at: responded, order: round.number * 10 + 1, entry: { kind: 'repair', check } }];
}
function gateIncident(round: ReviewRound, gate: string, label: string) {
  const assessment = round.integrationRepairAssessment, incident = assessment?.repair;
  if (!incident || assessment?.failedGate !== gate || incident.cause.gate !== gate) { throw new Unmapped('unmodelled-history', `${label} gate failure has no matching repair assessment`); } return incident;
}
function approvalSlots(round: ReviewRound, next: ReviewRound | undefined, repairs: readonly Repair[], decided: number, label: string): Slot[] {
  const decision = round.decision!;
  if (decision.kind !== 'approved') { return []; }
  if (decision.source.kind === 'mechanical-restoration') { reject('unmodelled-history', `${label} uses a retained approval`); }
  const slots: Slot[] = [{ at: decided, order: round.number * 10, entry: { kind: 'verdict', check: 'agent', passed: true } }];
  if (!decision.revocation) { return slots; }
  const revoked = decision.revocation, cause = decision.revocation.cause, revokedAt = instant(revoked.revokedAt, `${label} revocation`);
  if (cause?.kind !== 'integration-gate-failure') { return [...slots, { at: revokedAt, order: round.number * 10 + 1, entry: { kind: 'unmodelled-change' } }]; }
  if (!cause.gate) { throw new Unmapped('unmodelled-history', `${label} gate failure has no matching repair assessment`); }
  const gate = cause.gate, incident = gateIncident(round, gate, label);
  const failed = instant(incident.startedAt, `${label} gate failure`);
  if (revokedAt < failed) { reject('contradiction', `${label} revocation predates its gate failure`); }
  const nextDecision = next?.decision ? instant(next.decision.decidedAt, `round ${next.number} decision`) : Number.POSITIVE_INFINITY, nextIncident = next?.integrationRepairAssessment?.repair?.startedAt ? instant(next.integrationRepairAssessment.repair.startedAt, `round ${next.number} gate failure`) : Number.POSITIVE_INFINITY;
  const repaired = repairs.find(item => item.complete && item.gates.has(gate) && item.at >= failed && item.at <= Math.min(nextDecision, nextIncident));
  slots.push({ at: failed, order: round.number * 10 + 2, entry: { kind: 'verdict', check: 'tests', passed: false } });
  if (repaired) { slots.push({ at: repaired.at, order: round.number * 10 + 3, entry: { kind: 'repair', check: 'tests' } }); }
  return slots;
}
function validateRoundIdentity(round: ReviewRound, prior: ReviewRound | undefined): void {
  if (prior && round.number <= prior.number) { reject('invalid', 'review rounds are not strictly ordered'); }
}
function roundSlots(rounds: readonly ReviewRound[], repairs: readonly Repair[]): Slot[] {
  return rounds.flatMap((round, index) => {
    const prior = rounds[index - 1], next = rounds.slice(index + 1).find(item => item.decision || item.integrationRepairAssessment?.repair), label = `round ${round.number}`;
    validateRoundIdentity(round, prior);
    const decision = round.decision;
    if (!decision) { return []; }
    const decided = instant(decision.decidedAt, `${label} decision`);
    return decision.kind === 'changes-requested' ? changeSlots(round, decided, label) : approvalSlots(round, next, repairs, decided, label);
  });
}
function gateSlot(gates: IntegrationGateEvidence | null, testsAlreadyFailed: boolean): { slot?: Slot; observed: boolean } {
  if (!gates || gates.checkout.kind !== 'present' || gates.configured.length === 0) { return { observed: false }; }
  const outcomes = gates.configured.map(key => gates.gates.find(item => item.key === key));
  if (outcomes.some(item => !item)) { return { observed: true }; }
  for (const item of outcomes) {
    if (item!.proof.state === 'current' && item!.failure?.state === 'current') { reject('contradiction', `gate ${item!.key} both passed and failed`); }
  }
  const failures = outcomes.flatMap(item => item!.failure?.state === 'current' ? [item!.failure] : []);
  if (failures.length && !testsAlreadyFailed) {
    return { observed: true, slot: { at: Math.max(...failures.map(item => instant(item.observedAt, 'gate failure'))), order: 1e6, entry: { kind: 'verdict', check: 'tests', passed: false } } };
  }
  if (outcomes.every(item => item!.proof.state === 'current')) {
    return { observed: true, slot: { at: Math.max(...outcomes.map(item => instant((item!.proof as { observedAt: string }).observedAt, 'gate proof'))), order: 1e6, entry: { kind: 'verdict', check: 'tests', passed: true } } };
  }
  return { observed: true };
}
/** Pure mapping of authoritative review, gate and completed-repair facts into ordered policy history. */
export function adaptVerificationHistory(review: Review | null, gates: IntegrationGateEvidence | null,
  repairRows: readonly OperationalHistoryEntry[] = [], repairCheckpoints: readonly CheckpointData[] = []): PolicyHistory {
  try {
    const slots = roundSlots(review?.rounds ?? [], repairsFrom(repairRows, repairCheckpoints));
    slots.sort((left, right) => left.at - right.at || left.order - right.order); const pending = slots.findIndex((slot, index) => slot.entry.kind === 'verdict' && !slot.entry.passed && slots[index + 1]?.entry.kind !== 'repair'); if (pending >= 0) { slots.splice(pending + 1); }
    const gate = gateSlot(gates, slots.some(item => item.entry.kind === 'verdict' && item.entry.check === 'tests' && !item.entry.passed)); if (gate.slot && pending < 0) { slots.push(gate.slot); }
    slots.sort((left, right) => left.at - right.at || left.order - right.order);
    return { ok: true, entries: slots.map(item => item.entry), tests: gate.observed ? 'observed' : 'unobserved' };
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
}
/** Read through the existing typed owners only; unavailable facts fail to the fixed policy. */
export async function readVerificationHistory(ports: PolicyHistoryPorts, scope: GateEvidenceScope): Promise<PolicyHistory> {
  try {
    const loaded = await ports.store.load(scope.missionId);
    if (loaded.kind !== 'found') { return { ok: false, failure: { kind: 'unavailable', message: 'the Mission record could not be read' } }; }
    const [gates, repairs] = await Promise.all([
      ports.gates.readIntegrationGates(scope, null), ports.history.loadAllByTypeForMission('rebound.repair', scope.missionId),
    ]);
    return adaptVerificationHistory(loaded.mission.review ?? null, gates, repairs, loaded.mission.checkpoints);
  } catch { return { ok: false, failure: { kind: 'unavailable', message: 'verification history could not be read' } }; }
}
