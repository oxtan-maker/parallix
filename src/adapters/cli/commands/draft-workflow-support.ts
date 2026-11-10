import { commandErrorMessage } from './agent-result.js';

import { draftMissionServices, type DraftAdapterDependencies, type DraftLog, type DraftExit } from './draft-adapter-types.js';
import type { SyntheticDraftTask, DraftTarget } from './draft-setup.js';
import type { DraftWorkflowEnvironment } from './draft-workflow-adapter.js';

import type { DraftWorkflowContext } from '../../../application/ports/cli-workflows.js';
import * as fmt from '../../../application/presentation/cli-format.js';
import { startDraftAgent, selectAgent, readAgentConfigOrExit } from '../../agents/agents.js';
import { resolveTaskFile, reportTaskResolution, checkBacklogIntegrity } from '../../backlog/backlog.js';

import { backlogMirrorOwnership, missionId } from '../../../domain/mission.js';

import { resolveCanonicalRepositoryId } from '../../git/repository-identity.js';

import { buildRestartPrompt, buildContractRepairPrompt } from './draft-prompts.js';

import { getTaskFrontmatterValue } from '../../backlog/task-file-io.js';

const CLASSIFICATION_LABELS = new Set(['ai_sdlc', 'user_value', 'unknown']);

/** Authoritative post-draft classification check; null means use legacy fallback. */
export async function validateStoredDraftClassification(ctx: DraftWorkflowContext) {
  try {
    const services = await draftMissionServices(ctx);
    const loaded = await services.store.load(missionId(ctx.slug));
    if (loaded.kind !== 'found') { return null; }
    const labels = loaded.mission.labels
      .map((label: string) => String(label).toLowerCase())
      .filter((label: string) => CLASSIFICATION_LABELS.has(label));
    return labels.length === 1 && labels[0] !== 'unknown'
      ? { ok: true, classification: labels[0] }
      : { ok: false, reason: 'missing-classification' };
  } catch { return null; }
}

/** A failed hook prints its bounded tail, never the full install log. */
export function boundedFailureOutput(hook: { output?: string; failureTail?: string }): string {
  return hook.failureTail ?? hook.output ?? '';
}

/** Either the usable draft target, or the context of an already-reported refusal. */
export type DraftTargetResolution = { ok: true; target: DraftTarget } | { ok: false; context: DraftWorkflowContext };

/**
 * Turn the resolved draft target into a usable one, refusing an unusable target
 * before any draft side effect runs. A malformed or nested px-child reference
 * (PX-0045) must not fall through to free-text intake, which mints an unrelated
 * counter identity and drafts the wrong Mission, nor to worktree inference,
 * which drafts the Mission the operator happens to be standing in. An empty
 * target is the existing usage error. Both report the repair and exit.
 */
export function resolveDraftTargetOrReject(
  explicitInput: string | undefined,
  resolved: DraftTarget | null,
  environment: Pick<DraftWorkflowEnvironment, 'logFn' | 'errorFn' | 'exitedContext' | 'safeExit'>,
  options: Record<string, unknown>,
  inferSlugFn: NonNullable<DraftAdapterDependencies['inferSlugFn']>,
): DraftTargetResolution {
  const invalid = resolved?.invalidIdentity;
  if (invalid) {
    environment.errorFn(fmt.status('FAIL', `${fmt.slug(invalid)} is not a Mission identity: a Mission wave child is <parent>.NN with a two-digit position.`));
    environment.logFn('Repair: pass the exact child id recorded by the wave, or run px status <parent> and use one of its listed children.');
    environment.safeExit(1);
    return { ok: false, context: environment.exitedContext({ slug: invalid, options }) };
  }
  const target: DraftTarget = resolved || { slug: inferSlugFn(explicitInput) ?? '', syntheticTask: null };
  if (!target.slug) {
    environment.errorFn(fmt.status('FAIL', 'Usage: px draft <slug> [--agent <family>]'));
    environment.safeExit(1);
    return { ok: false, context: environment.exitedContext({ slug: '', options }) };
  }
  return { ok: true, target };
}

/** Separate checkout time from install-hook time so slow setup is attributable. */
export function describePreparationTiming(worktreeMs: number, hook: { durationMs?: number; storeState?: string }): string {
  return `Worktree checkout ${worktreeMs}ms; install hook ${hook.durationMs}ms (store ${hook.storeState}).`;
}

/**
 * Read the display title from the Backlog task mirror during draft setup.
 * Completed drafts use the recorded Mission title.
 */
export function readTaskTitle(taskFile: string, fallback: string) {
  try {
    return getTaskFrontmatterValue(taskFile, 'title')?.trim() || fallback;
  } catch { return fallback; }
}

export function flagValue(arr: string[], flag: string, name: string, errorFn: DraftLog, exitFn: DraftExit) {
  const i = arr.indexOf(flag);
  if (i === -1) { return null; }
  const value = arr[i + 1];
  if (!value || value.startsWith('--')) {
    errorFn(fmt.status('FAIL', `Missing value for --${name}. Usage: px draft <slug> --${name} <family>`));
    try { exitFn(1); } catch { /* exit may throw in tests */ }
    return null;
  }
  return value;
}

export function allocateAdhocDraftTarget(draftTarget: Pick<DraftTarget, "syntheticTask" | "existingDbOwnedIdentity">, syntheticTask: SyntheticDraftTask | null, slug: string, mainRepo: string, allocateAdhocIdentityFn: NonNullable<DraftAdapterDependencies['allocateAdhocIdentityFn']>, errorFn: DraftLog, exitFn: DraftExit) {
  if (!syntheticTask || draftTarget.existingDbOwnedIdentity) { return { slug, syntheticTask }; }
  try {
    const allocated = allocateAdhocIdentityFn(resolveCanonicalRepositoryId(mainRepo));
    return {
      slug: allocated.slug,
      syntheticTask: { ...syntheticTask, id: allocated.taskId, source: 'adhoc-db-identity' },
    };
  } catch (allocError) {
    errorFn(fmt.status('FAIL', `Could not allocate adhoc mission identity: ${(allocError instanceof Error ? allocError.message : String(allocError))}`));
    try { exitFn(1); } catch { /* exit may throw in tests */ }
    return null;
  }
}

/**
 * Whether a mission with this slug already exists in the operator store with
 * persisted planning fields (a web/board-created DB-owned mission). Such a
 * mission has no Backlog task file by design and must draft under its existing
 * identity without allocation or a Backlog mirror.
 *
 * Best-effort: an unavailable store (or any error) is treated as "not
 * DB-owned" so a store hiccup never silently drops the Backlog task-file
 * requirement for a real Backlog-backed mission.
 */
export async function isDbOwnedMission(slug: string, mainRepo: string, merged: DraftAdapterDependencies): Promise<boolean> {
  try {
    if (typeof merged.missionServicesFn !== 'function') { return false; }
    const services = await merged.missionServicesFn(mainRepo);
    const loaded = await services.store.load(missionId(slug));
    // A web-created px-NNNN mission and a persisted px-NNNN.NN wave child are
    // both born in the operator store without a Backlog mirror. Imported
    // task-NNNN missions remain on the Backlog path unless their aggregate
    // explicitly names a wave parent, so mere presence in the store never
    // bypasses task-file validation.
    return loaded.kind === 'found' && backlogMirrorOwnership(loaded.mission).kind === 'none';
  } catch {
    return false;
  }
}

export function reportBacklogIntegrityIssues(issues: ReturnType<typeof checkBacklogIntegrity>, normalizedSlug: string, errorFn: DraftLog, logFn: DraftLog) {
  errorFn(fmt.status('FAIL', `Backlog integrity issues detected for ${normalizedSlug}:`));
  for (const issue of issues) {
    if (issue.type === 'duplicate-completed') {
      logFn(`  - ${fmt.path(issue.file)}: task ${fmt.bold(issue.taskId)} already has a canonical copy in ${fmt.path(issue.canonicalFile)}; this backlog/tasks copy is stale.`);
    } else {
      logFn(`  - ${fmt.path(issue.file)}: filename ID (${fmt.bold(issue.filenameId)}) does not match frontmatter ID (${fmt.bold(issue.frontmatterId)})`);
    }
  }
  logFn('Repair: Fix filename/id mismatch, or remove the stale backlog/tasks copy of a completed/archived task, before drafting.');
}

export function validateDraftTask(taskLookupRoot: string, normalizedSlug: string, syntheticTask: SyntheticDraftTask | null, dbOwned: boolean, resolveTaskFileFn: typeof resolveTaskFile, reportTaskResolutionFn: typeof reportTaskResolution, checkBacklogIntegrityFn: typeof checkBacklogIntegrity, errorFn: DraftLog, logFn: DraftLog) {
  // A DB-owned mission (a web/board-created px-XXXX with persisted planning
  // fields but no Backlog task file) is DB-authoritative. Like a synthetic
  // adhoc identity, it never had a Backlog task file, so a missing resolution
  // is not a failure and there are no stale files to flag. A Backlog-backed
  // mission still requires its task file.
  if (dbOwned) {
    return true;
  }
  const resolution = resolveTaskFileFn(normalizedSlug, taskLookupRoot);
  if (!resolution.ok && !syntheticTask) {
    reportTaskResolutionFn(resolution, normalizedSlug, errorFn);
    return false;
  }
  const issues = syntheticTask ? [] : checkBacklogIntegrityFn(taskLookupRoot, normalizedSlug);
  if (issues.length > 0) {
    reportBacklogIntegrityIssues(issues, normalizedSlug, errorFn, logFn);
    return false;
  }
  return true;
}

/**
 * How many times an incomplete mission contract is sent back to the drafting
 * agent before the draft fails. Each attempt relaunches the agent with the
 * exact missing parts; the parts it already recorded stay in Mission state.
 */
export const DRAFT_CONTRACT_REPAIR_ATTEMPTS = 2;

/**
 * Record refinement on the Mission aggregate. `contractIncomplete` is a domain
 * rule rejection (the agent did not record every required part), which the
 * agent can repair; anything else is an infrastructure failure it cannot.
 */
export async function recordDraftRefinement(ctx: DraftWorkflowContext): Promise<{ ok: true } | { ok: false; contractIncomplete: boolean; message: string }> {
  try {
    if (typeof ctx.missionServicesFn !== 'function') { throw new Error('draft command requires injected mission services'); }
    const services = await draftMissionServices(ctx);
    const recorded = await services.store.load(missionId(ctx.slug));
    // Conversion is the successful completion state for a Large draft. The
    // parent deliberately stays in backlog as a non-executable planning
    // container; refining it would make the normal activation path ambiguous.
    if (recorded.kind === 'found' && recorded.mission.wave) { return { ok: true }; }
    const result = await services.lifecycle.transition({
      operationId: `draft-refine-${ctx.slug}`,
      missionId: missionId(ctx.slug), capabilities: new Set(['mission:transition']),
      command: { type: 'refine' }, actor: 'draft', occurredAt: new Date().toISOString(), idempotencyKey: `${ctx.slug}:refine`,
    });
    if (result.status === 'completed') { return { ok: true }; }
    const message = result.error?.message || 'unknown error';
    return { ok: false, contractIncomplete: result.error?.failureReason?.code === 'mission-contract-incomplete', message };
  } catch (error) {
    return { ok: false, contractIncomplete: false, message: (error instanceof Error ? error.message : String(error)) };
  }
}

/**
 * Send an incomplete contract back to the agent that drafted it. The same
 * family is relaunched with the refusal verbatim, so it records only what is
 * missing instead of starting the contract over.
 */
export async function repairDraftContract(slug: string, worktree: string, agent: string, refusal: string, {
  configuration,
  startDraftAgentFn = startDraftAgent,
  logFn = fmt.log.plain,
  errorFn = fmt.log.plainError,
}: Pick<DraftAdapterDependencies, "configuration" | "startDraftAgentFn" | "logFn" | "errorFn"> = {}) {
  const prompt = buildContractRepairPrompt(slug, { rootDir: worktree, worktree, refusal });
  const { agent: actualAgent, result } = await startDraftAgentFn({ configuration, prompt, worktree, agent, slug });
  if (result.error) {
    errorFn(fmt.status('FAIL', `Could not relaunch draft agent (${fmt.agent(actualAgent)}): ${commandErrorMessage(result.error)}`));
    return false;
  }
  if (typeof result.status === 'number' && result.status !== 0) {
    errorFn(fmt.status('FAIL', `Relaunched draft agent (${fmt.agent(actualAgent)}) exited with status ${result.status}.`));
    return false;
  }
  logFn(fmt.status('INFO', `Draft agent ${fmt.agent(actualAgent)} finished the contract repair.`));
  return true;
}

export async function restartDraftAgent(slug: string, worktree: string, {
  configuration,
  selectAgentFn = selectAgent,
  startDraftAgentFn = startDraftAgent,
  readAgentConfigOrExitFn = readAgentConfigOrExit,
  logFn = fmt.log.plain,
  errorFn = fmt.log.plainError
}: Pick<DraftAdapterDependencies, "selectAgentFn" | "startDraftAgentFn" | "readAgentConfigOrExitFn" | "logFn" | "errorFn" | "exitFn" | "configuration"> = {}) {
  const agentConfig = readAgentConfigOrExitFn(undefined, { configuration: configuration });
  const agent = selectAgentFn('draft', { config: agentConfig, configuration: configuration });

  const prompt = buildRestartPrompt(slug, { rootDir: worktree, worktree });
  logFn('Relaunching draft agent to repair mission type labels...');
  const { agent: actualAgent, result } = await startDraftAgentFn({ configuration, prompt, worktree, agent, slug });
  logFn(`Restart draft agent family: ${fmt.agent(actualAgent)}`);

  if (result.error) {
    errorFn(fmt.status('FAIL', `Could not restart draft agent (${fmt.agent(actualAgent)}): ${commandErrorMessage(result.error)}`));
    return false;
  }

  if (typeof result.status === 'number' && result.status !== 0) {
    errorFn(fmt.status('FAIL', `Restart draft agent (${fmt.agent(actualAgent)}) exited with status ${result.status}.`));
    return false;
  }

  return true;
}
