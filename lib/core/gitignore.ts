import fs from 'node:fs';
import path from 'node:path';

const WORKFLOW_ENTRIES = [
  '.workflow/',
  '.sessions/',
  '.forgejo-local/',
  'workflow/.cache/',
  'workflow/.sessions/',
  'workflow/config/agents.local.json',
  'agents.local.json',
] as const;

interface GitignoreResult {
  ok: boolean;
  created: boolean;
  appended: number;
  skipped: boolean;
  reason?: string;
}

interface EnsureOptions {
  existsSyncFn?: typeof fs.existsSync;
  lstatSyncFn?: typeof fs.lstatSync;
  readFileSyncFn?: typeof fs.readFileSync;
  writeFileSyncFn?: typeof fs.writeFileSync;
  logFn?: (msg: string) => void;
}

type EnsureWorkflowGitignoreFn = {
  (rootDir: string, options?: EnsureOptions): GitignoreResult;
  WORKFLOW_ENTRIES: typeof WORKFLOW_ENTRIES;
  ensureWorkflowGitignore: EnsureWorkflowGitignoreFn;
};

function ensureWorkflowGitignore(rootDir: string, options: EnsureOptions = {}): GitignoreResult {
  const {
    existsSyncFn = fs.existsSync,
    lstatSyncFn = fs.lstatSync,
    readFileSyncFn = fs.readFileSync,
    writeFileSyncFn = fs.writeFileSync,
    logFn = () => {},
  } = options;

  const gitignorePath = path.join(rootDir, '.gitignore');
  const gitDirPath = path.join(rootDir, '.git');

  if (!existsSyncFn(gitDirPath)) {
    logFn(`[gitignore] Skipping ${rootDir}: not a git repository (no .git directory)`);
    return { ok: true, created: false, appended: 0, skipped: true, reason: 'not-a-git-repo' };
  }

  if (!existsSyncFn(gitignorePath)) {
    const content = [...WORKFLOW_ENTRIES].join('\n') + '\n';
    writeFileSyncFn(gitignorePath, content, 'utf8');
    logFn(`[gitignore] Created ${gitignorePath} with ${WORKFLOW_ENTRIES.length} entries`);
    return { ok: true, created: true, appended: WORKFLOW_ENTRIES.length, skipped: false };
  }

  try {
    const stat = lstatSyncFn(gitignorePath);
    if (stat.isSymbolicLink()) {
      logFn(`[gitignore] Skipping ${gitignorePath}: symbolic link, not modifying`);
      return { ok: true, created: false, appended: 0, skipped: true, reason: 'symlink' };
    }
  } catch (_err: unknown) {
    // If we can't stat, fall through to read
  }

  let existingContent: string;
  try {
    existingContent = readFileSyncFn(gitignorePath, 'utf8');
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    logFn(`[gitignore] Could not read ${gitignorePath}: ${message}`);
    return { ok: false, created: false, appended: 0, skipped: false, reason: `read-error: ${message}` };
  }

  const existingLines = existingContent.split(/\r?\n/);
  const existingEntries = new Set(
    existingLines
      .map((line: string) => line.trim())
      .filter((line: string) => line.length > 0 && !line.startsWith('#'))
  );

  const missingEntries = WORKFLOW_ENTRIES.filter(entry => !existingEntries.has(entry));

  if (missingEntries.length === 0) {
    logFn(`[gitignore] ${gitignorePath} already contains all ${WORKFLOW_ENTRIES.length} workflow entries`);
    return { ok: true, created: false, appended: 0, skipped: false };
  }

  const newContent = existingContent + '\n' + [...missingEntries].join('\n') + '\n';
  writeFileSyncFn(gitignorePath, newContent, 'utf8');
  logFn(`[gitignore] Appended ${missingEntries.length} missing entries to ${gitignorePath}`);

  return { ok: true, created: false, appended: missingEntries.length, skipped: false };
}

(ensureWorkflowGitignore as EnsureWorkflowGitignoreFn).WORKFLOW_ENTRIES = WORKFLOW_ENTRIES;
(ensureWorkflowGitignore as EnsureWorkflowGitignoreFn).ensureWorkflowGitignore = ensureWorkflowGitignore as EnsureWorkflowGitignoreFn;

export default ensureWorkflowGitignore;
export { ensureWorkflowGitignore, WORKFLOW_ENTRIES, ensureWorkflowGitignore as ensureWorkflowGitignoreFn };

// CJS compat: ensure require() returns the function directly
declare const module: { exports: any } | undefined;
if (typeof module !== 'undefined') { module.exports = ensureWorkflowGitignore; }
