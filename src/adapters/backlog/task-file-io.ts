import fs from 'fs';
import path from 'path';
import { git } from '../git/git.js';
import * as fmt from '../../application/presentation/cli-format.js';
import { resolveTaskStorage } from '../config/product-config.js';

/**
 * Derive a stable repository id from a directory path.
 *
 * Prefers the repo name extracted from `remote.origin.url` so the same
 * repository produces the same id regardless of worktree path. Falls back
 * to the toplevel directory basename when no remote exists.
 */
function resolveStableRepositoryId(rootDir: string): string {
  // Try remote.origin.url first
  const urlResult = git(['-C', rootDir, 'config', '--get', 'remote.origin.url']);
  if (urlResult.status === 0 && urlResult.stdout.trim()) {
    const url = urlResult.stdout.trim();
    const name = extractRepoNameFromUrl(url);
    if (name) { return name; }
  }

  // Fallback: toplevel directory basename (works for worktrees too)
  const toplevelResult = git(['-C', rootDir, 'rev-parse', '--show-toplevel']);
  if (toplevelResult.status === 0 && toplevelResult.stdout.trim()) {
    return path.basename(toplevelResult.stdout.trim());
  }

  // Last resort: rootDir basename
  return path.basename(rootDir);
}

/** Extract repo name from a git remote URL (e.g. "parallix" from "git@github.com:user/parallix.git"). */
function extractRepoNameFromUrl(url: string): string | null {
  // git@host:user/repo.git or git@host:user/repo
  const sshMatch = url.match(/[^/:]+\/([^/]+?)(?:\.git)?$/);
  if (sshMatch) { return sshMatch[1] || null; }

  // https://host/user/repo.git or https://host/user/repo
  const httpsMatch = url.match(/\/([^/]+?)(?:\.git)?$/);
  if (httpsMatch) { return httpsMatch[1] || null; }

  return null;
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


export {
  checkBacklogIntegrity,
  commitTaskFileUpdate,
  extractRepoNameFromUrl,
  findTaskFile,
  findTaskFiles,
  getAcceptanceCriteria,
  getTaskFrontmatterValue,
  getTaskStorage,
  pruneStaleBacklogDuplicates,
  reportTaskResolution,
  resolveStableRepositoryId,
  resolveTaskFile,
  taskIdFromFilename,
};
