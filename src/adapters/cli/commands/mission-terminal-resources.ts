import { getRun } from '../../../application/run-history.js';
import type { MissionHistoryStorePort, MissionTerminalScope } from '../../../application/ports/mission-terminal.js';
import type childProcess from 'node:child_process';
import type { ParallixConfiguration } from '../../../application/ports/configuration.js';
import type { MissionTerminalCapability } from '../../../application/ports/mission-terminal.js';
import type { RecordedOutputRenderer } from '../../../application/ports/recorded-output-renderer.js';
import { createMissionTerminalService } from '../../../application/mission-terminal.js';
import { resolveCanonicalRepositoryId } from '../../git/repository-identity.js';
import { missionRepositoryKey } from '../../filesystem/mission-repository-key.js';
import { resolveWorktree } from '../../filesystem/mission-utils.js';
import { createRunHistoryStore, historyRepositoryRoot } from '../../filesystem/run-history-store.js';
import { createTmuxMissionTerminalHost, probeMissionExecution } from '../../process/tmux-mission-terminal.js';

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
  const store = createRunHistoryStore({ repositoryRoot, executionAlive: execution => probeMissionExecution(execution.pid, execution), repositoryKey: (options.repositoryKeyFn ?? missionRepositoryKey)(repositoryRoot), resolveWorktree: options.resolveWorktreeFn ?? (missionId => resolveWorktree(missionId)) });
  return createMissionTerminalService({
    repositoryId: resolveCanonicalRepositoryId(repositoryRoot),
    host: createTmuxMissionTerminalHost({ configuration: options.configuration, repositoryKey: (options.repositoryKeyFn ?? missionRepositoryKey)(repositoryRoot), recordedExecution: (identity, runId) => recordedExecution(store, identity, runId), ...(options.spawnSyncFn ? { spawnSyncFn: options.spawnSyncFn } : {}) }),
    store,
    ...(options.renderer ? { renderer: options.renderer } : {}),
  });
}

/** Reuse validated, attributed history; a native PID alone supplies no identity. */
function recordedExecution(store: MissionHistoryStorePort, identity: MissionTerminalScope, runId: string) {
  for (const location of store.locations(identity)) {
    const found = getRun({ runsDir: location.runsDir, fs: store.fs, isAlive: pid => store.isAlive(pid) }, runId);
    if (found.ok && found.run && store.attribute(identity, found.run.record, location).kind === 'attributed') {
      return found.run.record.execution ?? null;
    }
  }
  return null;
}
