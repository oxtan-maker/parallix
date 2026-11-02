import { AGENT_COMMAND_COMPLETION_CONTRACT } from './agent-completion-contract.js';
import type { RebaseContext } from './rebase-context.js';
import { readAgentLaunchIntent } from './agent-launch-context.js';
import type { MissionConflictClassification } from './ports/rebase-workflow.js';

export interface RebasePromptRequest {
  slug: string;
  area: string;
  worktreePath: string;
  missionBranch?: string;
  missionIntent?: string;
  rebaseInProgress?: boolean;
  conflictsFromIndex?: boolean;
  completionDiagnostic?: string;
  missionSpecificFiles: string[];
  sharedFiles: string[];
  /** Base branch the mission rebases onto; must not throw. */
  resolveBaseBranch: (_slug: string, _worktreePath: string) => string;
  formatVerificationCommand: (_area: string, _worktreePath: string) => string;
}

/** Build the prompt for the agent during shared-file conflict resolution. */
export function buildRebasePrompt({
  slug, area, worktreePath, missionBranch, missionIntent, missionSpecificFiles, sharedFiles, resolveBaseBranch, formatVerificationCommand,
  rebaseInProgress = true, conflictsFromIndex = true, completionDiagnostic,
}: RebasePromptRequest): string {
  const missionFileCommands = missionSpecificFiles
    .map(f => `  git checkout --theirs "${f}" && git add "${f}"`)
    .join('\n');
  const sharedFileList = sharedFiles.map(f => `  - ${f}`).join('\n');
  const primaryBranch = resolveBaseBranch(slug, worktreePath);

  const hasConflicts = missionSpecificFiles.length + sharedFiles.length > 0;
  return [
    'Mode: rebase conflict-resolution.',
    '',
    `Mission: ${slug}`,
    `Mission worktree: ${worktreePath}`,
    `Captured mission branch: ${missionBranch ?? `mission/${slug}`}`,
    missionIntent ?? 'Authoritative Mission intent unavailable. Do not invent missing intent; stop with paths and evidence if resolution depends on it.',
    '',
    completionDiagnostic ? `Completion diagnostic:\n${completionDiagnostic}`
      : rebaseInProgress ? `Rebase onto ${primaryBranch} paused on conflicts.` : `Workflow detected conflicts for rebase onto ${primaryBranch}.`,
    `Resolved local rebase base: ${primaryBranch}`,
    conflictsFromIndex || completionDiagnostic ? 'Current unmerged paths from Git:' : 'Predicted conflict paths from workflow (index has no unmerged paths):',
    ...[...missionSpecificFiles, ...sharedFiles].map(file => `  - ${file}`),
    ...(!missionSpecificFiles.length && !sharedFiles.length ? ['  (none)'] : []),
    '',
    ...(hasConflicts ? [
      'Step 1 — Resolve mission-specific conflicts (--theirs):',
      missionFileCommands.length > 0
        ? missionFileCommands
        : '  (none — all conflicts are shared files)',
      '',
      'Step 2 — Resolve shared-file conflicts:',
      sharedFileList,
      '',
      'Step 3 — Resolve and stage every current conflict before continuing:',
      '  Resolve the conflict, then git add "<file>" for EVERY resolved file.',
      '  Stage all resolved conflicts, then git rebase --continue.',
      '',
      'Step 4 — Repeat Steps 1-4 until the rebase completes.',
      '',
    ] : ['Repair the completion diagnostic above; inspect Git state before continuing or changing the checkout.', '']),
    hasConflicts ? 'Step 5 — Verify:' : 'Verify:',
    `  ${formatVerificationCommand(area, worktreePath)}`,
    '  Confirm git status reports no rebase in progress and no unmerged files.',
    '  Run the repository verification above against the final repaired tree.',
    '  If any required check fails, report the failure and stop; do not report completion until it passes.',
    '  Integration eligibility is checked later, after the required independent review.',
    '',
    'Rules:',
    AGENT_COMMAND_COMPLETION_CONTRACT,
    '- Take --theirs for every mission-specific file listed above.',
    '- For shared files, inspect the conflict markers and resolve sensibly.',
    '- Review shared conflicts semantically; never apply blanket ours/theirs.',
    '- Before resolving unexpectedly replayed inherited work, inspect the target branch, Git history and actual diffs. Preserve intended Mission changes and current base behavior.',
    '- Do not restore obsolete code or task metadata merely to apply an old commit; respect base-side relocations and completed work.',
    '- Use ordinary Git rebase tools when the intended range is clear. If unclear, explain the specific uncertainty with paths and evidence; stop for ambiguous intent or a human decision.',
    '- Stage every resolved file with git add before each git rebase --continue.',
    '- A rebase pause on a new conflict is an expected stop: resolve and stage it, then continue. This is not a command failure.',
    '- Repeat through successive conflict pauses using the current Git index; rediscover all unmerged paths after each continue.',
    '- Only a failed command (hook, verification, infrastructure) is a stop-and-report failure.',
  ].join('\n');
}

/** Construct every new resolver task from Mission authority and the current paused index. */
export async function buildCurrentRebasePrompt(ctx: RebaseContext, conflicts: MissionConflictClassification, completionDiagnostic?: string): Promise<string> {
  const { port, slug, executionRoot } = ctx;
  const services = await port.missionServices?.(executionRoot);
  const missionIntent = await readAgentLaunchIntent(services?.store ?? null, slug);
  const current = port.detectRebaseState(executionRoot);
  return buildRebasePrompt({ slug, area: ctx.area, worktreePath: executionRoot,
    missionBranch: ctx.branch, missionIntent, completionDiagnostic,
    rebaseInProgress: current.inProgress, conflictsFromIndex: current.unmergedFiles.length > 0, missionSpecificFiles: conflicts.missionSpecificFiles,
    sharedFiles: conflicts.sharedFiles,
    resolveBaseBranch: () => ctx.baseBranch,
    formatVerificationCommand: (area, root) => port.formatVerificationCommand(area, root),
  });
}
