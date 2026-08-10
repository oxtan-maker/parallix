import * as fmt from '../../application/presentation/cli-format.js';
import type { StatusResult } from '../../application/status-command-use-case.js';

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
export function renderStatus(result: StatusResult, log: (_msg: string) => void): void {
  log(fmt.bold('--- Mission Status ---'));
  log(`Branch: ${fmt.branch(result.branch)}`);
  log(`Worktree: ${fmt.path(result.worktree)}`);

  // Rebase diagnostics for current worktree
  if (result.rebaseInfo && result.rebaseInfo.inProgress && result.rebaseInfo.detached) {
    const detachedText = 'detached HEAD, ';
    log(`Detached HEAD: rebase in progress: ${detachedText}${result.rebaseInfo.unmergedFiles.length} unmerged file(s)`);
    for (const file of result.rebaseInfo.unmergedFiles) {
      log(`  - ${file}`);
    }
  }

  if (result.slug) {
    // Mission-specific output
    if (result.missionData) {
      const md = result.missionData;
      log(`Backlog status: ${md.backlogStatus}`);
      if (md.checkpoint) {
        log(`Last checkpoint: ${md.checkpoint} - ${md.checkpointDescription || ''}`);
      } else {
        log('Last checkpoint: none');
      }

      if (md.reviewPhase) {
        const disposition = md.reviewDisposition ?? 'none';
        log(`Review: round ${md.reviewRound ?? 1}, phase ${md.reviewPhase}, disposition ${disposition}`);
        for (const round of md.reviewHistory) {
          log(`  Round ${round.number} [${round.reviewer} -> ${round.implementer}]: ${round.disposition ?? 'pending'}`);
          if (round.comment) { log(`    comment: ${round.comment}`); }
          for (const summary of round.findingSummaries) { log(`    finding: ${summary}`); }
          for (const fix of round.fixes) { log(`    fixed: ${fix}`); }
          for (const pushback of round.pushbacks) { log(`    pushback: ${pushback}`); }
        }
      } else {
        log('Review: not started');
      }
    } else {
      log('Backlog status: unknown (projection unavailable)');
      log('Last checkpoint: none');
    }

    // Forgejo PR state
    if (result.prInfo) {
      if (result.prInfo.exists && result.prInfo.number !== undefined && result.prInfo.state) {
        log(`Forgejo PR: #${result.prInfo.number} (${result.prInfo.state})`);
      } else if (result.prInfo.raw) {
        log(`Forgejo PR: unavailable (${result.prInfo.raw})`);
      } else {
        log('Forgejo PR: none');
      }
    }
  }

  // Stale worktrees
  for (const entry of result.staleWorktrees) {
    log(`Stale worktree: ${fmt.path(entry.path)} (task: ${entry.taskStatus})`);
    const rebaseInfo = result.staleWorktreeRebase[entry.path];
    if (rebaseInfo && rebaseInfo.inProgress) {
      const branchName = entry.branch ? entry.branch.replace(/^refs\/heads\//, '') : '(detached HEAD)';
      const detachedText = rebaseInfo.detached ? 'detached HEAD, ' : '';
      log(`Rebase in progress on ${branchName}: ${detachedText}${rebaseInfo.unmergedFiles.length} unmerged file(s)`);
      for (const file of rebaseInfo.unmergedFiles) {
        log(`  - ${file}`);
      }
    }
    log(`  Cleanup: ${fmt.command(entry.cleanupCommand)}`);
  }

  // Agent launcher matrix
  log('Agent launcher matrix:');
  for (const entry of result.agentMatrix) {
    const support = entry.supported ? 'supported' : 'blocked';
    const draftMark = entry.draftEligible ? 'draft' : '-';
    const activeMark = entry.activeEligible ? 'active' : '-';
    log(`  ${fmt.agent(entry.agent)}: ${support} | eligible: ${draftMark},${activeMark}`);
  }
  if (result.agentOverride) {
    log(`  (WORKFLOW_AGENT override: ${fmt.agent(result.agentOverride)})`);
  }

  // Commits and uncommitted
  log('Last 3 commits:');
  for (const c of result.lastThreeCommits) {
    log(`  - ${c}`);
  }

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
