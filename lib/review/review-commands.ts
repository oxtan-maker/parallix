/**
 * Review Commands Module
 * Extracted from parallix/lib/review.js for task-1201
 * Handles command dispatching and CLI command implementations.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as fmt from '../core/fmt.js';
import { run, getCurrentBranch } from '../core/git.js';
import { findMissionDir, findMissionArea, resolveWorktree, inferSlug, findCheckpoints, missionBranchName, missionBaseDir, getPrimaryBranch } from '../core/mission-utils.js';
import { resolveTaskFile, getTaskStatus, getAcceptanceCriteria, getTaskAssignee, getTaskImplementer, reportTaskResolution, transitionTask } from '../tools/backlog.js';
import { toVirtual } from '../core/state-map.js';
import { getPrStatus, readToken, postComment, postReview, createPr, getComments, closePr, resolveReviewUser, isProviderEnabled } from './review-adapter.js';
import { buildAutonomousReviewMatrix, formatMatrixSummary } from '../core/runtime-matrix.js';
import { readReviewState, writeReviewState, resolveReviewIdentity, ReviewState } from './review-state.js';
import { createEvent, importAllLegacyArtifacts, ALL_EVENT_TYPES, isValidEventType, shouldMirrorToProvider, readAllEvents } from './review-events.js';
import { startAgent } from '../agents/agents.js';
import { formatVerificationCommand, runVerificationGate } from '../core/verification.js';
import { bootstrapReviewSurface } from '../tools/setup-review.js';
import { resolveReviewAdapter } from '../core/product-config.js';
import { buildMetadataFooter, reviewArtifactPath, postWorkflowComment, postWorkflowReview, consumeReviewerArtifacts, resolveArtifactDir } from './review-artifacts.js';
import { startReviewLoop, recordStageStatsSafe, commitSafeMissionArtifacts } from './review-loop.js';

/** Lazily loaded handoff module. */
let _handoff: any = null;
async function getHandoff(): Promise<any> {
  if (!_handoff) {
    _handoff = await import('../commands/handoff.js');
  }
  return _handoff as any;
}

const DEFAULT_MAX_ATTEMPTS = 5;

// ============================================================================
// Internal Helpers
// ============================================================================

export function flagValue(args: string[], flag: string): string | null {
  const idx = args.indexOf(flag);
  if (idx === -1) { return null; }
  const val = args[idx + 1];
  if (!val || val.startsWith('--')) { return null; }
  return val;
}

export function readTextFlag(
  args: string[],
  inlineFlag: string,
  fileFlag: string,
  label: string,
  options: { readFileSync?: typeof fs.readFileSync; error?: (msg: string) => void; exit?: (code: number) => never } = {}
): string | null {
  const readFileSync = options.readFileSync || fs.readFileSync;
  const error = options.error || fmt.log.plainError;
  const exit = options.exit || process.exit;
  const filePath = flagValue(args, fileFlag);
  if (filePath) {
    try {
      return (readFileSync(filePath, 'utf8') as string).trimEnd();
    } catch (err) {
      error(`Could not read ${label} from ${fmt.path(filePath)}: ${(err as Error).message}`);
      exit(1);
      return null;
    }
  }

  return flagValue(args, inlineFlag);
}

export function formatStaticReviewFindings(findings: string[]): string {
  const lines = [
    'Static review found the following issue(s) before autonomous review:',
    ''
  ];
  findings.forEach((finding, index) => {
    lines.push(`${index + 1}. ${finding}`);
  });
  lines.push('', 'Auto-launching the act-on-review loop for follow-up.');
  return lines.join('\n');
}

export function formatStaticReviewSuccess(slug: string): string {
  return [
    `Static review for ${slug} found zero issues.`,
    '',
    'Checked:',
    '- mission diff against the primary branch',
    '- checkpoint presence',
    '- final checkpoint Goal Check evidence',
    '',
    'Mission remains in `review` status awaiting an actual autonomous or peer review verdict.'
  ].join('\n');
}

function repairStaleActiveTaskAfterReview(
  slug: string,
  options: {
    log?: (msg: string) => void;
    error?: (msg: string) => void;
    getTaskStatusFn?: typeof getTaskStatus;
    resolveTaskFileFn?: typeof resolveTaskFile;
    transitionTaskFn?: typeof transitionTask;
    rootDir?: string;
  } = {}
): { repaired: boolean; skipped?: boolean; currentStatus?: string } {
  const log = options.log || fmt.log.plain;
  const error = options.error || fmt.log.plainError;
  const getTaskStatusFn = options.getTaskStatusFn || getTaskStatus;
  const resolveTaskFileFn = options.resolveTaskFileFn || resolveTaskFile;
  const transitionTaskFn = options.transitionTaskFn || transitionTask;
  const rootDir = options.rootDir || process.cwd();

  const taskResolution = resolveTaskFileFn(slug, rootDir);
  if (!taskResolution.ok) {
    return { repaired: false, skipped: true };
  }

  const currentStatus = getTaskStatusFn(taskResolution.taskFile!);
  if (toVirtual(currentStatus || '') !== 'active') {
    return { repaired: false, skipped: true, currentStatus: currentStatus ?? undefined };
  }

  if (!transitionTaskFn(slug, 'review', { rootDir, log })) {
    error(fmt.status('WARN', `Could not transition backlog task ${slug} to review after recording the review outcome.`));
    return { repaired: false, skipped: false, currentStatus: currentStatus ?? undefined };
  }

  return { repaired: true, currentStatus: currentStatus ?? undefined };
}

async function commitPersistedReviewOutputs(
  slug: string,
  options: { worktree?: string; taskFile?: string | null; log?: (msg: string) => void; error?: (msg: string) => void } = {}
): Promise<{ ok: boolean; dirty?: boolean; unsafe?: boolean }> {
  return commitSafeMissionArtifacts(slug, options.worktree || process.cwd(), {
    taskFile: options.taskFile || null,
    log: options.log || fmt.log.plain,
    error: options.error || fmt.log.plainError,
  });
}

export function postStaticReviewComment(
  slug: string,
  message: string,
  options: {
    log?: (msg: string) => void;
    error?: (msg: string) => void;
    resolveTaskFileFn?: typeof resolveTaskFile;
    getTaskImplementerFn?: typeof getTaskImplementer;
    resolveWorktreeFn?: typeof resolveWorktree;
    readTokenFn?: typeof readToken;
    postCommentFn?: typeof postComment;
    resolveReviewUserFn?: typeof resolveReviewUser;
    resolveForgejoUserFn?: typeof resolveReviewUser;
    readReviewStateFn?: typeof readReviewState;
    buildMetadataFooterFn?: typeof buildMetadataFooter;
    rootDir?: string;
  } = {}
): { ok: boolean; error?: string } {
  const log = options.log || fmt.log.plain;
  const error = options.error || fmt.log.plainError;
  const resolveTaskFileFn = options.resolveTaskFileFn || resolveTaskFile;
  const getTaskImplementerFn = options.getTaskImplementerFn || getTaskImplementer;
  const resolveWorktreeFn = options.resolveWorktreeFn || resolveWorktree;
  const readTokenFn = options.readTokenFn || readToken;
  const postCommentFn = options.postCommentFn || postComment;
  const resolveReviewUserFn = options.resolveReviewUserFn || options.resolveForgejoUserFn || resolveReviewUser;
  const readReviewStateFn = options.readReviewStateFn || readReviewState;
  const buildMetadataFooterFn = options.buildMetadataFooterFn || buildMetadataFooter;

  const rootDir = options.rootDir || resolveWorktreeFn(slug) || process.cwd();
  const branch = missionBranchName(slug, rootDir);
  const { identityUser } = resolveReviewIdentity(slug, rootDir, {
    readReviewStateFn,
  });
  let resolvedUser = identityUser;

  if (!resolvedUser) {
    const taskResolution = resolveTaskFileFn(slug, rootDir);
    if (taskResolution.ok) {
      resolvedUser = getTaskImplementerFn(taskResolution.taskFile!);
    }
  }
  if (!resolvedUser) {
    error('Cannot determine review identity. Set FORGEJO_USER, persist review-state.json, or assign the task implementer.');
    return { ok: false, error: 'missing-user' };
  }
  resolvedUser = resolveReviewUserFn(resolvedUser!);
  const token = readTokenFn(resolvedUser!, { rootDir });
  if (!token) {
    error(`No Forgejo token found for user "${resolvedUser}". Cannot post static review comment.`);
    return { ok: false, error: 'missing-token' };
  }

  const taggedMessage = message + buildMetadataFooterFn(slug, rootDir);
  log(`Posting static review comment on ${fmt.branch(branch)} as ${resolvedUser}...`);
  const result = postCommentFn(branch, token, taggedMessage, { reviewIdentity: resolvedUser, forgejoUser: resolvedUser }) as { ok: boolean; error?: string };

  if (!result.ok) {
    error(`Could not post static review comment: ${result.error || 'API error'}`);
    return result;
  }

  log(fmt.status('PASS', `Static review comment posted on PR for ${fmt.branch(branch)}.`));
  return result;
}

// ============================================================================
// Command: performStaticReview
// ============================================================================

export function performStaticReview(
  slug: string,
  options: {
    log?: (msg: string) => void;
    findMissionDir?: typeof findMissionDir;
    findCheckpoints?: typeof findCheckpoints;
    readFileSync?: typeof fs.readFileSync;
    run?: typeof run;
    resolveWorktree?: typeof resolveWorktree;
    missionPath?: string;
    rootDir?: string;
  } = {}
): { ok: boolean; findings: string[] } {
  const log = options.log || fmt.log.plain;
  const findMissionDirFn = options.findMissionDir || findMissionDir;
  const findCheckpointsFn = options.findCheckpoints || findCheckpoints;
  const readFileSyncFn = options.readFileSync || fs.readFileSync;
  const runFn = options.run || run;
  const resolveWorktreeFn = options.resolveWorktree || resolveWorktree;
  const findings: string[] = [];

  log(`Performing static review for mission: ${fmt.slug(slug)}`);

  // Resolve the worktree root early so mission dir and checkpoint lookups use the same base
  const worktreeRoot = resolveWorktreeFn(slug);
  const rootDir = worktreeRoot || process.cwd();

  // Check if mission directory exists (with optional --mission path override)
  const missionDir = findMissionDirFn(slug, rootDir, { missionPath: options.missionPath });
  if (!missionDir) {
    findings.push(`Mission directory not found for slug: ${slug}`);
    return { ok: false, findings };
  }
  log(fmt.status('PASS', `Mission directory found: ${fmt.path(missionDir)}`));

  // Check if checkpoint documents exist
  const checkpoints = findCheckpointsFn(missionDir);
  if (checkpoints.length === 0) {
    findings.push('No checkpoint documents found. Implementation evidence is required.');
    return { ok: false, findings };
  }
  log(fmt.status('PASS', `Found ${checkpoints.length} checkpoint document(s).`));

  // Check the final checkpoint for a Goal Check table
  const finalCheckpoint = checkpoints[checkpoints.length - 1];
  try {
    const checkpointContent = readFileSyncFn(finalCheckpoint, 'utf8') as string;
    const goalCheckMatch = checkpointContent.match(/^## Goal Check(?: Table)?\s*$/m);
    if (!goalCheckMatch) {
      findings.push(`Final checkpoint ${path.basename(finalCheckpoint)} is missing a "## Goal Check" section.`);
    } else {
      log(fmt.status('PASS', 'Final checkpoint contains "## Goal Check" section.'));

      // Verify goal-check table has at least one evidence row
      const afterHeader = checkpointContent.slice(goalCheckMatch.index! + goalCheckMatch[0].length);
      const separatorPattern = /^\|\s*:?-+:?\s*\|/;
      const headerPattern = /^\| .+\| .+\| .+\|$/;
      const evidenceLinePattern = /^\| .+\| .+\| .+\|$/;
      const linesAfterHeader = afterHeader.split('\n');
      let foundEvidence = false;
      let pastHeader = false;
      for (const line of linesAfterHeader) {
        const trimmed = line.trim();
        if (trimmed === '') { continue; }
        if (!pastHeader && headerPattern.test(trimmed)) {
          pastHeader = true;
          continue;
        }
        if (separatorPattern.test(trimmed)) { continue; }
        if (pastHeader && evidenceLinePattern.test(trimmed)) {
          foundEvidence = true;
          break;
        }
        break;
      }
      if (!foundEvidence) {
        findings.push(`Final checkpoint ${path.basename(finalCheckpoint)} has "## Goal Check" section but no evidence rows.`);
      } else {
        log(fmt.status('PASS', 'Goal Check table contains evidence rows.'));
      }
    }
  } catch (err) {
    findings.push(`Could not read final checkpoint ${path.basename(finalCheckpoint)}: ${(err as Error).message}`);
  }

  // Inspect git diff for changed files
  const baseBranch = getPrimaryBranch(rootDir);
  const diffResult = runFn('git', ['diff', `${baseBranch}..HEAD`, '--name-only'], { cwd: rootDir });
  if (diffResult.status === 0 && diffResult.stdout) {
    const changedFiles = (diffResult.stdout as string).trim().split('\n').filter((f: string) => f.trim());
    const missionDirPrefix = path.relative(rootDir, missionBaseDir(rootDir)).split(path.sep).join('/') + '/';
    log(`Changed files in branch: ${changedFiles.join(', ')}`);
    // Check for unexpected areas — missions may legitimately touch many surfaces.
    // Derive allowed set from known workflow areas plus common repo structures,
    // plus any file with a recognized extension or inside the mission directory.
    const knownAreas = [
      'parallix/', 'docs/', 'scripts/', 'config/', 'backlog/', 'forgejo/',
      '.agents/', '.github/', '.vscode/', '.graphifyignore',
    ];
    const knownExtensions = ['.sh', '.csv', '.json', '.yaml', '.yml', '.toml', '.lock', '.cfg', '.ini', '.env', '.txt', '.properties', '.sql', '.css', '.html', '.xml', '.png', '.jpg', '.jpeg', '.gif', '.svg', '.ico', '.pdf', '.tar', '.gz', '.zip'];
    const unexpectedFiles = changedFiles.filter((f: string) =>
      !knownAreas.some((area: string) => f.startsWith(area)) &&
      !f.startsWith(missionDirPrefix) &&
      !f.endsWith('.md') &&
      !knownExtensions.some((ext: string) => f.toLowerCase().endsWith(ext))
    );
    if (unexpectedFiles.length > 0) {
      log(fmt.status('WARN', `Changed files outside known areas (may be intentional): ${unexpectedFiles.join(', ')}`));
    } else {
      log(fmt.status('PASS', 'All changed files are within expected areas.'));
    }
  } else {
    log(fmt.status('WARN', `git diff ${baseBranch}..HEAD returned no output or failed — branch may be up to date with ${baseBranch}.`));
  }

  return { ok: findings.length === 0, findings };
}

// ============================================================================
// Command: verifyReview
// ============================================================================

export function verifyReview(
  slug: string,
  skipGate: boolean | string,
  options: {
    log?: (msg: string) => void;
    error?: (msg: string) => void;
    exit?: (code: number) => never;
    resolveWorktreeFn?: typeof resolveWorktree;
    findMissionDirFn?: typeof findMissionDir;
    getCurrentBranchFn?: typeof getCurrentBranch;
    resolveTaskFileFn?: typeof resolveTaskFile;
    getPrStatusFn?: typeof getPrStatus;
    getTaskStatusFn?: typeof getTaskStatus;
    toVirtualFn?: typeof toVirtual;
    findMissionAreaFn?: typeof findMissionArea;
    runFn?: typeof run;
    getAcceptanceCriteriaFn?: typeof getAcceptanceCriteria;
    formatMatrixSummaryFn?: typeof formatMatrixSummary;
    buildAutonomousReviewMatrixFn?: typeof buildAutonomousReviewMatrix;
    readReviewStateFn?: typeof readReviewState;
    isReviewProviderEnabledFn?: typeof isProviderEnabled;
    isForgejoReviewEnabledFn?: typeof isProviderEnabled;
    cwdFn?: () => string;
    missionPath?: string;
    skipGate?: boolean;
  } = {}
): void {
  const log = options.log || fmt.log.plain;
  const error = options.error || fmt.log.plainError;
  const exit = options.exit || process.exit;
  const resolveWorktreeFn = options.resolveWorktreeFn || resolveWorktree;
  const findMissionDirFn = options.findMissionDirFn || findMissionDir;
  const getCurrentBranchFn = options.getCurrentBranchFn || getCurrentBranch;
  const resolveTaskFileFn = options.resolveTaskFileFn || resolveTaskFile;
  const getPrStatusFn = options.getPrStatusFn || getPrStatus;
  const getTaskStatusFn = options.getTaskStatusFn || getTaskStatus;
  const toVirtualFn = options.toVirtualFn || toVirtual;
  const findMissionAreaFn = options.findMissionAreaFn || findMissionArea;
  const runFn = options.runFn || run;
  const getAcceptanceCriteriaFn = options.getAcceptanceCriteriaFn || getAcceptanceCriteria;
  const formatMatrixSummaryFn = options.formatMatrixSummaryFn || formatMatrixSummary;
  const buildAutonomousReviewMatrixFn = options.buildAutonomousReviewMatrixFn || buildAutonomousReviewMatrix;
  const readReviewStateFn = options.readReviewStateFn || readReviewState;
  const isReviewProviderEnabledFn = options.isReviewProviderEnabledFn || options.isForgejoReviewEnabledFn || isProviderEnabled;
  const cwdFn = options.cwdFn || (() => process.cwd());

  const worktree = resolveWorktreeFn(slug);
  const rootDir = worktree || cwdFn();

  const missionDir = findMissionDirFn(slug, rootDir, { missionPath: options.missionPath });
  const branch = missionBranchName(slug, rootDir);
  const current = getCurrentBranchFn(rootDir);
  const taskResolution = resolveTaskFileFn(slug, rootDir);
  const providerEnabled = isReviewProviderEnabledFn(rootDir);
  const pr = providerEnabled ? getPrStatusFn(branch, rootDir) : { exists: false };
  const failures: string[] = [];
  const warnings: string[] = [];

  log(`Reviewer verification for mission: ${fmt.slug(slug)}`);
  if (worktree) {
    log(`Found dedicated worktree: ${fmt.path(worktree)}`);
  } else {
    log('Using current directory as mission root.');
  }

  if (!missionDir) {
    failures.push('mission-dir');
    log(fmt.status('FAIL', `Mission directory not found for slug: ${fmt.slug(slug)}`));
  } else {
    log(fmt.status('PASS', `Mission doc: ${fmt.path(path.join(missionDir, 'MISSION.md'))}`));
  }

  if (current !== branch) {
    failures.push('branch');
    log(fmt.status('FAIL', `Branch: current branch is ${fmt.branch(current)}, expected ${fmt.branch(branch)}`));
  } else {
    log(fmt.status('PASS', `Branch: ${fmt.branch(current)}`));
  }

  let taskStatus: string | null = null;
  let virtualStatus: string | null = null;
  if (!taskResolution.ok) {
    failures.push('task');
    reportTaskResolution(taskResolution, slug, log);
  } else {
    taskStatus = getTaskStatusFn(taskResolution.taskFile!);
    virtualStatus = toVirtualFn(taskStatus || '');
    if (taskStatus === 'review' || virtualStatus === 'approved') {
      log(fmt.status('PASS', `Backlog task: ${path.basename(taskResolution.taskFile!)} (${taskStatus})`));
    } else if (taskStatus === 'done') {
      failures.push('task-status');
      log(fmt.status('FAIL', 'Backlog task: task is already done/integrated'));
    } else if (taskStatus === 'active' || virtualStatus === 'active') {
      warnings.push('task-still-active');
      log(fmt.status('WARN', `Backlog task: ${path.basename(taskResolution.taskFile!)} is still ${taskStatus}`));
    } else {
      failures.push('task-status');
      log(fmt.status('FAIL', `Backlog task: unexpected status ${taskStatus}`));
    }
  }

  const prAny = pr as Record<string, unknown>;
  if (providerEnabled) {
    if (prAny.exists && prAny.state === 'open' && !prAny.merged) {
      log(fmt.status('PASS', `Review PR: PR #${prAny.number} is open`));
    } else if (prAny.exists) {
      failures.push('pr-state');
      log(fmt.status('FAIL', `Review PR: expected an open PR, got state=${prAny.state} merged=${prAny.merged}`));
    } else {
      // No PR exists - check if task is in implementation phase
      if (taskResolution.ok) {
        const isImplementationPhase = taskStatus === 'active' || virtualStatus === 'active';
        if (isImplementationPhase) {
          // Task is still in implementation - emit warning instead of failure
          warnings.push('no-pr-yet');
          log(fmt.status('WARN', `Review PR: no PR found for ${branch}. Task is still ${taskStatus} — complete implementation and submit first: px review ${slug} --push`));
        } else {
          // Task is in post-implementation state or ambiguous - hard fail
          failures.push('pr-missing');
          log(fmt.status('FAIL', `Review PR: ${prAny.raw || 'no PR found'}`));
        }
      } else {
        // Cannot determine task status - safe default to hard fail
        failures.push('pr-missing');
        log(fmt.status('FAIL', `Review PR: ${prAny.raw || 'no PR found'}`));
      }
    }
  } else {
    log(fmt.status('INFO', 'Forgejo PR: skipped (review provider is not forgejo).'));
  }

  if (missionDir) {
    const area = findMissionAreaFn(missionDir);
    const skipGateFlag = Boolean(skipGate || options.skipGate);
    if (skipGateFlag) {
      log(fmt.status('WARN', `Verification gate skipped (--no-gate) for area ${area}`));
    } else {
      log(`Running reviewer gate: ${fmt.command(formatVerificationCommand(area, process.cwd()))}`);
      const verifyResult = runVerificationGate(area, { rootDir: process.cwd(), stdio: 'inherit', runFn });
      if (verifyResult.status !== 0) {
        failures.push('gate');
        log(fmt.status('FAIL', 'Reviewer gate failed.'));
      } else {
        log(fmt.status('PASS', 'Reviewer gate passed.'));
      }
    }
  }

  if (taskResolution.ok) {
    const acceptanceCriteria = getAcceptanceCriteriaFn(taskResolution.taskFile!);
    log(fmt.status('INFO', 'Acceptance evidence checklist:'));
    if (acceptanceCriteria.length === 0) {
      log('  - No Acceptance Criteria found on the Backlog task.');
    } else {
      acceptanceCriteria.forEach((line: string) => log(`  ${line}`));
    }
  }

  log(fmt.status('INFO', 'Autonomous review runtime matrix:'));
  formatMatrixSummaryFn(buildAutonomousReviewMatrixFn()).forEach((line: string) => log(line));

  // Show persisted reviewer state if present
  const persisted = readReviewStateFn(slug);
  if (persisted) {
    log(`Persisted reviewer state: reviewer=${fmt.agent(persisted.reviewer ?? '')} implementer=${fmt.agent(persisted.implementer ?? '')} round=${persisted.round} startedAt=${persisted.startedAt}`);
  }

  if (warnings.length > 0) {
    log(fmt.status('WARN', `Review verification warnings: ${warnings.join(', ')}`));
  }

  if (failures.length > 0) {
    error('\n' + fmt.status('INFO', 'Review verification failed. Resolve the blockers above before starting review.'));
    exit(1);
    return;
  }

  log('\n' + fmt.status('PASS', 'Review verification complete.'));
}

// ============================================================================
// Command: submitForReview
// ============================================================================

export async function submitForReview(
  slug: string,
  skipGate: boolean | string,
  options: {
    exit?: (code: number) => never;
    resolveTaskFileFn?: typeof resolveTaskFile;
    getTaskImplementerFn?: typeof getTaskImplementer;
    resolveWorktreeFn?: typeof resolveWorktree;
    performHandoffFn?: (slug: string, opts?: Record<string, unknown>) => Promise<Record<string, unknown>>;
    readReviewStateFn?: typeof readReviewState;
    isReviewProviderEnabledFn?: typeof isProviderEnabled;
    isForgejoReviewEnabledFn?: typeof isProviderEnabled;
    log?: (msg: string) => void;
  } = {}
): Promise<void> {
  const exit = options.exit || process.exit;
  const resolveTaskFileFn = options.resolveTaskFileFn || resolveTaskFile;
  const getTaskImplementerFn = options.getTaskImplementerFn || getTaskImplementer;
  const resolveWorktreeFn = options.resolveWorktreeFn || resolveWorktree;
  const performHandoffFn = options.performHandoffFn || (await getHandoff()).performHandoff;
  const readReviewStateFn = options.readReviewStateFn || readReviewState;
  const isReviewProviderEnabledFn = options.isReviewProviderEnabledFn || options.isForgejoReviewEnabledFn || isProviderEnabled;
  const log = options.log || fmt.log.plain;

  const worktree = resolveWorktreeFn(slug) || process.cwd();
  const providerEnabled = isReviewProviderEnabledFn(worktree);

  const { identityUser: reviewStateUser } = resolveReviewIdentity(slug, worktree, {
    readReviewStateFn,
  });
  let reviewIdentity = reviewStateUser;

  // 2. Check backlog task assignee
  if (!reviewIdentity) {
    const taskResolution = resolveTaskFileFn(slug, worktree);
    if (taskResolution.ok) {
      reviewIdentity = getTaskImplementerFn(taskResolution.taskFile!);
    }
  }

  // 3. Mode-specific final fallback: named identity (provider-backed) vs "autonomous" (provider=none) (SC 6)
  if (!reviewIdentity) {
    if (providerEnabled) {
      log(fmt.status('FAIL', `No review identity resolved for ${slug}. Persist review-state.json or set the task implementer before submitting for review.`));
      exit(1);
      return;
    } else {
      reviewIdentity = 'autonomous';
      log(fmt.status('WARN', `No reviewer/implementer identity resolved for ${slug}; defaulting to "autonomous"`));
    }
  }

  const result = await performHandoffFn(slug, { skipGate, reviewIdentity, forgejoUser: reviewIdentity, worktree });
  if (!result.ok) {
    exit(1);
  }
}

// ============================================================================
// Command: readComments
// ============================================================================

export async function readComments(
  slug: string,
  options: {
    log?: (msg: string) => void;
    error?: (msg: string) => void;
    exit?: (code: number) => never;
    readTokenFn?: typeof readToken;
    readReviewStateFn?: typeof readReviewState;
    resolveReviewUserFn?: typeof resolveReviewUser;
    resolveForgejoUserFn?: typeof resolveReviewUser;
    getCommentsFn?: typeof getComments;
    readAllEventsFn?: typeof readAllEvents;
    isReviewProviderEnabledFn?: typeof isProviderEnabled;
    isForgejoReviewEnabledFn?: typeof isProviderEnabled;
    worktree?: string;
  } = {}
): Promise<void> {
  const log = options.log || fmt.log.plain;
  const error = options.error || fmt.log.plainError;
  const exit = options.exit || process.exit;
  const readTokenFn = options.readTokenFn || readToken;
  const readReviewStateFn = options.readReviewStateFn || readReviewState;
  const resolveReviewUserFn = options.resolveReviewUserFn || options.resolveForgejoUserFn || resolveReviewUser;
  const getCommentsFn = options.getCommentsFn || getComments;
  const readAllEventsFn = options.readAllEventsFn || readAllEvents;
  const isReviewProviderEnabledFn = options.isReviewProviderEnabledFn || options.isForgejoReviewEnabledFn || isProviderEnabled;
  const worktree = options.worktree || resolveWorktree(slug) || process.cwd();
  const branch = missionBranchName(slug, worktree);

  // Provider-disabled fallback: read persisted local review events instead of polling the PR.
  // Avoids resolving a provider token (which would FAIL/exit) when the provider is off.
  if (!isReviewProviderEnabledFn(worktree)) {
    log(fmt.status('INFO', `Review provider disabled; reading local review events for ${slug}...`));
    const events = readAllEventsFn(slug, { rootDir: worktree, error });
    if (!events || events.length === 0) {
      log('no comments');
      return;
    }
    for (const e of events as Record<string, unknown>[]) {
      let label = (e.event_type as string) || 'event';
      if (e.round !== null) { label += ` round ${e.round}`; }
      log(`--- ${label} | ${(e.actor as string) || 'unknown'} (${(e.timestamp as string) || (e.fileCreated as string) || ''}) ---`);
      log((e.content as string) || '(no body)');
      log('');
    }
    return;
  }

  let reviewIdentity = resolveReviewIdentity(slug, worktree, {
    readReviewStateFn,
  }).identityUser;

  if (!reviewIdentity) {
    error(fmt.status('FAIL', `Cannot determine review identity for ${slug}. Persist review-state.json or set FORGEJO_USER.`));
    exit(1);
    return;
  }
  reviewIdentity = resolveReviewUserFn(reviewIdentity);

  const token = readTokenFn(reviewIdentity!, { rootDir: worktree });
  if (!token) {
    error(fmt.status('FAIL', `No Forgejo token found for user "${reviewIdentity}".`));
    exit(1);
    return;
  }

  log(fmt.status('INFO', `Reading PR comments on ${branch} as ${reviewIdentity}...`));
  const comments = await getCommentsFn(branch, token) as unknown[] | null;

  if (comments === null) {
    error(fmt.status('FAIL', `Could not fetch PR comments for ${branch}. The review provider may be unreachable or the PR is missing.`));
    exit(1);
    return;
  }

  if (comments.length === 0) {
    log('no comments');
    return;
  }

  for (const c of comments as Record<string, unknown>[]) {
    let label = c.kind as string;
    if (c.location) { label += ` ${c.location}`; }
    log(`--- ${label} | ${c.user} (${c.created}) ---`);
    log((c.body as string) || '(no body)');
    log('');
  }
}

// ============================================================================
// Command: pushRound
// ============================================================================

export async function pushRound(
  slug: string,
  options: {
    log?: (msg: string) => void;
    error?: (msg: string) => void;
    exit?: (code: number) => never;
    resolveWorktreeFn?: typeof resolveWorktree;
    resolveTaskFileFn?: typeof resolveTaskFile;
    getTaskImplementerFn?: typeof getTaskImplementer;
    transitionTaskFn?: typeof transitionTask;
    resolveReviewUserFn?: typeof resolveReviewUser;
    resolveForgejoUserFn?: typeof resolveReviewUser;
    isReviewProviderEnabledFn?: typeof isProviderEnabled;
    isForgejoReviewEnabledFn?: typeof isProviderEnabled;
    readTokenFn?: typeof readToken;
    readReviewStateFn?: typeof readReviewState;
    createPrFn?: typeof createPr;
    bootstrapReviewSurfaceFn?: typeof bootstrapReviewSurface;
    resolveReviewAdapterFn?: typeof resolveReviewAdapter;
    cwdFn?: () => string;
    force?: boolean;
  } = {}
): Promise<void> {
  const log = options.log || fmt.log.plain;
  const error = options.error || fmt.log.plainError;
  const exit = options.exit || process.exit;
  const resolveWorktreeFn = options.resolveWorktreeFn || resolveWorktree;
  const resolveTaskFileFn = options.resolveTaskFileFn || resolveTaskFile;
  const getTaskImplementerFn = options.getTaskImplementerFn || getTaskImplementer;
  const transitionTaskFn = options.transitionTaskFn || transitionTask;
  const resolveReviewUserFn = options.resolveReviewUserFn || options.resolveForgejoUserFn || resolveReviewUser;
  const isReviewProviderEnabledFn = options.isReviewProviderEnabledFn || options.isForgejoReviewEnabledFn || isProviderEnabled;
  const readTokenFn = options.readTokenFn || readToken;
  const readReviewStateFn = options.readReviewStateFn || readReviewState;
  const createPrFn = options.createPrFn || createPr;
  const bootstrapReviewSurfaceFn = options.bootstrapReviewSurfaceFn || bootstrapReviewSurface;
  const resolveReviewAdapterFn = options.resolveReviewAdapterFn || resolveReviewAdapter;
  const cwdFn = options.cwdFn || (() => process.cwd());
  const force = options.force || false;
  const worktree = resolveWorktreeFn(slug);
  const rootDir = worktree || cwdFn();
  const branch = missionBranchName(slug, rootDir);
  const providerEnabled = isReviewProviderEnabledFn(rootDir);

  const { identityUser: reviewStateUser } = resolveReviewIdentity(slug, rootDir, {
    readReviewStateFn,
  });
  let reviewIdentity = reviewStateUser;

  if (!reviewIdentity) {
    // 1. Check backlog task assignee
    const taskResolution = resolveTaskFileFn(slug, rootDir);
    if (taskResolution.ok) {
      reviewIdentity = getTaskImplementerFn(taskResolution.taskFile!);
    }
  }

  // 2. Mode-specific final fallback: named identity (provider-backed) vs "autonomous" (provider=none) (SC 6)
  if (!reviewIdentity) {
    if (providerEnabled) {
      error(fmt.status('FAIL', `No review identity resolved for --push on ${slug}. Persist review-state.json or set the task implementer.`));
      exit(1);
      return;
    } else {
      reviewIdentity = 'autonomous';
      log(fmt.status('WARN', `No reviewer/implementer identity resolved for --push; defaulting to "autonomous"`));
    }
  }

  if (!reviewIdentity || (providerEnabled && reviewIdentity === 'autonomous')) {
    error(fmt.status('FAIL', 'No review identity resolved for push.'));
    exit(1);
    return;
  }

  reviewIdentity = resolveReviewUserFn(reviewIdentity);
  const token = readTokenFn(reviewIdentity!, { rootDir: worktree || undefined });
  if (!token) {
    error(fmt.status('FAIL', `No Forgejo token found for user "${reviewIdentity}".`));
    exit(1);
    return;
  }

  // Transition to review before pushing so the state change is included in the PR update
  transitionTaskFn(slug, 'review', { rootDir, log });

  log(fmt.status('INFO', `Pushing ${branch} to the review provider as ${reviewIdentity}...${force ? ' (force-with-lease)' : ''}`));
  if (worktree) {
    log(fmt.status('INFO', `Found dedicated worktree: ${worktree}`));
  }

  let result = createPrFn(branch, reviewIdentity!, token, { rootDir, forceWithLease: true }) as Record<string, unknown>;
  if (!result.ok && /Repository not found/i.test((result.error as string) || '')) {
    const reviewAdapter = resolveReviewAdapterFn(rootDir) as Record<string, any>;
    const ownerLogin = (reviewAdapter.repo && reviewAdapter.repo.split('/')[0]) || 'magnus';
    const bootstrap = await bootstrapReviewSurfaceFn(rootDir, {
      baseUrl: reviewAdapter.baseUrl,
      repo: reviewAdapter.repo,
      ownerLogin,
      ownerPassword: '',
      agentPasswords: [],
    }, {
      interactive: false,
      log,
      error,
    });
    if ((bootstrap as Record<string, unknown>).ok) {
      result = createPrFn(branch, reviewIdentity!, token, { rootDir, forceWithLease: true }) as Record<string, unknown>;
    }
  }

  if (!result.ok) {
    error(fmt.status('FAIL', `Push to review provider failed: ${result.error}`));
    exit(1);
    return;
  }

  log(fmt.status('PASS', `Branch pushed and PR updated for ${branch}.`));
}

// ============================================================================
// Command: showReviewStatus
// ============================================================================

export function showReviewStatus(
  slug: string,
  options: {
    log?: (msg: string) => void;
    readReviewStateFn?: typeof readReviewState;
    resolveWorktreeFn?: typeof resolveWorktree;
  } = {}
): void {
  const log = options.log || fmt.log.plain;
  const readReviewStateFn = options.readReviewStateFn || readReviewState;
  const resolveWorktreeFn = options.resolveWorktreeFn || resolveWorktree;

  const worktree = resolveWorktreeFn(slug) || process.cwd();
  const state = readReviewStateFn(slug, worktree);

  log(fmt.status('INFO', `Review status for mission: ${fmt.slug(slug)}`));

  if (!state) {
    log(fmt.status('INFO', 'No persisted review state found.'));
    return;
  }

  log(`  Round:       ${state.round}`);
  log(`  Phase:       ${state.phase}`);
  log(`  Reviewer:    ${fmt.agent(state.reviewer ?? '')}`);
  log(`  Implementer: ${fmt.agent(state.implementer ?? '')}`);
  log(`  Started at:  ${state.startedAt}`);
  if (state.disposition) {
    log(`  Disposition: ${state.disposition}`);
  }
  if (state.reviewerRetryCount > 0) {
    log(`  Reviewer retries:    ${state.reviewerRetryCount}`);
  }
  if (state.implementerRetryCount > 0) {
    log(`  Implementer retries: ${state.implementerRetryCount}`);
  }
}

// ============================================================================
// Command: commentRound
// ============================================================================

export function commentRound(
  slug: string,
  message: string,
  options: {
    log?: (msg: string) => void;
    error?: (msg: string) => void;
    exit?: (code: number) => never;
    readReviewStateFn?: typeof readReviewState;
    writeReviewStateFn?: typeof writeReviewState;
    resolveReviewUserFn?: typeof resolveReviewUser;
    resolveForgejoUserFn?: typeof resolveReviewUser;
    rootDir?: string;
    readTokenFn?: typeof readToken;
    postCommentFn?: typeof postComment;
    buildMetadataFooterFn?: typeof buildMetadataFooter;
  } = {}
): void {
  const log = options.log || fmt.log.plain;
  const error = options.error || fmt.log.plainError;
  const exit = options.exit || process.exit;
  const readReviewStateFn = options.readReviewStateFn || readReviewState;
  const writeReviewStateFn = options.writeReviewStateFn || writeReviewState;
  const resolveReviewUserFn = options.resolveReviewUserFn || options.resolveForgejoUserFn || resolveReviewUser;
  const rootDir = options.rootDir || resolveWorktree(slug) || process.cwd();

  let reviewIdentity = resolveReviewIdentity(slug, rootDir, {
    readReviewStateFn,
  }).identityUser;

  if (!reviewIdentity) {
    error(fmt.status('FAIL', `Cannot determine review identity for ${slug}. Persist review-state.json or set FORGEJO_USER.`));
    exit(1);
    return;
  }
  reviewIdentity = resolveReviewUserFn(reviewIdentity);
  const result = postWorkflowComment(slug, message, {
    rootDir,
    reviewIdentity: reviewIdentity || undefined,
    readTokenFn: options.readTokenFn,
    postCommentFn: options.postCommentFn,
    buildMetadataFooterFn: options.buildMetadataFooterFn,
    log,
    error
  });

  if (!result.ok) {
    exit(1);
    return;
  }

  const currentState = readReviewStateFn(slug, rootDir);
  if (currentState) {
    writeReviewStateFn(slug, currentState, rootDir);
  }
}

// ============================================================================
// Command: consumeArtifacts
// ============================================================================

export async function consumeArtifacts(
  slug: string,
  options: {
    log?: (msg: string) => void;
    error?: (msg: string) => void;
    resolveWorktreeFn?: typeof resolveWorktree;
    transitionTaskFn?: typeof transitionTask;
    consumeReviewerArtifactsFn?: typeof consumeReviewerArtifacts;
    resolveTaskFileFn?: typeof resolveTaskFile;
    getTaskAssigneeFn?: typeof getTaskAssignee;
    getTaskStatusFn?: typeof getTaskStatus;
    resolveArtifactDirFn?: typeof resolveArtifactDir;
    readReviewStateFn?: typeof readReviewState;
    createEventFn?: typeof createEvent;
    readArtifactFn?: unknown;
    deleteArtifactFn?: unknown;
  } = {}
): Promise<{ ok: boolean; consumed: boolean; reviewState?: string | null }> {
  const log = options.log || fmt.log.plain;
  const error = options.error || fmt.log.plainError;
  const resolveWorktreeFn = options.resolveWorktreeFn || resolveWorktree;
  const transitionTaskFn = options.transitionTaskFn || transitionTask;
  const consumeReviewerArtifactsFn = options.consumeReviewerArtifactsFn || consumeReviewerArtifacts;
  const resolveTaskFileFn = options.resolveTaskFileFn || resolveTaskFile;
  const getTaskAssigneeFn = options.getTaskAssigneeFn || getTaskAssignee;
  const getTaskStatusFn = options.getTaskStatusFn || getTaskStatus;
  const resolveArtifactDirFn = options.resolveArtifactDirFn || resolveArtifactDir;

  const worktree = resolveWorktreeFn(slug) || process.cwd();
  const rootDir = worktree;
  const taskResolution = resolveTaskFileFn(slug, rootDir);

  // Resolve artifact directory
  const artifactDir = resolveArtifactDirFn(rootDir);
  log(fmt.status('INFO', `Consuming reviewer artifacts for ${slug} from ${artifactDir}`));

  // Determine reviewer identity from review-state first, then task assignee.
  const { identityUser: stateReviewer } = resolveReviewIdentity(slug, worktree, {
    readReviewStateFn: options.readReviewStateFn || readReviewState,
  });
  let reviewer = stateReviewer;
  if (!reviewer && taskResolution.ok) {
    reviewer = getTaskAssigneeFn(taskResolution.taskFile!);
  }
  if (!reviewer) {
    reviewer = 'autonomous';
    log(fmt.status('WARN', `No reviewer identity resolved; defaulting to "${reviewer}"`));
  }

  // Consume artifacts - this will create reviewer_findings and reviewer_outcome events
  const result = await consumeReviewerArtifactsFn(slug, reviewer, {
    worktree,
    tmpDir: artifactDir,
    log,
    error,
    providerEnabled: false,
    createEventFn: options.createEventFn as any,
    readArtifactFn: options.readArtifactFn as any,
    deleteArtifactFn: options.deleteArtifactFn as any,
  });

  if (!result.consumed) {
    log(fmt.status('WARN', `No reviewer artifact files found at ${artifactDir} for ${slug}.`));
    return { ok: false, consumed: false };
  }

  if (!result.ok) {
    error(fmt.status('FAIL', `Failed to consume reviewer artifacts for ${slug}: ${result.ok === false ? 'missing required fields (findings, outcome, verdict)' : 'unknown failure'}`));
    return { ok: false, consumed: true };
  }

  // Persist the artifact location to review-state.json if it doesn't exist yet
  const persisted = readReviewState(slug, worktree);
  if (!persisted) {
    writeReviewState(slug, new ReviewState(slug, {
      reviewer,
      round: 1,
      phase: 'reviewing',
    }), worktree);
    log(fmt.status('INFO', 'Created review-state.json for artifact consumption.'));
  }

  // Transition backlog task to review status
  if (taskResolution.ok) {
    const currentStatus = getTaskStatusFn ? getTaskStatusFn(taskResolution.taskFile!) : null;
    if (!currentStatus || currentStatus !== 'review') {
      transitionTaskFn(slug, 'review', { rootDir, log });
    } else {
      log(fmt.status('INFO', `Backlog task for ${slug} already at review status.`));
    }
  }

  const cleanup = await commitPersistedReviewOutputs(slug, {
    worktree,
    taskFile: taskResolution.ok ? taskResolution.taskFile : null,
    log,
    error
  });
  if (!cleanup.ok) {
    error(fmt.status('FAIL', `Consumed reviewer artifacts for ${slug}, but could not commit the persisted mission artifacts.`));
    return { ok: false, consumed: true };
  }

  log(fmt.status('PASS', `Reviewer artifacts consumed for ${slug}. Backlog task set to review.`));
  return { ok: true, consumed: true, reviewState: result.reviewState };
}

// ============================================================================
// Command: submitReviewRound
// ============================================================================

export function submitReviewRound(
  slug: string,
  outcome: string,
  message: string,
  options: {
    log?: (msg: string) => void;
    error?: (msg: string) => void;
    exit?: (code: number) => never;
    transitionTaskFn?: typeof transitionTask;
    readReviewStateFn?: typeof readReviewState;
    writeReviewStateFn?: typeof writeReviewState;
    isReviewProviderEnabledFn?: typeof isProviderEnabled;
    isForgejoReviewEnabledFn?: typeof isProviderEnabled;
    resolveReviewUserFn?: typeof resolveReviewUser;
    resolveForgejoUserFn?: typeof resolveReviewUser;
    resolveTaskFileFn?: typeof resolveTaskFile;
    getTaskStatusFn?: typeof getTaskStatus;
    worktree?: string;
    readTokenFn?: typeof readToken;
    postReviewFn?: typeof postReview;
    getPrAuthorFn?: unknown;
    createEventFn?: typeof createEvent;
    buildMetadataFooterFn?: typeof buildMetadataFooter;
  } = {}
): void {
  const log = options.log || fmt.log.plain;
  const error = options.error || fmt.log.plainError;
  const exit = options.exit || process.exit;
  const transitionTaskFn = options.transitionTaskFn || transitionTask;
  const readReviewStateFn = options.readReviewStateFn || readReviewState;
  const writeReviewStateFn = options.writeReviewStateFn || writeReviewState;
  const isReviewProviderEnabledFn = options.isReviewProviderEnabledFn || options.isForgejoReviewEnabledFn || isProviderEnabled;
  const resolveReviewUserFn = options.resolveReviewUserFn || options.resolveForgejoUserFn || resolveReviewUser;
  const resolveTaskFileFn = options.resolveTaskFileFn || resolveTaskFile;
  const getTaskStatusFn = options.getTaskStatusFn || getTaskStatus;
  const VALID_OUTCOMES = ['approve', 'request-changes', 'comment'];
  if (!VALID_OUTCOMES.includes(outcome)) {
    error(fmt.status('FAIL', `Unknown review outcome "${outcome}". Valid: ${VALID_OUTCOMES.join(', ')}.`));
    exit(1);
    return;
  }

  const worktree = options.worktree || resolveWorktree(slug) || process.cwd();
  const providerEnabled = isReviewProviderEnabledFn(worktree);

  // For provider=none (standalone), skip provider posting and only update review-state
  if (!providerEnabled) {
    log(fmt.status('INFO', `Review provider is none — skipping provider posting, updating review-state only for ${slug}.`));
    const currentState = readReviewStateFn(slug, worktree);

    let stateToWrite: ReviewState;
    if (currentState) {
      stateToWrite = currentState;
      if (outcome === 'approve') {
        stateToWrite.disposition = 'APPROVED';
        try { stateToWrite.transitionTo('approved'); } catch (_) { /* ignore */ }
      } else if (outcome === 'request-changes') {
        stateToWrite.disposition = 'REQUEST_CHANGES';
        try { stateToWrite.transitionTo('fixing'); } catch (_) { /* ignore */ }
      }
    } else {
      // No existing state, create minimal state for tracking
      const phaseForOutcome = outcome === 'approve' ? 'approved' : 'fixing';
      stateToWrite = new ReviewState(slug, {
        disposition: outcome === 'approve' ? 'APPROVED' : outcome === 'request-changes' ? 'REQUEST_CHANGES' : undefined,
        reviewer: 'autonomous',
        implementer: process.env.WORKFLOW_AGENT || 'autonomous',
        round: 1,
        phase: phaseForOutcome,
      });
    }
    writeReviewStateFn(slug, stateToWrite, worktree);

    // Also transition the backlog task for provider=none so integrate preflight passes
    const backlogStatusMap: Record<string, string> = {
      'approve': 'approved',
      'request-changes': 'review',
      'comment': 'review'
    };
    const backlogStatus = backlogStatusMap[outcome];
    if (backlogStatus && !transitionTaskFn(slug, backlogStatus, { rootDir: worktree, log })) {
      log(fmt.status('WARN', `Could not transition backlog task ${slug} to ${backlogStatus}.`));
    }

    log(fmt.status('PASS', `Review outcome "${outcome}" recorded locally for ${slug}.`));
    return;
  }

  // For provider-backed reviews, post through the adapter. Review-state is the normal source.
  let reviewIdentity = resolveReviewIdentity(slug, worktree, {
    readReviewStateFn,
  }).identityUser;

  if (!reviewIdentity) {
    error(fmt.status('FAIL', `Cannot determine review identity for ${slug}. Persist review-state.json or set FORGEJO_USER.`));
    exit(1);
    return;
  }
  reviewIdentity = resolveReviewUserFn(reviewIdentity);
  const result = postWorkflowReview(slug, outcome, message, {
    worktree,
    reviewIdentity: reviewIdentity || undefined,
    readTokenFn: options.readTokenFn,
    postReviewFn: options.postReviewFn,
    getPrAuthorFn: options.getPrAuthorFn as any,
    writeReviewStateFn: options.writeReviewStateFn,
    createEventFn: options.createEventFn as any,
    readReviewStateFn: options.readReviewStateFn,
    buildMetadataFooterFn: options.buildMetadataFooterFn,
    log,
    error
  });

  // Self-author skip: postWorkflowReview intentionally did not POST to the provider
  // (reviewer == PR author) and already persisted the verdict locally. This is
  // a legitimate same-agent-reviewer fallback, not a failure — do NOT exit(1).
  if (result.ok && result.skipped) {
    repairStaleActiveTaskAfterReview(slug, {
      rootDir: worktree,
      resolveTaskFileFn,
      getTaskStatusFn,
      transitionTaskFn,
      log,
      error
    });
    log(fmt.status('WARN', `Review outcome "${outcome}" recorded locally for ${slug} (self-approval POST skipped). A different agent or a human must post the formal provider approval.`));
    return;
  }

  if (!result.ok) {
    exit(1);
    return;
  }

  const currentState = readReviewStateFn(slug, worktree);
  if (currentState) {
    if (outcome === 'approve') {
      currentState.disposition = 'APPROVED';
      try { currentState.transitionTo('approved'); } catch (_) { /* ignore */ }
    } else if (outcome === 'request-changes') {
      currentState.disposition = 'REQUEST_CHANGES';
      try { currentState.transitionTo('fixing'); } catch (_) { /* ignore */ }
    }
    writeReviewStateFn(slug, currentState, worktree);
  }

  const taskResolution = resolveTaskFileFn(slug, worktree);
  const currentStatus = taskResolution.ok ? getTaskStatusFn(taskResolution.taskFile!) : null;
  let backlogStatus: string | null = null;

  if (outcome === 'approve') {
    backlogStatus = currentStatus === 'active' ? 'review' : 'approved';
  } else if (outcome === 'request-changes' || outcome === 'comment') {
    backlogStatus = 'review';
  }

  if (backlogStatus && !transitionTaskFn(slug, backlogStatus, { rootDir: worktree, log })) {
    log(fmt.status('WARN', `Could not transition backlog task ${slug} to ${backlogStatus}.`));
  }
}

// ============================================================================
// Command: closeMissionPr
// ============================================================================

export async function closeMissionPr(
  slug: string,
  options: {
    log?: (msg: string) => void;
    error?: (msg: string) => void;
    exit?: (code: number) => never;
    readTokenFn?: typeof readToken;
    readReviewStateFn?: typeof readReviewState;
    resolveReviewUserFn?: typeof resolveReviewUser;
    resolveForgejoUserFn?: typeof resolveReviewUser;
    closePrFn?: typeof closePr;
    worktree?: string;
  } = {}
): Promise<void> {
  const log = options.log || fmt.log.plain;
  const error = options.error || fmt.log.plainError;
  const exit = options.exit || process.exit;
  const readTokenFn = options.readTokenFn || readToken;
  const readReviewStateFn = options.readReviewStateFn || readReviewState;
  const resolveReviewUserFn = options.resolveReviewUserFn || options.resolveForgejoUserFn || resolveReviewUser;
  const closePrFn = options.closePrFn || closePr;
  const worktree = options.worktree || resolveWorktree(slug) || process.cwd();
  const branch = missionBranchName(slug, worktree);

  let reviewIdentity = resolveReviewIdentity(slug, worktree, {
    readReviewStateFn,
  }).identityUser;

  if (!reviewIdentity) {
    error(fmt.status('FAIL', `Cannot determine review identity for ${slug}. Persist review-state.json or set FORGEJO_USER.`));
    exit(1);
    return;
  }
  reviewIdentity = resolveReviewUserFn(reviewIdentity);

  const token = readTokenFn(reviewIdentity!, { rootDir: worktree });
  if (!token) {
    error(fmt.status('FAIL', `No Forgejo token found for user "${reviewIdentity}".`));
    exit(1);
    return;
  }

  log(fmt.status('INFO', `Closing PR for ${branch} as ${reviewIdentity}...`));
  const result = await closePrFn(branch, token, reviewIdentity!) as Record<string, unknown>;

  if (!result.ok) {
    exit(1);
  }
}

// ============================================================================
// Event CLI Handlers
// ============================================================================

export function createEventHandler(
  slug: string,
  args: string[],
  options: {
    log?: (msg: string) => void;
    error?: (msg: string) => void;
    exit?: (code: number) => never;
    resolveWorktreeFn?: typeof resolveWorktree;
    readReviewStateFn?: typeof readReviewState;
  } = {}
): void {
  const log = options.log || fmt.log.plain;
  const error = options.error || fmt.log.plainError;
  const exit = options.exit || process.exit;
  const resolveWorktreeFn = options.resolveWorktreeFn || resolveWorktree;

  const eventType = flagValue(args, '--type');
  const inputFile = flagValue(args, '--input-file');
  const actor = flagValue(args, '--actor');
  const roundRaw = flagValue(args, '--round');
  const phase = flagValue(args, '--phase');
  const disposition = flagValue(args, '--disposition');
  const verdict = flagValue(args, '--verdict');

  if (!eventType) {
    error(fmt.status('FAIL', '--create-event requires --type <classification>'));
    exit(1);
    return;
  }

  // Validate event type first
  if (!isValidEventType(eventType)) {
    error(fmt.status('FAIL', `Invalid event type "${eventType}". Valid: ${(ALL_EVENT_TYPES as unknown as string[]).join(', ')}`));
    exit(1);
    return;
  }

  // Read content from input file or stdin
  let content = '';
  if (inputFile) {
    try {
      content = fs.readFileSync(inputFile, 'utf8');
      log(fmt.status('INFO', `Read event content from: ${inputFile}`));
    } catch (err) {
      error(fmt.status('FAIL', `Failed to read input file: ${(err as Error).message}`));
      exit(1);
      return;
    }
  }

  const round = roundRaw ? parseInt(roundRaw, 10) : undefined;
  if (roundRaw && isNaN(round!)) {
    error(fmt.status('FAIL', `--round must be a number, got "${roundRaw}"`));
    exit(1);
    return;
  }

  const worktree = resolveWorktreeFn(slug) || process.cwd();

  const params: Record<string, unknown> = { content };
  if (round !== undefined) { params.round = round; }
  if (phase) { params.phase = phase; }
  if (actor) { params.actor = actor; }
  if (disposition) { params.disposition = disposition; }
  if (verdict) { params.verdict = verdict; }

  const readReviewStateFn = options.readReviewStateFn || readReviewState;
  const { identityUser: stateReviewIdentity } = resolveReviewIdentity(slug, worktree, {
    readReviewStateFn,
  });
  const reviewIdentity = actor || stateReviewIdentity;

  // SC 4: For mirrored event types, a provider identity is required before creating the event.
  if (shouldMirrorToProvider(eventType) && !reviewIdentity) {
    error(fmt.status('FAIL', 'Cannot determine review identity for a mirrored event. Validate review-state.json or use --actor.'));
    exit(1);
    return;
  }

  // Extract fields from content if structured
  if (content.includes('fixed_items:') || content.includes('fixedItems:')) {
    try {
      const frontmatterMatch = content.match(/fixed_items:\s*(\[[^\]]*\])/i);
      if (frontmatterMatch) { params.fixedItems = JSON.parse(frontmatterMatch[1]); }
    } catch (_) { /* ignore */ }
    try {
      const frontmatterMatch = content.match(/pushed_back_items:\s*(\[[^\]]*\])/i);
      if (frontmatterMatch) { params.pushedBackItems = JSON.parse(frontmatterMatch[1]); }
    } catch (_) { /* ignore */ }
    try {
      const frontmatterMatch = content.match(/parked_items:\s*(\[[^\]]*\])/i);
      if (frontmatterMatch) { params.parkedItems = JSON.parse(frontmatterMatch[1]); }
    } catch (_) { /* ignore */ }
    try {
      const frontmatterMatch = content.match(/blocked_reason:\s*"([^"]*)"/i);
      if (frontmatterMatch) { params.blockedReason = frontmatterMatch[1]; }
    } catch (_) { /* ignore */ }
  }

  // Create the event
  const result = createEvent(slug, eventType, params as any, {
    worktree,
    skipGit: false,
    log,
    error
  });

  if (!result.ok) {
    error(fmt.status('FAIL', `Could not create event: ${result.error}`));
    exit(1);
    return;
  }

  log(fmt.status('PASS', `Created review event at: ${result.path}`));
}

export function importLegacyHandler(
  slug: string,
  args: string[],
  options: {
    log?: (msg: string) => void;
    error?: (msg: string) => void;
    exit?: (code: number) => never;
    resolveWorktreeFn?: typeof resolveWorktree;
  } = {}
): void {
  const log = options.log || fmt.log.plain;
  const error = options.error || fmt.log.plainError;
  const exit = options.exit || process.exit;
  const resolveWorktreeFn = options.resolveWorktreeFn || resolveWorktree;

  const tmpDir = flagValue(args, '--tmp-dir') || process.env.WORKFLOW_TMP_DIR || os.tmpdir();
  const worktree = resolveWorktreeFn(slug) || process.cwd();

  const result = importAllLegacyArtifacts(slug, { tmpDir, worktree, log, error }) as unknown as Record<string, unknown>;

  const errors = (result.errors as string[]) || [];
  if (!result.ok) {
    error(fmt.status('FAIL', `Legacy import failed: ${errors.join(', ')}`));
    exit(1);
    return;
  }

  log(fmt.status('PASS', `Imported ${result.imported ? (result.imported as unknown[]).length : 0} legacy artifacts for ${slug}`));
}

// ============================================================================
// Main Dispatcher
// ============================================================================

export async function review(
  args: string[],
  options: {
    inferSlugFn?: typeof inferSlug;
    log?: (msg: string) => void;
    error?: (msg: string) => void;
    exit?: (code: number) => never;
    verifyReviewFn?: typeof verifyReview;
    submitForReviewFn?: typeof submitForReview;
    consumeArtifactsFn?: typeof consumeArtifacts;
    pushRoundFn?: typeof pushRound;
    readCommentsFn?: typeof readComments;
    commentRoundFn?: typeof commentRound;
    submitReviewRoundFn?: typeof submitReviewRound;
    closeMissionPrFn?: typeof closeMissionPr;
    startReviewLoopFn?: typeof startReviewLoop;
    recordStageStatsSafeFn?: typeof recordStageStatsSafe;
    startAgentFn?: typeof startAgent;
    resolveTaskFileFn?: typeof resolveTaskFile;
    getTaskImplementerFn?: typeof getTaskImplementer;
    getPrStatusFn?: typeof getPrStatus;
    readReviewStateFn?: typeof readReviewState;
    performStaticReviewFn?: typeof performStaticReview;
    postStaticReviewCommentFn?: typeof postStaticReviewComment;
    resolveWorktreeFn?: typeof resolveWorktree;
    run?: typeof run;
    missionPath?: string;
  } = {}
): Promise<void> {
  const inferSlugFn = options.inferSlugFn || inferSlug;
  const log = options.log || fmt.log.plain;
  const error = options.error || fmt.log.plainError;
  const exit = options.exit || process.exit;
  const verifyReviewFn = options.verifyReviewFn || verifyReview;
  const submitForReviewFn = options.submitForReviewFn || submitForReview;
  const consumeArtifactsFn = options.consumeArtifactsFn || consumeArtifacts;
  const pushRoundFn = options.pushRoundFn || pushRound;
  const readCommentsFn = options.readCommentsFn || readComments;
  const commentRoundFn = options.commentRoundFn || commentRound;
  const submitReviewRoundFn = options.submitReviewRoundFn || submitReviewRound;
  const closeMissionPrFn = options.closeMissionPrFn || closeMissionPr;
  const startReviewLoopFn = options.startReviewLoopFn || startReviewLoop;
  const recordStageStatsSafeFn = options.recordStageStatsSafeFn || recordStageStatsSafe;
  const startAgentFn = options.startAgentFn || startAgent;
  const resolveTaskFileFn = options.resolveTaskFileFn || resolveTaskFile;
  const getTaskImplementerFn = options.getTaskImplementerFn || getTaskImplementer;
  const getPrStatusFn = options.getPrStatusFn || getPrStatus;
  const readReviewStateFn = options.readReviewStateFn || readReviewState;
  const performStaticReviewFn = options.performStaticReviewFn || performStaticReview;
  const postStaticReviewCommentFn = options.postStaticReviewCommentFn || postStaticReviewComment;
  const resolveWorktreeFn = options.resolveWorktreeFn || resolveWorktree;
  const runFn = options.run || run;

  const flags = args.filter(a => a.startsWith('--'));
  const params = args.filter(a => !a.startsWith('--'));

  const explicitSlug = params[0];
  const slug = inferSlugFn(explicitSlug);
  const isSubmit      = flags.includes('--submit');
  const isVerify      = flags.includes('--verify');
  const isStart       = flags.includes('--start');
  const isContinue    = flags.includes('--continue');
  const isPush        = flags.includes('--push');
  const isForce       = flags.includes('--force');
  const isComment     = flags.includes('--comment') || flags.includes('--comment-file');
  const isComments    = flags.includes('--comments');
  const isSubmitReview = flags.includes('--submit-review');
  const isClose       = flags.includes('--close');
  const isStatus      = flags.includes('--status');
  const skipGate      = flags.includes('--no-gate');
  const isDryRun      = flags.includes('--dry-run');
  const isReset       = flags.includes('--reset');
  const isCreateEvent = flags.includes('--create-event');
  const isImportLegacy = flags.includes('--import-legacy');
  const isConsumeArtifacts = flags.includes('--consume-artifacts');
  const missionPath = flagValue(args, '--mission');

  if (!slug) {
    error('Usage: px review [<slug>] [--verify] [--submit] [--push] [--force] [--start] [--continue] [--no-gate] [--status] [--comments] [--comment "<msg>"|--comment-file <path>] [--submit-review <outcome> [--message "<summary>"|--message-file <path>] [--close] [--create-event --type <classification> [--input-file <path>] [--actor <name>] [--round <n>] [--phase <phase>] [--mission <path>]] [--import-legacy [--tmp-dir <dir>]] [--consume-artifacts]');
    exit(1);
    return;
  }

  if (isStatus) {
    showReviewStatus(slug, { ...options, readReviewStateFn });
    return;
  } else if (isVerify) {
    verifyReviewFn(slug, skipGate, { ...options, missionPath: missionPath || undefined });
  } else if (isSubmit) {
    // Pre-check: inspect the configured artifact directory for unprocessed files
    // and emit a warning if artifacts are found but --submit-review was not used.
    const artifactDir = resolveArtifactDir(resolveWorktreeFn(slug) || process.cwd());
    const findingsPath = reviewArtifactPath(slug, 'review-findings.md', artifactDir);
    const outcomePath = reviewArtifactPath(slug, 'review-outcome.md', artifactDir);
    const verdictPath = reviewArtifactPath(slug, 'review-verdict.txt', artifactDir);
    if (fs.existsSync(findingsPath) || fs.existsSync(outcomePath) || fs.existsSync(verdictPath)) {
      log(fmt.status('WARN', `Unprocessed review artifacts found at ${artifactDir} for ${slug}. Consider using --consume-artifacts to persist them before handoff, or use --submit-review to post a verdict.`));
    }
    await submitForReviewFn(slug, skipGate, options);
  } else if (isConsumeArtifacts) {
    await consumeArtifactsFn(slug, options);
  } else if (isPush) {
    await pushRoundFn(slug, { ...options, force: isForce });
  } else if (isComments) {
    await readCommentsFn(slug, options);
  } else if (isComment) {
    const message = readTextFlag(args, '--comment', '--comment-file', 'comment', options);
    if (!message) {
      error(fmt.status('FAIL', '--comment requires text via --comment "<text>" or --comment-file <path>.'));
      exit(1);
      return;
    }
    commentRoundFn(slug, message, options);
  } else if (isSubmitReview) {
    const outcome = flagValue(args, '--submit-review');
    const message = readTextFlag(args, '--message', '--message-file', 'review message', options) || '';
    if (!outcome) {
      error(fmt.status('FAIL', '--submit-review requires an outcome: px review <slug> --submit-review <approve|request-changes|comment> [--message "<summary>"|--message-file <path>]'));
      exit(1);
      return;
    }
    submitReviewRoundFn(slug, outcome, message, options);
  } else if (isClose) {
    await closeMissionPrFn(slug, options);
  } else if (isCreateEvent) {
    createEventHandler(slug, args, options);
    return;
  } else if (isImportLegacy) {
    importLegacyHandler(slug, args, options);
    return;
  } else if (isStart || isContinue) {
    const implementer = flagValue(args, '--implementer');
    const reviewer    = flagValue(args, '--reviewer');
    const focus       = flagValue(args, '--focus') || 'all';
    const maxAttempts = parseInt(flagValue(args, '--max-attempts') || String(DEFAULT_MAX_ATTEMPTS), 10);
    const verbose     = flags.includes('--verbose');
    const pollTimeoutRaw = flagValue(args, '--poll-timeout-seconds');
    const pollTimeoutSeconds = pollTimeoutRaw ? parseInt(pollTimeoutRaw, 10) : null;
    await startReviewLoopFn(slug, {
      implementer: implementer || undefined,
      reviewer: reviewer || undefined,
      focus,
      maxAttempts,
      dryRun: isDryRun,
      reset: isReset,
      isContinue,
      verbose,
      pollTimeoutSeconds,
      missionPath: missionPath || undefined,
      recordStageStatsSafeFn
    });
  } else {
    const pr = getPrStatusFn(missionBranchName(slug, process.cwd()), process.cwd());
    log(fmt.status('INFO', `Review status for mission: ${fmt.slug(slug)}`));
    if ((pr as Record<string, unknown>).exists) {
      log((pr as Record<string, unknown>).raw as string);
    } else {
      log(fmt.status('INFO', 'No active PR found for this mission.'));
      // Static review: when branch exists but no PR is open, inspect the diff
      // and check checkpoint evidence. Auto-trigger review loop if findings exist.
      const worktreeForStatic = resolveWorktreeFn(slug) || process.cwd();
      const staticResult = performStaticReviewFn(slug, { log, findMissionDir, findCheckpoints, readFileSync: fs.readFileSync, run: runFn, resolveWorktree: resolveWorktreeFn, rootDir: worktreeForStatic, missionPath: missionPath || undefined });
      if (staticResult.findings && staticResult.findings.length > 0) {
        // Trivial structural findings (missing Goal Check, no evidence rows, mission
        // dir absent) are self-fixable, so re-launch the implementer with a targeted
        // prompt instead of burning a full reviewer round via the review loop.
        const taskResolution = resolveTaskFileFn(slug, worktreeForStatic);
        const implementer = taskResolution && taskResolution.taskFile
          ? getTaskImplementerFn(taskResolution.taskFile)
          : null;
        if (!implementer) {
          log(fmt.status('WARN', `Static review found ${staticResult.findings.length} finding(s) but the implementer could not be resolved for ${fmt.slug(slug)} — not re-launching the implementer and not starting the review loop.`));
        } else {
          log(`\nStatic review found ${staticResult.findings.length} finding(s). Re-launching implementer (${fmt.agent(implementer)}) with a targeted fix prompt...`);
          const findingLines = staticResult.findings.map((f: string) => `- ${f}`).join('\n');
          const prompt = `Static review of your mission branch found the following issue(s). Fix them and commit, then stop:\n${findingLines}`;
          await startAgentFn('active', { prompt, worktree: worktreeForStatic, agent: implementer, slug });
        }
      } else if (staticResult.ok) {
        log(fmt.status('INFO', 'Static review passed — no findings. Mission branch is clean.'));
        const prStatus = getPrStatusFn(missionBranchName(slug, process.cwd()), process.cwd());
        if (!(prStatus as Record<string, unknown>).exists || (prStatus as Record<string, unknown>).state !== 'open') {
          log(fmt.status('INFO', 'No open PR found — submitting for review before finalizing static review...'));
          await submitForReviewFn(slug, true, options);
        }
        postStaticReviewCommentFn(
          slug,
          formatStaticReviewSuccess(slug),
          { ...options, rootDir: worktreeForStatic, log, error }
        );
      }
    }
    const persisted = readReviewStateFn(slug);
    if (persisted) {
      log(fmt.status('INFO', `Persisted reviewer state: reviewer=${fmt.agent(persisted.reviewer ?? '')} implementer=${fmt.agent(persisted.implementer ?? '')} round=${persisted.round}`));
    }
  }
}
