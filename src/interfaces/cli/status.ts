import * as fmt from '../../application/presentation/cli-format.js';
import type { StatusResult } from '../../application/status-command-use-case.js';
import type { StatusMissionData, StatusPrInfo } from '../../application/ports/cli-workflows.js';
import { describeCoordinatorEvidence, describeMissionWork } from '../../application/projections/mission-activity.js';

/** Parse public CLI flags for the status command. */
export interface StatusCliRequest {
  /** Explicit slug argument, or undefined for inferred slug. */
  readonly explicitSlug?: string;
}

/** Parse status CLI args without consulting filesystem or adapter state. */
export function parseStatusCliRequest(args: string[]): StatusCliRequest {
  const positional: string[] = [];
  for (const arg of args) {
    if (arg.startsWith('--')) {
      throw new Error(`Unknown status option: ${arg}`);
    }
    positional.push(arg);
  }
  return { explicitSlug: positional[0] };
}

/** Render the complete status output from a StatusResult. */
/** `n unmerged file(s)` plus one line per file, under a caller-supplied heading. */
function logRebaseFiles(heading: string, rebaseInfo: { detached: boolean; unmergedFiles: readonly string[] }, log: (_msg: string) => void): void {
  const detachedText = rebaseInfo.detached ? 'detached HEAD, ' : '';
  log(`${heading}: ${detachedText}${rebaseInfo.unmergedFiles.length} unmerged file(s)`);
  for (const file of rebaseInfo.unmergedFiles) { log(`  - ${file}`); }
}

/** Every settled round, so a verdict survives a reviewer reroute. */
function logReviewRounds(missionData: StatusMissionData, log: (_msg: string) => void): void {
  if (!missionData.reviewPhase) { log('Review: not started'); return; }
  log(`Review: round ${missionData.reviewRound ?? 1}, phase ${missionData.reviewPhase}, disposition ${missionData.reviewDisposition ?? 'none'}`);
  if (missionData.approvalOwed) {
    log('Formal approval owed: external provider approval is still required after the local self-review.');
  }
  for (const round of missionData.reviewHistory) {
    log(`  Round ${round.number} [${round.reviewer} -> ${round.implementer}]: ${round.disposition ?? 'pending'}`);
    if (round.comment) { log(`    comment: ${round.comment}`); }
    for (const summary of round.findingSummaries) { log(`    finding: ${summary}`); }
    for (const fix of round.fixes) { log(`    fixed: ${fix}`); }
    for (const pushback of round.pushbacks) { log(`    pushback: ${pushback}`); }
  }
}

function logMissionData(missionData: StatusMissionData | null, log: (_msg: string) => void): void {
  if (!missionData) {
    log('Backlog status: unknown (projection unavailable)');
    log('Last checkpoint: none');
    return;
  }
  log(`Backlog status: ${missionData.backlogStatus}`);
  // The same two facts the TUI agent strip renders, from the same projection:
  // authoritative work first, then the recovery-only evidence that a `px`
  // coordinator process exists. Keeping them on separate lines is deliberate —
  // a live coordinator is not a running agent.
  if (missionData.activity) {
    log(`Mission work: ${describeMissionWork(missionData.activity.work)}`);
    log(`Coordinator evidence: ${describeCoordinatorEvidence(missionData.activity.coordinator)}`);
  }
  log(missionData.checkpoint
    ? `Last checkpoint: ${missionData.checkpoint} - ${missionData.checkpointDescription || ''}`
    : 'Last checkpoint: none');
  logReviewRounds(missionData, log);
}

function logPrInfo(prInfo: StatusPrInfo | null, log: (_msg: string) => void): void {
  if (!prInfo) { return; }
  if (prInfo.exists && prInfo.number !== undefined && prInfo.state) {
    log(`Forgejo PR: #${prInfo.number} (${prInfo.state})`);
    return;
  }
  log(prInfo.raw ? `Forgejo PR: unavailable (${prInfo.raw})` : 'Forgejo PR: none');
}

function logStaleWorktrees(result: StatusResult, log: (_msg: string) => void): void {
  for (const entry of result.staleWorktrees) {
    log(`Stale worktree: ${fmt.path(entry.path)} (task: ${entry.taskStatus})`);
    const rebaseInfo = result.staleWorktreeRebase[entry.path];
    if (rebaseInfo?.inProgress) {
      const branchName = entry.branch ? entry.branch.replace(/^refs\/heads\//, '') : '(detached HEAD)';
      logRebaseFiles(`Rebase in progress on ${branchName}`, rebaseInfo, log);
    }
    log(`  Cleanup: ${fmt.command(entry.cleanupCommand)}`);
  }
}

function logAgentMatrix(result: StatusResult, log: (_msg: string) => void): void {
  log('Agent launcher matrix:');
  for (const entry of result.agentMatrix) {
    const support = entry.supported ? 'supported' : 'blocked';
    const draftMark = entry.draftEligible ? 'draft' : '-';
    const activeMark = entry.activeEligible ? 'active' : '-';
    log(`  ${fmt.agent(entry.agent)}: ${support} | eligible: ${draftMark},${activeMark}`);
  }
  if (result.agentOverride) { log(`  (WORKFLOW_AGENT override: ${fmt.agent(result.agentOverride)})`); }
}

export function renderStatus(result: StatusResult, log: (_msg: string) => void): void {
  log(fmt.bold('--- Mission Status ---'));
  log(`Branch: ${fmt.branch(result.branch)}`);
  log(`Worktree: ${fmt.path(result.worktree)}`);

  // Rebase diagnostics for current worktree. This heading always says "detached
  // HEAD" because the branch only renders when the rebase is detached.
  if (result.rebaseInfo?.inProgress && result.rebaseInfo.detached) {
    logRebaseFiles('Detached HEAD: rebase in progress', result.rebaseInfo, log);
  }

  if (result.slug) {
    logMissionData(result.missionData, log);
    logPrInfo(result.prInfo, log);
  }

  logStaleWorktrees(result, log);
  logAgentMatrix(result, log);

  log('Last 3 commits:');
  for (const c of result.lastThreeCommits) { log(`  - ${c}`); }

  log(`Uncommitted files: ${result.uncommittedCount}`);
  log(fmt.bold('----------------------'));
}

/** Map a parse error to the status CLI's established diagnostic format. */
function formatParseError(error: Error): string {
  return fmt.status('FAIL', error.message);
}

export interface StatusCommandOptions {
  readonly exitFn?: (_code?: number) => never;
  readonly logFn?: (_msg: string) => void;
  readonly errorFn?: (_msg: string) => void;
}

/** Create the status CLI command that delegates to the use case. */
export function createStatusCommand(useCase: { execute: (_rootDir: string, _slug?: string | null) => Promise<StatusResult> }) {
  return async (args: string[], options: StatusCommandOptions = {}) => {
    const errorFn = options.errorFn || fmt.log.plainError;
    const exitFn = options.exitFn || process.exit;
    const logFn = options.logFn || fmt.log.plain;

    let explicitSlug: string | undefined;
    try {
      const request = parseStatusCliRequest(args);
      explicitSlug = request.explicitSlug;
    } catch (error) {
      errorFn(formatParseError(error as Error));
      exitFn(1);
      return;
    }

    const result = await useCase.execute(process.cwd(), explicitSlug ?? null);
    renderStatus(result, logFn);
    exitFn(0);
  };
}
