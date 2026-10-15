import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import type { PromptArtifactPort } from '../../application/ports/prompt-artifacts.js';

/** Kept inside the worktree so both read-only reviewers and implementers can read it. */
export function promptArtifacts(worktree: string): PromptArtifactPort {
  return { async retain(content) {
    const directory = path.join(worktree, '.workflow', 'agent-context');
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    const file = path.join(directory, `${createHash('sha256').update(content).digest('hex')}.json`);
    try { fs.writeFileSync(file, content, { flag: 'wx', mode: 0o600 }); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST' || fs.readFileSync(file, 'utf8') !== content) { throw error; }
    }
    // Never unlink on a later round: a previous agent may still hold this reference.
    return file;
  } };
}
