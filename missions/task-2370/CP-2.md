# CP-2: Authoritative mission-scoped current work and its publication lifecycle

## Summary

### Authority trace (done before implementation)

Each board-relevant fact keeps exactly one owner. The allocation is recorded in
code and asserted by tests, not left as prose:

| Fact | Authority | Where |
|---|---|---|
| Mission lifecycle / lane | `Mission` rows via `MissionStore` | ADR 0053; unchanged |
| Review state, rounds, phase | `Review` nested in `Mission` | ADR 0053; unchanged |
| Agent family availability | `AgentBlock` (`agent_blocklist`) | `src/application/services/agent-block-service.ts`; unchanged |
| Operation progress for the log | `ProgressPort` events | `src/application/ports.ts`; unchanged |
| Agent/session resume metadata | `SessionMarker` | ADR 0053; unchanged |
| Gate state | `GateReadAdapter` | `src/application/projections/board-readers.ts`; unchanged |
| **Which mission is being worked on now** | **current-work events on the existing operational-history authority** | `src/application/recording/current-work-recorder.ts` (new) |
| Process liveness | observed, never stored | `src/adapters/process/process-liveness.ts` (new), reconciliation only |

No new table, no new domain entity, and no per-launch identity: the mission is
the key, `operationId` is a correlation string, and the newest event for a
mission supersedes every older one. ADR 0053 already makes
`operational_history` authoritative for the event history itself and never for
current Mission state, which is exactly how the reader treats it.

### Implementation

- **Write side** — `src/application/recording/current-work-recorder.ts`:
  `CurrentWorkEvent` (mission, operation, phase, `running`/`ended`/`blocked`,
  summary, family, publishing process id, blocked reason), its
  `operational_history` serialization, a tolerant parser, the `CurrentWorkPort`
  interface commands depend on, `CurrentWorkRecorder`, the throw-free
  `currentWorkPublication` builder, and `NO_CURRENT_WORK_PORT` for when
  operator-local state is unavailable.
- **Read side** — `src/application/projections/current-work.ts`:
  `CurrentWorkReadAdapter` plus `reconcileCurrentWork`, which reduces events to
  one fact per mission and grades a surviving `running` fact `live` /
  `unverified` / `stale`. A process observed *dead* clears the fact (known
  stopped); an unobservable one stays `unverified` until it ages past
  `CURRENT_WORK_TTL_MS`. Reconciliation detail is exercised in CP-3.
- **Board consumption** — `BoardProjectionBuilder` reconciles current work once
  per build and feeds `MissionOperationalFacts.currentWork` /
  `blockingReason`; the hard-coded `currentWork: null` is gone.
  `agentIsWorking` now reads the published fact first and falls back to the
  OS-process scan only for missions that recorded no fact at all.
- **Publication at real operation boundaries** —
  `ExecuteMissionService` publishes `execute` at launch, republishes on every
  automatic family handoff through the new `AgentLaunchRequest.onAgentChanged`
  seam (wired to `selectLaunchAndRecord`'s existing `onLaunch` hook),
  publishes `handoff` before handoff/review, clears on completion or
  cancellation, and publishes `blocked` with the failure reason when the run
  cannot finish. `ReviewCommandUseCase` brackets `--start`/`--continue`/
  `--submit`/`--submit-review` with the `review` phase and
  `--consume-artifacts` with `review-response`. `IntegrateCommandUseCase`
  brackets the run with `integrate`. Short read operations publish nothing.
- **Composition** — one `CurrentWorkRecorder` per process in
  `createProductionApplicationServices`, handed to the execute service, the
  review use case, and the integrate use case; the board reads the same rows
  through `ConcreteCurrentWorkReadAdapter`.

Publication is best-effort in both directions: a recorder outage cannot fail a
command, and a failing command still clears its current work in a `finally`.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC2: one mission-scoped `currentWork` with operation/phase, summary, family, freshness | `src/application/projections/current-work.ts`, `src/application/projections/mission-board.ts` (`LiveMissionWork`), `"TASK-2370 repro A: a live operation is projected as current work on the board card"` | PASS |
| SC2: `BoardProjectionBuilder` consumes the fact instead of `currentWork: null` | `src/application/projections/board-readers.ts`, `npx tsx --test test/task-2370-repro.test.ts` (repro A and B now pass) | PASS |
| SC2: process scan demoted to recovery | `agentIsWorking` in `src/application/projections/mission-board.ts` consults `liveSession` only when `currentWork` is absent; `"TASK-2370 repro B: a live review phase is not misidentified as needing a human when the process scan sees nothing"` | PASS |
| SC3: publication covers active execution and handoff | `test/current-work-publication.test.ts`, `"an execute run publishes execute work, then handoff work, then clears it"` | PASS |
| SC3: publication covers review and the review response | `test/current-work-publication.test.ts`, `"px review --start brackets the review loop with review-phase current work"`, `"px review --consume-artifacts publishes the review-response phase"` | PASS |
| SC3: publication covers integration | `test/current-work-publication.test.ts`, `"px integrate brackets the run with integrate-phase current work"` | PASS |
| SC4: automatic family handoff stays one mission's work with an updated family | `test/current-work-publication.test.ts`, `"an automatic family handoff updates the same mission current work and creates no second identity"` | PASS |
| SC4/SC5: exhaustion publishes a truthful blocked fact rather than silence | `test/current-work-publication.test.ts`, `"an execute run that cannot finish publishes blocked work carrying the reason"` | PASS |
| Authorities stay distinct — no lifecycle, session-marker, or blocklist write from publication | `test/current-work-publication.test.ts`, `"publishing current work writes only operational history and touches no other authority"` (the mission-transition port throws on any call) | PASS |
| No durable run/attempt entity introduced | `npx tsx --test test/domain-attempt-guard.test.ts`; ADR 0053 (`Attempt` excluded); current work is keyed by mission with no per-launch row | PASS |
| Publication cannot break a command | `test/current-work-publication.test.ts`, `"a recorder outage never turns a completed execute run into a failure"`, `"a failing review operation still clears its current work"` | PASS |
| Existing board and projection suites still pass | `npx tsx --test test/board-projections.test.ts test/board-readers.test.ts test/domain-projections.test.ts test/tui-shell-component.test.ts` → 54 pass / 0 fail | PASS |
| Lint and typecheck clean on changed files | `npx eslint src/`, `npx tsc --noEmit` (only the five pre-existing `src/adapters/cli/commands/stats.ts` baseline errors remain, unchanged from the parent commit) | PASS |

Next action: begin CP-3 — cover reconciliation (failover versus exhaustion,
unverified observation, stale work after abnormal termination), scope the
attention policy and source warnings in shared projection code, and add
reactive invalidation/re-query behind the application boundary while keeping
piped `px board` a finite one-shot render.
