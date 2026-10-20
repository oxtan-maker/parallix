import { mergeFixturePort } from './merge-fixture-port.js';
import { fixtureMission } from '../fixtures/mission-builders.js';
import { missionVersion } from '../../src/application/domain-ports.js';
import { missionId } from '../../src/domain/mission.js';
import { agentFamily } from '../../src/domain/agents.js';
import { phaseGateResult } from './phase-gate-result.js';
/**
 * Fully stubbed `HandoffWorkflowPorts` for hermetic handoff tests (TASK-2332.09).
 *
 * Every collaborator is a plain in-memory stub. No test using these touches
 * Forgejo, an agent CLI, a real git repository, or a recursive workflow command.
 */
import { isTransientVerificationFailure } from '../../src/adapters/verification/verification.js';
import type { HandoffWorkflowPorts } from '../../src/application/ports/handoff-workflow.js';

export const SLUG = 'task-2332.09';
export const ROOT = '/root';
export const MISSION_DIR = '/root/missions/task-2332.09';
export const CHECKPOINT = '/root/missions/task-2332.09/CP-1.md';
export const BRANCH = 'mission/task-2332.09';
/**
 * A Mission drafted before the typed contract verbs: no recorded brief, gates
 * or checkpoints, so handoff takes its document path. A Mission the store does
 * not hold fails handoff closed instead.
 */
export const LEGACY_MISSION_LOAD = { kind: 'found', mission: fixtureMission(SLUG, { assignee: agentFamily('claude'), checkpoints: [], brief: null, declaredGates: [] }), version: missionVersion(1) } as const;
export const RECORDED_MISSION_LOAD = {
  kind: 'found',
  mission: fixtureMission(SLUG, {
    assignee: agentFamily('claude'),
    checkpoints: [{ missionId: missionId(SLUG), name: 'CP-1', goalCheck: [{ criterion: 'Workflow re-homed', evidence: 'src/application/handoff-command-use-case.ts' }], nextActionText: 'review' }],
    brief: { goal: 'g', why: 'w', scope: 's', outOfScope: [] },
    successCriteria: ['Workflow re-homed'],
    completedSuccessCriteria: [0],
    declaredGates: ['npm run typecheck'],
  }),
  version: missionVersion(1),
} as const;

export const CHECKPOINT_CONTENT = [
  '# CP-1: Example',
  '',
  '## Goal Check',
  '',
  '| Criterion | Evidence | Status |',
  '|---|---|---|',
  '| Workflow re-homed | src/application/handoff-command-use-case.ts:1 | PASS |',
  '',
  'Next action: hand off.',
  '',
].join('\n');

export const MISSION_CONTENT = [
  '# Mission',
  '',
  '## Gates',
  '',
  '- [ ] `npm run typecheck`',
  '',
  '## Stop Rules',
  '',
].join('\n');

export interface Recorder {
  readonly log: string[];
  readonly errors: string[];
  readonly relaunches: number[];
  readonly transitions: string[];
  readonly gatekeeperCalls: number[];
  readonly spawned: string[];
}

export function makeRecorder(): Recorder {
  return { log: [], errors: [], relaunches: [], transitions: [], gatekeeperCalls: [], spawned: [] };
}

/**
 * A fully stubbed port bag whose defaults drive a successful handoff.
 * Each test overrides only the ports its scenario needs.
 */
type HandoffOverrides = Omit<{ [K in keyof HandoffWorkflowPorts]?: Partial<HandoffWorkflowPorts[K]> }, 'missionServices'> & Pick<Partial<HandoffWorkflowPorts>, 'missionServices'>;

export function makePorts(recorder: Recorder, overrides: HandoffOverrides = {}): HandoffWorkflowPorts {
  const files: Record<string, string> = {
    [CHECKPOINT]: CHECKPOINT_CONTENT,
    [`${MISSION_DIR}/MISSION.md`]: MISSION_CONTENT,
  };
  const base: HandoffWorkflowPorts = {
    fileSystem: {
      existsSync: () => true,
      readText: (target: string) => files[target] ?? '',
      writeText: (target: string, content: string) => { files[target] = content; },
      listNames: () => [],
      listEntries: () => [],
    },
    git: {
      commitMissionChanges: () => ({ repaired: false, blocker: null }),
      git: (args: readonly string[]) => ({ signal: null,  status: 0, stdout: args.includes('rev-parse') ? 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' : '', stderr: '' }),
      run: () => ({ signal: null, stdout: '', stderr: '',  status: 0 }),
      getCurrentBranch: () => BRANCH,
      getWorktreeStatus: () => [] as string[],
    },
    missionUtils: {
      inferSlug: (explicit?: string) => explicit,
      resolveWorktree: () => ROOT,
      findMissionDir: () => MISSION_DIR,
      findMissionArea: () => 'docs',
      missionBranchName: () => BRANCH,
      findCheckpoints: () => [CHECKPOINT],
      getPrimaryBranch: () => 'main',
    },
    backlog: {
      resolveTaskFile: () => ({ ok: true as const, taskFile: '/root/backlog/tasks/task-2332.09.md' }),
      getTaskImplementer: () => 'claude',
      transitionTask: (_slug: string, status: string) => { recorder.transitions.push(status); return true; },
    },
    forgejo: {
      readToken: () => 'token',
      resolveForgejoSettings: () => ({ url: 'http://localhost', repo: 'human/parallix' }),
      createPr: () => ({ ok: true as const }),
      authenticatedReviewUrl: () => 'http://localhost/human/parallix.git',
      resolveTrackingBranchSha: () => ({ ok: true as const, sha: 'abc123' }),
    },
    reviewIdentity: {
      resolveReviewIdentity: async () => ({ forgejoUser: 'claude' }),
    },
    setupReview: {
      bootstrapReviewSurface: async () => ({ ok: true as const }),
      apiRequest: () => ({ ok: true as const, statusCode: 200, data: null, error: null }),
    },
    rebase: {
      rebaseBeforeReviewRound: async () => ({ ok: true as const }),
    },
    gatekeeper: {
      runGatekeeper: () => { recorder.gatekeeperCalls.push(1); return { ok: true as const, missing: [] } },
    },
    repositoryGates: {
      // Default: an unconfigured checkout runs no gate. Task-2457 tests inject
      // a configured gate or a failing runner via overrides.
      loadPhaseGates: () => [],
      runPhaseGates: async () => (phaseGateResult({ ok: true, skipped: true, executed: 0, failedGate: null, error: null })),
    },
    verification: {
      resolveEffectiveArea: () => 'workflow',
      formatVerificationCommand: () => 'npm run typecheck',
      createVerificationProofIdentity: () => ({ ok: true as const, identity: 'proof-1' }),
      readReusableVerificationProof: () => ({ ok: false as const, error: 'no proof' }),
      writeReusableVerificationProof: () => ({ ok: true as const, identity: 'proof-1' }),
      runVerificationGate: () => ({ status: 0, stdout: '', stderr: '' }),
      isTransientVerificationFailure,
    },
    nel: {
      computeNELRecord: () => ({ nel: 120, bucket: { label: 'Medium' } }),
    },
    documentWriter: { write: () => '/fixture/document.json' },
    productConfig: { isForgejoReviewEnabled: () => false },
    agents: {
      startAgent: async () => { recorder.relaunches.push(1); throw new Error('no launcher'); },
    },
    agentSelection: {
      eligibleAgentsForStep: () => ['claude', 'codex'],
      selectAgent: () => 'codex',
    },
    process: {
      spawnSync: (_cmd: string, args: string[]) => { recorder.spawned.push(args[1]); return { status: 0, stdout: '', stderr: '' }; },
    },
    missionServices: async () => ({
      checkpoints: { record: async () => ({ durableEvidence: [],  status: 'completed' as const }) },
      lifecycle: { transition: async () => ({ durableEvidence: [],  status: 'completed' as const, value: { version: missionVersion(3), mission: RECORDED_MISSION_LOAD.mission, previousAssignee: null, from: 'active', to: 'review', laneChanged: true } }) },
      store: { load: async () => RECORDED_MISSION_LOAD },
      handoff: { recordNel: async () => ({ durableEvidence: [],  status: 'completed' as const }) },
    }),
  };
  return {
    fileSystem: mergeFixturePort(base.fileSystem, overrides.fileSystem),
    git: mergeFixturePort(base.git, overrides.git),
    missionUtils: mergeFixturePort(base.missionUtils, overrides.missionUtils),
    backlog: mergeFixturePort(base.backlog, overrides.backlog),
    forgejo: mergeFixturePort(base.forgejo, overrides.forgejo),
    reviewIdentity: mergeFixturePort(base.reviewIdentity, overrides.reviewIdentity),
    setupReview: mergeFixturePort(base.setupReview, overrides.setupReview),
    rebase: mergeFixturePort(base.rebase, overrides.rebase),
    gatekeeper: mergeFixturePort(base.gatekeeper, overrides.gatekeeper),
    repositoryGates: mergeFixturePort(base.repositoryGates, overrides.repositoryGates),
    verification: mergeFixturePort(base.verification, overrides.verification),
    nel: mergeFixturePort(base.nel, overrides.nel),
    documentWriter: mergeFixturePort(base.documentWriter, overrides.documentWriter),
    productConfig: mergeFixturePort(base.productConfig, overrides.productConfig),
    agents: mergeFixturePort(base.agents, overrides.agents),
    agentSelection: mergeFixturePort(base.agentSelection, overrides.agentSelection),
    process: mergeFixturePort(base.process, overrides.process),
    missionServices: 'missionServices' in overrides ? overrides.missionServices : base.missionServices,
  };
}

export function runOptions(recorder: Recorder, extra: Record<string, unknown> = {}) {
  return {
    worktree: ROOT,
    log: (line: string) => recorder.log.push(String(line)),
    error: (line: string) => recorder.errors.push(String(line)),
    ...extra,
  };
}

/** Full lifecycle receipt facts for handoff orchestration fixtures. */
export function handoffTransitionValue(version = missionVersion(3)): import('../../src/application/mission-lifecycle-service.js').MissionTransitionResult {
  return { version, mission: RECORDED_MISSION_LOAD.mission, previousAssignee: null, from: 'active', to: 'review', laneChanged: true };
}
