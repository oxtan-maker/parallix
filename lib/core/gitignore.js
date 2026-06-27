const fs = require('fs');
const path = require('path');

/**
 * Workflow-generated paths that must be gitignored in enterprise repositories.
 * These are paths created by the px workflow toolkit that should never be
 * committed to version control.
 */
const WORKFLOW_ENTRIES = [
  '.workflow/',
  '.sessions/',
  '.forgejo-local/',
  'workflow/.cache/',
  'workflow/.sessions/',
  'workflow/config/agents.local.json',
  'agents.local.json',
];

/**
 * Ensure that a repository's .gitignore contains all workflow-generated paths.
 *
 * Handles:
 * - Missing .gitignore: creates one with all 7 entries
 * - Existing .gitignore: appends only missing entries, skips duplicates
 * - Symlinked .gitignore: skips modification, logs warning
 * - Non-git directories: skips gracefully without crashing
 *
 * @param {string} rootDir - Path to the repository root
 * @param {object} options - Injected dependencies
 * @param {Function} [options.existsSyncFn] - fs.existsSync replacement
 * @param {Function} [options.lstatSyncFn] - fs.lstatSync replacement
 * @param {Function} [options.readFileSyncFn] - fs.readFileSync replacement
 * @param {Function} [options.writeFileSyncFn] - fs.writeFileSync replacement
 * @param {Function} [options.logFn] - Logger function
 * @returns {{ ok: boolean, created: boolean, appended: number, skipped: boolean, reason?: string }}
 */
function ensureWorkflowGitignore(rootDir, options = {}) {
  const {
    existsSyncFn = fs.existsSync,
    lstatSyncFn = fs.lstatSync,
    readFileSyncFn = fs.readFileSync,
    writeFileSyncFn = fs.writeFileSync,
    logFn = () => {},
  } = options;

  const gitignorePath = path.join(rootDir, '.gitignore');
  const gitDirPath = path.join(rootDir, '.git');

  // Check if this is a git repository
  if (!existsSyncFn(gitDirPath)) {
    logFn(`[gitignore] Skipping ${rootDir}: not a git repository (no .git directory)`);
    return { ok: true, created: false, appended: 0, skipped: true, reason: 'not-a-git-repo' };
  }

  // Check if .gitignore exists
  if (!existsSyncFn(gitignorePath)) {
    // Create new .gitignore with all entries
    const content = WORKFLOW_ENTRIES.join('\n') + '\n';
    writeFileSyncFn(gitignorePath, content, 'utf8');
    logFn(`[gitignore] Created ${gitignorePath} with ${WORKFLOW_ENTRIES.length} entries`);
    return { ok: true, created: true, appended: WORKFLOW_ENTRIES.length, skipped: false };
  }

  // .gitignore exists - check for symlink
  try {
    const stat = lstatSyncFn(gitignorePath);
    if (stat.isSymbolicLink()) {
      logFn(`[gitignore] Skipping ${gitignorePath}: symbolic link, not modifying`);
      return { ok: true, created: false, appended: 0, skipped: true, reason: 'symlink' };
    }
  } catch (_) {
    // If we can't stat, fall through to read - it might exist but be inaccessible
  }

  // Read existing .gitignore
  let existingContent;
  try {
    existingContent = readFileSyncFn(gitignorePath, 'utf8');
  } catch (err) {
    logFn(`[gitignore] Could not read ${gitignorePath}: ${/** @type{Error} */(err).message}`);
    return { ok: false, created: false, appended: 0, skipped: false, reason: `read-error: ${/** @type{Error} */(err).message}` };
  }

  // Parse existing entries
  const existingLines = existingContent.split(/\r?\n/);
  const existingEntries = new Set(
    existingLines
      /** @param {string} line */
      .map(/** @param {string} line */(line) => line.trim())
      /** @param {string} line */
      .filter(/** @param {string} line */(line) => line.length > 0 && !line.startsWith('#'))
  );

  // Find missing entries
  const missingEntries = WORKFLOW_ENTRIES.filter(entry => !existingEntries.has(entry));

  if (missingEntries.length === 0) {
    logFn(`[gitignore] ${gitignorePath} already contains all ${WORKFLOW_ENTRIES.length} workflow entries`);
    return { ok: true, created: false, appended: 0, skipped: false };
  }

  // Append missing entries
  const newContent = existingContent + '\n' + missingEntries.join('\n') + '\n';
  writeFileSyncFn(gitignorePath, newContent, 'utf8');
  logFn(`[gitignore] Appended ${missingEntries.length} missing entries to ${gitignorePath}`);

  return { ok: true, created: false, appended: missingEntries.length, skipped: false };
}

module.exports = ensureWorkflowGitignore;
module.exports.ensureWorkflowGitignore = ensureWorkflowGitignore;
module.exports.WORKFLOW_ENTRIES = WORKFLOW_ENTRIES;
