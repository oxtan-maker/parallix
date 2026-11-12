import type { ParallixConfiguration } from "../../../application/ports/configuration.js";
/** Concrete injection seams for the active CLI adapter. */
import type { CommandAgentLaunch } from './agent-result.js';
import type { BoardCommandDispatcher } from '../../../application/controller/board-command.js';
import type { ProgressEvent } from '../../../application/contracts.js';
import type { ExecuteMissionService } from '../../../application/execute-mission-service.js';
import type { AgentConfig } from '../../agents/agent-config.js';
import type * as agents from '../../agents/agents.js';
import type { inferSlug } from '../../filesystem/mission-utils.js';
import type { transitionTask } from '../../backlog/backlog.js';
import type { SessionMarkerPort } from '../../../application/domain-ports.js';
import type { ExecutionActivityActor } from '../../../domain/execution-activity.js';

export type Log = (_message: string) => void;
export type Exit = (_code: number) => void;
export interface ActiveOptions {
  /** Set only by the direct operator CLI entry; borrowed recovery calls default to false. */
  operatorInvocation?: boolean;
  /** Trusted composition metadata for a workflow forwarded by px lead. */
  activityActor?: ExecutionActivityActor;
  inferSlugFn?: typeof inferSlug;
  service?: Pick<ExecuteMissionService, 'execute'>;
  controller?: BoardCommandDispatcher;
  controllerFactory?: (_rootDir: string, _progress: (_event: Pick<ProgressEvent, 'phase' | 'agent'>) => void) => BoardCommandDispatcher | Promise<BoardCommandDispatcher>;
  serviceFactory?: (_rootDir: string, _progress: (_event: Pick<ProgressEvent, 'phase' | 'agent'>) => void) => Pick<ExecuteMissionService, 'execute'> | Promise<Pick<ExecuteMissionService, 'execute'>>;
  rootDir?: string; exitFn?: Exit; logFn?: Log; errorFn?: Log;
  missionTitleFn?: (_slug: string) => string | null | Promise<string | null>;
  payloadLandedFn?: (_slug: string) => boolean | Promise<boolean>;
}
export interface ActiveExecution extends Pick<ActiveOptions, 'controller' | 'controllerFactory' | 'service' | 'serviceFactory' | 'operatorInvocation' | 'activityActor'> {
  cancellation: import('../../../application/controller/board-command.js').BoardCancellation;
  rootDir: string; renderProgress: (_event: Pick<ProgressEvent, 'phase' | 'agent'>) => void; operationId: string; slug: string; agent: string | null; reviewer: string | null;
}
export interface LaunchOptions {
  configuration?: ParallixConfiguration;
  slug: string; worktree: string; prompt: string; preselectedAgent?: string | null;
  agentConfig: AgentConfig;
  /** Once-materialized SQLite blocklist rows consulted by the preselection. */
  runtimeBlocklist?: NonNullable<Parameters<typeof agents.selectAgent>[1]>['runtimeBlocklist'];
  taskResolution?: { ok: boolean; taskFile?: string };
  startAgentFn?: (_step: string, _options: NonNullable<Parameters<typeof agents.startAgent>[1]>) => Promise<CommandAgentLaunch>;
  transitionTaskFn?: (..._args: Parameters<typeof transitionTask>) => boolean | Promise<boolean>;
  selectAgentFn?: typeof agents.selectAgent;
  log?: Log; sessionMarkerPort?: SessionMarkerPort | null;
  onAgentLaunched?: ((_agent: string, _model?: string | null) => Promise<void>) | null;
  unrefChild?: boolean; pinnedAgent?: boolean;
}
