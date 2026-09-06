import type { Mission } from '../domain/mission.js';

export type AuthorityOwner = 'target-repository' | 'operator-local' | 'tool-owned-asset';
export type AuthorityRole = 'source-of-truth' | 'cache';

export interface Authority {
  readonly owner: AuthorityOwner;
  readonly role: AuthorityRole;
}

const targetSource = { owner: 'target-repository', role: 'source-of-truth' } as const;
const localSource = { owner: 'operator-local', role: 'source-of-truth' } as const;
const toolSource = { owner: 'tool-owned-asset', role: 'source-of-truth' } as const;

/** Exhaustive: adding or renaming a Mission field fails type-check until authority is decided. */
export const MISSION_FIELD_AUTHORITY = {
  id: targetSource,
  repositoryId: targetSource,
  title: targetSource,
  labels: targetSource,
  status: targetSource,
  rawStatus: targetSource,
  closedAt: targetSource,
  assignee: targetSource,
  // Intake traceability only: the external system still owns the material, so
  // Parallix is authoritative for the reference it accepted, not the task.
  externalTaskRef: targetSource,
  checkpoints: targetSource,
  review: targetSource,
  netEngineeringLines: targetSource,
} as const satisfies Readonly<Record<keyof Mission, Authority>>;

export const OPERATOR_CONCERN_AUTHORITY = {
  agentBlocks: localSource,
  usageMeasurements: localSource,
  knownRepositories: { owner: 'operator-local', role: 'cache' } as const,
  boardProjection: { owner: 'operator-local', role: 'cache' } as const,
  agentSelectionPolicy: toolSource,
  lifecycleAliases: toolSource,
} as const;

export interface MissionReadResult {
  readonly mission: Mission | null;
  readonly source: 'target-repository' | 'operator-cache' | 'unavailable';
  readonly stale: boolean;
}

/** Repository data wins; a cache is explicitly stale fallback and never mutation authority. */
export function reconcileMissionRead(
  repositoryMission: Mission | null,
  cachedMission: Mission | null,
): MissionReadResult {
  if (repositoryMission) {
    return { mission: repositoryMission, source: 'target-repository', stale: false };
  }
  if (cachedMission) {
    return { mission: cachedMission, source: 'operator-cache', stale: true };
  }
  return { mission: null, source: 'unavailable', stale: false };
}

/** Commands route every Mission field mutation to the target-repository adapter. */
export function missionMutationOwner(field: keyof Mission): AuthorityOwner {
  return MISSION_FIELD_AUTHORITY[field].owner;
}

export type LegacyInventoryId =
  | 'session-metadata'
  | 'nel-record'
  | 'review-state'
  | 'agent-blocklist'
  | 'backlog-task'
  | 'coverage-manifest'
  | 'forgejo-token'
  | 'workflow-config'
  | 'qwen-settings';

/** Compatibility routing for the current durable-state inventory. */
export const LEGACY_INVENTORY_AUTHORITY = {
  'session-metadata': targetSource,
  'nel-record': MISSION_FIELD_AUTHORITY.netEngineeringLines,
  'review-state': MISSION_FIELD_AUTHORITY.review,
  'agent-blocklist': OPERATOR_CONCERN_AUTHORITY.agentBlocks,
  'backlog-task': MISSION_FIELD_AUTHORITY.status,
  'coverage-manifest': { owner: 'operator-local', role: 'cache' } as const,
  'forgejo-token': localSource,
  'workflow-config': targetSource,
  'qwen-settings': { owner: 'operator-local', role: 'cache' } as const,
} as const satisfies Readonly<Record<LegacyInventoryId, Authority>>;
