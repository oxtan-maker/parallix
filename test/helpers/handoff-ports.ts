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
export const LEGACY_MISSION_LOAD = { kind: 'found', mission: { checkpoints: [], brief: null, declaredGates: [] }, version: 1 } as const;

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
export function makePorts(recorder: Recorder, overrides: Record<string, unknown> = {}): HandoffWorkflowPorts {
  const files: Record<string, string> = {
    [CHECKPOINT]: CHECKPOINT_CONTENT,
    [`${MISSION_DIR}/MISSION.md`]: MISSION_CONTENT,
  };
  const base = {
    fileSystem: {
      existsSync: () => true,
      readText: (target: string) => files[target] ?? '',
      writeText: (target: string, content: string) => { files[target] = content; },
      listNames: () => [],
      listEntries: () => [],
    },
    git: {
      git: () => ({ status: 0, stdout: '', stderr: '' }),
      run: () => ({ status: 0 }),
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
      resolveTaskFile: () => ({ ok: true, taskFile: '/root/backlog/tasks/task-2332.09.md' }),
      getTaskImplementer: () => 'claude',
      transitionTask: (_slug: string, status: string) => { recorder.transitions.push(status); return true; },
    },
    forgejo: {
      readToken: () => 'token',
      resolveForgejoSettings: () => ({ url: 'http://localhost', repo: 'human/parallix' }),
      createPr: () => ({ ok: true }),
      authenticatedReviewUrl: () => 'http://localhost/human/parallix.git',
      resolveTrackingBranchSha: () => ({ ok: true, sha: 'abc123' }),
    },
    reviewIdentity: {
      resolveReviewIdentity: async () => ({ forgejoUser: 'claude' }),
    },
    setupReview: {
      bootstrapReviewSurface: async () => ({ ok: true }),
      apiRequest: () => ({ ok: true }),
    },
    rebase: {
      rebaseBeforeReviewRound: async () => ({ ok: true }),
    },
    gatekeeper: {
      runGatekeeper: () => { recorder.gatekeeperCalls.push(1); return { ok: true } },
    },
    repositoryGates: {
      // Default: an unconfigured checkout runs no gate. Task-2457 tests inject
      // a configured gate or a failing runner via overrides.
      loadPhaseGates: () => [],
      runPhaseGates: async () => ({ ok: true, skipped: true, executed: 0, failedGate: null, error: null }) as any,
    },
    verification: {
      formatVerificationCommand: () => 'npm run typecheck',
      createVerificationProofIdentity: () => ({ ok: true, identity: 'proof-1' }),
      readReusableVerificationProof: () => ({ ok: false, error: 'no proof' }),
      writeReusableVerificationProof: () => ({ ok: true, identity: 'proof-1' }),
      runVerificationGate: () => ({ status: 0, stdout: '', stderr: '' }),
      isTransientVerificationFailure,
    },
    nel: {
      computeNELRecord: () => ({ nel: 120, bucket: { label: 'Medium' } }),
    },
    documentWriter: { writeJson: () => undefined },
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
      checkpoints: { record: async () => ({ status: 'completed' }) },
      lifecycle: { transition: async () => ({ status: 'completed', value: { version: 3 } }) },
      store: { load: async () => LEGACY_MISSION_LOAD },
      handoff: { recordNel: async () => ({ status: 'completed' }) },
    }),
  };
  return { ...base, ...overrides } as unknown as HandoffWorkflowPorts;
}

export function runOptions(recorder: Recorder, extra: Record<string, unknown> = {}) {
  return {
    worktree: ROOT,
    log: (line: string) => recorder.log.push(String(line)),
    error: (line: string) => recorder.errors.push(String(line)),
    ...extra,
  };
}
