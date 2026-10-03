/**
 * In-memory stand-in for `createMissionApplicationServices()`.
 *
 * After the TASK-2322.07 cutover, `performHandoff` commits the Mission
 * transition through the SQLite authority before it touches the Backlog task.
 * Tests that mock `fs` wholesale cannot let the real composition root run — its
 * lazy `import()` of the SQLite adapter would read the mocked file contents —
 * so they inject this stub through the `missionServicesFn` seam instead.
 */
export function stubMissionServices(overrides: Record<string, unknown> = {}) {
  return () => ({
    repositoryId: 'test-repo',
    store: {
      _repoId: 'test-repo',
      async load() {
        return { kind: 'found' as const, mission: { status: 'review', review: { rounds: [] }, checkpoints: [], brief: null, declaredGates: [] }, version: 1 };
      },
    },
    checkpoints: {
      async record() {
        return { status: 'completed', value: { replaced: false }, durableEvidence: [] };
      },
    },
    lifecycle: {
      async transition() {
        return { status: 'completed', value: { to: 'review', version: 2 }, durableEvidence: [] };
      },
    },
    handoff: {
      async recordNel() {
        return { status: 'completed', value: {}, durableEvidence: [] };
      },
    },
    ...overrides,
  });
}

export function stubRecordedMissionServices() {
  return stubMissionServices({
    store: {
      async load() {
        return {
          kind: 'found' as const,
          mission: {
            status: 'review', review: { rounds: [] },
            checkpoints: [{ name: 'CP-1', goalCheck: [{ criterion: 'handoff coverage', evidence: '`npm run typecheck`' }], nextActionText: 'review' }],
            brief: { goal: 'g', why: 'w', scope: 's', outOfScope: [] },
            successCriteria: ['handoff coverage'], completedSuccessCriteria: [0], declaredGates: ['true'],
          },
          version: 1,
        };
      },
    },
  });
}
