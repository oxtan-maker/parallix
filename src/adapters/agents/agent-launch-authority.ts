import type { AgentProcessResult } from "./agent-process-types.js";
import type { ParallixConfiguration } from "../../application/ports/configuration.js";
import { DEFAULT_CONFIGURATION } from "../../application/ports/configuration.js";
import { CONFIG_PATH, readAgentConfig } from "./agent-config.js";
import { resolveAgentBlockAuthority } from "./agent-block-authority.js";
import type { SessionMarkerPort } from "../../application/domain-ports.js";
import { type AgentFamily } from "../../domain/agents.js";
import type { MissionId } from "../../domain/mission.js";
import type { SessionRole } from "../../domain/session.js";
import type { StartAgentLoopDeps, PreparedLaunch } from './agent-launch-context.js';


export const defaultSessionMarkerPorts = new Map<string, Promise<SessionMarkerPort>>();


/**
 * Build the sole production session-marker authority on demand.  This keeps
 * SQLite out of the launcher module's static graph while making an unavailable
 * database an explicit launch failure instead of falling back to worktree files.
 */
export async function defaultSessionMarkerPort(worktree: string, configuration: ParallixConfiguration): Promise<SessionMarkerPort> {
  const { ConcreteGitReadAdapter } = await import('../backlog/concrete-git-read-adapter.js');
  const repositoryId = await new ConcreteGitReadAdapter({ rootDir: worktree }).loadRepositoryId();
  const key = `${configuration.storage.parallixHome ?? ''}:${repositoryId}`;
  let port = defaultSessionMarkerPorts.get(key);
  if (!port) {
    port = (async () => {
      const { initOperatorState } = await import('../sqlite/adapter-factory.js');
      const { SqliteSessionMarkerAdapter } = await import('../sqlite/session-marker-adapter.js');
      const { db } = await initOperatorState({ configuration });
      return new SqliteSessionMarkerAdapter(db, repositoryId);
    })();
    defaultSessionMarkerPorts.set(key, port);
  }
  try {
    return await port;
  } catch (error) {
    defaultSessionMarkerPorts.delete(key);
    throw error;
  }
}


/**
 * Runtime callers describe the participant identity while SessionMarker uses
 * the checked workflow stage. Keep that translation at this boundary instead
 * of casting unchecked strings through the application port.
 */
export function normalizeSessionRole(role: string): SessionRole {
  switch (role) {
    case 'implementer':
      return 'execute';
    case 'reviewer':
      return 'review';
    case 'execute':
    case 'draft':
    case 'review':
      return role;
    default:
      throw new Error(`Unsupported session marker role: ${role}`);
  }
}


/**
 * Launcher inputs have already passed mission lookup and agent selection.
 * Keep their checked identities as branded values without adding a second
 * runtime dependency on domain constructors here. The authoritative
 * SessionMarker adapter validates them again at every persistence boundary.
 */
export function sessionMissionId(slug: string): MissionId {
  return slug as MissionId;
}


export function sessionAgentFamily(agent: string): AgentFamily {
  return agent as AgentFamily;
}


export async function defaultIsAgentBlockedNow(agent: string, configuration: ParallixConfiguration = DEFAULT_CONFIGURATION) {
  try {
    const { initOperatorState } = await import('../sqlite/adapter-factory.js');
    const { SqliteBlocklistRepository } = await import('../sqlite/blocklist-repository.js');
    const { AgentBlockService } = await import('../../application/services/agent-block-service.js');
    const config = readAgentConfig(CONFIG_PATH, { configuration });
    const state = await initOperatorState({ configuration });
    const runtimeBlock = await new AgentBlockService(new SqliteBlocklistRepository(state.db)).query(agent);
    return resolveAgentBlockAuthority(agent, runtimeBlock, config).blocked;
  } catch (_err) {
    // If the config is malformed, surface that through the launcher path
    // (assertAgentSupported / launch) instead of silently rerouting. Treat as
    // not-blocked here so the existing error path runs.
    return false;
  }
}


/** Runtime block writes require a composed configuration; never infer operator storage. */
export async function updateAgentBlockChecked(agent: string, until: string, options: {reason?: string; configuration?: ParallixConfiguration} = {}) {
  if (!options.configuration) {
    throw new Error('updateAgentBlockChecked requires explicit configuration to select operator storage');
  }
  const { initOperatorState } = await import('../sqlite/adapter-factory.js');
  const { SqliteBlocklistRepository } = await import('../sqlite/blocklist-repository.js');
  const { AgentBlockService } = await import('../../application/services/agent-block-service.js');
  const state = await initOperatorState({ configuration: options.configuration });
  return new AgentBlockService(new SqliteBlocklistRepository(state.db)).block(agent, until, options.reason ?? null);
}


/**
 * Record the session marker so a subsequent same-(slug, role) launch knows
 * which family last ran here. Only persisted when the run exited cleanly
 * (status 0 and no spawn error); a failed launch must not overwrite the
 * canonical session marker with a stale transcript.
 */
export async function recordSessionMarker(deps: StartAgentLoopDeps, prepared: PreparedLaunch, chosen: string, result: AgentProcessResult | null | undefined): Promise<void> {
  const { worktree, slug, role } = deps;
  if (!(worktree && slug && role && result && result.status === 0 && !result.error)) { return; }
  const launchSessionId = result && result.sessionId ? result.sessionId : null;
  if (!prepared.launchSessionMarkerPort || !prepared.sessionRole) {
    throw new Error('SessionMarkerPort and canonical role are required');
  }
  try {
    await prepared.launchSessionMarkerPort.save({
      missionId: sessionMissionId(slug),
      role: prepared.sessionRole,
      agent: sessionAgentFamily(chosen),
      lastLaunched: new Date().toISOString(),
      sessionId: launchSessionId,
    });
  } catch (err) {
    // Diagnostic: log full error details and database state
    if (deps.configuration.storage.debugSql) {
      const { getOperatorStateCacheSize } = await import('../sqlite/adapter-factory.js');
      const e = err as Error & { code?: string };
      process.stderr.write(`[sql-error] save failed: code=${e.code ?? 'n/a'} message="${e.message}\n`);
      process.stderr.write(`[sql-error] cacheSize=${getOperatorStateCacheSize()} pid=${process.pid}\n`);
      process.stderr.write(`[sql-error] stack:\n${e.stack ?? 'n/a'}\n`);
    }
    throw new Error(`Could not persist session marker for ${slug} (${role}): ${(err as Error).message}`);
  }
}
