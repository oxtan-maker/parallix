import type { LegacyDependencyException } from './boundary-guards.js';

/**
 * Temporary migration inventory captured by TASK-2332.01.
 * Every exception must be removed by its named follow-up mission; additions
 * require an explicit owner and removal plan rather than a broad suppression.
 */
export const legacyDependencyAllowlist: readonly LegacyDependencyException[] = [
  { source: 'src/application/ports.ts', target: 'src/adapters/sqlite/ports.ts', ownerTaskId: 'TASK-2332.03', removalMission: 'mission/task-2332.03' },
  { source: 'src/application/projections/create-board-projection-builder.ts', target: 'src/adapters/sqlite/ports.ts', ownerTaskId: 'TASK-2332.03', removalMission: 'mission/task-2332.03' },
  { source: 'src/application/projections/create-board-projection-builder.ts', target: 'src/adapters/backlog/concrete-mission-read-adapter.ts', ownerTaskId: 'TASK-2332.02', removalMission: 'mission/task-2332.02' },
  { source: 'src/application/projections/create-board-projection-builder.ts', target: 'src/adapters/backlog/concrete-review-read-adapter.ts', ownerTaskId: 'TASK-2332.02', removalMission: 'mission/task-2332.02' },
  { source: 'src/application/projections/create-board-projection-builder.ts', target: 'src/adapters/backlog/concrete-gate-read-adapter.ts', ownerTaskId: 'TASK-2332.02', removalMission: 'mission/task-2332.02' },
  { source: 'src/application/projections/create-board-projection-builder.ts', target: 'src/adapters/backlog/concrete-agent-read-adapter.ts', ownerTaskId: 'TASK-2332.02', removalMission: 'mission/task-2332.02' },
  { source: 'src/application/projections/create-board-projection-builder.ts', target: 'src/adapters/backlog/concrete-operation-log-read-adapter.ts', ownerTaskId: 'TASK-2332.02', removalMission: 'mission/task-2332.02' },
  { source: 'src/application/projections/create-board-projection-builder.ts', target: 'src/adapters/backlog/concrete-git-read-adapter.ts', ownerTaskId: 'TASK-2332.02', removalMission: 'mission/task-2332.02' },
  { source: 'src/application/projections/metrics-read-adapter.ts', target: 'src/adapters/sqlite/ports.ts', ownerTaskId: 'TASK-2332.03', removalMission: 'mission/task-2332.03' },
  { source: 'src/application/recording/board-event-recorder.ts', target: 'src/adapters/sqlite/ports.ts', ownerTaskId: 'TASK-2332.03', removalMission: 'mission/task-2332.03' },
  { source: 'src/application/services/agent-block-service.ts', target: 'src/adapters/sqlite/ports.ts', ownerTaskId: 'TASK-2332.03', removalMission: 'mission/task-2332.03' },
  { source: 'src/application/services/known-repository-service.ts', target: 'src/adapters/sqlite/ports.ts', ownerTaskId: 'TASK-2332.03', removalMission: 'mission/task-2332.03' },
  { source: 'src/application/services/operational-history-service.ts', target: 'src/adapters/sqlite/ports.ts', ownerTaskId: 'TASK-2332.03', removalMission: 'mission/task-2332.03' },
  { source: 'src/application/services/ui-preferences-service.ts', target: 'src/adapters/sqlite/ports.ts', ownerTaskId: 'TASK-2332.03', removalMission: 'mission/task-2332.03' },
  { source: 'src/adapters/backlog/concrete-agent-read-adapter.ts', target: 'src/platform/runtime/lib/tools/backlog.ts', ownerTaskId: 'TASK-2332.02', removalMission: 'mission/task-2332.02' },
  { source: 'src/adapters/backlog/concrete-gate-read-adapter.ts', target: 'src/platform/runtime/lib/core/mission-utils.ts', ownerTaskId: 'TASK-2332.02', removalMission: 'mission/task-2332.02' },
  { source: 'src/adapters/backlog/concrete-git-read-adapter.ts', target: 'src/platform/runtime/lib/core/git.ts', ownerTaskId: 'TASK-2332.02', removalMission: 'mission/task-2332.02' },
  { source: 'src/adapters/backlog/concrete-mission-read-adapter.ts', target: 'src/platform/runtime/lib/core/mission-utils.ts', ownerTaskId: 'TASK-2332.02', removalMission: 'mission/task-2332.02' },
  { source: 'src/adapters/backlog/concrete-mission-read-adapter.ts', target: 'src/platform/runtime/lib/tools/backlog.ts', ownerTaskId: 'TASK-2332.02', removalMission: 'mission/task-2332.02' },
  { source: 'src/adapters/backlog/concrete-review-read-adapter.ts', target: 'src/platform/runtime/lib/review/review-state.ts', ownerTaskId: 'TASK-2332.02', removalMission: 'mission/task-2332.02' },
  { source: 'src/adapters/backlog/concrete-review-read-adapter.ts', target: 'src/platform/runtime/lib/core/mission-utils.ts', ownerTaskId: 'TASK-2332.02', removalMission: 'mission/task-2332.02' },
  { source: 'src/adapters/sqlite/database-path-resolver.ts', target: 'src/platform/runtime/lib/core/storage.ts', ownerTaskId: 'TASK-2332.02', removalMission: 'mission/task-2332.02' },
  { source: 'src/interfaces/cli/dispatcher.ts', target: 'src/platform/runtime/index.ts', ownerTaskId: 'TASK-2332.02', removalMission: 'mission/task-2332.02' },
  { source: 'src/interfaces/tui/ui-command.ts', target: 'src/adapters/backlog/concrete-mission-read-adapter.ts', ownerTaskId: 'TASK-2332.02', removalMission: 'mission/task-2332.02' },
  { source: 'src/interfaces/tui/ui-command.ts', target: 'src/platform/runtime/lib/composition/application-services.ts', ownerTaskId: 'TASK-2332.02', removalMission: 'mission/task-2332.02' },
];
