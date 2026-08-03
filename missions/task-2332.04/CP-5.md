# CP-5 — Documentation and final verification

## Summary

Docs updated where they described `active` as an adapter-owned workflow:

- `docs/adr/0051-ui-neutral-application-boundary.md:230` — the `active` proof
  slice is now recorded as extracted, naming `ExecuteMissionService`, the
  mechanism ports in `src/application/ports/execute-mission.ts`, and the
  one-port-per-class adapters, plus the rule that none of them sequences the
  workflow or chooses a lifecycle transition.
- `docs/adr/0051-ui-neutral-application-boundary.md:154` (C2) — transition
  correctness now cites the use case that owns launch → record → rollback
  ordering and its characterization suite.
- `docs/adr/0051-ui-neutral-application-boundary.md:156` (C4) — the execute
  workflow is unit-tested against in-memory ports; the "not yet an application
  boundary" claim now applies only to the command families still unextracted.
- The relocated-module list (`:265`) and the incremental-extraction paragraph
  (`:300`) no longer name the deleted `active-service.ts`.
- `src/domain/README.md:257` points at `execute-mission-service.ts:63-99`
  instead of the deleted `active-service.ts`.

Gates run on the final tree: `./scripts/verify-local.sh static-analysis` (all
four stages PASS) and `./scripts/verify-local.sh all` (1666 pass / 0 fail).
`test/active.test.ts` is classified into the integration suite by
`test/run-default-tests.ts`, so it was verified both directly
(`npm test test/active.test.ts` — 79 pass / 0 fail) and through
`npm run test:integration` (1430 pass / 0 fail / 25 pre-existing skips).

## Final architecture

```
px active  ─┐
TUI board  ─┴─> ExecuteMissionService (src/application/execute-mission-service.ts)
                 ├─ MissionWorkspacePort      → MissionWorkspaceAdapter
                 ├─ AgentExecutionPort        → AgentExecutionAdapter
                 ├─ MissionTransitionStore    → SqliteMissionStore (checked)
                 ├─ ExecuteTelemetryPort      → ExecuteTelemetryAdapter
                 └─ HandoffReviewPort         → HandoffReviewAdapter
```

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| An `ExecuteMission` use case under `src/application/` contains the full step ordering, each step an application-owned port call | `src/application/execute-mission-service.ts:63`, `:72`, `:77`, `:83`, `:90`, `:165`, `:170`; `src/application/ports/execute-mission.ts:31`, `:91`, `:110`, `:126`, `:141` | PASS |
| `ActivePort` with `validateSlug`/`launch`/`recordLaunch`/`handoff` is gone; replacements are named for workspace, agent execution, lifecycle/store, telemetry, handoff/review | `src/application/ports.ts:22`, `src/application/ports/execute-mission.ts:31`, `:91`, `:110`, `:126`, `:141` | PASS |
| No application module keeps per-slug workflow state in a module- or instance-level `Map` | `src/application/execute-mission-service.ts:32`, `"execute mission use case carries run state per call instead of holding it per slug"`, `"execute workflow: two concurrent slugs each resolve their own worktree and handoff"` | PASS |
| Every execute-path lifecycle change goes through the checked `MissionTransitionStore` / `MissionLifecycleService` boundary | `src/application/execute-mission-service.ts:190`, `src/application/ports/execute-mission.ts:141`, ADR 0051, `"execute mission use case fails closed when the checked Mission authority refuses activation"` | PASS |
| `legacy-active-adapter.ts` deleted; every remaining execute adapter implements exactly one mechanism port and sequences nothing | `src/platform/runtime/lib/adapters/execute-mission-adapters.ts:70`, `:98`, `:161`, `:181`, `:202`; `"each execute mechanism port is a distinct narrow adapter"` | PASS |
| Agent spawn, Git/worktree, Backlog Markdown, and stats writes appear only under `src/platform/runtime/lib/` or `src/adapters/` | `src/platform/runtime/lib/adapters/execute-mission-adapters.ts:1-8`, `"application import guard accepts every file under src/application/"`, `test/application-boundaries.test.ts` | PASS |
| Characterization tests assert identical behavior for all eight scenarios, including `dedicated execute worktree is required`, `execute preflight failed`, `cancelled after durable launch; re-query task state` | `test/execute-mission-characterization.test.ts:91`, `:153`, `:187`, `:203`, `:236`, `:249`, `:269`, `:284` — 17 pass / 0 fail, only the `:15` factory changed between CP-1 and CP-4 | PASS |
| `test/active.test.ts` passes unmodified with no weakened or deleted assertion | `test/active.test.ts`, `"active() success path: preflight, launch, and handoff run in order"`, `"active() exits 1 when handoff fails after successful execute launch"`, `npm test test/active.test.ts` — 79 pass / 0 fail | PASS |
| `test/legacy-active-adapter.test.ts` and `test/application-services.test.ts` replaced with no net loss of asserted behavior | `test/execute-mission-adapters.test.ts`, `"execute mission ports use the injected mission transition store identity"`; `test/execute-mission-service.test.ts`, `"execute mission use case sequences workspace, agent, lifecycle, telemetry, then handoff"` | PASS |
| Composition-root enforcement retargeted rather than removed | `src/platform/runtime/lib/architecture/boundary-guards.ts:136`, `"composition guard rejects complete adapter construction fixture"`, `"composition guard accepts the sole production composition root"` | PASS |
| `px active` text, exit codes, and flag surface unchanged | `src/platform/runtime/lib/commands/active.ts:63` (only the resolved service field changed), `test/active.test.ts`, `"active() exits with agent status when execute agent returns non-zero"` | PASS |
| ADR and docs no longer describe `active` as adapter-owned | `docs/adr/0051-ui-neutral-application-boundary.md:230`, `:154`, `:156`; `src/domain/README.md:257`; ADR 0051 | PASS |
| `./scripts/verify-local.sh static-analysis` passes on the final tree | `./scripts/verify-local.sh static-analysis` — ESLint, tsc typecheck, test-hygiene, test typecheck all PASS | PASS |
| `./scripts/verify-local.sh all` passes on the final tree | `./scripts/verify-local.sh all` — 1666 tests, 1666 pass, 0 fail | PASS |

Next action: hand off for review; if a reviewer asks for a deeper regression
sweep, re-run `npm run test:integration` (which is where
`test/run-default-tests.ts` classifies `test/active.test.ts`).
