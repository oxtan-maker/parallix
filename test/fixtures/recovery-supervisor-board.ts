// Scripted attention board for the recovery supervisor contract (TASK-2489, ADR 0059).
import assert from 'node:assert/strict';
import type {
  AttentionObservation,
  MissionSupervision,
  Poll,
  RecoveryRequest,
  SupervisorPort,
} from '../../src/application/recovery-supervisor.js';
import type { AttentionReason } from '../../src/application/projections/board.js';
import { OperatorJudgmentService } from '../../src/application/operator-judgment.js';

export const MISSION = 'task-2489-stuck';
export const GATE_FAILED: AttentionReason = { kind: 'gate-failed', detail: 'Gate failed' };
/** A cancellable pause, shaped like the production polling timer. */
export function pause(milliseconds: number): Poll {
  let timer: NodeJS.Timeout | undefined;
  const elapsed = new Promise<void>((resolve) => { timer = setTimeout(resolve, milliseconds); });
  return { elapsed, cancel: () => { if (timer) { clearTimeout(timer); } } };
}
export function item(overrides: Partial<AttentionObservation> = {}): AttentionObservation {
  return {
    missionId: MISSION,
    lane: 'active',
    reason: GATE_FAILED,
    action: { kind: 'active:execute', display: `px active ${overrides.missionId ?? MISSION}` },
    working: false,
    workingDetail: null,
    progress: 'active|failed|-|-|-|-|sha0',
    ...overrides,
  };
}
export const fixtureJudgment: NonNullable<SupervisorPort['judgeRecovery']> = async missionId => {
      const facts = { missionId, version: 1, operationId: null, progress: item().progress, lane: 'active', working: false, evidence: [{ ref: 'fixture', summary: 'fixture' }] };
      return { action: 'continue', summary: 'Verify mission worktree controls.', admission: {
        envelope: { ...facts, observedAt: 0, allowedActions: ['continue'] },
        proposal: { missionId, version: 1, operationId: null, progress: facts.progress, evidenceRefs: ['fixture'], action: 'continue', summary: 'fixture' },
      } };
};
export interface Recorder {
  readonly port: SupervisorPort;
  readonly ran: Array<[string, string]>;
  readonly recoveries: RecoveryRequest[];
  readonly released: string[];
  readonly waits: number[];
  /** Attention-queue reads: one per pass. */
  readonly reads: () => number;
}
/**
 * A board driven by a script of attention queues, one entry per pass. The last
 * entry repeats, so a test says exactly what the board reports at each pass.
 */
export function board(passes: Array<readonly AttentionObservation[]>, options: {
  readonly claimable?: boolean;
  readonly actionFails?: string;
  readonly launchFails?: string;
} = {}): Recorder {
  const ran: Array<[string, string]> = [];
  const recoveries: RecoveryRequest[] = [];
  const released: string[] = [];
  const waits: number[] = [];
  let pass = -1;
  const current = (): readonly AttentionObservation[] => passes[Math.min(Math.max(pass, 0), passes.length - 1)];
  const port: SupervisorPort = {
    judgeRecovery: fixtureJudgment,
    attention: async () => {
      pass += 1;
      return current();
    },
    missionExists: async (mission) => passes.some((entries) => entries.some((entry) => entry.missionId === mission)),
    liveness: async (mission) => {
      const entry = current().find((candidate) => candidate.missionId === mission);
      return { working: entry?.working ?? false, detail: entry?.workingDetail ?? null };
    },
    runAction: async (mission, action) => {
      ran.push([mission, action.kind]);
      if (options.actionFails) { throw new Error(options.actionFails); }
    },
    claimRecovery: async (mission) => {
      if (options.claimable === false) { return null; }
      return async () => { released.push(mission); };
    },
    launchRecovery: async (request) => {
      recoveries.push(request);
      if (options.launchFails) { throw new Error(options.launchFails); }
      return 'claude ran in /tmp/worktree';
    },
    // Recorded, and yielded to the macrotask queue: a pause that resolves
    // synchronously would starve the timers the tests themselves rely on.
    wait: (milliseconds) => {
      waits.push(milliseconds);
      return pause(1);
    },
  };
  return { port, ran, recoveries, released, waits, reads: () => pass + 1 };
}
export function resultFor(results: readonly MissionSupervision[], mission = MISSION): MissionSupervision {
  const found = results.find((result) => result.missionId === mission);
  assert.ok(found, `${mission} was supervised`);
  return found;
}

/**
 * Real judgment policy and admission (TASK-2798) for one observed Mission; only
 * the decision model is scripted: it continues whenever policy offers it.
 */
export function realJudgment(observed: AttentionObservation, now: () => number = () => 1_000) {
  const offered: string[][] = [];
  const service = new OperatorJudgmentService({ propose: async envelope => {
    offered.push([...envelope.allowedActions]);
    return { missionId: envelope.missionId, version: envelope.version, operationId: envelope.operationId,
      progress: envelope.progress, evidenceRefs: envelope.evidence.map(entry => entry.ref),
      action: envelope.allowedActions.includes('continue') ? 'continue' : 'escalate', summary: 'scripted decision' };
  } }, { now, record: () => {},
    read: async missionId => ({ missionId, version: 1, operationId: null, progress: observed.progress, lane: observed.lane,
      working: false, evidence: [{ ref: `mission:${missionId}@1`, summary: 'recorded blocker' }] }) });
  return { offered, judgeRecovery: (missionId: string) => service.judge(missionId) };
}
