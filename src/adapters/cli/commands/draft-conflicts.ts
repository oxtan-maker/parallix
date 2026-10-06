import * as fmt from '../../../application/presentation/cli-format.js';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { git, getWorktreeStatus } from '../../git/git.js';
import { findMissionArea, findMissionDir, missionDirForSlug } from '../../filesystem/mission-utils.js';
import { formatVerificationCommand } from '../../verification/verification.js';
import { unquoteGitStatusPath } from '../../git/porcelain-path.js';
import { fallbackDraftCommitMessage } from './draft-prompts.js';

interface DirtyEntry {
  status: string;
  filePath: string;
  sourcePath: string | null;
}

interface DraftConflictOptions {
  slug: string;
  worktree: string;
  conflictEntries: readonly DirtyEntry[];
  gitImpl?: typeof git;
  logFn?: (_message: string) => void;
}

function parseDirtyEntry(entry: string): DirtyEntry {
  const match = entry.match(/^(.{1,2})\s+(.*)$/);
  const status = (match ? match[1] : entry.slice(0, 2)).padEnd(2, ' ');
  const rawPath = (match ? match[2] : entry.slice(2)).trim();
  // For renames git reports `<old> -> <new>`; each side is independently quoted
  // and the ` -> ` separator is always literal, so split before unquoting. Both
  // sides must be decoded because git C-escapes any path with a space or unusual
  // byte under core.quotePath — otherwise `git add --` is handed a quote-wrapped
  // pathspec that matches no file and the fallback commit aborts.
  const renameParts = rawPath.includes(' -> ') ? rawPath.split(' -> ') : null;
  const sourcePath = renameParts ? unquoteGitStatusPath(renameParts[0].trim()) : null;
  const filePath = unquoteGitStatusPath(
    renameParts ? renameParts[renameParts.length - 1].trim() : rawPath
  );
  return { status, filePath, sourcePath };
}

function isUnmergedStatus(status: string): boolean {
  return ['DD', 'AU', 'UD', 'UA', 'DU', 'AA', 'UU'].includes(status);
}

function isDeletedStatus(status: string): boolean {
  return status.includes('D') && !isUnmergedStatus(status);
}

function isMissionTaskPath(filePath: string, slug: string): boolean {
  if (!filePath) {return false;}
  const taskPattern = new RegExp(`^backlog/(?:tasks|completed)/[^/]*${slug}(?:\\b|[^/]*$)`);
  return taskPattern.test(filePath);
}

function isExpectedDraftPath(filePath: string, slug: string, worktree: string): boolean {
  const missionDir = findMissionDir(slug, worktree);
  const missionPrefix = missionDir
    ? `${path.relative(worktree, missionDir)}/`
    : path.relative(worktree, missionDirForSlug(worktree, slug)).split(path.sep).join('/') + '/';
  const isAncestorOfMissionDir = filePath.endsWith('/') && missionPrefix.startsWith(filePath);
  // The harness appends its own workflow entries to `.gitignore` during setup;
  // warning the operator about the harness's own edit is noise on every draft.
  const isWorkflowGitignore = filePath === '.gitignore';
  return filePath.startsWith(missionPrefix)
    || isAncestorOfMissionDir
    || isWorkflowGitignore
    || isMissionTaskPath(filePath, slug);
}

function classifyDraftEntries(dirtyEntries: readonly string[], slug: string, worktree: string) {
  const parsedEntries = dirtyEntries.map(parseDirtyEntry);
  const conflictEntries = parsedEntries.filter(entry => isUnmergedStatus(entry.status));
  const stagedEntries = parsedEntries.filter(entry => !isUnmergedStatus(entry.status));
  const expectedEntries = stagedEntries.filter(entry => isExpectedDraftPath(entry.filePath, slug, worktree));
  const unexpectedEntries = stagedEntries.filter(entry => !isExpectedDraftPath(entry.filePath, slug, worktree));

  return { conflictEntries, expectedEntries, unexpectedEntries };
}

function resolveMissionSpecificDraftConflicts({ slug, worktree, conflictEntries, gitImpl = git, logFn = fmt.log.plain }: DraftConflictOptions): void {
  const sharedConflicts = conflictEntries.filter(entry => !isExpectedDraftPath(entry.filePath, slug, worktree));
  if (sharedConflicts.length > 0) {
    const area = findMissionArea(findMissionDir(slug, worktree) || missionDirForSlug(worktree, slug));
    const sharedFiles = sharedConflicts.map(entry => entry.filePath);
    throw new Error(
      `Draft safety harness found shared-file conflicts: ${sharedFiles.join(', ')}. ` +
      `Run "px resolve-conflict ${slug}" from ${worktree}, then re-run ${formatVerificationCommand(area, worktree)}.`
    );
  }

  if (conflictEntries.length === 0) {
    return;
  }

  logFn(fmt.status('WARN', 'Draft safety harness found mission-specific merge conflicts. Auto-resolving with --theirs:'));
  for (const entry of conflictEntries) {
    logFn(`  ${entry.filePath}`);
    gitImpl(['-C', worktree, 'checkout', '--theirs', '--', entry.filePath]);
    gitImpl(['-C', worktree, 'add', '--', entry.filePath]);
  }
}

interface DraftCommitSafetyOptions {
  slug: string;
  worktree: string;
  dirtyEntries?: readonly string[];
  gitImpl?: typeof git;
  logFn?: (_message: string) => void;
  plumbingLogFn?: (_message: string) => void;
}

function enforceDraftCommitSafety({ slug, worktree, dirtyEntries = getWorktreeStatus(worktree), gitImpl = git, logFn = fmt.log.plain, plumbingLogFn = logFn }: DraftCommitSafetyOptions): boolean {
  if (dirtyEntries.length === 0) {
    plumbingLogFn(fmt.status('PASS', 'Draft safety harness: no uncommitted changes left behind.'));
    return false;
  }

  const entries = dirtyEntries.map(parseDirtyEntry);
  const retiredDocument = entries.find(entry =>
    /(?:^|\/)(?:MISSION|CP-\d+)\.md$/i.test(entry.filePath)
  );
  if (retiredDocument) {
    throw new Error(`Draft safety harness refuses to commit ${retiredDocument.filePath}; record the contract with typed px commands and inspect it with px status.`);
  }
  const missionDir = findMissionDir(slug, worktree) || missionDirForSlug(worktree, slug);
  const missionPath = path.relative(worktree, missionDir).split(path.sep).join('/');
  if (entries.some(entry => entry.status === '??' && entry.filePath.endsWith('/') && `${missionPath}/`.startsWith(entry.filePath)) && fs.existsSync(missionDir)) {
    const retiredName = fs.readdirSync(missionDir).find(name => /^(?:MISSION|CP-\d+)\.md$/i.test(name));
    if (retiredName) {
      throw new Error(`Draft safety harness refuses to commit ${path.join(missionPath, retiredName)}; record the contract with typed px commands and inspect it with px status.`);
    }
  }

  // A draft agent may leave Backlog task metadata uncommitted for the harness.
  // That is the designed handoff, so it travels on the plumbing channel. Genuine trouble
  // (shared-file conflicts, unexpected dirty files) keeps its own WARN below.
  plumbingLogFn(fmt.status('INFO', 'Draft safety harness: committing the changes the draft agent left behind.'));
  for (const entry of dirtyEntries) {
    plumbingLogFn(`  ${entry}`);
  }

  const { conflictEntries, expectedEntries, unexpectedEntries } = classifyDraftEntries(dirtyEntries, slug, worktree);
  resolveMissionSpecificDraftConflicts({ slug, worktree, conflictEntries, gitImpl, logFn });

  const deletedTaskEntries = [...expectedEntries, ...unexpectedEntries].filter(entry =>
    isMissionTaskPath(entry.filePath, slug) && isDeletedStatus(entry.status)
  );
  if (deletedTaskEntries.length > 0) {
    throw new Error(
      `Draft safety harness found deletion of the mission backlog task: ${deletedTaskEntries.map(entry => entry.filePath).join(', ')}. ` +
      'Restore the task file and re-run the draft.'
    );
  }

  const renamedTaskEntries = [...expectedEntries, ...unexpectedEntries].filter(entry =>
    entry.sourcePath &&
    isMissionTaskPath(entry.sourcePath, slug) &&
    entry.filePath !== entry.sourcePath
  );
  if (renamedTaskEntries.length > 0) {
    throw new Error(
      `Draft safety harness found rename/move of the mission backlog task: ${renamedTaskEntries.map(entry => `${entry.sourcePath} -> ${entry.filePath}`).join(', ')}. ` +
      'Restore the task file path and re-run the draft.'
    );
  }

  const stagePaths = [...expectedEntries, ...unexpectedEntries].map(entry => entry.filePath);
  if (unexpectedEntries.length > 0) {
    logFn(fmt.status('WARN', 'Draft safety harness: capturing unexpected dirty files alongside mission artifacts:'));
    for (const entry of unexpectedEntries) {
      logFn(`  ${entry.status} ${entry.filePath}`);
    }
  }

  if (stagePaths.length > 0) {
    gitImpl(['-C', worktree, 'add', '--', ...stagePaths]);
  }
  const commitMessage = fallbackDraftCommitMessage(slug);
  const commitResult = gitImpl([
    '-C',
    worktree,
    'commit',
    '-m',
    commitMessage,
    '-m',
    'Safety harness: capture draft worktree changes left uncommitted by the agent.'
  ]);

  if (commitResult.status !== 0) {
    throw new Error('Draft safety harness could not create fallback commit.');
  }

  plumbingLogFn(fmt.status('PASS', `Draft safety harness committed remaining changes with "${commitMessage}".`));
  return true;
}



export { classifyDraftEntries, isUnmergedStatus, isDeletedStatus, isMissionTaskPath, isExpectedDraftPath, parseDirtyEntry, resolveMissionSpecificDraftConflicts, enforceDraftCommitSafety };
