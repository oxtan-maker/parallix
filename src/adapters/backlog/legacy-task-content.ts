import path from 'node:path';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { git, type GitResult } from '../git/git.js';
import { parseTaskFrontmatterValue } from './task-file-io.js';

/** Read a migration-pinned task artifact; never consult the current task tree. */
export function readLegacyTaskContent(
  ref: { readonly source: string; readonly id: string; readonly url: string | null },
  rootDir: string,
  gitFn: typeof git = git,
): { content: string | null; error: string | null } {
  if (ref.source !== 'backlog-md' || !ref.url) { return { content: null, error: null }; }
  const match = /^(backlog\/(?:tasks|completed|archive)\/[^\r\n]+)@([a-f0-9]{40,64})$/.exec(ref.url);
  if (!match || path.posix.normalize(match[1]) !== match[1]) {
    return { content: null, error: `Invalid pinned legacy task reference: ${ref.url}` };
  }
  // Mission integration squash-merges the branch, so its pinned import commit
  // may eventually be unreachable. The committed archive survives Mission 7.
  const archiveName = 'missions/task-2521.06/artifacts/task-bodies.json';
  const archiveFile = path.join(rootDir, archiveName);
  if (fs.existsSync(archiveFile)) {
    try {
      const raw = fs.readFileSync(archiveFile, 'utf8');
      const committed = gitFn(['show', `HEAD:${archiveName}`], { cwd: rootDir, maxBuffer: 8 * 1024 * 1024 });
      if (committed.status !== 0 || committed.stdout !== raw) {
        return { content: null, error: 'Committed legacy task archive differs from the working tree' };
      }
      const archive = JSON.parse(raw) as { entries?: { id: string; url: string; sha256: string; content: string }[] };
      const entries = archive.entries?.filter(entry => entry.id === ref.id);
      if (entries?.length !== 1 || entries[0].url !== ref.url
        || createHash('sha256').update(entries[0].content).digest('hex') !== entries[0].sha256
        || parseTaskFrontmatterValue(entries[0].content, 'id')?.trim().toUpperCase() !== ref.id.toUpperCase()) {
        return { content: null, error: `Legacy task archive has no verified body for ${ref.id}` };
      }
      return { content: entries[0].content, error: null };
    } catch (error) {
      return { content: null, error: `Legacy task archive unavailable: ${error instanceof Error ? error.message : String(error)}` };
    }
  }
  let result: GitResult;
  try { result = gitFn(['show', `${match[2]}:${match[1]}`], { cwd: rootDir, maxBuffer: 8 * 1024 * 1024 }); }
  catch (error) { return { content: null, error: error instanceof Error ? error.message : 'Git history unavailable' }; }
  if (result.status !== 0) {
    return { content: null, error: `Pinned legacy task unavailable: ${ref.url}` };
  }
  if (parseTaskFrontmatterValue(result.stdout, 'id')?.trim().toUpperCase() !== ref.id.toUpperCase()) {
    return { content: null, error: `Pinned legacy task identity differs: ${ref.url}` };
  }
  return { content: result.stdout, error: null };
}
