import type { ParallixConfiguration } from "../../../application/ports/configuration.js";
import childProcess from 'node:child_process';
import fs from 'node:fs';
import { missionRepositoryKey } from '../../filesystem/mission-repository-key.js';
import * as fmt from '../../../application/presentation/cli-format.js';
import { listRuns, searchRuns, showRun } from '../../../application/run-history.js';
import type { RunHistoryScope, RunSearchQuery } from '../../../application/run-history.js';
import { parseRunHistoryRef } from '../../../application/run-history-types.js';
import { inferSlug, resolveWorktree } from '../../filesystem/mission-utils.js';
import { missionRunsDir, runHistoryFileSystem } from '../../filesystem/run-history-store.js';
import { listTmuxSessions, tmuxAttachArgs, missionSocketPath, missionTerminalCapturePath, closeMissionTerminal } from '../../process/tmux-host.js';

/**
 * `px history` / `px attach` workflows (TASK-2643).
 *
 * Access follows the Mission boundary. From inside a Mission worktree only
 * that Mission's runs are reachable, so a confined agent of one Mission cannot
 * search or attach to another's; from outside a Mission worktree an operator
 * names the Mission explicitly. Retrieval never loads a whole transcript.
 */

export interface RunHistoryCommandDeps {
  readonly inferSlugFn?: (_explicit: string | undefined) => string | null;
  readonly resolveWorktreeFn?: (_slug: string) => string | null;
  readonly log?: (_line: string) => void;
  readonly spawnSyncFn?: typeof childProcess.spawnSync;
  readonly isTTY?: boolean;
  readonly repositoryKeyFn?: (_worktree: string) => string;
  readonly configuration?: ParallixConfiguration;
}

function isAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch (err) { return (err as NodeJS.ErrnoException).code === 'EPERM'; }
}

/** Resolve the Mission scope, refusing a different Mission from inside a Mission worktree. */
export function resolveRunHistoryScope(explicit: string | undefined, deps: RunHistoryCommandDeps = {}): { slug: string; worktree: string; scope: RunHistoryScope } {
  const infer = deps.inferSlugFn ?? inferSlug;
  const current = infer(undefined);
  const slug = explicit ? explicit.toLowerCase() : current;
  if (!slug) { throw new Error('Mission slug is required outside a Mission worktree: px history <slug> ...'); }
  if (current && explicit && current !== slug) {
    throw new Error(`Run history is scoped to this worktree's Mission (${current}); ${slug} is another Mission's history.`);
  }
  const worktree = (deps.resolveWorktreeFn ?? ((s: string) => resolveWorktree(s)))(slug);
  if (!worktree) { throw new Error(`Mission worktree not found for ${slug}.`); }
  return { slug, worktree, scope: { runsDir: missionRunsDir(worktree, slug), fs: runHistoryFileSystem, isAlive } };
}

/** Bind `px history` retrieval to a Mission scope. */
export function createRunHistoryPort(deps: RunHistoryCommandDeps = {}) {
  return {
    list: (slug: string | undefined) => listRuns(resolveRunHistoryScope(slug, deps).scope),
    search: (slug: string | undefined, query: RunSearchQuery) => searchRuns(resolveRunHistoryScope(slug, deps).scope, query),
    show: (slug: string | undefined, token: string, context: number) => {
      const ref = parseRunHistoryRef(token);
      return ref ? showRun(resolveRunHistoryScope(slug, deps).scope, ref, context) : null;
    },
    attach: (request: AttachRequest) => attachRun(request, deps),
  };
}

export interface AttachRequest {
  readonly slug?: string;
  readonly readOnly: boolean;
  readonly list: boolean;
  readonly close?: boolean;
}

/** Attach the mission terminal, including an idle shell without retained runs. */
export function attachRun(request: AttachRequest, deps: RunHistoryCommandDeps = {}): void {
  const log = deps.log ?? fmt.log.plain;
  const spawnSyncFn = deps.spawnSyncFn ?? childProcess.spawnSync;
  const infer = deps.inferSlugFn ?? inferSlug;
  const current = infer(undefined);
  const slug = request.slug ? request.slug.toLowerCase() : current;
  if (!slug) { throw new Error('Mission slug is required outside a Mission worktree: px attach <slug>'); }
  if (current && request.slug && current !== slug) {
    throw new Error(`Mission terminal is scoped to this worktree's Mission (${current}); ${slug} is another Mission terminal.`);
  }
  // Integration removes its mission worktree after landing.  Its terminal
  // transcript remains under the repository-keyed state root, so attachment
  // discovery must fall back to the operator's surviving checkout.
  const worktree = (deps.resolveWorktreeFn ?? ((s: string) => resolveWorktree(s)))(slug) ?? process.cwd();
  const repositoryKey = (deps.repositoryKeyFn ?? missionRepositoryKey)(worktree);
  const socket = missionSocketPath({ repositoryKey, missionId: slug }, deps.configuration);
  const capture = missionTerminalCapturePath({ repositoryKey, missionId: slug }, deps.configuration);
  const session = listTmuxSessions(socket, spawnSyncFn).find(entry => entry.name === slug);
  if (request.list) {
    log(session ? `${slug}  session=${session.name}` : fs.existsSync(capture) ? `${slug}  no live terminal; captured output=${capture}` : `${slug}  no live terminal; captured output=unavailable`);
    return;
  }
  if (!session) { throw new Error(`Nothing to attach: no mission terminal is live for ${slug}.${fs.existsSync(capture) ? ` Captured terminal output: ${capture}` : ' Captured terminal output is unavailable.'}`); }
  if (request.close) { closeMissionTerminal(socket, session.name, spawnSyncFn); log(`Closed mission terminal ${slug}.`); return; }
  if (!(deps.isTTY ?? (process.stdin.isTTY && process.stdout.isTTY))) { throw new Error('px attach needs an interactive terminal.'); }
  const attached = spawnSyncFn('tmux', tmuxAttachArgs(socket, session.name, request.readOnly), { stdio: 'inherit' });
  if (attached.status !== 0) { process.exitCode = attached.status ?? 1; }
}
