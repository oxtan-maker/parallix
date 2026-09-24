import * as fmt from '../../application/presentation/cli-format.js';
import type { StatusResult } from '../../application/status-command-use-case.js';
import type { StatusMissionData, StatusPrInfo } from '../../application/ports/cli-workflows.js';
import { describeCoordinatorEvidence, describeMissionWork } from '../../application/projections/mission-activity.js';

/** Parse public CLI flags for the status command. */
export interface StatusCliRequest {
  /** Explicit slug argument, or undefined for inferred slug. */
  readonly explicitSlug?: string;
  /** Emit the mission's recorded state as JSON instead of the human render. */
  readonly json: boolean;
}

/** Parse status CLI args without consulting filesystem or adapter state. */
export function parseStatusCliRequest(args: string[]): StatusCliRequest {
  const positional: string[] = [];
  let json = false;
  for (const arg of args) {
    if (arg === '--json') { json = true; continue; }
    if (arg.startsWith('--')) {
      throw new Error(`Unknown status option: ${arg}`);
    }
    positional.push(arg);
  }
  return { explicitSlug: positional[0], json };
}

/**
 * The machine-readable projection agents consume. Only recorded Mission state
 * appears here: the operator/environment sections of the human render (agent
 * matrix, stale worktrees, commit list) are deliberately excluded, so an agent
 * parsing this never depends on the machine it runs on.
 */
export function statusJson(result: StatusResult): string {
  const md = result.missionData;
  return JSON.stringify({
    slug: result.slug,
    title: md?.title ?? null,
    branch: result.branch,
    backlogStatus: md?.backlogStatus ?? null,
    assignee: md?.assignee ?? null,
    externalTaskRef: md?.externalTaskRef ?? null,
    version: md?.version ?? null,
    brief: md?.brief ?? null,
    declaredGates: md?.declaredGates ?? [],
    successCriteria: md?.successCriteria ?? [],
    dependencies: md?.dependencies ?? [],
    checkpoints: md?.checkpoints ?? [],
    predictedNelBucket: md?.predictedNelBucket ?? null,
    reproductionTest: md?.reproductionTest ?? null,
    latestCheckpoint: md?.checkpoint
      ? { name: md.checkpoint, description: md.checkpointDescription ?? null, goalCheck: md.goalCheck ?? [], nextAction: md.nextAction ?? null }
      : null,
    review: md?.reviewPhase
      ? {
        round: md.reviewRound ?? 1,
        phase: md.reviewPhase,
        disposition: md.reviewDisposition ?? null,
        approvalOwed: md.approvalOwed ?? false,
        history: md.reviewHistory,
      }
      : null,
    pullRequest: result.prInfo ?? null,
  }, null, 2);
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

/**
 * The recorded brief and declared gates, so an agent never opens a mission
 * document to learn what the mission is for or what verifies it.
 */
function logBriefAndGates(missionData: StatusMissionData, log: (_msg: string) => void): void {
  const brief = missionData.brief;
  if (brief) {
    log(`Goal: ${brief.goal}`);
    log(`Why: ${brief.why}`);
    if (brief.scope) { log(`Scope: ${brief.scope}`); }
    if (brief.outOfScope.length > 0) { log(`Out of scope: ${brief.outOfScope.join('; ')}`); }
  } else {
    log('Brief: none recorded');
  }
  const criteria = missionData.successCriteria ?? [];
  if (criteria.length > 0) {
    log('Success criteria:');
    for (const [index, criterion] of criteria.entries()) { log(`  ${index + 1}. ${criterion}`); }
  } else {
    log('Success criteria: none');
  }
  const dependencies = missionData.dependencies ?? [];
  log(dependencies.length > 0 ? `Depends on: ${dependencies.join(', ')}` : 'Depends on: nothing recorded');
  const checkpoints = missionData.checkpoints ?? [];
  if (checkpoints.length > 0) {
    log('Checkpoints:');
    for (const checkpoint of checkpoints) { log(`  ${checkpoint.recorded ? '[x]' : '[ ]'} ${checkpoint.name}: ${checkpoint.description}`.trimEnd()); }
  }
  const gates = missionData.declaredGates ?? [];
  log(gates.length > 0 ? `Declared gates: ${gates.join('; ')}` : 'Declared gates: none');
  if (missionData.predictedNelBucket) { log(`Predicted NEL bucket: ${missionData.predictedNelBucket}`); }
  if (missionData.reproductionTest) { log(`Reproduction test: ${missionData.reproductionTest}`); }
}

function logMissionData(missionData: StatusMissionData | null, log: (_msg: string) => void): void {
  if (!missionData) {
    log('Backlog status: unknown (projection unavailable)');
    log('Last checkpoint: none');
    return;
  }
  if (missionData.title) { log(`Title: ${missionData.title}`); }
  log(`Backlog status: ${missionData.backlogStatus}`);
  log(`Assignee: ${missionData.assignee ?? 'none'}`);
  if (missionData.externalTaskRef) {
    const ref = missionData.externalTaskRef;
    log(`External task: ${ref.source}:${ref.id}${ref.url ? ` (${ref.url})` : ''}`);
  }
  // The same two facts the TUI agent strip renders, from the same projection:
  // authoritative work first, then the recovery-only evidence that a `px`
  // coordinator process exists. Keeping them on separate lines is deliberate —
  // a live coordinator is not a running agent.
  if (missionData.activity) {
    log(`Mission work: ${describeMissionWork(missionData.activity.work)}`);
    log(`Coordinator evidence: ${describeCoordinatorEvidence(missionData.activity.coordinator)}`);
  }
  logBriefAndGates(missionData, log);
  if (missionData.version !== null && missionData.version !== undefined) {
    log(`Version: ${missionData.version} (pass to --expected-version when writing)`);
  }
  if (missionData.checkpoint) {
    log(`Last checkpoint: ${missionData.checkpoint}${missionData.checkpointDescription ? ` - ${missionData.checkpointDescription}` : ''}`);
    for (const row of missionData.goalCheck ?? []) { log(`  ${row.criterion}: ${row.evidence}`); }
    if (missionData.nextAction) { log(`  Next action: ${missionData.nextAction}`); }
  } else {
    log('Last checkpoint: none');
  }
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

function describeBlock(block: NonNullable<StatusResult['agents']>[number]['block']): string {
  if (block.kind === 'none') { return 'available'; }
  const reason = block.reason ? ` (${block.reason})` : '';
  return block.kind === 'until' ? `blocked until ${new Date(block.untilMs).toISOString()}${reason}` : `blocked${reason}`;
}

function logAgents(result: StatusResult, log: (_msg: string) => void): void {
  if (result.agents === null) {
    log('Agents: unknown (operator database unavailable)');
    return;
  }
  log('Agents:');
  for (const entry of result.agents) {
    log(`  ${fmt.agent(entry.agent)}: ${describeBlock(entry.block)}`);
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
  logAgents(result, log);

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
    let json = false;
    try {
      const request = parseStatusCliRequest(args);
      explicitSlug = request.explicitSlug;
      json = request.json;
    } catch (error) {
      errorFn(formatParseError(error as Error));
      exitFn(1);
      return;
    }

    const result = await useCase.execute(process.cwd(), explicitSlug ?? null);
    if (json) { logFn(statusJson(result)); } else { renderStatus(result, logFn); }
    exitFn(0);
  };
}
