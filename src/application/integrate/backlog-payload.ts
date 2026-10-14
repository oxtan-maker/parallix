import type { IntegrateWorkflowPorts } from '../ports/integrate-workflow.js';
import * as fmt from '../presentation/cli-format.js';
import { abortWith } from './support.js';

/** Normalize only stale active copies; completed history is never rewritten. */
export function prepareBacklogPayload(
  ports: IntegrateWorkflowPorts,
  rootDir: string,
  canonicalRevision: string,
): Set<string> {
  const git = ports.git.git;
  const removed = new Set<string>();
  for (const issue of ports.backlog.checkBacklogIntegrity(rootDir)) {
    if (issue.type !== 'duplicate-completed' || !issue.canonicalFile) { continue; }
    if (git(['-C', rootDir, 'cat-file', '-e', `${canonicalRevision}:${issue.canonicalFile}`]).status !== 0) { continue; }
    if (git(['-C', rootDir, 'rm', '-f', '--', issue.file]).status !== 0) {
      throw abortWith(ports.landing, `Could not remove stale backlog copy ${issue.file}.`);
    }
    removed.add(issue.file);
    fmt.log.info(`Dropped stale backlog copy ${issue.file}; ${issue.taskId} is already canonical at ${issue.canonicalFile}.`);
  }
  return removed;
}
