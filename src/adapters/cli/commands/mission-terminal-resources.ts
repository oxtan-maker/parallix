import { probeProcessLiveness } from '../../process/process-liveness.js';
import type childProcess from 'node:child_process';
import type { ParallixConfiguration } from '../../../application/ports/configuration.js';
import type { MissionTerminalCapability } from '../../../application/ports/mission-terminal.js';
import type { RecordedOutputRenderer } from '../../../application/ports/recorded-output-renderer.js';
import { createMissionTerminalService } from '../../../application/mission-terminal.js';
import { resolveCanonicalRepositoryId } from '../../git/repository-identity.js';
import { missionRepositoryKey } from '../../filesystem/mission-repository-key.js';
import { resolveWorktree } from '../../filesystem/mission-utils.js';
import { createRunHistoryStore, historyRepositoryRoot } from '../../filesystem/run-history-store.js';
import { createTmuxMissionTerminalHost } from '../../process/tmux-mission-terminal.js';

export interface MissionTerminalResourceOptions {
  readonly configuration: ParallixConfiguration;
  readonly renderer?: RecordedOutputRenderer;
  readonly spawnSyncFn?: typeof childProcess.spawnSync;
  readonly repositoryKeyFn?: (_checkout: string) => string;
  readonly resolveWorktreeFn?: (_missionId: string) => string | null;
}

/**
 * Bind the application's mission terminal capability to one repository
 * (TASK-2749). `checkout` may be any checkout of the repository; the
 * repository key and the history store come from its canonical root, so a
 * removed Mission worktree changes neither.
 */
export function createMissionTerminalResources(checkout: string, options: MissionTerminalResourceOptions): MissionTerminalCapability {
  const repositoryRoot = historyRepositoryRoot(checkout);
  return createMissionTerminalService({
    repositoryId: resolveCanonicalRepositoryId(repositoryRoot),
    host: createTmuxMissionTerminalHost({ configuration: options.configuration, repositoryKey: (options.repositoryKeyFn ?? missionRepositoryKey)(repositoryRoot), ...(options.spawnSyncFn ? { spawnSyncFn: options.spawnSyncFn } : {}) }),
    store: createRunHistoryStore({ repositoryRoot, executionAlive: execution => probeProcessLiveness(execution.pid, execution.processIdentity), repositoryKey: (options.repositoryKeyFn ?? missionRepositoryKey)(repositoryRoot), resolveWorktree: options.resolveWorktreeFn ?? (missionId => resolveWorktree(missionId)) }),
    ...(options.renderer ? { renderer: options.renderer } : {}),
  });
}
