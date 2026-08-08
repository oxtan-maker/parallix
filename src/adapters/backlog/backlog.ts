import fs from 'fs';
import path from 'path';
import { git } from '../git/git.js';
import { WORKFLOW_AGENT_NAMES } from '../agents/agents.js';
import * as fmt from '../../application/presentation/cli-format.js';
import { resolveTaskStorage } from '../config/product-config.js';
import { isMissionArtifact, missionPathForSlug, resolveBaseWorktree, resolveMissionBaseBranch, resolveWorktree } from '../filesystem/mission-utils.js';

/** @returns {readonly string[]} */
function getSupportedAgents() {
  return WORKFLOW_AGENT_NAMES;
}

/** @param {string} [rootDir] @returns {{tasksDir: string, completedDir: string, archiveTasksDir: string}} */
function getTaskStorage(rootDir = process.cwd()) {
  return resolveTaskStorage(rootDir);
}

/**
 * @param {string} slug
 * @param {string} [rootDir]
 * @returns {string[]}
 */
function findTaskFiles(slug: string, rootDir: string = process.cwd()): string[] {
  const { tasksDir, completedDir, archiveTasksDir: archivedDir } = getTaskStorage(rootDir);
  const sortByBacklogState = (filePath: string) => {
    if (filePath.startsWith(tasksDir + path.sep)) {return 0;}
    if (filePath.startsWith(completedDir + path.sep)) {return 1;}
    if (filePath.startsWith(archivedDir + path.sep)) {return 2;}
    return 3;
  };

  /** @param {string} dir */
  const scan = (dir: string) => {
    if (!fs.existsSync(dir)) {return [];}
    const files = fs.readdirSync(dir);
    const normalizedSlug = slug.toLowerCase();
    return files
      .filter((f: string) => f.toLowerCase().startsWith(normalizedSlug))
      .map((f: string) => path.join(dir, f));
  };

  const matches = [...scan(tasksDir), ...scan(completedDir), ...scan(archivedDir)];
  return matches.sort((a, b) => sortByBacklogState(a) - sortByBacklogState(b) || a.localeCompare(b));
}

/**
 * @param {string} slug
 * @param {string} [rootDir]
 * @returns {{ok: boolean, taskFile?: string, matches: string[], reason?: string}}
 */
function resolveTaskFile(slug: string, rootDir: string = process.cwd()) {
  let matches = findTaskFiles(slug, rootDir);
  const normalizedId = slug.toUpperCase();
  const { tasksDir, completedDir, archiveTasksDir: archivedDir } = getTaskStorage(rootDir);
  /** @param {string[]} candidateMatches */
  const preferSameTaskInHigherPriorityDir = (candidateMatches: string[]) => {
    if (candidateMatches.length < 2) {return null;}
    const [preferred, ...rest] = candidateMatches;
    return rest.every((match: string) => path.basename(match) === path.basename(preferred)) ? preferred : null;
  };

  /** @param {string[]} candidateFiles @param {string} targetId */
  const findById = (candidateFiles: string[], targetId: string) => {
    return candidateFiles.filter((f: string) => {
      try {
        const content = fs.readFileSync(f, 'utf8');
        const idMatch = content.match(/^id:\s*([^\r\n]+)/m);
        return idMatch && idMatch[1].trim().toUpperCase() === targetId;
      } catch (_) {
        return false;
      }
    });
  };

  if (matches.length === 0) {
    // Hardening: If no prefix match, search ALL task files for an exact ID match
    const allFiles = [
      ...(fs.existsSync(tasksDir) ? fs.readdirSync(tasksDir).map(f => path.join(tasksDir, f)) : []),
      ...(fs.existsSync(completedDir) ? fs.readdirSync(completedDir).map(f => path.join(completedDir, f)) : []),
      ...(fs.existsSync(archivedDir) ? fs.readdirSync(archivedDir).map(f => path.join(archivedDir, f)) : []),
    ].filter(f => f.endsWith('.md'));

    const idMatches = findById(allFiles, normalizedId);
    if (idMatches.length === 1) {
      return { ok: true, taskFile: idMatches[0], matches: idMatches };
    }

    // Still no match? Try base task ID if slug has a suffix (e.g., architecture migration-modern -> architecture migration)
    const baseTaskMatch = slug.match(/^(task-\d+)/i);
    if (baseTaskMatch) {
      const baseId = baseTaskMatch[1].toUpperCase();
      const baseMatches = findById(allFiles, baseId);
      if (baseMatches.length === 1) {
        return { ok: true, taskFile: baseMatches[0], matches: baseMatches };
      }
      if (baseMatches.length > 1) {
        const preferred = preferSameTaskInHigherPriorityDir(baseMatches);
        if (preferred) {
          return { ok: true, taskFile: preferred, matches: baseMatches };
        }
        return { ok: false, reason: 'ambiguous', matches: baseMatches };
      }
    }

    return { ok: false, reason: 'missing', matches: idMatches };
  }

  if (matches.length === 1) {
    // Even if one prefix match exists, verify it doesn't conflict with another ID match
    // or just return it if it's the only one.
    return { ok: true, taskFile: matches[0], matches };
  }

  // Preference 1: Exact frontmatter id: match (e.g., id: architecture migration)
  const idMatches = findById(matches, normalizedId);

  if (idMatches.length === 1) {
    return { ok: true, taskFile: idMatches[0], matches: idMatches };
  }
  if (idMatches.length > 1) {
    const preferred = preferSameTaskInHigherPriorityDir(idMatches);
    if (preferred) {
      return { ok: true, taskFile: preferred, matches: idMatches };
    }
    return { ok: false, reason: 'ambiguous', matches: idMatches };
  }

  // Fallback: If no ID matches but we have filename-prefix matches, 
  // we only allow it if it's unambiguous.
  return { ok: false, reason: 'ambiguous', matches };
}

/**
 * @param {string} slug
 * @param {string} [rootDir]
 * @returns {string|undefined|null}
 */
function findTaskFile(slug: string, rootDir: string = process.cwd()) {
  const result = resolveTaskFile(slug, rootDir);
  return result.ok ? result.taskFile : null;
}

/**
 * @param {{ok: boolean, taskFile?: string, matches: string[], reason?: string}} result
 * @param {string} slug
 * @param {Function} [log]
 */
function reportTaskResolution(result: {ok: boolean, taskFile?: string, matches: string[], reason?: string}, slug: string, log: Function = fmt.log.plain) {
  if (result.ok) {return;}
  const { tasksDir, completedDir } = getTaskStorage(process.cwd());
  const taskHint = path.relative(process.cwd(), tasksDir).split(path.sep).join('/');
  const completedHint = path.relative(process.cwd(), completedDir).split(path.sep).join('/');

  if (result.reason === 'ambiguous') {
    log(fmt.status('FAIL', `Backlog task resolution is ambiguous for slug: ${fmt.slug(slug)}`));
    log(fmt.status('INFO', 'Multiple candidates found:'));
    result.matches.forEach((m: string) => log(`  - ${m}`));
    log(fmt.status('INFO', 'Repair: Ensure only one task has the filename prefix or matching "id:" frontmatter.'));
  } else {
    log(fmt.status('FAIL', `Backlog task for ${fmt.slug(slug)} not found in ${fmt.path(taskHint)}/ or ${fmt.path(completedHint)}/.`));
    log(fmt.status('INFO', 'Create the task file first.'));
    log(fmt.status('INFO', 'Repair: create the task with your task adapter, or add a markdown task file manually.'));
    log(fmt.status('INFO', `Manual fallback: create ${fmt.path(`${taskHint}/${slug} - <title>.md`)} with frontmatter id ${fmt.bold(slug.toUpperCase())}.`));
  }
}

/** @param {string} file @returns {string|null} */
function taskIdFromFilename(file: string) {
  // Extract ID from filename prefix (e.g., architecture migration or architecture migration)
  const filenameMatch = file.match(/^(task-\d+(?:\.\d+)?)/i);
  return filenameMatch ? filenameMatch[1].toUpperCase() : null;
}

/**
 * @param {string} [rootDir]
 * @param {string} [slug]
 * @returns {{file: string, type: string, taskId?: string, canonicalFile?: string}[]}
 */
function checkBacklogIntegrity(rootDir: string = process.cwd(), slug: string | null = null) {
  const { tasksDir, completedDir, archiveTasksDir: archivedDir } = getTaskStorage(rootDir);
  const issues = [];
  const normalizedSlug = slug ? slug.toLowerCase() : null;

  // Track where each task id lives so we can detect the same id appearing in
  // both backlog/tasks/ and backlog/completed/ (or backlog/archive/) — the
  // reorder-recreates-completed-task defect (architecture migration). The completed/archive
  // copy is canonical; a backlog/tasks/ copy alongside it is stale.
  const tasksLocations = new Map();      // id -> rel path in tasks/
  const canonicalLocations = new Map();  // id -> rel path in completed|archive

  /** @param {string} dir @param {{canonical?: boolean}} [opts] */
  const scan = (dir: string, { canonical = false }: { canonical?: boolean } = {}) => {
    if (!fs.existsSync(dir)) {return;}
    const files = fs.readdirSync(dir).filter((f: string) => f.endsWith('.md'));
    for (const file of files) {
      if (normalizedSlug && !file.toLowerCase().startsWith(normalizedSlug)) {
        continue;
      }
      const filePath = path.join(dir, file);
      const filenameId = taskIdFromFilename(file);
      if (!filenameId) {continue;}
      const relPath = path.relative(rootDir, filePath);

      if (canonical) {
        if (!canonicalLocations.has(filenameId)) {canonicalLocations.set(filenameId, relPath);}
      } else if (!tasksLocations.has(filenameId)) {
        tasksLocations.set(filenameId, relPath);
      }

      try {
        const content = fs.readFileSync(filePath, 'utf8');

        // Extract ID from frontmatter
        const idMatch = content.match(/^id:\s*([^\r\n]+)/m);
        if (idMatch) {
          const frontmatterId = idMatch[1].trim().toUpperCase();
          if (frontmatterId !== filenameId) {
            issues.push({
              file: relPath,
              type: 'id-mismatch',
              filenameId,
              frontmatterId
            });
          }
        }
      } catch (_) {
        // ignore read errors
      }
    }
  };

  scan(tasksDir);
  scan(completedDir, { canonical: true });
  scan(archivedDir, { canonical: true });

  for (const [id, taskPath] of tasksLocations) {
    const canonicalPath = canonicalLocations.get(id);
    if (canonicalPath) {
      issues.push({
        file: taskPath,
        type: 'duplicate-completed',
        taskId: id,
        canonicalFile: canonicalPath
      });
    }
  }

  return issues;
}

/**
 * Drop backlog/tasks/ copies of task ids whose canonical record already lives
 * in backlog/completed/ or backlog/archive/. Used to make any board mutation
 * (reorder / ordinal write) completed- and archive-aware: the completed copy is
 * treated as canonical and the stale backlog/tasks/ copy is removed. Returns
 * the list of removed { taskId, file, canonicalFile } records. See architecture migration.
 */
function pruneStaleBacklogDuplicates(rootDir = process.cwd()) {
  const removed = [];
  const duplicates = checkBacklogIntegrity(rootDir)
    .filter(issue => issue.type === 'duplicate-completed');

  for (const dup of duplicates) {
    const absPath = path.join(rootDir, dup.file);
    try {
      if (fs.existsSync(absPath)) {
        fs.rmSync(absPath);
        removed.push({ taskId: dup.taskId, file: dup.file, canonicalFile: dup.canonicalFile });
      }
    } catch (_) {
      // ignore removal errors; the integrity gate will still surface the duplicate
    }
  }

  return removed;
}

/** @param {string} taskFilePath @returns {string|null} */
function getTaskStatus(taskFilePath: string) {
  if (!taskFilePath || !fs.existsSync(taskFilePath)) {return null;}
  const content = fs.readFileSync(taskFilePath, 'utf8');

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
 * Internal helper to parse assignee families from YAML frontmatter content.
 * Supports inline array, simple inline, and block formats.
 */
/**
 * @param {string} content
 * @returns {{matched: boolean, families: string[]}}
 */
function parseAssigneeFamilies(content: string) {
  let families: string[] = /** @type {string[]} */ ([]);
  let matched = false;

  const lineMatch = content.match(/^assignee:[ \t]*(.*)$/m);
  if (lineMatch) {
    const rest = lineMatch[1].trim();
    if (rest) {
      matched = true;
      // It's some kind of inline form
      const rawValues = rest.startsWith('[') && rest.endsWith(']')
        ? rest.slice(1, -1)
        : rest;

      families = rawValues.split(',')
        .map((s: string) => s.trim().replace(/^['"]|['"]$/g, '').replace(/^@/, ''))
        .filter((s: string) => s.length > 0);
    }
  }

  if (!matched) {
    // Try block form
    const blockMatch = content.match(/^assignee:[ \t]*[\r\n]+((?:\s+-\s+.+[\r\n]*)+)/m);
    if (blockMatch) {
      matched = true;
      families = blockMatch[1].split(/[\r\n]+/)
        .map((line: string) => line.trim())
        .filter((line: string) => line.startsWith('-'))
        .map((line: string) => line.substring(1).trim().replace(/^['"]|['"]$/g, '').replace(/^@/, ''))
        .filter((s: string) => s.length > 0);
    }
  }

  return { matched, families };
}

/**
 * @param {string} taskFilePath
 * @param {string} message
 * @param {string} [rootDir]
 * @returns {boolean|null|void}
 */
function commitTaskFileUpdate(taskFilePath: string, message: string, rootDir: string = process.cwd()) {
  if (!taskFilePath || !fs.existsSync(taskFilePath)) {return;}
  // Run `git add/commit` against the worktree the caller intended (rootDir),
  // not whichever branch process.cwd() happens to have checked out. All
  // worktrees share one git object store, so the only thing that pins the
  // commit to the correct mission branch is the `-C <rootDir>` working dir.
  // Fall back to the task file's directory if rootDir isn't supplied or the
  // task file lives outside it (defensive: keeps the add/commit consistent).
  const gitDir = (rootDir && taskFilePath.startsWith(path.resolve(rootDir) + path.sep))
    ? rootDir
    : path.dirname(taskFilePath);
  const relativeTaskPath = path.relative(gitDir, taskFilePath);
  try {
    git(['-C', gitDir, 'add', relativeTaskPath]);
    const result = git(['-C', gitDir, 'commit', '-m', message]);
    if (result.status !== 0) {
      // If there's nothing to commit (e.g. no change), git commit exits with status 1
      // but we should check if it was really a failure or just no-op.
      const statusResult = git(['-C', gitDir, 'status', '--porcelain', relativeTaskPath]);
      if (statusResult.stdout.trim() === '') {
        return true; // No-op is success
      }
      fmt.log.warn(`Failed to commit task update: ${result.stderr}`);
      return false;
    }
    return true;
  } catch (/** @type {unknown} */ e) {
    fmt.log.fail(`Git error during task update: ${(e as Error).message}`);
    return false;
  }
}

/** @param {string} taskFilePath @returns {boolean} */
function clearTaskAgentAssignee(taskFilePath: string) {
  if (!taskFilePath || !fs.existsSync(taskFilePath)) {return false;}
  let content = fs.readFileSync(taskFilePath, 'utf8');
  if (!content.match(/^assignee:/m)) {return false;}

  const { families } = parseAssigneeFamilies(content);
  const supportedAgents = getSupportedAgents();

  // Separate agent families from human assignees
  const agentFamilies = families.filter((f: string) => supportedAgents.includes(f.toLowerCase()));
  const humanFamilies = families.filter((f: string) => !supportedAgents.includes(f.toLowerCase()));

  // If there are no agent families to clear, nothing to do — preserve human assignees
  if (agentFamilies.length === 0) {
    // Write back the human-only assignee list
    if (humanFamilies.length > 0) {
      const hasBlockForm = content.match(/^assignee:[ \t]*[\r\n]+/);
      if (humanFamilies.length === families.length) {
        // All families were human; no change needed
        return false;
      }
      // Remove agent families and write back human-only
      let newAssigneeLine;
      if (hasBlockForm) {
        newAssigneeLine = 'assignee:\n' + humanFamilies.map((f: string) => `  - ${f}`).join('\n') + '\n';
      } else {
        newAssigneeLine = `assignee: [${humanFamilies.join(', ')}]`;
      }

      if (content.match(/^assignee:\s*\[.*?\]/m)) {
        content = content.replace(/^assignee:\s*\[.*?\]/m, newAssigneeLine);
      } else if (content.match(/^assignee:[ \t]*[\r\n]+((?:[ \t]+-[ \t]+.+[\r\n]*)+)/m)) {
        content = content.replace(/^assignee:[ \t]*[\r\n]+((?:[ \t]+-[ \t]+.+[\r\n]*)+)/m, newAssigneeLine);
      } else {
        content = content.replace(/^assignee:[ \t]*.*$/m, newAssigneeLine);
      }

      fs.writeFileSync(taskFilePath, content, 'utf8');
      return true;
    }
    return false;
  }

  const hasBlockForm = content.match(/^assignee:\s*\n((?:\s+-\s+.+\r?\n?)+)/m);

  if (!hasBlockForm) {
    // Inline array form: replace with human-only agents
    const newAssignee = humanFamilies.length > 0 ? `[${humanFamilies.join(', ')}]` : '[]';
    content = content.replace(/^assignee:\s*\[.*?\]/m, `assignee: ${newAssignee}`);
  } else {
    // Block form: remove agent lines, keep human lines
    let newBlock = content.replace(/^assignee:[ \t]*[\r\n]+/m, 'assignee:\n');
    const blockLines = newBlock.match(/^assignee:\n((?:\s+-\s+.+\n?)*)/m);
    if (blockLines) {
      const keptLines = blockLines[1].split('\n').filter(line => {
        const m = line.match(/^\s+-\s+(.+)/);
        if (!m) {return line.trim() === '';}
        const family = m[1].trim().replace(/^['"]|['"]$/g, '');
        return !supportedAgents.includes(family.toLowerCase());
      }).join('\n');
      newBlock = newBlock.replace(/^assignee:\n((?:\s+-\s+.+\n?)*)/m, 'assignee:\n' + keptLines);
      if (newBlock.endsWith('assignee:\n') || newBlock.endsWith('assignee: \n') || newBlock.endsWith('assignee:\n\n')) {
        newBlock = newBlock.replace(/assignee:\s*\n\s*$/, 'assignee: []\n');
      }
      content = newBlock;
    } else {
      content = content.replace(/^assignee:\s*\[.*?\]/m, `assignee: []`);
    }
  }

  fs.writeFileSync(taskFilePath, content, 'utf8');
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
 * @returns {boolean}
 */
function transitionTaskLocal(slug: string, newStatus: string, { implementer = null, clearAssignee = false, rootDir = process.cwd(), log = fmt.log.plain }: { implementer?: string | null | undefined, clearAssignee?: boolean, rootDir?: string, log?: Function } = {} as any) {
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
      log(fmt.status('PASS', `Task ${fmt.slug(slug)} transitioned to ${newStatus}${implementer ? ' (assignee=' + fmt.agent(implementer) + ')' : ''} and committed.`));
      return true;
    }
    return false;
  }

  return true; // Already in the desired state
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
      const recorder = new OperationEventRecorder(new SqliteOperationalHistoryRepository(db));
      await recorder.append({
        missionId: missionId(slug),
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

  if (!transitionTaskLocal(slug, newStatus, { implementer, clearAssignee, rootDir: stateRoot, log })) {
    return false;
  }

  // Lane-transition event recording (awaited so the write is not dropped
  // in short-lived CLI processes). Uses dynamic import so the recorder is
  // an optional dependency — recording failure never blocks the authoritative
  // transition (ADR 0051).
  // The old status read above is captured before transitionTaskLocal overwrites it.
  if (oldStatus !== newStatus) {
    await (async () => {
      try {
        const { SqliteDatabaseAdapter } = await import('../sqlite/database-adapter.js');
        const { SqliteMigrationRunner, loadDefaultMigrations } = await import('../sqlite/migration-runner.js');
        const { SqliteBoardLaneEventRepository } = await import('../sqlite/board-lane-event-repository.js');
        const { resolveDatabasePath } = await import('../sqlite/database-path-resolver.js');
        const { BoardEventRecorder, recordLaneTransitionSafely } = await import('../../application/recording/board-event-recorder.js');
        const { SqliteOperationalHistoryRepository } = await import('../sqlite/operational-history-repository.js');
        const { OperationEventRecorder } = await import('../../application/recording/operation-event-recorder.js');
        const { missionId } = await import('../../domain/mission.js');
        const { repositoryId } = await import('../../domain/repository.js');
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
          const repo = new SqliteBoardLaneEventRepository(db);
          const recorder = new BoardEventRecorder(repo);
          const agent = implementer ?? 'unknown';
          const occurredAt = new Date().toISOString();
          // The lane event and the operation-log entry describe the same
          // transition, so they commit as one unit (ADR 0053 transaction
          // rule 1). A failure rolls both back rather than leaving the board
          // with an operation that has no lane history, or the reverse.
          await db.beginTransaction();
          try {
            const appended = await recordLaneTransitionSafely(recorder, {
              missionId: missionId(slug),
              repositoryId: repositoryId(rootDir),
              from: fromStatus,
              to: toStatus,
              trigger,
              agent,
              occurredAt,
              idempotencyKey: `${slug}-${fromStatus ?? 'null'}-${toStatus}-${Date.now() / 1000 | 0}`,
            });
            if (appended) {
              const operations = new OperationEventRecorder(new SqliteOperationalHistoryRepository(db));
              await operations.append({
                missionId: missionId(slug),
                trigger,
                toStatus,
                agent,
                occurredAt,
              });
            }
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

// Public lifecycle seam. Existing command injection and mocks retain this name,
// while every production caller now receives integration-branch behavior.
const transitionTask = transitionTaskOnIntegrationBranch;

/** @param {string} taskFilePath @returns {string|null} */
function getTaskAssignee(taskFilePath: string) {
  if (!taskFilePath || !fs.existsSync(taskFilePath)) {return null;}
  const content = fs.readFileSync(taskFilePath, 'utf8');
  const { families } = parseAssigneeFamilies(content);
  return families.length > 0 ? families[0] : null;
}

/** @param {string} taskFilePath @returns {string|null} */
function getTaskImplementer(taskFilePath: string) {
  if (!taskFilePath || !fs.existsSync(taskFilePath)) {return null;}
  const content = fs.readFileSync(taskFilePath, 'utf8');
  const { families } = parseAssigneeFamilies(content);

  const normalizedFamilies = families.map((f: string) => f.toLowerCase());
  const supportedAgents = getSupportedAgents();
  return normalizedFamilies.find((f: string) => supportedAgents.includes(f)) || null;
}

/** @param {string} taskFilePath @param {string} field @returns {string|null} */
function getTaskFrontmatterValue(taskFilePath: string, field: string) {
  if (!taskFilePath || !fs.existsSync(taskFilePath)) {return null;}
  const content = fs.readFileSync(taskFilePath, 'utf8');
  const pattern = new RegExp(`^${field}:\\s*([^\\r\\n]+)`, 'mi');
  const match = content.match(pattern);
  if (!match) {return null;}
  const value = match[1].trim().replace(/^['"]|['"]$/g, '');
  return value || null;
}

const CLASSIFICATION_LABELS = new Set(['ai_sdlc', 'user_value', 'unknown']);

/**
 * Parse all labels from a task file's frontmatter, supporting both block
 * and inline YAML formats. Returns a lowercased array of label strings.
 * When both formats are present, block labels take precedence (inline is
 * treated as a fallback when no block labels are found).
 */
/** @param {string} taskFilePath */
function getTaskLabels(taskFilePath: string) {
  if (!taskFilePath || !fs.existsSync(taskFilePath)) {return [];}
  const content = fs.readFileSync(taskFilePath, 'utf8');

  const blockMatch = content.match(/^labels:[ \t]*[\r\n]+((?:\s+-\s+.+[\r\n]*)+)/m);
  if (blockMatch) {
    return blockMatch[1].split(/[\r\n]+/)
      .map(line => line.trim())
      .filter(line => line.startsWith('-'))
      .map(line => line.substring(1).trim().replace(/^['"]|['"]$/g, ''))
      .map(s => s.toLowerCase())
      .filter(s => s.length > 0);
  }

  const inlineMatch = content.match(/^labels:[ \t]*\[(.*?)\]/m);
  if (inlineMatch) {
    return inlineMatch[1].split(',')
      .map(s => s.trim().replace(/^['"]|['"]$/g, ''))
      .map(s => s.toLowerCase())
      .filter(s => s.length > 0);
  }

  return [];
}

/** @param {string} taskFilePath */
function getTaskClassification(taskFilePath: string) {
  if (!taskFilePath || !fs.existsSync(taskFilePath)) {return null;}
  const labels = getTaskLabels(taskFilePath);
  const matches = new Set();
  for (const label of labels) {
    if (CLASSIFICATION_LABELS.has(label)) {matches.add(label);}
  }
  return matches.size === 1 ? [...matches][0] : null;
}

/** @param {string} taskFilePath */
function hasBugLabel(taskFilePath: string) {
  const labels = getTaskLabels(taskFilePath);
  return labels.includes('bug');
}

/**
 * Write a label array to a task file's `labels` frontmatter field.
 * Preserves the existing format (inline `labels: [a, b]` or block
 * `labels:\n  - a\n  - b`). If no `labels` field exists, inserts
 * an inline format field after `created_date`.
 *
 * @param {string} taskFilePath
 * @param {string[]} labels
 * @returns {boolean}
 */
function setTaskLabels(taskFilePath: string, labels: string[]) {
  if (!taskFilePath || !fs.existsSync(taskFilePath)) {return false;}
  let content = fs.readFileSync(taskFilePath, 'utf8');

  const inlinePattern = /^labels:[ \t]*\[.*\]$/m;
  const blockPattern = /^labels:[ \t]*[\r\n]+((?:\s+-\s+.+[\r\n]*)+)/m;

  if (inlinePattern.test(content)) {
    // Replace existing inline format
    const newInline = `labels: [${labels.join(', ')}]`;
    content = content.replace(inlinePattern, newInline);
  } else if (blockPattern.test(content)) {
    // Replace existing block format, preserving block style
    const newBlock = 'labels:\n' + labels.map((l: string) => `  - ${l}`).join('\n') + '\n';
    content = content.replace(blockPattern, newBlock);
  } else {
    // No labels field — insert after created_date (inline format)
    const createdDateMatch = content.match(/^created_date:.*$/m);
    if (createdDateMatch && createdDateMatch.index !== undefined) {
      const insertPos = createdDateMatch.index + createdDateMatch[0].length;
      const newLine = '\nlabels: [' + labels.join(', ') + ']';
      content = content.slice(0, insertPos) + newLine + content.slice(insertPos);
    } else {
      // Fallback: insert after the id field
      const idMatch = content.match(/^id:.*$/m);
      if (!idMatch || idMatch.index === undefined) {return false;}
      const insertPos = idMatch.index + idMatch[0].length;
      const newLine = '\nlabels: [' + labels.join(', ') + ']';
      content = content.slice(0, insertPos) + newLine + content.slice(insertPos);
    }
  }

  fs.writeFileSync(taskFilePath, content, 'utf8');
  return true;
}

/**
 * Sync classification labels from a mission worktree task file to the base
 * worktree task file. Reads labels from the mission worktree, writes them to
 * the base worktree using setTaskLabels, and commits the change.
 *
 * @param {string} slug - The mission slug (e.g., 'architecture migration')
 * @param {string} missionWorktree - Path to the mission worktree
 * @param {string} [baseRoot] - Optional base worktree root (resolved from missionWorktree if omitted)
 * @returns {boolean} - true if sync succeeded, false otherwise
 */
function syncTaskLabelsToBaseWorktree(slug: string, missionWorktree: string, baseRoot?: string) {
  try {
    const missionResolution = resolveTaskFile(slug, missionWorktree);
    if (!missionResolution.ok || !missionResolution.taskFile) {
      return false;
    }

    const missionLabels = getTaskLabels(missionResolution.taskFile);
    if (missionLabels.length === 0) {
      return false;
    }

    const baseWorktree = baseRoot || resolveBaseWorktree(slug, { rootDir: missionWorktree });
    const baseResolution = resolveTaskFile(slug, baseWorktree);
    if (!baseResolution.ok || !baseResolution.taskFile) {
      return false;
    }

    if (!setTaskLabels(baseResolution.taskFile, missionLabels)) {
      return false;
    }

    commitTaskFileUpdate(
      baseResolution.taskFile,
      `backlog(${slug}): sync classification labels from mission worktree`,
      baseWorktree
    );

    return true;
  } catch (_) {
    return false;
  }
}


/**
 * @param {string} taskFilePath
 * @param {string} agentFamily
 * @param {{promote?: boolean}} [opts]
 * @returns {boolean}
 */
function setTaskAssignee(taskFilePath: string, agentFamily: string, { promote = true }: { promote?: boolean } = {} as any) {
  if (!taskFilePath || !fs.existsSync(taskFilePath)) {return false;}
  let content = fs.readFileSync(taskFilePath, 'utf8');

  const { matched, families } = parseAssigneeFamilies(content);

  if (matched) {
    const lowerAgentFamily = agentFamily.toLowerCase();
    const existingIndex = families.findIndex((f: string) => f.toLowerCase() === lowerAgentFamily);

    if (existingIndex !== 0) {
      if (existingIndex !== -1) {
        if (!promote) {return false;} // Already in the list, and we don't want to move it
        // Remove existing to promote to first
        families.splice(existingIndex, 1);
      }

      if (promote) {
        families.unshift(agentFamily);
      } else {
        families.push(agentFamily);
      }

      const newAssignees = `assignee: [${families.join(', ')}]`;

      // Replace whatever form was there with a normalized inline array form
      if (content.match(/^assignee:\s*\[.*?\]/m)) {
        content = content.replace(/^assignee:\s*\[.*?\]/m, newAssignees);
      } else if (content.match(/^assignee:\s*\n((?:\s+-\s+.+\r?\n?)+)/m)) {
        content = content.replace(/^assignee:\s*\n((?:\s+-\s+.+\r?\n?)+)/m, newAssignees + '\n');
      } else {
        // Fallback for simple form
        content = content.replace(/^assignee:\s*.*$/m, newAssignees);
      }

      fs.writeFileSync(taskFilePath, content, 'utf8');
      return true;
    }
    return false; // Already authoritative (at index 0)
  }

  // No assignee line exists — insert one after the id frontmatter line
  const insertMatch = content.match(/^(id:.*)/m);
  if (insertMatch && insertMatch.index !== undefined) {
    const insertPos = insertMatch.index + insertMatch[0].length;
    const newLine = '\nassignee: [' + agentFamily + ']';
    content = content.slice(0, insertPos) + newLine + content.slice(insertPos);
    fs.writeFileSync(taskFilePath, content, 'utf8');
    return true;
  }

  return false;
}

/** @param {string} taskFilePath @param {string} agentFamily @returns {boolean} */
function setTaskImplementer(taskFilePath: string, agentFamily: string) {
  if (!taskFilePath || !fs.existsSync(taskFilePath)) {return false;}
  let content = fs.readFileSync(taskFilePath, 'utf8');

  const { matched, families } = parseAssigneeFamilies(content);
  // Separate humans from recognized agents
  const supportedAgents = getSupportedAgents();
  const preservedFamilies = families.filter(f => !supportedAgents.includes(f.toLowerCase()));
  // To ensure the new implementer is authoritative for getTaskImplementer(),
  // it MUST be the first recognized agent in the list.
  const nextFamilies = [agentFamily, ...preservedFamilies];

  if (matched) {
    const normalizedCurrent = families.map((f: string) => f.toLowerCase());
    const normalizedNext = nextFamilies.map((f: string) => f.toLowerCase());
    // Check if the first agent is already the one we want to set
    if (normalizedCurrent.length > 0 && normalizedCurrent[0] === agentFamily.toLowerCase()) {
      // If the rest of the list is also the same, it's a no-op
      if (normalizedCurrent.length === normalizedNext.length &&
          normalizedCurrent.every((f, /** @type {number} */ i) => f === normalizedNext[i])) {
        return false;
      }
    }

    const newAssignees = `assignee: [${nextFamilies.join(', ')}]`;

    if (content.match(/^assignee:\s*\[.*?\]/m)) {
      content = content.replace(/^assignee:\s*\[.*?\]/m, newAssignees);
    } else if (content.match(/^assignee:\s*\n((?:\s+-\s+.+\r?\n?)+)/m)) {
      content = content.replace(/^assignee:\s*\n((?:\s+-\s+.+\r?\n?)+)/m, newAssignees + '\n');
    } else {
      content = content.replace(/^assignee:\s*.*$/m, newAssignees);
    }

    fs.writeFileSync(taskFilePath, content, 'utf8');
    return true;
  }

  const insertMatch = content.match(/^(id:.*)/m);
  if (insertMatch && insertMatch.index !== undefined) {
    const insertPos = insertMatch.index + insertMatch[0].length;
    const newLine = '\nassignee: [' + agentFamily + ']';
    content = content.slice(0, insertPos) + newLine + content.slice(insertPos);
    fs.writeFileSync(taskFilePath, content, 'utf8');
    return true;
  }

  return false;
}

/** @param {string} taskFilePath @param {string} agentFamily @returns {boolean} */
function enforceTaskAssignee(taskFilePath: string, agentFamily: string) {
  if (!taskFilePath || !fs.existsSync(taskFilePath)) {return false;}
  let content = fs.readFileSync(taskFilePath, 'utf8');

  const { families } = parseAssigneeFamilies(content);
  if (families.length === 1 && families[0] === agentFamily) {return true;}

  const newAssignee = `assignee: [${agentFamily}]`;

  if (content.match(/^assignee:[ \t]*[\r\n]+((?:[ \t]+-[ \t]+.+[\r\n]*)+)/m)) {
    content = content.replace(/^assignee:[ \t]*[\r\n]+((?:[ \t]+-[ \t]+.+[\r\n]*)+)/m, newAssignee + '\n');
  } else if (content.match(/^assignee:[ \t]*.*$/m)) {
    content = content.replace(/^assignee:[ \t]*.*$/m, newAssignee);
  } else {
    const insertMatch = content.match(/^(id:.*)/m);
    if (!insertMatch || insertMatch.index === undefined) {return false;}
    const insertPos = insertMatch.index + insertMatch[0].length;
    content = content.slice(0, insertPos) + '\n' + newAssignee + content.slice(insertPos);
  }

  fs.writeFileSync(taskFilePath, content, 'utf8');
  return true;
}

/** @param {string} taskFilePath @returns {string[]} */
function getAcceptanceCriteria(taskFilePath: string) {
  if (!taskFilePath || !fs.existsSync(taskFilePath)) {return [];}
  const content = fs.readFileSync(taskFilePath, 'utf8');
  const sectionMatch = content.match(/## Acceptance Criteria\s*\n([\s\S]*?)(?:\n## |\nDefinition of Done:|\n---\n|$)/);
  if (!sectionMatch) {return [];}

  return sectionMatch[1]
    .split('\n')
    .map(line => line.trim())
    .filter(line => /^- \[[ xX]\]/.test(line));
}


export { findTaskFiles };
export { findTaskFile };
export { resolveTaskFile };
export { reportTaskResolution };
export { checkBacklogIntegrity };
export { pruneStaleBacklogDuplicates };
export { getTaskStorage };
export { getTaskStatus };
export { setTaskStatus };
export { transitionTask };
export { resolveBacklogStateRoot };
export { transitionTaskOnIntegrationBranch };
export { commitTaskFileUpdate };
export { completeTask };
export { getTaskAssignee };
export { getTaskImplementer };
export { getTaskFrontmatterValue };
export { getTaskClassification };
export { getTaskLabels };
export { setTaskLabels };
export { syncTaskLabelsToBaseWorktree };
export { hasBugLabel };
export { setTaskAssignee };
export { setTaskImplementer };
export { enforceTaskAssignee };
export { getAcceptanceCriteria };
export { parseAssigneeFamilies };
export { clearTaskAgentAssignee };
;
