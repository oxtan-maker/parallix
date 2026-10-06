// Agent-run identity value object (TASK-2643).
//
// One launch of one agent family for one Mission role is one run. The identity
// names the repository, Mission, role, family, attempt and launch instant, so
// concurrent Missions, the roles inside one Mission and the fallback families
// of one step never share a history directory or an attributed search result.
// A relaunch mints a new evidence identity while sharing the mission terminal.

/** Characters a run-identity token may carry; tmux session names reject `.` and `:`. */
const TOKEN_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/;

export interface AgentRunIdentity {
  /** Short, stable key of the canonical repository root (computed by an adapter). */
  readonly repositoryKey: string;
  readonly missionId: string;
  /** Launch role: `execute`, `draft`, `review`, or another launcher step. */
  readonly role: string;
  readonly family: string;
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

/** Build a validated identity; every token is normalized once, here. */
export function agentRunIdentity(input: AgentRunIdentity): AgentRunIdentity {
  if (!Number.isInteger(input.attempt) || input.attempt < 1) {
    throw new Error(`Invalid agent-run attempt: ${input.attempt}`);
  }
  if (!Number.isInteger(input.startedAtMs) || input.startedAtMs <= 0) {
    throw new Error(`Invalid agent-run start: ${input.startedAtMs}`);
  }
  return Object.freeze({
    repositoryKey: runToken(input.repositoryKey, 'repository key'),
    missionId: runToken(input.missionId, 'mission'),
    // The run id joins role and family with `-`, so they carry `_` instead.
    role: runToken(input.role, 'role').replace(/-/g, '_'),
    family: runToken(input.family, 'family').replace(/-/g, '_'),
    attempt: input.attempt,
    startedAtMs: input.startedAtMs,
  });
}

/**
 * The run id: unique within one Mission and safe as a directory name and a
 * tmux session name. The Mission and repository are deliberately not part of
 * it, because they already scope the history directory and the tmux socket.
 */
export function agentRunId(identity: AgentRunIdentity): string {
  return `${identity.role}-${identity.family}-a${identity.attempt}-${identity.startedAtMs.toString(36)}`;
}

/** Parse a run id back into its role, family and attempt; `null` when malformed. */
export function parseAgentRunId(runId: string): { role: string; family: string; attempt: number } | null {
  const match = /^([a-z0-9][a-z0-9_]*)-([a-z0-9][a-z0-9_]*)-a(\d+)-[a-z0-9]+$/.exec(runId);
  if (!match) { return null; }
  return { role: match[1], family: match[2], attempt: Number(match[3]) };
}

/** True when `runId` is shaped like a run id; used to refuse path traversal. */
export function isAgentRunId(runId: string): boolean {
  return parseAgentRunId(runId) !== null;
}
