## CP-4 — Scoped metrics read and composition

`ConcreteMetricsReadAdapterOptions` now requires `repositoryId`. `buildMetrics`
uses `findByRepositoryId(repositoryId)` for lane events instead of unscoped
`findAll()`. Usage records filtered to matching `repo`. Outcomes keyed by
`(repositoryId::mission)` following `statsMissionKey` precedent.
`src/composition/board-projection.ts` wires `deps.repositoryId` into the
adapter constructor.

### Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| `ConcreteMetricsReadAdapter` requires `repositoryId` option | `src/application/projections/metrics-read-adapter.ts:36` — `readonly repositoryId: RepositoryId` | PASS |
| `buildMetrics` scopes lane-event read | `src/application/projections/metrics-read-adapter.ts:63` — `findByRepositoryId(this.repositoryId)` | PASS |
| Usage records filtered to repository | `src/application/projections/metrics-read-adapter.ts:105` — `records.filter(r => r.repo === repositoryId)` | PASS |
| Outcomes keyed by (repo, mission) | `src/application/projections/metrics-read-adapter.ts:115` — `` key = `${repositoryId}::${record.mission}` `` | PASS |
| `board-projection.ts` passes `deps.repositoryId` | `src/composition/board-projection.ts:59` — `repositoryId: deps.repositoryId` | PASS |
| Repro test: cross-repo contamination GREEN | `test/task-2347-01-repository-identity-repro.test.ts` — `"metrics built for alpha exclude lane events recorded for beta"` | PASS |
| Repro test: all 6 cases GREEN | `test/task-2347-01-repository-identity-repro.test.ts` — 6 pass, 0 fail | PASS |
| `task-2343-board-projection-repro.test.ts` still passes | `test/task-2343-board-projection-repro.test.ts` — 7 pass | PASS |

Next action: CP-5 — update `docs/adr/0053-persistence-inventory.md` for `board_lane_events` columns/indexes, run final gate, record red-to-green evidence.
