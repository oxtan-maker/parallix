# CP-4 — Narrow adapters, rewiring, and the removal of `LegacyActiveAdapter`

## Summary

### Adapters

`src/platform/runtime/lib/adapters/execute-mission-adapters.ts` implements the
CP-2 ports over the existing `active.ts` helpers, one class per port:

| Adapter | Port | Mechanism it keeps |
|---|---|---|
| `MissionWorkspaceAdapter` (`:70`) | `MissionWorkspacePort` | preflight, worktree/task-file resolution, Backlog status read, commit safety |
| `AgentExecutionAdapter` (`:98`) | `AgentExecutionPort` | agent config + blocklist overlay, prompt construction, `selectLaunchAndRecord` |
| `ExecuteTelemetryAdapter` (`:161`) | `ExecuteTelemetryPort` | model resolution, stage telemetry, `recordActiveStats` |
| `HandoffReviewAdapter` (`:181`) | `HandoffReviewPort` | `runHandoffAndReview` |

`createExecuteMissionPorts` (`:202`) assembles the set and passes the injected
`MissionTransitionStore` through unchanged. No class sequences launch → record →
handoff, and none holds per-slug state.

### Rewiring

- `src/platform/runtime/lib/composition/application-services.ts:185` builds the
  mechanism set via `createExecuteMissionPorts`; `:198` constructs
  `ExecuteMissionService`. `LegacyActiveAdapter` is no longer imported.
- `src/composition/production-capabilities.ts:36` and
  `src/composition/board-projection.ts:48` now carry `ExecuteMissionPorts`.
- `src/application/controller/board-controller.ts:56` builds the use case per
  progress sink; `:173` dispatches through it.
- `src/platform/runtime/lib/commands/active.ts:63` resolves `.executeMission`.
- `src/platform/runtime/lib/architecture/boundary-guards.ts:136` now detects the
  complete graph via `createExecuteMissionPorts(` — the rule (only
  `lib/composition/application-services.ts` may build it) is retargeted, not
  removed; `test/fixtures/application-boundary/composition-violation.ts` is
  still rejected.

### Deletions

`src/application/active-service.ts`, `src/platform/runtime/lib/adapters/legacy-active-adapter.ts`,
and `test/legacy-active-adapter.test.ts` are removed (`git status --short` shows
them as `D`). `ActivePort`/`ActiveLaunch` are gone from `src/application/ports.ts`;
a repo-wide grep for `ActivePort|ActiveService|LegacyActiveAdapter` outside
`backlog/`, `missions/`, and build artifacts returns only the explanatory
comment at `src/application/ports.ts:22`.

### Tests

- `test/execute-mission-characterization.test.ts` — only the factory at `:15-24`
  changed; all 17 expectations are byte-identical to CP-1 and pass through the
  new use case + adapters.
- `test/execute-mission-adapters.test.ts` (new, 10 tests) absorbs the deleted
  `legacy-active-adapter.test.ts` assertions (injected-store identity,
  fail-closed construction) and adds per-adapter contracts.
- `test/application-services.test.ts` keeps its stats coverage; its four
  `ActiveService` tests are replaced one-for-one in
  `test/execute-mission-service.test.ts` (CP-3).
- `test/board-controller.test.ts`, `test/board-progress-events.test.ts`, and
  `test/production-composition-capabilities.test.ts` construct the shared
  in-memory `makeExecutePorts` fixture (`test/fixtures/execute-mission-ports.ts`);
  their assertions, including the `validate → launch → record → handoff` call
  trace, are unchanged.
- `test/active.test.ts` is untouched.

One incidental source change: `resolveStageTelemetry`'s `result` option is now
optional (`src/platform/runtime/lib/agents/stage-telemetry.ts:21`) because the
adapter passes a typed value where the legacy `@ts-nocheck` path passed `any`.
The implementation already returned `null` for a missing result.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| `src/application/ports.ts` no longer declares `ActivePort` with `validateSlug`/`launch`/`recordLaunch`/`handoff` | `src/application/ports.ts:22` (comment only), `src/application/ports/execute-mission.ts:31` | PASS |
| `LegacyActiveAdapter` deleted; remaining classes each implement exactly one mechanism port | `git status --short` shows `D src/platform/runtime/lib/adapters/legacy-active-adapter.ts`; `src/platform/runtime/lib/adapters/execute-mission-adapters.ts:70`, `:98`, `:161`, `:181`; `"each execute mechanism port is a distinct narrow adapter"` | PASS |
| Composition no longer constructs the legacy adapter | `src/platform/runtime/lib/composition/application-services.ts:185`, `:198`, `"composition guard accepts the sole production composition root"` | PASS |
| Composition-root enforcement retargeted, not removed | `src/platform/runtime/lib/architecture/boundary-guards.ts:136`, `"composition guard rejects complete adapter construction fixture"` | PASS |
| Agent spawn, Git/worktree, Backlog Markdown, and stats writes stay outside `src/application/` | `src/platform/runtime/lib/adapters/execute-mission-adapters.ts:1-8`, `"application import guard accepts every file under src/application/"` | PASS |
| Characterization behavior identical before and after the extraction | `test/execute-mission-characterization.test.ts:15` (only the factory changed), `"execute workflow: success runs preflight, prepare, launch, record, telemetry, handoff in order"` — 17 pass / 0 fail | PASS |
| `test/active.test.ts` passes unmodified, no assertion weakened | `test/active.test.ts`, `"active() success path: preflight, launch, and handoff run in order"`, `"active() exits 1 when handoff fails after successful execute launch"` | PASS |
| `test/legacy-active-adapter.test.ts` / `test/application-services.test.ts` replaced with no net loss of asserted behavior | `test/execute-mission-adapters.test.ts`, `"execute mission ports use the injected mission transition store identity"`; `test/execute-mission-service.test.ts`, `"execute mission use case cancels after the durable record without a rollback claim"` | PASS |
| Shared SQLite handles still flow through the new agent adapter (no new connection) | `src/platform/runtime/lib/adapters/execute-mission-adapters.ts:98`, `src/platform/runtime/lib/composition/application-services.ts:185` (same `sessionMarkerPort` / `operatorBlocklist` overlay) | PASS |
| `./scripts/verify-local.sh static-analysis` passes | `./scripts/verify-local.sh static-analysis` — ESLint, tsc, test-hygiene, test typecheck all PASS | PASS |
| `./scripts/verify-local.sh all` passes | `./scripts/verify-local.sh all` — 1666 pass / 0 fail | PASS |

Next action: CP-5 — update `docs/adr/0051-ui-neutral-application-boundary.md` and
`src/domain/README.md:257` where they describe `active` as an adapter-owned
workflow, then re-run both mission gates on the final tree.
