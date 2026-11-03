import type { GitCommandResult, RebaseWorkflowPort } from '../../src/application/ports/rebase-workflow.js';
import { rebaseWorkflowFixture } from './rebase-workflow-fixture.js';
import { setLogger } from '../../src/application/presentation/cli-format.js';
import { RebaseCommandUseCase } from '../../src/application/rebase-command-use-case.js';

const OK: GitCommandResult = { status: 0, stdout: '', stderr: '' };
const SHARED_FILE = 'src/adapters/git/git.ts';
/** Strip the leading `-C <root>` / `-c <key=value>` globals so index 0 is the subcommand. */
function subcommand(args: string[]): string[] {
  let index = 0;
  while (index + 1 < args.length && (args[index] === '-C' || args[index] === '-c')) { index += 2; }
  return args.slice(index);
}
interface Harness {
  port: RebaseWorkflowPort;
  lines: string[];
  exitCodes: number[];
  agentLaunches: Array<{ step: string; options: Record<string, unknown> }>;
}
export function sharedConflictHarness(overrides: Partial<RebaseWorkflowPort> = {}): Harness {
  const lines: string[] = [];
  const exitCodes: number[] = [];
  const agentLaunches: Array<{ step: string; options: Record<string, unknown> }> = [];
  const port: RebaseWorkflowPort = rebaseWorkflowFixture({
    git: (args: string[]) => {
      const tail = subcommand(args);
      if (tail[0] === 'rebase' && tail[1] === 'main') {
        return { failureReason: { version: 1, code: 'git-conflict', source: 'git' }, signal: null,  status: 1, stdout: '', stderr: `CONFLICT (content): Merge conflict in ${SHARED_FILE}\n` };
      }
      return OK;
    },
    detectRebaseState: () => ({ inProgress: false, unmergedFiles: [] }),
    getCurrentBranch: () => 'mission/task-2503',
    cwd: () => '/repo',
    inferSlug: (explicitSlug?: string) => explicitSlug ?? 'task-2503',
    findMissionDir: () => '/worktree/missions/task-2503',
    findMissionArea: () => 'docs',
    resolveWorktree: () => '/worktree',
    conventionalWorktreePath: () => '/worktrees/task-2503',
    missionBranchName: () => 'mission/task-2503',
    resolveMissionBaseBranch: () => 'main',
    missionConflictPathPrefix: () => 'missions/task-2503/',
    startAgent: async (step: string, options: Record<string, unknown>) => {
      agentLaunches.push({ step, options });
      return { agent: String(options.agent ?? 'pool-selected'), result: { status: 0 } };
    },
    selectAgent: () => 'pool-selected',
    workflowLauncherStatus: (_agent: string) => ({ supported: true, agent: _agent }),
    applyAgentFallback: async () => 'pool-selected',
    createPr: () => ({ ok: true as const }),
    readToken: () => 'token',
    resolveForgejoUser: (user: string | null) => user ?? 'tester',
    fetchReviewBranch: () => OK,
    resolveTaskFile: () => ({ ok: true as const, taskFile: '/worktree/backlog/tasks/task-2503.md', task: {} }),
    getTaskImplementer: () => null,
    transitionTask: async () => undefined,
    resolveReviewIdentity: () => ({ forgejoUser: null }),
    readReviewState: async () => null,
    writeReviewState: async () => ({ outcome: 'committed' as const }),
    persistReviewState: async () => ({ outcome: 'committed' as const }),
    isForgejoReviewEnabled: () => false,
    formatVerificationCommand: () => 'npm test',
    resolveConflictsForMission: () => ({
      ok: true as const,
      conflictFiles: [SHARED_FILE],
      missionSpecificFiles: [],
      sharedFiles: [SHARED_FILE],
    }),
    missionServices: null,
    exit: (code: number) => { exitCodes.push(code); },
    ...overrides,
  });
  return { port, lines, exitCodes, agentLaunches };
}
/** Run the use case with the workflow's terminal output captured. */
export async function run(h: Harness, args: string[] = ['task-2503']): Promise<void> {
  const previous = setLogger({ log: (...parts: unknown[]) => h.lines.push(parts.join(' ')) });
  try {
    await new RebaseCommandUseCase(h.port).execute(args);
  } finally {
    setLogger(previous);
  }
}
