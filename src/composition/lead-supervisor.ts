import { createLeadOperatorJudgment } from './lead-operator-judgment.js';
import type { ParallixConfiguration } from '../application/ports/configuration.js';
import fs from 'node:fs';
import type { createActiveCommand } from '../interfaces/cli/active.js';

import * as fmt from '../application/presentation/cli-format.js';

import { findTaskFile } from '../adapters/backlog/backlog.js';

import { leadFinishesParkedApproval, leadInvocation } from '../interfaces/cli/lead.js';
import { recordApproval } from '../adapters/review/review-round.js';
import { currentWorkPublication, type CurrentWorkPort } from '../application/recording/current-work-recorder.js';
import type { AttentionAction } from '../application/projections/board.js';

import { observationFromAttention } from '../application/recovery-supervisor.js';
import type { AttentionObservation, SupervisorPort } from '../application/recovery-supervisor.js';
import { claimRecoveryLock } from '../adapters/filesystem/recovery-claim.js';
import { pollingPause } from '../adapters/process/polling-pause.js';
import { ConcreteCurrentWorkReadAdapter } from '../adapters/backlog/concrete-current-work-read-adapter.js';
import { CURRENT_WORK_TTL_MS, reconcileCurrentWork } from '../application/projections/current-work.js';
import { processLivenessProbe } from '../adapters/process/process-liveness.js';
import { missionId } from '../domain/mission.js';
import { conventionalWorktreePath, resolveWorktree } from '../adapters/git/worktree.js';
import { git } from '../adapters/git/git.js';

import { type Command } from '../interfaces/cli/runtime.js';
import { createProductionApplicationServices } from './application-services.js';
import { statusMissionTitle } from './status-board.js';

import type { CliServiceScope } from './cli-service-scope.js';

export function createLeadSupervisorPort(
  services: Awaited<ReturnType<typeof createProductionApplicationServices>>,
  forwards: Set<Promise<unknown>>,
  context: LeadCompositionContext,
): SupervisorPort {
  const { rootDir, active, registry, runPublicCli: run } = context;
  const { openWorkflowServices } = context.scope;
  const builder = services.presentationCapabilities?.boardProjection;
  if (!builder) { throw new Error('board projection is unavailable for px lead'); }
  const currentWork = services.currentWork;
  // The board's own "needs your attention" queue, rebuilt from the
  // authorities every time it is asked for: the supervisor acts on what is
  // true now, never on a snapshot it kept (ADR 0053).
  const queue = async (headFor?: string): Promise<AttentionObservation[]> => (await builder.build()).attentionQueue
    .map(item => {
      const mission = String(item.missionId);
      return observationFromAttention(item, !headFor || mission === headFor ? leadHeadSha(mission) : null);
    });
  // `px active` and `px review` own long agent loops. Start one
  // and return to the fleet loop immediately; the current-work fact prevents
  // the next poll from treating that mission as idle and starting it again.
  const startForward = async (mission: string, action: AttentionAction, work: () => Promise<unknown>) => {
    const publication = currentWorkPublication({
      slug: mission,
      operationId: `lead-${Date.now()}`,
      phase: action.kind === 'active:execute' ? 'execute' : 'review',
      summary: `lead running ${action.display}`,
    });
    if (publication) { await currentWork.running(publication); }
    fmt.log.info(`[lead] Started ${action.display}; continuing to supervise the fleet.`);
    const forward: Promise<unknown> = Promise.resolve().then(work)
      .catch((error) => fmt.log.fail(`[lead] ${action.display} stopped: ${error instanceof Error ? error.message : String(error)}`))
      .finally(() => { finishPublication(publication, currentWork); forwards.delete(forward); });
    forwards.add(forward);
  };
  // Finishing a publication is fire-and-forget: the board update may reject
  // after the process is gone, and that is not a step the fleet can act on.
  const finishPublication = (
    publication: ReturnType<typeof currentWorkPublication>,
    currentWork: CurrentWorkPort,
  ): void => { if (publication) { void currentWork.ended(publication).catch(() => { }); } }
  const port: SupervisorPort = {
    attention: queue,
    // The operator database holds every sibling worktree's missions; this
    // checkout's task files only hold what its branch has seen. Lead is
    // started from any worktree, so the store answers first.
    missionExists: async (mission) => (await services.mission?.store.load(missionId(mission)))?.kind === 'found'
      || findTaskFile(mission, rootDir) !== null,
    // Liveness comes straight from the current-work authority for the one
    // mission being acted on. Rebuilding the whole board to answer it made a
    // pass cost one projection per question (ADR 0053: the board is a read
    // model, not the only way to read a fact).
    liveness: async (mission) => {
      const history = services.operatorState.repositories?.operationalHistory;
      // Fail closed. An unreadable current-work authority is not evidence
      // that nobody is working; refusing the step is the only safe answer,
      // and the supervisor records it like any other failed step.
      if (!history) { throw new Error(`Current work for ${mission} is unreadable: the operator database is unavailable`); }
      const events = await new ConcreteCurrentWorkReadAdapter(history)
        .loadMissionCurrentWork(missionId(mission));
      const facts = reconcileCurrentWork(events, {
        nowMs: Date.now(),
        ttlMs: CURRENT_WORK_TTL_MS,
        isProcessAlive: processLivenessProbe,
      }).get(missionId(mission));
      const work = facts?.currentWork ?? null;
      return {
        working: work !== null && work.freshness !== 'stale',
        detail: work ? `${work.phase} — ${work.summary} (${work.freshness}, ${work.updatedAt})` : null,
      };
    },
    runAction: async (mission, action, observation, signal) => {
      if (observation) {
        const detail = observation.reason.kind === 'none' ? 'none' : observation.reason.detail;
        fmt.log.info(`[lead] Found stuck mission ${fmt.slug(mission)} in state ${observation.lane}; fixing by ${action.display} (${observation.reason.kind}: ${detail})`);
      }
      // An approved round still parked in review lost its review → integration
      // transition. Finishing it moves the lane only; merging stays human.
      // Lead never decides a review: an undecided round goes to
      // `review`, whose configured reviewer decides (TASK-2620).
      if (action.kind === 'review:submit' && services.mission
        && leadFinishesParkedApproval(await services.mission.store.load(missionId(mission)))) {
        const finished = await recordApproval(mission, { comment: null, decidedAt: new Date().toISOString() }, {
          missionStore: services.mission.store,
          lifecycleService: services.mission.lifecycle,
        });
        if (finished.outcome === 'recorded') { return; }
      }
      const invocation = leadInvocation(action.kind, mission);
      if (!invocation) { throw new Error(`px lead does not run ${action.kind}`); }
      const missionWorktree = resolveWorktree(mission, {});
      if (!missionWorktree) { throw new Error(`No worktree resolved for ${mission}`); }
      // Borrow the target's workflow owner, including admission and cancellation.
      if (invocation.command === 'active') {
        const targetServices = await openWorkflowServices(missionWorktree);
        await startForward(mission, action, () => runBorrowedActive(targetServices, active, missionWorktree, invocation.args, signal));
        return;
      }
      if (!registry[invocation.command]) { throw new Error(`No runnable px command for ${action.kind}`); }
      // Run a forwarded command through the public CLI entry point so its
      // target is explicit. Calling the cached registry directly inherits
      // the process directory of `px lead`; that is wrong when lead is
      // supervising a sibling worktree and forces callers to mutate cwd.
      await startForward(mission, action, async () => {
        if (signal?.aborted) { return; }
        await run([invocation.command, ...invocation.args],
          { baseCwd: missionWorktree, log: fmt.log.plain, error: fmt.log.plainError, operatorInvocation: false });
      });
    },
    claimRecovery: async (mission) => claimRecoveryLock(mission),
    wait: pollingPause,
    // A fresh agent context in the existing mission worktree. It is not the
    // failed session resumed, and it is not an ADR 0048 repair bounce: the
    // supervisor supplies context, and the agent diagnoses. Recovery is
    // published as current work so the mission shows as being recovered.
    launchRecovery: context.launchRecovery,
  };
  return { ...port, ...createLeadOperatorJudgment(services, port, context.configuration) };
}
/** Finish only this borrowed scope; shared SQLite shutdown remains process-owned. */
async function runBorrowedActive(services: Awaited<ReturnType<typeof createProductionApplicationServices>>,
  active: LeadCompositionContext['active'], root: string, args: string[], signal?: AbortSignal): Promise<void> {
  try {
    if (signal?.aborted) { return; }
    const controller = services.presentationCapabilities?.commandController;
    if (!controller) { throw new Error(`No active controller available for ${args[0]}`); }
    await active(args, {
      controller, rootDir: root,
      missionTitleFn: (slug: string) => statusMissionTitle(services, slug, root),
      exitFn: (code: number): never => { throw new Error(`command exited with status ${code}`); },
    });
  } finally { await services.operatorState.close(); }
}

interface LeadCompositionContext { configuration: ParallixConfiguration; rootDir: string; active: ReturnType<typeof createActiveCommand>; registry: Record<string, Command>; runPublicCli: typeof import('./create-cli.js').run; scope: CliServiceScope; launchRecovery: SupervisorPort['launchRecovery'] }

function leadHeadSha(mission: string): string | null {
  const worktree = resolveWorktree(mission, {});
  if (!worktree) { return null; }
  try { return git(['-C', worktree, 'rev-parse', 'HEAD'], { stdio: 'pipe' }).stdout.trim() || null; }
  catch { return null; }
}

export function leadRecoveryWorkspace(request: Parameters<SupervisorPort['launchRecovery']>[0]) {
  const missionWorktree = resolveWorktree(request.missionId, {});
  const expectedWorktree = conventionalWorktreePath(request.missionId);
  const worktree = missionWorktree ?? expectedWorktree;
  if (!fs.existsSync(worktree)) { throw new Error(`No workspace exists for ${request.missionId}`); }
  const prompt = missionWorktree ? request.instruction : `${request.instruction}\n\n`
    + `The expected mission workspace ${expectedWorktree} does not currently resolve to the mission branch. `
    + 'Diagnose and repair its git worktree state while preserving unrelated changes.';
  if (!missionWorktree) {
    fmt.log.warn(`[lead] Expected workspace ${fmt.path(worktree)} is not attached to mission/${request.missionId}; the recovery agent will diagnose it inside the existing sandbox`);
  }
  return { worktree, prompt };
}
