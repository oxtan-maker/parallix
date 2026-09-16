/**
 * Preflight section for the integration checkout itself: its branch, any
 * in-progress rebase or unresolved index entries, dirty paths that would
 * collide with closeout, and where Backlog writes will resolve.
 */
import path from 'node:path';
import * as fmt from '../presentation/cli-format.js';
import { resolveIntegrationTaskPath } from './support.js';
import type { PreflightReport } from './preflight.js';
import type {
  IntegrateCheckoutPort,
  IntegrateGitPort,
  IntegrateGitRunner,
  IntegrateWorkflowPorts,
} from '../ports/integrate-workflow.js';

interface CheckoutTarget {
  baseWorktree: string;
  baseBranch: string;
  detectRebaseStateFn: IntegrateGitPort['detectRebaseState'];
  getUnresolvedIndexConflictsFn: IntegrateCheckoutPort['getUnresolvedIndexConflicts'];
  gitFn: IntegrateGitRunner;
}

function checkRebaseAndIndex(report: PreflightReport, context: any, { baseWorktree, detectRebaseStateFn, getUnresolvedIndexConflictsFn }: CheckoutTarget) {
  const { failures, log, detail } = report;
  const rebaseState = detectRebaseStateFn(baseWorktree);
  if (rebaseState.inProgress) {
    failures.push('rebase-in-progress');
    log(fmt.status('FAIL', `Integration checkout rebase: rebase in progress in ${baseWorktree}`));
    if (rebaseState.rebaseHead) {
      log(fmt.status('INFO', `Current rebase head: ${rebaseState.rebaseHead}`));
    }
    rebaseState.unmergedFiles.forEach(file => log(fmt.status('INFO', `  - ${file}`)));
    log(fmt.status('INFO', 'Finish or abort the existing rebase before retrying:'));
    log(fmt.status('INFO', `  git -C ${baseWorktree} rebase --continue`));
    log(fmt.status('INFO', `  git -C ${baseWorktree} rebase --abort`));
    log(fmt.status('INFO', `  git -C ${baseWorktree} rebase --skip`));
    log(fmt.status('INFO', `Retry with: px integrate ${context.slug} --dry-run`));
  }

  const indexConflicts = getUnresolvedIndexConflictsFn(baseWorktree);
  if (!indexConflicts.ok) {
    failures.push('main-index-conflict-check');
    log(fmt.status('FAIL', `Integration checkout conflict scan: could not inspect ${baseWorktree} (${indexConflicts.error || 'unknown error'})`));
  } else if (indexConflicts.files.length > 0) {
    failures.push('main-index-conflicts');
    log(fmt.status('FAIL', `Integration checkout conflicts: unresolved merge entries detected in ${baseWorktree}`));
    indexConflicts.files.forEach(file => log(fmt.status('INFO', `  - ${file}`)));
    log(fmt.status('INFO', 'Resolve each conflicted path, then drop the stale stash entry before retrying:'));
    indexConflicts.files.forEach(file => {
      log(fmt.status('INFO', `  git -C ${baseWorktree} rm "${file}"`));
      log(fmt.status('INFO', `  git -C ${baseWorktree} add "${file}"`));
    });
    log(fmt.status('INFO', `  git -C ${baseWorktree} stash drop`));
    log(fmt.status('INFO', `Retry with: px integrate ${context.slug} --dry-run`));
  } else {
    detail('Integration checkout conflicts: no unresolved merge entries in the git index');
  }
}

/**
 * Paths integrate mutates during closeout. Unrelated backlog tasks are safe to
 * stash and restore; only this mission's task, mission artifacts, and the
 * squash payload can collide with writes.
 */
function closeoutPaths(report: PreflightReport, context: any, { baseWorktree, baseBranch, gitFn }: CheckoutTarget): string[] {
  const overlapPaths: string[] = [];
  const payloadResult = gitFn(['-C', baseWorktree, 'diff', '--name-only', '--no-renames', `${baseBranch}...${context.branch}`]);
  if (payloadResult.status === 0) {
    payloadResult.stdout.split('\n').map(file => file.trim()).filter(Boolean).forEach(file => overlapPaths.push(file));
  } else {
    report.failures.push('main-dirty-payload');
    const payloadError = String(payloadResult.stderr || 'git diff failed').split('\n')[0];
    fmt.log.fail(`[STASH] Could not determine the integration payload; refusing to stash a dirty checkout (${payloadError}).`);
  }
  const taskPath = context.task?.taskFile
    ? resolveIntegrationTaskPath(context.task.taskFile, context.missionWorktree, baseWorktree)
    : '';
  if (taskPath) {
    const taskRelativePath = path.relative(baseWorktree, taskPath);
    overlapPaths.push(taskRelativePath.split(path.sep).join('/'));
    overlapPaths.push(path.join('backlog/completed', path.basename(taskRelativePath)).split(path.sep).join('/'));
  }
  if (context.missionDir) {
    overlapPaths.push(path.relative(baseWorktree, context.missionDir));
  }
  overlapPaths.push(`missions/${context.slug}`);
  return overlapPaths;
}

function checkDirtyEntries(report: PreflightReport, context: any, target: CheckoutTarget) {
  if (!context.mainDirty) {
    report.detail('Integration checkout dirty state: clean');
    return;
  }
  const { baseWorktree } = target;
  const overlapPaths = closeoutPaths(report, context, target);
  const overlappingEntries: string[] = [];
  const nonOverlappingEntries: string[] = [];

  context.mainDirtyEntries.forEach((entry: string) => {
    // Extract the file path from git status --porcelain format (columns 3+)
    const filePath = entry.slice(3).trim();
    if (!filePath) { return; }
    // A first-run config is untracked by design. If the squash lands it,
    // restore drops the stash after confirming the landed file is preserved.
    const isRecoverableFirstRunConfig = entry.startsWith('?? ') && filePath === 'config/agents.json';
    const isOverlap = !isRecoverableFirstRunConfig && overlapPaths.some(missionPath =>
      missionPath && (filePath === missionPath || filePath.startsWith(missionPath + path.sep) || filePath.startsWith(missionPath + '/')));
    (isOverlap ? overlappingEntries : nonOverlappingEntries).push(entry);
  });

  if (overlappingEntries.length > 0) {
    // Upgrade to FAIL — overlapping dirty paths will collide with closeout mutations
    report.failures.push('main-dirty-overlap');
    fmt.log.fail(`[STASH] Integration checkout dirty: overlapping paths detected that collide with integrate closeout.`);
    overlappingEntries.forEach(entry => report.log(fmt.status('WARN', `  - ${entry}`)));
    fmt.log.fail('Recovery steps:');
    fmt.log.fail(`  1. Commit or discard the overlapping changes in ${baseWorktree}`);
    fmt.log.fail(`     git -C ${baseWorktree} add ${overlappingEntries.map(entry => `"${entry.slice(3).trim()}"`).join(' ')}`);
    fmt.log.fail(`  2. Retry: px integrate ${context.slug} --dry-run`);
  } else if (nonOverlappingEntries.length > 0) {
    // Non-overlapping dirty paths are safe to stash and restore
    report.warnings.push('main-dirty');
    fmt.log.warn(`[STASH] Integration checkout dirty: ${baseWorktree} has uncommitted changes that will be stashed temporarily`);
    nonOverlappingEntries.forEach(entry => report.log(fmt.status('INFO', `  - ${entry}`)));
  } else {
    report.detail('Integration checkout dirty state: clean');
  }
}

export function checkIntegrationCheckout(report: PreflightReport, context: any, ports: IntegrateWorkflowPorts, target: CheckoutTarget) {
  const { failures, warnings, log, detail } = report;
  const { baseWorktree, baseBranch } = target;

  if (context.mainBranch === baseBranch) {
    detail(`Integration checkout branch: ${baseWorktree} is on ${baseBranch}`);
  } else {
    failures.push('main-branch');
    log(fmt.status('FAIL', `Integration checkout branch: expected ${baseBranch}, found ${context.mainBranch || '(detached HEAD)'}`));
    log(fmt.status('INFO', `Retry with: git -C ${baseWorktree} checkout ${baseBranch}`));
  }

  checkRebaseAndIndex(report, context, target);
  checkDirtyEntries(report, context, target);

  const cwd = process.cwd();
  const gitDir = path.join(cwd, '.git');
  const isMainRepo = ports.fileSystem.existsSync(gitDir) && !ports.fileSystem.isSymbolicLink(gitDir);
  // Running `px integrate` from the mission's own worktree is the documented
  // flow, not an anomaly.
  const insideMissionWorktree = () => {
    const missionWorktree = ports.missionPaths.conventionalWorktreePath(context.slug);
    return cwd === missionWorktree || cwd.startsWith(missionWorktree + path.sep);
  };
  if (isMainRepo && cwd === baseWorktree) {
    detail('Backlog context: resolves to main repository');
  } else if (insideMissionWorktree()) {
    // integrate chdir's to the integration checkout before any closeout write.
    // Warning about it trained operators to ignore the warning line; keep the
    // fact, drop the false alarm (TASK-2479).
    detail(`Backlog context: invoked from the mission worktree; closeout runs in ${baseWorktree}`);
  } else {
    warnings.push('backlog-context');
    log(fmt.status('WARN', `Backlog context: does not resolve to ${baseWorktree}. (Ignore if running from worktree to test dry-run; post-squash closeout still requires the local integration checkout).`));
  }
}
