import path from 'node:path';
import { resolveProcessConfiguration } from './config.js';
import { repositoryId } from '../domain/repository.js';
import { resolveCanonicalRepositoryId } from '../adapters/git/repository-identity.js';
import { registerOperatorStateShutdown } from './operator-state-lifecycle.js';
import { bindInheritedWorkflowAuthorization } from './workflow-authorization.js';
import { createMissionStore } from './mission-persistence.js';
import { MissionLifecycleService } from '../application/mission-lifecycle-service.js';
import type { MissionApplicationServiceOverrides } from './mission-services.js';

/** Shared durable authority for full Mission services and short review writers. */
export async function createMissionAuthority(rootDir: string, overrides: MissionApplicationServiceOverrides = {}) {
  // A mission worktree and the checkout it was branched from are the same
  // repository: the Mission row a handoff writes from `<repo>-<slug>` is the
  // one integrate reads from `<repo>`. Anchor the repository identity to the
  // primary worktree so callers key consistent rows.
  const repoId = overrides.repositoryId
    ? repositoryId(overrides.repositoryId)
    : resolveCanonicalRepositoryId(rootDir);

  // Dynamic imports keep the built-in SQLite module out of the statically
  // loaded runtime graph so the CJS rollback bundle degrades gracefully.
  const { initOperatorState, clearOperatorStateCache, clearOperatorStateCacheSync } = await import('../adapters/sqlite/adapter-factory.js');
  const { resolveDatabasePath } = await import('../adapters/sqlite/database-path-resolver.js');

  // Use the shared singleton connection from initOperatorState so that the
  // mission store, session markers, and blocklist all converge on the same
  // DatabaseSync handle. This avoids "database is locked" contention between
  // independent connections on the same file.
  const configuration = overrides.configuration ?? resolveProcessConfiguration();
  const dbPath = overrides.databasePath ?? resolveDatabasePath({ configuration });
  const { db } = await initOperatorState({
    configuration,
    homeDir: overrides.databasePath
      ? path.dirname(dbPath)
      : undefined,
  });

  registerOperatorStateShutdown(clearOperatorStateCache, clearOperatorStateCacheSync);
  bindInheritedWorkflowAuthorization(configuration, overrides.inheritWorkflowAuthorization, { repositoryId: repoId }, db);
  const store = createMissionStore(db);
  return { db, repositoryId: repoId, store, lifecycle: new MissionLifecycleService(store) };
}
