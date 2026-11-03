import type { GitRunner } from './ports/rebase-workflow.js';

/**
 * Parse conflict file paths from git status --porcelain output
 * when a rebase is in progress. Handles all unmerged states:
 * UU (unmerged), DU/UD (modify/delete), AU/UA (add/add), AA (add/add).
 */
const UNMERGED_STATUSES = new Set(['UU', 'DU', 'UD', 'AU', 'UA', 'AA']);

/** Extract a conflict file path from one `git status --porcelain` line, or null when the line is blank, unparseable, outside the unmerged family, or resolves to an empty path. */
function conflictFileFromStatusLine(line: string): string | null {
  const trimmed = line.trim();
  if (!trimmed) { return null; }
  const match = trimmed.match(/^([A-Z]{2})\s+(.+)$/);
  if (!match || !UNMERGED_STATUSES.has(match[1])) { return null; }
  let file = match[2].trim();
  // Remove surrounding quotes if present
  if ((file.startsWith('"') && file.endsWith('"')) || (file.startsWith("'") && file.endsWith("'"))) {
    file = file.slice(1, -1);
  }
  return file || null;
}

export function parseConflictFilesFromGitStatus(worktreePath: string, gitFn: GitRunner): string[] {
  const statusResult = gitFn(['-C', worktreePath, 'status', '--porcelain']);
  const files: string[] = [];
  for (const line of (statusResult.stdout || '').split('\n')) {
    const file = conflictFileFromStatusLine(line);
    if (file) { files.push(file); }
  }
  return [...new Set(files)];
}
