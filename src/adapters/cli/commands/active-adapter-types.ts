import type { ParallixConfiguration } from "../../../application/ports/configuration.js";
/** Concrete injection seams for the active CLI adapter. */
import type { CommandAgentLaunch } from './agent-result.js';
import type { BoardCommandDispatcher } from '../../../application/controller/board-command.js';
import type { ProgressEvent } from '../../../application/contracts.js';
import type { ExecuteMissionService } from '../../../application/execute-mission-service.js';
import type { AgentConfig } from '../../agents/agent-config.js';
import type * as agents from '../../agents/agents.js';
import type { inferSlug } from '../../filesystem/mission-utils.js';
import type { transitionTask, getTaskStatus, getTaskImplementer } from '../../backlog/backlog.js';
import type { SessionMarkerPort } from '../../../application/domain-ports.js';

export type Log = (_message: string) => void;
export type Exit = (_code?: number) => void;
export interface ActiveOptions extends Record<string, unknown> {
  inferSlugFn?: typeof inferSlug;
  service?: Pick<ExecuteMissionService, 'execute'>;
  controller?: BoardCommandDispatcher;
  controllerFactory?: (_rootDir: string, _progress: (_event: Pick<ProgressEvent, 'phase' | 'agent'>) => void) => BoardCommandDispatcher | Promise<BoardCommandDispatcher>;
  serviceFactory?: (_rootDir: string, _progress: (_event: Pick<ProgressEvent, 'phase' | 'agent'>) => void) => Pick<ExecuteMissionService, 'execute'> | Promise<Pick<ExecuteMissionService, 'execute'>>;
  rootDir?: string; exitFn?: Exit; logFn?: Log; errorFn?: Log;
  missionTitleFn?: (_slug: string) => string | null | Promise<string | null>;
  payloadLandedFn?: (_slug: string) => boolean | Promise<boolean>;
}
export interface ActiveExecution extends Pick<ActiveOptions, 'controller' | 'controllerFactory' | 'service' | 'serviceFactory'> {
  rootDir: string; renderProgress: (_event: Pick<ProgressEvent, 'phase' | 'agent'>) => void; operationId: string; slug: string; agent: string | null;
}
export interface LaunchOptions {
  configuration?: ParallixConfiguration;
  slug: string; worktree: string; prompt: string; preselectedAgent?: string | null;
  agentConfig: AgentConfig;
  taskResolution?: { ok: boolean; taskFile?: string };
  startAgentFn?: (_step: string, _options: NonNullable<Parameters<typeof agents.startAgent>[1]>) => Promise<CommandAgentLaunch>;
  transitionTaskFn?: (..._args: Parameters<typeof transitionTask>) => boolean | Promise<boolean>;
  getTaskStatusFn?: typeof getTaskStatus; getTaskImplementerFn?: typeof getTaskImplementer; selectAgentFn?: typeof agents.selectAgent;
  log?: Log; sessionMarkerPort?: SessionMarkerPort | null;
  onAgentLaunched?: ((_agent: string) => Promise<void>) | null;
  onActivated?: ((_agent: string, _startedAtMs?: number) => Promise<void>) | null;
  authorityAlreadyActive?: boolean; unrefChild?: boolean;
}
