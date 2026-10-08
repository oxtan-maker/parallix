import fs from 'fs';
import path from 'path';
import { git } from '../git/git.js';
import * as fmt from '../../application/presentation/cli-format.js';
import { resolveTaskStorage } from '../config/product-config.js';
import { bookkeepingCommitMessage } from '../../domain/approval-coverage.js';

function resolveStableRepositoryId(rootDir: string): string {
  // Prefer the git common dir: shared by the primary checkout and every linked
  // worktree, so it is stable across worktrees and can never equal a worktree
  // basename. Unique per repository on the machine, and present even when the
  // remote.origin.url is missing (e.g. a moved/local scratch checkout).
  // Resolve to an absolute path so a relative ".git" from a primary checkout
  // collapses to the same absolute common dir a linked worktree reports.
  const commonDirResult = git(['-C', rootDir, 'rev-parse', '--git-common-dir']);
  if (commonDirResult.status === 0 && commonDirResult.stdout.trim()) {
    const commonDir = commonDirResult.stdout.trim();
    return path.isAbsolute(commonDir) ? commonDir : path.resolve(rootDir, commonDir);
  }

  // Fallback: full remote URL. Identical for the primary checkout and every
  // linked worktree, and never a basename. Useful when the common dir path is
  // not meaningful on its own.
  const urlResult = git(['-C', rootDir, 'config', '--get', 'remote.origin.url']);
  if (urlResult.status === 0 && urlResult.stdout.trim()) {
    return urlResult.stdout.trim();
  }

  // Absolute last resort: toplevel directory path. Only reached when the git
  // common dir is unavailable (e.g. a moved scratch checkout whose common dir
  // no longer resolves). The absolute toplevel path is stable for a single
  // checkout and never leaks a worktree basename.
  const toplevelResult = git(['-C', rootDir, 'rev-parse', '--show-toplevel']);
  if (toplevelResult.status === 0 && toplevelResult.stdout.trim()) {
    return toplevelResult.stdout.trim();
  }

  return path.basename(rootDir);
}

/** @param {string} [rootDir] @returns {{tasksDir: string, completedDir: string, archiveTasksDir: string}} */
function getTaskStorage(rootDir = process.cwd(), cache?: TaskScanCache) {
  const cached = cache?.storage.get(rootDir);
  if (cached !== undefined) { return cached; }
  const storage = resolveTaskStorage(rootDir);
  cache?.storage.set(rootDir, storage);
  return storage;
}

function listDirectory(dir: string, cache?: TaskScanCache): string[] {
  const cached = cache?.listings.get(dir);
  if (cached !== undefined) { return cached; }
  const names = fs.existsSync(dir) ? fs.readdirSync(dir) : [];
  cache?.listings.set(dir, names);
  return names;
}

/**
 * @param {string} slug
 * @param {string} [rootDir]
 * @returns {string[]}
 */
function findTaskFiles(slug: string, rootDir: string = process.cwd(), cache?: TaskScanCache): string[] {
  const { tasksDir, completedDir, archiveTasksDir: archivedDir } = getTaskStorage(rootDir, cache);
  const sortByBacklogState = (filePath: string) => {
    if (filePath.startsWith(tasksDir + path.sep)) {return 0;}
    if (filePath.startsWith(completedDir + path.sep)) {return 1;}
    if (filePath.startsWith(archivedDir + path.sep)) {return 2;}
    return 3;
  };

  /** @param {string} dir */
  const scan = (dir: string) => {
    const files = listDirectory(dir, cache);
    const normalizedSlug = slug.toLowerCase();
    return files
      .filter((f: string) => f.toLowerCase().startsWith(normalizedSlug))
      .map((f: string) => path.join(dir, f));
  };

  const matches = [...scan(tasksDir), ...scan(completedDir), ...scan(archivedDir)];
  return matches.sort((a, b) => sortByBacklogState(a) - sortByBacklogState(b) || a.localeCompare(b));
}

function preferSameTaskInHigherPriorityDir(candidateMatches: string[]): string | null {
  if (candidateMatches.length < 2) { return null; }
  const [preferred, ...rest] = candidateMatches;
  return rest.every((match: string) => path.basename(match) === path.basename(preferred)) ? preferred : null;
}

/**
 * Memo for a batch of task resolutions that observe one filesystem state
 * (one board build). Without it every unresolved slug re-lists the Backlog
 * directories and re-reads every task file for its frontmatter id.
 */
interface TaskScanCache {
  readonly listings: Map<string, string[]>;
  readonly ids: Map<string, string | null>;
  readonly storage: Map<string, ReturnType<typeof resolveTaskStorage>>;
}

function createTaskScanCache(): TaskScanCache {
  return { listings: new Map(), ids: new Map(), storage: new Map() };
}

function frontmatterTaskId(file: string, cache?: TaskScanCache): string | null {
  const cached = cache?.ids.get(file);
  if (cached !== undefined) { return cached; }
  let id: string | null;
  try {
    const idMatch = fs.readFileSync(file, 'utf8').match(/^id:\s*([^\r\n]+)/m);
    id = idMatch ? idMatch[1].trim().toUpperCase() : null;
  } catch (_) {
    id = null;
  }
  cache?.ids.set(file, id);
  return id;
}

function findTaskFilesById(candidateFiles: string[], targetId: string, cache?: TaskScanCache): string[] {
  return candidateFiles.filter((file: string) => frontmatterTaskId(file, cache) === targetId);
}

function uniqueOrPreferredTask(matches: string[]) {
  if (matches.length === 1) { return { ok: true, taskFile: matches[0], matches }; }
  const preferred = preferSameTaskInHigherPriorityDir(matches);
  return preferred
    ? { ok: true, taskFile: preferred, matches }
    : { ok: false, reason: 'ambiguous', matches };
}

function allTaskFiles(tasksDir: string, completedDir: string, archivedDir: string, cache?: TaskScanCache): string[] {
  const key = `all\0${tasksDir}\0${completedDir}\0${archivedDir}`;
  const cached = cache?.listings.get(key);
  if (cached !== undefined) { return cached; }
  const files = [tasksDir, completedDir, archivedDir]
    .flatMap((dir) => listDirectory(dir, cache).map((file) => path.join(dir, file)))
    .filter((file) => file.endsWith('.md'));
  cache?.listings.set(key, files);
  return files;
}

function resolveMissingPrefixTask(slug: string, normalizedId: string, files: string[], cache?: TaskScanCache) {
  // Only a single exact-id hit resolves here. Several files claiming one id is
  // not authority to pick one, so the base-task-id fallback still runs and the
  // unresolved answer stays `missing` — the reason this seam reported before the
  // id lookup was factored out. The base id keeps a dotted subtask number: an
  // explicit `task-2623.04` names that exact task, so it never falls back to
  // TASK-2623 (task-2624); `task-115-modernized` still falls back to TASK-115.
  const idMatches = findTaskFilesById(files, normalizedId, cache);
  if (idMatches.length === 1) { return { ok: true, taskFile: idMatches[0], matches: idMatches }; }
  const baseId = slug.match(/^(task-\d+(?:\.\d+)?)/i)?.[1]?.toUpperCase();
  if (!baseId) { return { ok: false, reason: 'missing', matches: idMatches }; }
  const baseMatches = findTaskFilesById(files, baseId, cache);
  return baseMatches.length > 0
    ? uniqueOrPreferredTask(baseMatches)
    : { ok: false, reason: 'missing', matches: idMatches };
}

/**
 * @param {string} slug
 * @param {string} [rootDir]
 * @param {TaskScanCache} [cache] share across resolutions that observe one filesystem state
 * @returns {{ok: boolean, taskFile?: string, matches: string[], reason?: string}}
 */
function resolveTaskFile(slug: string, rootDir: string = process.cwd(), cache?: TaskScanCache) {
  const matches = findTaskFiles(slug, rootDir, cache);
  const normalizedId = slug.toUpperCase();
  const { tasksDir, completedDir, archiveTasksDir: archivedDir } = getTaskStorage(rootDir, cache);

  if (matches.length === 0) {
    return resolveMissingPrefixTask(slug, normalizedId, allTaskFiles(tasksDir, completedDir, archivedDir, cache), cache);
  }

  if (matches.length === 1) {
    // Even if one prefix match exists, verify it doesn't conflict with another ID match
    // or just return it if it's the only one.
    return { ok: true, taskFile: matches[0], matches };
  }

  // Preference 1: Exact frontmatter id: match (e.g., id: architecture migration)
  const idMatches = findTaskFilesById(matches, normalizedId);
  if (idMatches.length > 0) { return uniqueOrPreferredTask(idMatches); }

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

function recordFrontmatterIdMismatch(filePath: string, relPath: string, filenameId: string, issues: any[]) {
  try {
    const idMatch = fs.readFileSync(filePath, 'utf8').match(/^id:\s*([^\r\n]+)/m);
    const frontmatterId = idMatch?.[1]?.trim().toUpperCase();
    if (frontmatterId !== undefined && frontmatterId !== filenameId) {
      issues.push({ file: relPath, type: 'id-mismatch', filenameId, frontmatterId });
    }
  } catch (_) {
    // ignore read errors
  }
}

function scanBacklogDirectory(
  dir: string,
  rootDir: string,
  normalizedSlug: string | null,
  canonical: boolean,
  tasksLocations: Map<string, string>,
  canonicalLocations: Map<string, string>,
  issues: any[],
) {
  if (!fs.existsSync(dir)) {return;}
  const files = fs.readdirSync(dir).filter((file: string) => file.endsWith('.md'));
  for (const file of files) {
    if (normalizedSlug && !file.toLowerCase().startsWith(normalizedSlug)) {continue;}
    const filePath = path.join(dir, file);
    const filenameId = taskIdFromFilename(file);
    if (!filenameId) {continue;}
    const relPath = path.relative(rootDir, filePath);
    const locations = canonical ? canonicalLocations : tasksLocations;
    if (!locations.has(filenameId)) {locations.set(filenameId, relPath);}
    recordFrontmatterIdMismatch(filePath, relPath, filenameId, issues);
  }
}

/**
 * @param {string} [rootDir]
 * @param {string} [slug]
 * @returns {{file: string, type: string, taskId?: string, canonicalFile?: string}[]}
 */
function checkBacklogIntegrity(rootDir: string = process.cwd(), slug: string | null = null) {
  const { tasksDir, completedDir, archiveTasksDir: archivedDir } = getTaskStorage(rootDir);
  const issues: any[] = [];
  const normalizedSlug = slug ? slug.toLowerCase() : null;

  // Track where each task id lives so we can detect the same id appearing in
  // both backlog/tasks/ and backlog/completed/ (or backlog/archive/) — the
  // reorder-recreates-completed-task defect (architecture migration). The completed/archive
  // copy is canonical; a backlog/tasks/ copy alongside it is stale.
  const tasksLocations = new Map();      // id -> rel path in tasks/
  const canonicalLocations = new Map();  // id -> rel path in completed|archive

  scanBacklogDirectory(tasksDir, rootDir, normalizedSlug, false, tasksLocations, canonicalLocations, issues);
  scanBacklogDirectory(completedDir, rootDir, normalizedSlug, true, tasksLocations, canonicalLocations, issues);
  scanBacklogDirectory(archivedDir, rootDir, normalizedSlug, true, tasksLocations, canonicalLocations, issues);

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
    const result = git(['-C', gitDir, 'commit', '-m', bookkeepingCommitMessage(message, 'backlog-mirror')]);
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

/** YAML block-scalar indicator: `>`, `|`, optionally with a chomping flag and an indentation indicator (`>-`, `|+2`, …). */
const BLOCK_SCALAR_HEADER = /^[>|][-+]?\d*$/;

/** Leading whitespace width of `line`. */
function indentWidth(line: string): number {
  return (/^\s*/.exec(line) ?? [''])[0].length;
}

/**
 * Join the continuation lines of a YAML block scalar opened by `header`.
 *
 * Continuation lines sit indented past the mapping key; the first later
 * non-blank line at the key's indent ends the scalar. Folded (`>`) scalars
 * fold line breaks into spaces; literal (`|`) scalars keep them. This is the
 * shape a single-line reader (`^key:\s*(.+)$`) used to drop, leaving only the
 * `>-`/`|` marker behind.
 */
function blockScalarText(header: string, lines: readonly string[], from: number, keyIndent: number): string {
  const taken: string[] = [];
  let cursor = from;
  while (cursor < lines.length) {
    const line = lines[cursor];
    if (line.trim() !== '' && indentWidth(line) <= keyIndent) {break;}
    taken.push(line);
    cursor += 1;
  }
  // Trailing blank lines are not part of the scalar.
  while (taken.length > 0 && taken[taken.length - 1].trim() === '') {taken.pop();}
  const text = taken.join('\n');
  return /^>/.test(header) ? text.replace(/\s+/g, ' ').trim() : text.replace(/\s+$/, '');
}

/** @param {string} content @param {string} field @returns {string|null} */
function parseTaskFrontmatterValue(content: string, field: string) {
  const lines = content.split(/\r?\n/);
  // Case-insensitive on the key so `title` and `Title` both resolve; the value
  // capture is `.*` (not `[^\r\n]+`) so an empty scalar still returns null and
  // a block-scalar header can be detected on the same line.
  const keyRe = new RegExp(`^${field.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}:\\s*(.*)$`, 'i');
  for (let i = 0; i < lines.length; i += 1) {
    const match = keyRe.exec(lines[i]);
    if (!match) {continue;}
    const header = match[1].trim();
    if (BLOCK_SCALAR_HEADER.test(header)) {
      return blockScalarText(header, lines, i + 1, indentWidth(lines[i]));
    }
    const value = header.replace(/(?:^['"])|(?:['"]$)/g, '');
    return value || null;
  }
  return null;
}

/** @param {string} taskFilePath @param {string} field @returns {string|null} */
function getTaskFrontmatterValue(taskFilePath: string, field: string) {
  if (!taskFilePath || !fs.existsSync(taskFilePath)) {return null;}
  return parseTaskFrontmatterValue(fs.readFileSync(taskFilePath, 'utf8'), field);
}


export type { TaskScanCache };
export {
  checkBacklogIntegrity,
  commitTaskFileUpdate,
  createTaskScanCache,
  findTaskFile,
  findTaskFiles,
  getAcceptanceCriteria,
  getTaskFrontmatterValue,
  parseTaskFrontmatterValue,
  getTaskStorage,
  pruneStaleBacklogDuplicates,
  reportTaskResolution,
  resolveStableRepositoryId,
  resolveTaskFile,
  taskIdFromFilename,
};
