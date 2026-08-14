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
        return { kind: 'found' as const, mission: { status: 'review', review: { rounds: [] } }, version: 1 };
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
