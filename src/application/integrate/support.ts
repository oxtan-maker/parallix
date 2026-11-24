/**
 * Shared support for the integrate workflow modules: the public
 * flag contract, task-path containment, bounce implementer resolution, and the
 * abort helper every step uses to stop a run after printing its diagnostic.
 */
import path from 'node:path';
import * as fmt from '../presentation/cli-format.js';
import type { IntegrateAgentsPort, IntegrateLandingPort } from '../ports/integrate-workflow.js';
import type { MissionStore } from '../domain-ports.js';
import { missionId } from '../../domain/mission.js';
import type { IntegrationContext } from './context.js';
import type { BacklogMirrorOwnership } from '../../domain/mission.js';

export const VARIANT_B_AUTOMATION_SUMMARY = 'Variant B automation: Backlog task closeout, worktree-path rewrite, squash commit with hook-enforced validation, Forgejo sync-merged, and mission worktree cleanup.';

const INTEGRATE_BOOLEAN_OPTIONS: ReadonlyMap<string, 'dryRun' | 'noGate' | 'recoverLanded'> = new Map([['--dry-run', 'dryRun'], ['--no-gate', 'noGate'], ['--recover-landed', 'recoverLanded']]);

export interface IntegrateRequest {
  readonly explicitSlug?: string;
  readonly dryRun: boolean;
  readonly noGate: boolean;
  readonly recoverLanded: boolean;
}

/** Parse only the public integrate flags before any preflight work. */
export function parseIntegrateArgs(args: string[]): IntegrateRequest {
  const params: string[] = [];
  const state = { dryRun: false, noGate: false, recoverLanded: false };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const booleanOption = INTEGRATE_BOOLEAN_OPTIONS.get(arg);
    if (booleanOption) { state[booleanOption] = true; continue; }
    if (arg.startsWith('--')) {throw new Error(`Unknown integrate option: ${arg}`);}
    params.push(arg);
  }

  return { explicitSlug: params[0], ...state };
}

/** Resolve a task file into the integration checkout without escaping either worktree. */
export function resolveIntegrationTaskPath(rawTaskFile: string | undefined, missionWorktree: string | null | undefined, baseWorktree: string | null | undefined): string | null {
  if (!rawTaskFile) { return ''; }
  if (!baseWorktree) { return null; }
  if (missionWorktree) {
    const relative = path.relative(missionWorktree, rawTaskFile);
    if (!relative.startsWith('..') && !path.isAbsolute(relative)) { return path.join(baseWorktree, relative); }
  }
  const baseRelative = path.relative(baseWorktree, rawTaskFile);
  return !baseRelative.startsWith('..') && !path.isAbsolute(baseRelative) ? rawTaskFile : null;
}

/** The `task-N` family a suffixed working slug belongs to (`task-12-modern` → `task-12`). */
export function baseTaskSlug(slug: string): string {
  const match = slug.match(/^(task-\d+)/i);
  return match ? match[1].toLowerCase() : slug;
}

/** Agent seams a bounce launches through; injected by tests, defaulted to the agents port. */
export interface BounceSeams {
  startAgentFn: IntegrateAgentsPort['startAgent'];
  transitionTaskFn: (_slug: string, _status: string) => unknown;
  applyAgentFallbackFn: IntegrateAgentsPort['applyAgentFallback'];
  selectAgentFn?: IntegrateAgentsPort['selectAgent'];
  workflowLauncherStatusFn?: IntegrateAgentsPort['workflowLauncherStatus'];
}

/** Project authoritative lifecycle state only when this Mission owns a Backlog mirror. */
export function projectBacklogTransition(
  ownership: BacklogMirrorOwnership,
  transition: BounceSeams['transitionTaskFn'],
  slug: string,
  status: string,
): unknown {
  return ownership.kind === 'none' ? true : transition(slug, status);
}

/** Read current recorded ownership, retaining known identity on a transient read failure. */
async function readRepairImplementer(slug: string, store: Pick<MissionStore, 'load'>, previous: string | null): Promise<string | null> {
  try {
    const loaded = await store.load(missionId(slug));
    if (loaded.kind !== 'found') { return previous; }
    return loaded.mission.assignee ?? loaded.mission.review?.rounds.at(-1)?.implementer ?? previous;
  } catch (error) {
    // A failed read cannot authorize a new selection when no owner was known.
    if (!previous) { throw error; }
    return previous;
  }
}

/**
 * Name the implementer a bounce should launch.
 *
 * Both `px integrate` bounces — the squash-commit hook failure and the
 * integration-gate failure — resolve the same way, so the chain lives once:
 * the current Mission assignee or recorded review implementer, then the legacy
 * task assignee, configured agent, and launcher probe when no identity exists.
 * Read the Mission at repair time: rebase or an earlier repair may have changed
 * its implementer since the integration context was built.
 * F3: only trust a launcher that reports itself supported; an absent
 * launcher returns `{ agent: '', supported: false }`, so name an agent only
 * when the probe confirms a healthy, supported family. An empty result means
 * strand rather than launch with an empty agent identity.
 */
export async function resolveBounceImplementer(
  slug: string,
  missionStore: Pick<MissionStore, 'load'>,
  context: Pick<IntegrationContext, 'taskAssignee' | 'reviewState'>,
  rootDir: string,
  fns: Pick<BounceSeams, 'selectAgentFn' | 'workflowLauncherStatusFn'>,
): Promise<string> {
  const recorded = await readRepairImplementer(slug, missionStore, context.reviewState?.implementer || context.taskAssignee);
  const implementer = recorded || (fns.selectAgentFn ? fns.selectAgentFn('act-on-review') : '');
  if (implementer) { return implementer; }
  if (!fns.workflowLauncherStatusFn) { return ''; }
  const status = fns.workflowLauncherStatusFn(context.taskAssignee ?? '', rootDir);
  return status?.supported ? (status.agent ?? '') : '';
}

/** Print the blocking diagnostic and return the abort signal for the caller to throw. */
export function abortWith(landing: IntegrateLandingPort, ...messages: string[]): Error {
  messages.forEach(message => fmt.log.fail(message));
  // The reason travels with the abort so the failure footer can name the blocker instead of an unknown cause.
  return landing.createAbort(messages.map(message => message.trim()).filter(Boolean).join(' ') || undefined);
}
