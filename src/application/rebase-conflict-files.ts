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

/**
 * Parse conflict file paths from git rebase output.
 * Similar to parseConflictFilesFromMergeOutput but handles rebase-specific output.
 */
export function parseConflictFilesFromRebaseOutput(output: string): string[] {
  const seen = new Set<string>();
  const files: string[] = [];
  for (const line of output.split('\n')) {
    if (!/CONFLICT|KONFLIKT/i.test(line)) {continue;}
    // Try each matcher in order; ordering is significant (the Swedish
    // modify/delete matcher must precede the generic colon fallback).
    const file =
      matchRebaseEnglishConflict(line)
      ?? matchRebaseSwedishConflict(line)
      ?? matchRebaseSwedishModDelConflict(line)
      ?? matchRebaseColonConflict(line);
    if (file && !seen.has(file)) { seen.add(file); files.push(file); }
  }
  return files;
}

// English: "Merge conflict in <file>"
function matchRebaseEnglishConflict(line: string): string | null {
  const inMatch = line.match(/Merge conflict in (.+)$/);
  if (!inMatch) {return null;}
  let f = inMatch[1].trim();
  // Strip modify/delete description (e.g. ": deleted by master, modified by HEAD")
  f = f.replace(/\s*:\s*(deleted|modified|added|removed|renamed|both|ours|yours|theirs|by\s*\w+,\s*(modified|deleted)\b).*$/i, '').trim();
  return f || null;
}

// Swedish: "Sammanslagningskonflikt i <file>"
function matchRebaseSwedishConflict(line: string): string | null {
  const svMatch = line.match(/Sammanslagningskonflikt\s+i\s+(.+)$/);
  if (!svMatch) {return null;}
  let f = svMatch[1].trim();
  // Strip modify/delete description (e.g. ": deleted/raderad av master, modified/ändrad av HEAD")
  f = f.replace(/\s*:\s*(deleted|modified|added|removed|renamed|both|ours|yours|theirs|raderad|ändrad|lagd till|borttagen|by|av|av\s*\w+,\s*(modified|ändrad|deleted|raderad)\b).*$/i, '').trim();
  return f || null;
}

// Swedish modify/delete: "KONFLIKT (ändra/radera): <file> raderad i <commit> ... och ändrad i HEAD"
function matchRebaseSwedishModDelConflict(line: string): string | null {
  const svModDelMatch = line.match(/^KONFLIKT\s+\(ändra\/radera\)\s*:\s*(.+)$/i);
  if (!svModDelMatch) {return null;}
  let f = svModDelMatch[1].trim();
  // Strip trailing "Versionen HEAD av <file> lämnad i trädet." sentence (real git output).
  // Must come before raderad/ändrad stripping since the trailing sentence contains "ändrad".
  f = f.replace(/\s+Versionen\s+HEAD[\s\S]*$/i, '').trim();
  // Strip "raderad i <commit> ... och ändrad i HEAD" (Swedish modify/delete description)
  f = f.replace(/\s+raderad\s+i\s+\S+(?:\s*\([^)]*\))?\s+(?:och|and)\s+ändrad\s+i\s+\S+\.?\s*$/i, '').trim();
  // Also handle "raderad i <commit> och ändrad i HEAD" without trailing period
  f = f.replace(/\s+raderad\s+i\s+\S+(?:\s*\([^)]*\))?\s+och\s+ändrad\s+i\s+\S+\s*$/i, '').trim();
  return f || null;
}

// Generic fallback: extract a file path from a colon-delimited rebase line.
// Handles the patterns the specific matchers miss:
//   "<file>: <description>"                          -> generic fallback
//   "CONFLICT (content): <file>: <description>"      -> nested colons
//   "CONFLICT (modify/delete): <file>: deleted by ..., modified by ..." -> modify/delete
//   "CONFLICT (modify/delete): <file>: ..."          -> modify/delete header
function matchRebaseColonConflict(line: string): string | null {
  const colonIdx = line.indexOf(':');
  if (colonIdx === -1) {return null;}
  const beforeColon = line.slice(0, colonIdx).trim();
  const afterColon = line.slice(colonIdx + 1).trim();
  const isNonPathPrefix = /^(CONFLICT|KONFLIKT|CONFLICTS|Merge conflict|Sammanslagningskonflikt|Automatic merge|Auto-merging|resolved|merged|deleted|added|changed|modified|rejected|skipped|dropped|superseded|discarded|kept|stashed|applied|already|would|both|ours|yours|their|his|her|its|your|my|us|we|they|he|she|it|a|an|the|but|and|or|for|nor|not|so|yet)\b/i.test(beforeColon);
  if (!isNonPathPrefix) {
    // Skip known advice/hint labels — the rest of the line is not a path.
    if (/^(tips|hint|note)\b/i.test(beforeColon)) {return null;}
    return beforeColon || null;
  }
  if (!afterColon) {return null;}
  // If there's a second colon, take the segment before it as the path.
  const secondColonIdx = afterColon.indexOf(':');
  if (secondColonIdx !== -1) {
    let f = afterColon.slice(0, secondColonIdx).trim();
    // Strip modify/delete description (e.g. ": deleted by master, modified by HEAD")
    f = f.replace(/\s*:\s*(deleted|modified|added|removed|renamed|both|ours|yours|theirs|raderad|ändrad|lagd till|borttagen|by|av|av\s*\w+,\s*(modified|ändrad|deleted|raderad)\b).*$/i, '');
    f = f.trim();
    return f || null;
  }
  // No second colon — take everything after the first colon as the path.
  return afterColon || null;
}
