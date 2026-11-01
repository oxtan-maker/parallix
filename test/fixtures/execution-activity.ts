import { advanceExecutionActivity, projectExecutionActivity, type ExecutionActivity, type ExecutionActivitySnapshot, type ActivityObservation } from '../../src/domain/execution-activity.js';
import type { ExecutionActivityStore } from '../../src/application/ports/execution-activity.js';
import { ExecutionActivityRecorder, executionActivityToEntry } from '../../src/application/recording/execution-activity-recorder.js';
import type { OperationalHistoryRepository } from '../../src/application/ports/operation-history.js';

/** Drive publications through the production transition owner, in durable order. */
export function activitySnapshots(events: readonly ExecutionActivity[]): readonly ExecutionActivitySnapshot[] {
  const snapshots = new Map<string, ExecutionActivitySnapshot>();
  const ordered = [...events].sort((a, b) => a.sequence !== undefined && b.sequence !== undefined
    ? a.sequence - b.sequence : Date.parse(a.occurredAt) - Date.parse(b.occurredAt));
  for (const event of ordered) {
    const next = advanceExecutionActivity(snapshots.get(event.missionId) ?? null, event, event.operationId);
    if (next) { snapshots.set(event.missionId, next); }
  }
  return [...snapshots.values()];
}

export function projectActivityPublications(events: readonly ExecutionActivity[], observation: ActivityObservation) {
  return projectExecutionActivity(activitySnapshots(events), observation);
}

/** Case-owned state and an optional audit sink; reads never reconstruct from audit. */
export function memoryExecutionActivity(history?: OperationalHistoryRepository): ExecutionActivityStore {
  const snapshots = new Map<string, ExecutionActivitySnapshot>();
  return {
    async loadCurrentWork() { return [...snapshots.values()]; },
    async loadMissionCurrentWork(mission) { const value = snapshots.get(mission); return value ? [value] : []; },
    async publish(event, source) {
      const next = advanceExecutionActivity(snapshots.get(event.missionId) ?? null, event, source);
      await history?.append(executionActivityToEntry(event));
      if (next) { snapshots.set(event.missionId, next); }
    },
  };
}

const stores = new WeakMap<OperationalHistoryRepository, ExecutionActivityStore>();
export function activityFixture(history: OperationalHistoryRepository): ExecutionActivityStore {
  let store = stores.get(history);
  if (!store) { store = memoryExecutionActivity(history); stores.set(history, store); }
  return store;
}

/** Existing command fixtures retain their audit sink while publishing real checked state. */
export class ActivityRecorderFixture extends ExecutionActivityRecorder {
  constructor(history: OperationalHistoryRepository, options?: ConstructorParameters<typeof ExecutionActivityRecorder>[1]) {
    super(activityFixture(history), options);
  }
}
