/** Concrete injection seams for the draft CLI adapter. */
import type { CommandAgentLaunch } from './agent-result.js';
import type { DraftWorkflowContext } from '../../../application/ports/cli-workflows.js';
import type { MissionStore } from '../../../application/domain-ports.js';
import type { MissionIntakeService } from '../../../application/mission-intake-service.js';
import type { MissionLifecycleService } from '../../../application/mission-lifecycle-service.js';
import type { RepositoryId } from '../../../domain/repository.js';
import type * as agents from '../../agents/agents.js';
import type * as backlog from '../../backlog/backlog.js';
import type * as missionUtils from '../../filesystem/mission-utils.js';
import type * as setup from './draft-setup.js';
import type * as prompts from './draft-prompts.js';
import type * as conflicts from './draft-conflicts.js';
import type * as draftStats from './draft-stats.js';
import type { transitionVirtual } from '../../config/state-map.js';
import type { ensureStandaloneMissionBaseline } from '../../config/product-config.js';
import type { allocateAdhocIdentity } from '../../sqlite/adhoc-counter.js';
import type { runPreDraftHook } from '../../process/pre-draft-hook.js';

export type DraftLog = (_message: string) => void;
export type DraftExit = (_code?: number) => void;
export interface DraftMissionServices {
  repositoryId: RepositoryId;
  store: Pick<MissionStore, 'load'>;
  intake: Pick<MissionIntakeService, 'execute'>;
  lifecycle: Pick<MissionLifecycleService, 'transition'>;
}
export interface DraftAdapterDependencies extends Record<string, unknown> {
  exitFn?: DraftExit; logFn?: DraftLog; errorFn?: DraftLog;
  missionServicesFn?: DraftWorkflowContext['missionServicesFn'];
  inferSlugFn?: typeof missionUtils.inferSlug;
  resolveMainRepoFn?: typeof missionUtils.resolveMainRepo;
  conventionalWorktreePathFn?: typeof missionUtils.conventionalWorktreePath;
  detectLaunchBaseBranchFn?: typeof missionUtils.detectLaunchBaseBranch;
  ensureRepoExistsFn?: typeof setup.ensureRepoExists;
  ensureStandaloneMissionBaselineFn?: (..._args: Parameters<typeof ensureStandaloneMissionBaseline>) => { committed?: boolean; failed?: boolean; message?: string };
  ensureDraftRepoConfigCommittedFn?: typeof setup.ensureDraftRepoConfigCommitted;
  allocateAdhocIdentityFn?: (..._args: Parameters<typeof allocateAdhocIdentity>) => { slug: string; taskId: string };
  resolveTaskFileFn?: typeof backlog.resolveTaskFile;
  reportTaskResolutionFn?: typeof backlog.reportTaskResolution;
  checkBacklogIntegrityFn?: typeof backlog.checkBacklogIntegrity;
  transitionTaskFn?: (..._args: Parameters<typeof backlog.transitionTask>) => boolean | Promise<boolean>;
  transitionVirtualFn?: typeof transitionVirtual;
  ensureMissionBranchFn?: typeof setup.ensureMissionBranch;
  ensureWorktreeFn?: typeof setup.ensureWorktree;
  ensureGraphifyWorkspaceFn?: (..._args: Parameters<typeof setup.ensureGraphifyWorkspace>) => unknown;
  ensureGraphifyIgnoreFn?: (..._args: Parameters<typeof setup.ensureGraphifyIgnore>) => unknown;
  ensureMissionFileFn?: typeof setup.ensureMissionFile;
  bootstrapBacklogTaskFn?: typeof setup.bootstrapBacklogTask;
  runPreDraftHookFn?: typeof runPreDraftHook;
  validateDraftClassificationFn?: (..._args: Parameters<typeof prompts.validateDraftClassification>) => { ok: boolean; classification?: string | null; reason?: string };
  normalizeDraftClassificationFn?: (..._args: Parameters<typeof prompts.normalizeDraftClassification>) => { ok: boolean; classification?: string | null; reason?: string };
  readAgentConfigOrExitFn?: typeof agents.readAgentConfigOrExit;
  selectAgentFn?: typeof agents.selectAgent;
  startDraftAgentFn?: (_options: NonNullable<Parameters<typeof agents.startDraftAgent>[0]>) => Promise<CommandAgentLaunch>;
  recordDraftImplementerFn?: (..._args: Parameters<typeof draftStats.recordDraftImplementer>) => unknown;
  recordDraftStatsFn?: typeof draftStats.recordDraftStats;
  restartDraftAgentFn?: (..._args: Parameters<typeof draftStats.restartDraftAgent>) => boolean | Promise<boolean>;
  repairDraftContractFn?: typeof draftStats.repairDraftContract;
  enforceDraftCommitSafetyFn?: typeof conflicts.enforceDraftCommitSafety;
  cwdFn?: () => string;
  anchorLaunchDirToMainRepo?: boolean;
}

/** The broad workflow port retains the adapter's opaque services factory. */
export function draftMissionServices(ctx: DraftWorkflowContext): Promise<DraftMissionServices> {
  const factory = ctx.missionServicesFn as (_rootDir: string) => Promise<DraftMissionServices>;
  return factory(ctx.targetWorktree);
}
