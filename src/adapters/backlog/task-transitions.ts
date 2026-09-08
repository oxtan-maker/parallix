import fs from 'fs';
import path from 'path';
import { git } from '../git/git.js';
import * as fmt from '../../application/presentation/cli-format.js';
import { clearTaskAgentAssignee, enforceTaskAssignee, parseAssigneeFamilies } from './task-metadata.js';
import { commitTaskFileUpdate, getTaskStorage, resolveStableRepositoryId, resolveTaskFile } from './task-file-io.js';
import { isMissionArtifact, missionPathForSlug, resolveBaseWorktree, resolveMissionBaseBranch, resolveWorktree } from '../filesystem/mission-utils.js';

function parseTaskStatus(content: string) {

  // Try YAML first
  const yamlMatch = content.match(/^status:\s*([^\r\n]+)/m);
  if (yamlMatch) {
    return yamlMatch[1].trim().toLowerCase();
  }

  // Try rendered format
  const statusMatch = content.match(/^Status:\s*(.*)$/m);
  if (statusMatch) {
    return statusMatch[1].replace(/^[○●\(\)\s]+/, '').trim().toLowerCase();
  }

  return null;
}

function getTaskStatus(taskFilePath: string) {
  if (!taskFilePath || !fs.existsSync(taskFilePath)) {return null;}
  return parseTaskStatus(fs.readFileSync(taskFilePath, 'utf8'));
}

/** @param {string} taskFilePath @param {string} newStatus @returns {boolean} */
function setTaskStatus(taskFilePath: string, newStatus: string) {
  if (!taskFilePath || !fs.existsSync(taskFilePath)) {return false;}
  let content = fs.readFileSync(taskFilePath, 'utf8');

  // Update YAML
  const yamlMatch = content.match(/^status:\s*([^\r\n]+)/m);
  if (yamlMatch) {
    content = content.replace(/^status:\s*.*$/m, `status: ${newStatus}`);
  }

  // Update rendered status line (e.g., "Status: ○ backlog")
  // Map internal status to display markers if needed, but for now just text update
  const statusMatch = content.match(/^Status:\s*(.*)$/m);
  if (statusMatch) {
    const original = statusMatch[1];
    // Keep markers like ○ if they exist
    const markerMatch = original.match(/^([○●\(\)\s]+)/);
    const marker = markerMatch ? markerMatch[1] : '';
    content = content.replace(/^Status:\s*.*$/m, `Status: ${marker}${newStatus}`);
  }

  fs.writeFileSync(taskFilePath, content, 'utf8');
  return true;
}

/**
 * @param {string} slug
 * @param {string} [rootDir]
 * @returns {boolean}
 */
function completeTask(slug: string, rootDir: string = process.cwd()): boolean {
  const resolution = resolveTaskFile(slug, rootDir);
  if (!resolution.ok) {return false;}

  const taskFilePath = /** @type {string} */ (resolution.taskFile);
  if (!taskFilePath) {return false;}
  const fileName = path.basename(taskFilePath);
  const { tasksDir, completedDir } = getTaskStorage(rootDir);

  if (!taskFilePath.includes(tasksDir)) {
    // Already in completed or somewhere else
    setTaskStatus(taskFilePath, 'done');
    return true;
  }

  if (!fs.existsSync(completedDir)) {
    fs.mkdirSync(completedDir, { recursive: true });
  }

  const targetPath = path.join(completedDir, fileName);

  // Set status before moving
  setTaskStatus(taskFilePath, 'done');

  fs.renameSync(taskFilePath, targetPath);
  return true;
}


/**
 * Move a task file into the archive store — the one board authority that hides
 * a mission from every lane. Cancellation deletes lifecycle rows, which the
 * board does not read; without this the cancelled card is re-projected from
 * its task file on the very next refresh.
 *
 * @param {string} slug
 * @param {string} [rootDir]
 * @returns {boolean} whether a task file for the slug is now archived
 */
function archiveTask(slug: string, rootDir: string = process.cwd()): boolean {
  const resolution = resolveTaskFile(slug, rootDir);
  const taskFilePath = resolution.ok ? resolution.taskFile : undefined;
  if (!taskFilePath) { return false; }
  const { archiveTasksDir } = getTaskStorage(rootDir);
  if (taskFilePath.startsWith(archiveTasksDir + path.sep)) { return true; }
  fs.mkdirSync(archiveTasksDir, { recursive: true });
  fs.renameSync(taskFilePath, path.join(archiveTasksDir, path.basename(taskFilePath)));
  return true;
}

/**
 * Transition a task to a new status, optionally enforcing an implementer,
 * restoring a prior assignee, or clearing agent assignees,
 * and commit the change to the mission branch.
 */
/**
 * @param {string} slug
 * @param {string} newStatus
 * @param {{implementer?: string|null, clearAssignee?: boolean, rootDir?: string, log?: Function}} [opts]
 * @returns {Promise<boolean>}
 */
async function transitionTaskLocal(slug: string, newStatus: string, { implementer = null, clearAssignee = false, rootDir = process.cwd(), log = fmt.log.plain }: { implementer?: string | null | undefined, clearAssignee?: boolean, rootDir?: string, log?: Function } = {} as any) {
  const resolution = resolveTaskFile(slug, rootDir);
  if (!resolution.ok) {
    log(fmt.status('WARN', `Could not transition task ${fmt.slug(slug)}: ${resolution.reason}`));
    return false;
  }

  const taskFile = resolution.taskFile as string;

  // Guard: reject suffixed slugs (e.g. "architecture migration-regress") to prevent
  // resolveTaskFile's base-ID fallback from silently committing to the
  // wrong task file when the slug's base ID does not match the resolved
  // file's frontmatter id.  See architecture migration for the original incident.
  const slugHasSuffix = /^(task-\d+)-/i.test(slug);
  if (slugHasSuffix) {
    log(fmt.status('WARN',
      `Task ${fmt.slug(slug)} rejected: slug "${slug}" has a suffix; ` +
      'use the exact task id instead to avoid committing to the wrong file.'));
    return false;
  }

  let changed = false;

  if (implementer) {
    if (enforceTaskAssignee(taskFile, implementer)) {
      changed = true;
    }
  } else if (clearAssignee) {
    if (clearTaskAgentAssignee(taskFile)) {
      changed = true;
    }
  }

  const currentStatus = getTaskStatus(taskFile);
  if (currentStatus !== newStatus) {
    if (setTaskStatus(taskFile, newStatus)) {
      changed = true;
    }
  }

  if (changed) {
    let msg = `backlog(${slug}): transition to ${newStatus}`;
    if (implementer) {msg += ` and implementer=${implementer}`;}
    
    if (commitTaskFileUpdate(taskFile, msg, rootDir)) {
      if (currentStatus !== newStatus) {
        await reconcileExternalMissionLifecycle(slug, newStatus, rootDir);
      }
      log(fmt.status('PASS', `Task ${fmt.slug(slug)} transitioned to ${newStatus}${implementer ? ' (assignee=' + fmt.agent(implementer) + ')' : ''} and committed.`));
      return true;
    }
    return false;
  }

  return true; // Already in the desired state
}

/** Mirror a successful external task write onto its existing repository Mission. */
async function reconcileExternalMissionLifecycle(slug: string, newStatus: string, rootDir: string): Promise<void> {
  try {
    const { SqliteDatabaseAdapter } = await import('../sqlite/database-adapter.js');
    const { SqliteMigrationRunner, loadDefaultMigrations } = await import('../sqlite/migration-runner.js');
    const { resolveDatabasePath } = await import('../sqlite/database-path-resolver.js');
    const { SqliteMissionStore } = await import('../sqlite/mission-store.js');
    const { missionId } = await import('../../domain/mission.js');
    const { parseMissionStatus } = await import('../../domain/board-event.js');
    const status = parseMissionStatus(newStatus);
    if (!status) { return; }

    const db = new SqliteDatabaseAdapter();
    await db.open({ path: resolveDatabasePath() });
    try {
      await new SqliteMigrationRunner(db).applyPending(loadDefaultMigrations());
      const store = new SqliteMissionStore(db);
      const read = await store.load(missionId(slug));
      if (read.kind === 'found'
        && read.mission.repositoryId === resolveStableRepositoryId(rootDir)
        && read.mission.closedAt === null) {
        await store.save({ ...read.mission, status, closedAt: null }, read.version);
      }
    } finally {
      await db.close();
    }
  } catch {
    // SQLite is an optional projection; it never changes the external write result.
  }
}

/**
 * Resolve the checkout that owns a mission's durable Backlog state.  The
 * recorded feature base wins; missions without one retain main's legacy role.
 */
function resolveBacklogStateRoot(slug: string, missionRoot: string = process.cwd()): string {
  const currentBranch = git(['-C', missionRoot, 'branch', '--show-current']);
  if (currentBranch.status === 0 && currentBranch.stdout.trim() && !currentBranch.stdout.trim().startsWith('mission/')) {
    return missionRoot;
  }
  return resolveBaseWorktree(slug, { rootDir: missionRoot });
}

/** @param {string} taskFilePath @param {string[]} families */
function replaceTaskAssignees(taskFilePath: string, families: string[]): boolean {
  if (!taskFilePath || !fs.existsSync(taskFilePath)) {return false;}
  let content = fs.readFileSync(taskFilePath, 'utf8');
  const replacement = `assignee: [${families.join(', ')}]`;
  const blockPattern = /^assignee:[ \t]*[\r\n]+((?:[ \t]+-[ \t]+.+[\r\n]*)+)/m;
  if (blockPattern.test(content)) {
    content = content.replace(blockPattern, replacement + '\n');
  } else if (/^assignee:[ \t]*.*$/m.test(content)) {
    content = content.replace(/^assignee:[ \t]*.*$/m, replacement);
  } else {
    const idMatch = content.match(/^id:.*$/m);
    if (!idMatch || idMatch.index === undefined) {return false;}
    const insertPos = idMatch.index + idMatch[0].length;
    content = content.slice(0, insertPos) + '\n' + replacement + content.slice(insertPos);
  }
  fs.writeFileSync(taskFilePath, content, 'utf8');
  return true;
}

/**
 * Keep the mission's descriptive task metadata while restoring the lifecycle
 * fields owned by the integration branch.
 * @param {string} missionTaskFile
 * @param {string} authoritativeTaskFile
 */
function restoreAuthoritativeTaskLifecycle(missionTaskFile: string, authoritativeTaskFile: string): boolean {
  if (!fs.existsSync(missionTaskFile) || !fs.existsSync(authoritativeTaskFile)) {return false;}
  const authoritative = fs.readFileSync(authoritativeTaskFile, 'utf8');
  const status = getTaskStatus(authoritativeTaskFile);
  const assignees = parseAssigneeFamilies(authoritative);
  if (!status || !assignees.matched) {return false;}
  return setTaskStatus(missionTaskFile, status)
    && replaceTaskAssignees(missionTaskFile, assignees.families);
}

/** @param {string} worktree */
function unresolvedRebaseFiles(worktree: string): string[] {
  const result = git(['-C', worktree, 'diff', '--name-only', '--diff-filter=U']);
  if (result.status !== 0) {return [];}
  return result.stdout.split('\n').map(file => file.trim()).filter(Boolean);
}

/**
 * Resolve only mission-owned artifacts. Shared source conflicts still require a
 * human decision. Task files receive a field-aware merge: descriptive metadata
 * comes from the mission commit, while status and assignee come from the
 * integration branch.
 */
function reconcileMissionRebase({ slug, missionWorktree, authoritativeTaskFile, taskRelativePath, log }: {
  slug: string;
  missionWorktree: string;
  authoritativeTaskFile: string;
  taskRelativePath: string;
  log: Function;
}): boolean {
  for (let round = 0; round < 20; round += 1) {
    const conflicts = unresolvedRebaseFiles(missionWorktree);
    if (conflicts.length === 0 || conflicts.some(file => !isMissionArtifact(file, slug, missionWorktree))) {
      return false;
    }

    for (const file of conflicts) {
      const checkout = git(['-C', missionWorktree, 'checkout', '--theirs', '--', file]);
      if (checkout.status !== 0) {return false;}
      if (file === taskRelativePath) {
        const missionTaskFile = path.join(missionWorktree, file);
        if (!restoreAuthoritativeTaskLifecycle(missionTaskFile, authoritativeTaskFile)) {return false;}
      }
      if (git(['-C', missionWorktree, 'add', '--', file]).status !== 0) {return false;}
    }

    log(fmt.status('INFO', `Automatically reconciled mission-owned rebase conflict(s): ${conflicts.join(', ')}`));
    const staged = git(['-C', missionWorktree, 'diff', '--cached', '--quiet']);
    const continuation = staged.status === 0
      ? git(['-C', missionWorktree, 'rebase', '--skip'])
      : git(['-C', missionWorktree, '-c', 'core.editor=true', 'rebase', '--continue']);
    if (continuation.status === 0) {return true;}
    if (unresolvedRebaseFiles(missionWorktree).length === 0) {return false;}
  }
  return false;
}

/**
 * Apply a mission lifecycle transition where Backlog is authoritative, then
 * bring the mission worktree forward to the branch that received the update.
 * This deliberately composes the established worktree and git abstractions;
 * callers must not write a mission-worktree copy of backlog.md directly.
 */
/**
 * Transition a task to a new status on the integration branch.
 * Awaits lane-event recording so the write is not dropped in short-lived CLI processes.
 */
/**
 * Record a lifecycle operation that changes no lane.
 *
 * `px checkpoint` records evidence without moving the mission between lanes, so
 * it has no `LaneTransitionEvent` to commit alongside. It still appends one
 * `operational_history` row through the same recorder and the same operator
 * database as the transition seam below, so the board's operation log carries
 * every lifecycle step rather than only the ones that changed lane.
 *
 * Operator-local telemetry never blocks the command that produced it
 * (ADR 0051): a database that cannot be opened is a silent no-op.
 */
export async function recordLifecycleOperation(
  slug: string,
  options: { trigger: string; toStatus: string; agent?: string | null; occurredAt?: string } ,
): Promise<boolean> {
  try {
    const { SqliteDatabaseAdapter } = await import('../sqlite/database-adapter.js');
    const { SqliteMigrationRunner, loadDefaultMigrations } = await import('../sqlite/migration-runner.js');
    const { SqliteOperationalHistoryRepository } = await import('../sqlite/operational-history-repository.js');
    const { resolveDatabasePath } = await import('../sqlite/database-path-resolver.js');
    const { OperationEventRecorder } = await import('../../application/recording/operation-event-recorder.js');
    const { missionId } = await import('../../domain/mission.js');

    const db = new SqliteDatabaseAdapter();
    await db.open({ path: resolveDatabasePath() });
    try {
      const runner = new SqliteMigrationRunner(db);
      await runner.applyPending(loadDefaultMigrations());
      // The Mission aggregate owns the repository this operation belongs to.
      // Recording the row without it would leave a history entry that no
      // repository-scoped reader can attribute, and mission ids collide across
      // repositories.
      const { SqliteMissionStore } = await import('../sqlite/mission-store.js');
      const read = await new SqliteMissionStore(db).load(missionId(slug));
      if (read.kind !== 'found') {
        return false;
      }
      const recorder = new OperationEventRecorder(new SqliteOperationalHistoryRepository(db));
      await recorder.append({
        missionId: missionId(slug),
        repositoryId: read.mission.repositoryId,
        trigger: options.trigger as never,
        toStatus: options.toStatus,
        agent: options.agent ?? 'unknown',
        occurredAt: options.occurredAt ?? new Date().toISOString(),
      });
      return true;
    } finally {
      await db.close();
    }
  } catch {
    return false;
  }
}

async function transitionTaskOnIntegrationBranch(
  slug: string,
  newStatus: string,
  { implementer = null, clearAssignee = false, rootDir = process.cwd(), log = fmt.log.plain, deferMissionRebase = false }: { implementer?: string | null | undefined, clearAssignee?: boolean, rootDir?: string, log?: Function, deferMissionRebase?: boolean } = {} as any
): Promise<boolean> {
  let stateRoot: string;
  try {
    stateRoot = resolveBacklogStateRoot(slug, rootDir);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    log(fmt.status('WARN', `Could not resolve integration branch for ${fmt.slug(slug)}: ${detail}`));
    return false;
  }

  // Capture old status before the transition for lane-event recording
  const resolution = resolveTaskFile(slug, stateRoot);
  const oldStatus = resolution.ok && resolution.taskFile ? getTaskStatus(resolution.taskFile) : null;

  if (!await transitionTaskLocal(slug, newStatus, { implementer, clearAssignee, rootDir: stateRoot, log })) {
    return false;
  }

  // Mirror the authoritative Markdown transition onto the Mission aggregate so
  // the lane event is written by the one module that writes lane events,
  // `SqliteMissionStore.saveWithTransition`. This seam builds no event row of
  // its own (TASK-2347.02). It is awaited so the write is not dropped in
  // short-lived CLI processes, and every dependency is imported dynamically so
  // operator storage stays optional — recording failure never blocks the
  // authoritative transition (ADR 0051).
  // The old status read above is captured before transitionTaskLocal overwrites it.
  if (oldStatus !== newStatus) {
    await (async () => {
      try {
        const { SqliteDatabaseAdapter } = await import('../sqlite/database-adapter.js');
        const { SqliteMigrationRunner, loadDefaultMigrations } = await import('../sqlite/migration-runner.js');
        const { resolveDatabasePath } = await import('../sqlite/database-path-resolver.js');
        const { SqliteMissionStore } = await import('../sqlite/mission-store.js');
        const { lifecycleLaneEvent } = await import('../../application/lifecycle-lane-event.js');
        const { SqliteOperationalHistoryRepository } = await import('../sqlite/operational-history-repository.js');
        const { OperationEventRecorder } = await import('../../application/recording/operation-event-recorder.js');
        const { missionId } = await import('../../domain/mission.js');
        const { triggerFromTransition, parseMissionStatus } = await import('../../domain/board-event.js');
        const toStatus = parseMissionStatus(newStatus);
        // Skip if the target status is not a valid MissionStatus
        if (!toStatus) {
          return;
        }
        const fromStatus = parseMissionStatus(oldStatus ?? '');
        const trigger = triggerFromTransition(fromStatus, toStatus);
        // Skip recording if the transition is not recognised by the state machine
        if (!trigger) {
          return;
        }
        const db = new SqliteDatabaseAdapter();
        await db.open({ path: resolveDatabasePath() });
        try {
          const runner = new SqliteMigrationRunner(db);
          await runner.applyPending(loadDefaultMigrations());
          const store = new SqliteMissionStore(db);
          const read = await store.load(missionId(slug));
          // The lane event belongs to the Mission aggregate. A slug the
          // operator database does not know has no aggregate to move, so there
          // is nothing to record — inventing a bare event here is exactly the
          // second write path this seam no longer owns.
          if (read.kind !== 'found' || read.mission.closedAt !== null) {
            return;
          }
          const agent = implementer ?? 'unknown';
          const occurredAt = new Date().toISOString();
          const moved = { ...read.mission, status: toStatus, closedAt: null };
          // The aggregate write, its lane event and the operation-log entry
          // describe the same transition, so they commit as one unit (ADR 0053
          // transaction rule 1). The lane event is appended by
          // `SqliteMissionStore.saveWithTransition` — the single writer — and a
          // failure rolls the whole unit back rather than leaving the board
          // with an operation that has no lane history, or the reverse.
          await db.beginTransaction();
          try {
            await store.saveWithTransition(
              moved,
              read.version,
              lifecycleLaneEvent({
                mission: moved,
                from: fromStatus,
                trigger,
                agent,
                occurredAt,
              }),
            );
            const operations = new OperationEventRecorder(new SqliteOperationalHistoryRepository(db));
            await operations.append({
              missionId: missionId(slug),
              repositoryId: read.mission.repositoryId,
              trigger,
              toStatus,
              agent,
              occurredAt,
            });
            await db.commitTransaction();
          } catch (error) {
            await db.rollbackTransaction();
            throw error;
          }
        } finally {
          await db.close();
        }
      } catch {
        // Recording failure is silently swallowed — never blocks the transition
      }
    })();
  }

  const missionWorktree = resolveWorktree(slug, { cwd: rootDir });
  if (!missionWorktree || missionWorktree === stateRoot) {
    return true;
  }
  const authoritativeResolution = resolveTaskFile(slug, stateRoot);
  if (!authoritativeResolution.ok || !authoritativeResolution.taskFile) {
    log(fmt.status('WARN', `Could not resolve authoritative task metadata for ${fmt.slug(slug)} after transition.`));
    return false;
  }
  const taskRelativePath = path.relative(stateRoot, authoritativeResolution.taskFile).split(path.sep).join('/');

  // Launch callbacks run concurrently with the newly spawned agent, and draft
  // bookkeeping can run while agent output is still uncommitted. Rebasing in
  // either state races or rejects those edits. The authoritative transition is
  // already durable on the integration branch, so leave synchronization to the
  // next clean lifecycle boundary.
  const dirty = git(['-C', missionWorktree, 'status', '--porcelain']);
  const reviewEventPrefix = `${path.relative(missionWorktree, path.join(path.dirname(missionPathForSlug(missionWorktree, slug)), 'review-events')).split(path.sep).join('/')}/`;
  const blockingDirtyEntries = dirty.status === 0
    ? dirty.stdout.split('\n').map(entry => entry.trimEnd()).filter(Boolean).filter(entry => {
      const status = entry.slice(0, 2);
      const file = entry.slice(3).trim().split(path.sep).join('/');
      // Reviewer artifacts are complete workflow output by the time approval is
      // recorded. They are committed at the next review boundary, but must not
      // look like in-flight agent edits and strand the mission task at `review`.
      return status !== '??'
        || !file.startsWith(reviewEventPrefix);
    })
    : [];
  if (deferMissionRebase || blockingDirtyEntries.length > 0) {
    log(fmt.status('INFO', `Deferring mission rebase for ${fmt.slug(slug)} until the worktree is clean.`));
    return true;
  }

  const baseBranch = resolveMissionBaseBranch(slug, missionWorktree);
  const result = git(['-C', missionWorktree, 'rebase', baseBranch]);
  if (result.status !== 0) {
    if (reconcileMissionRebase({
      slug,
      missionWorktree,
      authoritativeTaskFile: authoritativeResolution.taskFile,
      taskRelativePath,
      log,
    })) {
      log(fmt.status('PASS', `Rebased mission/${slug} onto ${baseBranch} after automatic mission-state reconciliation.`));
      return true;
    }
    const detail = [result.stdout, result.stderr].filter(Boolean).join('\n').trim();
    const abort = git(['-C', missionWorktree, 'rebase', '--abort']);
    const abortDetail = abort.status === 0
      ? ' Rebase aborted; the mission worktree was restored to its pre-rebase state.'
      : ` Rebase abort also failed${[abort.stdout, abort.stderr].filter(Boolean).join('\n').trim() ? ': ' + [abort.stdout, abort.stderr].filter(Boolean).join('\n').trim() : '.'}`;
    log(fmt.status('WARN', `Backlog state updated on integration branch, but mission/${slug} could not rebase onto ${baseBranch}${detail ? ': ' + detail : '.'}${abortDetail}`));
    return false;
  }
  log(fmt.status('PASS', `Rebased mission/${slug} onto ${baseBranch} after Backlog state update.`));
  return true;
}

// Public lifecycle seam: transitions belong to the worktree that invokes them.
const transitionTask = transitionTaskLocal;

export {
  archiveTask,
  completeTask,
  getTaskStatus,
  parseTaskStatus,
  reconcileMissionRebase,
  replaceTaskAssignees,
  resolveBacklogStateRoot,
  restoreAuthoritativeTaskLifecycle,
  setTaskStatus,
  transitionTask,
  transitionTaskLocal,
  transitionTaskOnIntegrationBranch,
  unresolvedRebaseFiles,
};
