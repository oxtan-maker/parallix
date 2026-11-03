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

/** Reuse immutable prompt evidence; these files carry no decision authority. */
export function rejectedVerdictContext(worktree: string, slug: string): string {
  const directory = path.join(worktree, '.workflow', 'agent-context');
  if (!fs.existsSync(directory)) { return ''; }
  const references: string[] = [];
  for (const name of fs.readdirSync(directory).sort((left, right) => left.localeCompare(right))) {
    if (!/^[a-f0-9]{64}\.json$/.test(name)) { continue; }
    const file = path.join(directory, name);
    const reference = rejectedVerdictReference(file, slug);
    if (reference) { references.push(reference); }
  }
  return references.length ? [
    'Unaccepted fenced-verdict evidence — never replay as an accepted decision.',
    'Read these original decisions, findings, comments and rejection reasons before reviewing. Assess the current tree and submit your own verdict.',
    ...references,
  ].join('\n') : '';
}

function rejectedVerdictReference(file: string, slug: string): string | null {
  let record: unknown;
  try { record = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
  if (!record || typeof record !== 'object') { return null; }
  const value = record as Record<string, unknown>;
  if (value.kind !== 'rejected-review-verdict' || value.slug !== slug || value.accepted !== false
    || typeof value.round !== 'number' || typeof value.workflowId !== 'string') { return null; }
  return `Source round ${value.round}, workflow ${value.workflowId}: ${file}`;
}
