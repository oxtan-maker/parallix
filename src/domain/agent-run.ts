// Agent-run identity value object (TASK-2643).
//
// One launch of one agent family for one Mission role is one run. The identity
// names the repository, Mission, role, family, attempt and launch instant, so
// concurrent Missions, the roles inside one Mission and the fallback families
// of one step never share a history directory or an attributed search result.
// A relaunch mints a new evidence identity while sharing the mission terminal,
// whose repository and canonical Mission ID it carries unchanged (TASK-2749).

import { agentFamily, type AgentFamily } from './agents.js';
import { missionId, type MissionId } from './mission.js';
import { repositoryId, type RepositoryId } from './repository.js';

/** Characters a launch-role token may carry. */
const TOKEN_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/;

export interface AgentRunIdentity {
  readonly repositoryId: RepositoryId;
  readonly missionId: MissionId;
  /** Launch role: `execute`, `draft`, `review`, or another launcher step. */
  readonly role: string;
  readonly family: AgentFamily;
  /** One-based attempt within the launch loop (fallback families advance it). */
  readonly attempt: number;
  /** Launch instant in epoch milliseconds; separates relaunches of one attempt. */
  readonly startedAtMs: number;
}

/** Normalize a free-form value into one identity token, or throw. */
export function runToken(value: string, label: string): string {
  const normalized = String(value ?? '').trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '_').replace(/^[_-]+/, '');
  if (!TOKEN_PATTERN.test(normalized)) {
    throw new Error(`Invalid agent-run ${label}: ${JSON.stringify(value)}`);
  }
  return normalized;
}

/**
 * Build a validated identity using the existing family, repository and Mission
 * authorities. Only the launch-role token is encoded here.
 */
export function agentRunIdentity(input: Omit<AgentRunIdentity, 'missionId' | 'repositoryId' | 'family'> & { readonly missionId: string; readonly repositoryId: string; readonly family: string }): AgentRunIdentity {
  if (!Number.isInteger(input.attempt) || input.attempt < 1) {
    throw new Error(`Invalid agent-run attempt: ${input.attempt}`);
  }
  if (!Number.isInteger(input.startedAtMs) || input.startedAtMs <= 0) {
    throw new Error(`Invalid agent-run start: ${input.startedAtMs}`);
  }
  return Object.freeze({
    repositoryId: repositoryId(input.repositoryId),
    missionId: missionId(input.missionId),
    // Role tokens keep the existing run-id separator encoding.
    role: runToken(input.role, 'role').replace(/-/g, '_'),
    family: agentFamily(input.family),
    attempt: input.attempt,
    startedAtMs: input.startedAtMs,
  });
}

/**
 * The run id: unique within one Mission and safe as a directory name and a
 * tmux session name. The Mission and repository are deliberately not part of
 * it, because they already scope the history directory and the tmux socket.
 */
export function agentRunId(identity: Pick<AgentRunIdentity, 'role' | 'family' | 'attempt' | 'startedAtMs'>): string {
  return `${identity.role}-${identity.family.replace(/-/g, '_')}-a${identity.attempt}-${identity.startedAtMs.toString(36)}`;
}

/** Parse a run id back into its role, family and attempt; `null` when malformed. */
export function parseAgentRunId(runId: string): { role: string; family: AgentFamily; attempt: number } | null {
  const match = /^([a-z0-9][a-z0-9_]*)-([a-z0-9][a-z0-9_]*)-a(\d+)-[a-z0-9]+$/.exec(runId);
  if (!match) { return null; }
  try { return { role: match[1], family: agentFamily(match[2].replace(/_/g, '-')), attempt: Number(match[3]) }; }
  catch { return null; }
}

/** True when `runId` is shaped like a run id; used to refuse path traversal. */
export function isAgentRunId(runId: string): boolean {
  return parseAgentRunId(runId) !== null;
}
