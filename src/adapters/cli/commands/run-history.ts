import type { ParallixConfiguration } from "../../../application/ports/configuration.js";
import { DEFAULT_CONFIGURATION } from "../../../application/ports/configuration.js";
import type childProcess from 'node:child_process';
import * as fmt from '../../../application/presentation/cli-format.js';
import type { RunSearchQuery, RunShowResult } from '../../../application/run-history.js';
import { parseRunHistoryRef } from '../../../application/run-history-types.js';
import type { MissionHistoryError, MissionTerminalCapability } from '../../../application/ports/mission-terminal.js';
import { inferSlug } from '../../filesystem/mission-utils.js';
import { createMissionTerminalResources } from './mission-terminal-resources.js';

/**
 * `px history` / `px attach` workflows (TASK-2643, TASK-2749).
 *
 * Access follows the Mission boundary. From inside a Mission worktree only
 * that Mission's runs are reachable, so a confined agent of one Mission cannot
 * search or attach to another's; from outside a Mission worktree an operator
 * names the Mission explicitly. Everything else — identity, history location,
 * legacy attribution and the live terminal — is resolved by the application's
 * mission terminal capability, so this adapter derives no native handle.
 */

export interface RunHistoryCommandDeps {
  readonly inferSlugFn?: (_explicit: string | undefined) => string | null;
  readonly resolveWorktreeFn?: (_slug: string) => string | null;
  readonly log?: (_line: string) => void;
  readonly spawnSyncFn?: typeof childProcess.spawnSync;
  readonly isTTY?: boolean;
  readonly repositoryKeyFn?: (_checkout: string) => string;
  readonly configuration?: ParallixConfiguration;
  /** Any checkout of the repository; defaults to the current directory. */
  readonly checkout?: string;
  /** The composed capability; built from the options above when absent. */
  readonly capability?: MissionTerminalCapability;
}

function capabilityOf(deps: RunHistoryCommandDeps): MissionTerminalCapability {
  return deps.capability ?? createMissionTerminalResources(deps.checkout ?? process.cwd(), {
    configuration: deps.configuration ?? DEFAULT_CONFIGURATION,
    ...(deps.spawnSyncFn ? { spawnSyncFn: deps.spawnSyncFn } : {}),
    ...(deps.repositoryKeyFn ? { repositoryKeyFn: deps.repositoryKeyFn } : {}),
    ...(deps.resolveWorktreeFn ? { resolveWorktreeFn: deps.resolveWorktreeFn } : {}),
  });
}

function unwrap<T>(result: T | MissionHistoryError): T {
  if (typeof result === 'object' && result !== null && (result as { ok?: unknown }).ok === false) {
    throw new Error((result as MissionHistoryError).detail);
  }
  return result as T;
}

/** Resolve the Mission, refusing a different Mission from inside a Mission worktree. */
export function resolveRunHistoryMission(explicit: string | undefined, deps: RunHistoryCommandDeps = {}, noun = 'Run history is', other = 'history'): string {
  const current = (deps.inferSlugFn ?? inferSlug)(undefined);
  const slug = explicit ? explicit.trim().toLowerCase() : current;
  if (!slug) { throw new Error(`Mission slug is required outside a Mission worktree: px ${other === 'history' ? 'history <slug> ...' : 'attach <slug>'}`); }
  if (current && explicit && current !== slug) {
    throw new Error(`${noun} scoped to this worktree's Mission (${current}); ${slug} is another Mission's ${other}.`);
  }
  return slug;
}

/** Bind `px history` retrieval to a Mission. */
export function createRunHistoryPort(deps: RunHistoryCommandDeps = {}) {
  return {
    list: (slug: string | undefined) => unwrap(capabilityOf(deps).history(resolveRunHistoryMission(slug, deps))).runs,
    search: (slug: string | undefined, query: RunSearchQuery) => unwrap(capabilityOf(deps).search(resolveRunHistoryMission(slug, deps), query)),
    show: (slug: string | undefined, token: string, context: number) => {
      const ref = parseRunHistoryRef(token);
      if (!ref) { return null; }
      const shown = capabilityOf(deps).show(resolveRunHistoryMission(slug, deps), ref, context);
      if (shown.ok || (shown.error !== 'invalid' && shown.error !== 'ambiguous')) { return shown as RunShowResult; }
      throw new Error(shown.detail);
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
  const slug = resolveRunHistoryMission(request.slug, deps, 'Mission terminal is', 'terminal');
  // Integration removes its Mission worktree after landing; the capability
  // resolves the terminal and history from the repository, not the worktree.
  const capability = capabilityOf(deps);
  if (request.list) {
    const overview = unwrap(capability.overview(slug));
    const probe = overview.probe;
    const terminal = probe.kind === 'live' || probe.kind === 'starting' ? `${probe.kind} operation ${probe.operation}`
      : probe.kind === 'idle' ? 'idle console'
      : probe.kind === 'absent' ? 'no live terminal'
      : `${probe.kind}: ${probe.detail}`;
    log(`${overview.missionId}  terminal=${terminal}; retained operations=${overview.operations.length}${overview.operations.length > 0 ? ` (px history ${overview.missionId} list)` : ''}`);
    return;
  }
  if (request.close) { capability.close(slug); log(`Closed mission terminal ${slug}.`); return; }
  if (!(deps.isTTY ?? (process.stdin.isTTY && process.stdout.isTTY))) {
    unwrap(capability.identify(slug));
    throw new Error('px attach needs an interactive terminal.');
  }
  const status = capability.attach(slug, { readOnly: request.readOnly });
  if (status !== 0) { process.exitCode = status; }
}
