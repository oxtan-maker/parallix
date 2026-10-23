import { OPERATOR_ACTIONS, type OperatorAction, type OperatorEnvelope, type OperatorProposal,
  type OperatorJudgmentPort, type OperatorJudgmentAuthority, type OperatorSnapshot, type OperatorContinuationAdmission } from './ports/operator-judgment.js';

const FRESH_MS = 30_000;
const MAX_INVOCATIONS = 3;
const MISSION_MS = 120_000;
const CALL_MS = 10_000;

function textField(value: unknown, maximum = 512): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= maximum;
}
function proposalIdentity(p: Record<string, unknown>): boolean {
  return textField(p.missionId) && Number.isSafeInteger(p.version) && Number(p.version) >= 1
    && (p.operationId === null || textField(p.operationId)) && textField(p.progress);
}
function evidenceReferences(value: unknown): value is string[] {
  return Array.isArray(value) && value.length > 0 && value.length <= 16
    && value.every(ref => textField(ref, 256));
}
/** Exact parsing is separate from admission: structured output is not permission. */
export function parseOperatorProposal(value: unknown): OperatorProposal {
  if (!value || typeof value !== 'object' || Array.isArray(value)) { throw new Error('malformed proposal'); }
  const p = value as Record<string, unknown>;
  const keys = ['missionId', 'version', 'operationId', 'progress', 'evidenceRefs', 'action', 'summary'];
  if (Object.keys(p).length !== keys.length || keys.some(key => !Object.hasOwn(p, key))
    || !proposalIdentity(p) || !evidenceReferences(p.evidenceRefs)
    || !OPERATOR_ACTIONS.includes(p.action as OperatorAction) || !textField(p.summary)) {
    throw new Error('malformed or unsupported proposal');
  }
  return p as unknown as OperatorProposal;
}
function identity(s: OperatorSnapshot): string {
  return JSON.stringify([s.missionId, s.version, s.operationId, s.progress, s.lane, s.working, s.evidence]);
}
export function admitOperatorProposal(value: unknown, envelope: OperatorEnvelope, current: OperatorSnapshot, now: number): OperatorProposal {
  const p = parseOperatorProposal(value);
  if (now < envelope.observedAt || now - envelope.observedAt > FRESH_MS || identity(envelope) !== identity(current)
    || p.missionId !== current.missionId || p.version !== current.version
    || p.operationId !== current.operationId || p.progress !== current.progress) { throw new Error('stale proposal'); }
  if (!envelope.allowedActions.includes(p.action)
    || p.evidenceRefs.some(ref => !current.evidence.some(e => e.ref === ref))) { throw new Error('unauthorized proposal'); }
  if (p.action === 'continue' && (current.working || !['active', 'review'].includes(current.lane))) {
    throw new Error('continuation not authorized by current work');
  }
  return p;
}

export type OperatorJudgmentResult = { readonly action: OperatorAction; readonly summary: string; readonly admission?: OperatorContinuationAdmission };

/** Run-scoped bookkeeping only. Mission and operation state always come from authorities. */
export class OperatorJudgmentService {
  private readonly started = new Map<string, number>();
  private readonly seen = new Set<string>();
  private readonly counts = new Map<string, number>();
  constructor(private readonly model: OperatorJudgmentPort, private readonly authority: OperatorJudgmentAuthority) {}
  async judge(mission: string): Promise<OperatorJudgmentResult> {
    const started = this.started.get(mission) ?? this.authority.now();
    this.started.set(mission, started);
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const assertActive = () => { if (!active) { throw new Error('Operator judgment time budget exhausted; decision history unconfirmed.'); } };
    try {
      return await Promise.race([this.consult(mission, started, assertActive), new Promise<never>((_, reject) => {
        timer = setTimeout(() => { active = false; reject(new Error('Operator judgment time budget exhausted; decision history unconfirmed.')); }, CALL_MS);
      })]);
    } catch (error) {
      // Even unavailable history must return a terminal public outcome to the
      // fleet. Retrying its failed write cannot establish decision persistence.
      return { action: 'escalate', summary: error instanceof Error ? error.message : 'Operator judgment authority unavailable.' };
    } finally { active = false; if (timer) { clearTimeout(timer); } }
  }
  async assertContinuation(admission: OperatorContinuationAdmission): Promise<void> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const current = await Promise.race([this.authority.read(admission.envelope.missionId), new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('Recovery launch authority read timed out')), CALL_MS);
      })]);
      const started = this.started.get(admission.envelope.missionId);
      if (started === undefined || this.authority.now() - started >= MISSION_MS) {
        throw new Error('Operator judgment Mission time budget exhausted before recovery launch');
      }
      admitOperatorProposal(admission.proposal, admission.envelope, current, this.authority.now());
      if (admission.proposal.action !== 'continue') { throw new Error('Recovery launch requires an admitted continuation'); }
    } finally { if (timer) { clearTimeout(timer); } }
  }
  private async consult(mission: string, started: number, assertActive: () => void): Promise<OperatorJudgmentResult> {
    let current: OperatorSnapshot | undefined;
    const finish = async (action: OperatorAction, summary: string): Promise<OperatorJudgmentResult> => {
      assertActive();
      await this.authority.record({ missionId: mission, action, summary,
        evidenceRefs: current?.evidence.map(e => e.ref) ?? [], invocations: this.counts.get(mission) ?? 0 });
      assertActive();
      if (action !== 'escalate' && this.authority.now() - started >= MISSION_MS) {
        throw new Error('Operator judgment Mission time budget exhausted');
      }
      return { action, summary };
    };
    try {
      current = await this.authority.read(mission);
      assertActive();
      const key = identity(current);
      const count = this.counts.get(mission) ?? 0;
      if (count >= MAX_INVOCATIONS || this.authority.now() - started >= MISSION_MS) {
        return await finish('escalate', 'Operator judgment invocation/time budget exhausted; operator inspection required.');
      }
      if (this.seen.has(key)) { return await finish('wait', 'Unchanged evidence; model not consulted again.'); }
      this.seen.add(key);
      // Reserve before awaiting so concurrent calls cannot duplicate billed work.
      this.counts.set(mission, count + 1);
      const envelope: OperatorEnvelope = { ...current, observedAt: this.authority.now(),
        allowedActions: current.working || !['active', 'review'].includes(current.lane)
          ? ['wait', 'request-evidence', 'escalate'] : OPERATOR_ACTIONS };
      const proposal = await this.model.propose(envelope);
      assertActive();
      const refreshed = await this.authority.read(mission);
      assertActive();
      const admitted = admitOperatorProposal(proposal, envelope, refreshed, this.authority.now());
      if (this.authority.now() - started >= MISSION_MS) { throw new Error('Operator judgment Mission time budget exhausted'); }
      const result = await finish(admitted.action, admitted.summary);
      const final = await this.authority.read(mission);
      assertActive();
      admitOperatorProposal(proposal, envelope, final, this.authority.now());
      if (this.authority.now() - started >= MISSION_MS) { throw new Error('Operator judgment Mission time budget exhausted'); }
      return admitted.action === 'continue' ? { ...result, admission: { envelope, proposal: admitted } } : result;
    } catch (error) {
      return finish('escalate', error instanceof Error ? error.message : 'Operator judgment failed.');
    }
  }
}
