# CP-4: Shutdown semantics and final integration gates

## Summary

**In-flight shutdown tests added**: `test/task-2373-shutdown.test.ts` proves SC3 against a dispatched action that is **demonstrably in flight**, not merely attempted. A real mission fixture (git repo, `mission/task-2375shut` branch, active classified task, mission dir) plus a stub `claude` on PATH: the stub's `--help` preflight exits 0, and a real launch writes a start marker with its own PID before blocking. The test arms and confirms the dispatch, waits (bounded, polling) until the marker exists and the child PID is alive, and only then presses the key — the in-flight precondition is asserted, never slept for. After the key it asserts, all with bounded waits:
- the board's PID is gone within `SHUTDOWN_BUDGET_MS` (5 s) and the terminal is restored
- the in-flight child is reaped within a bounded window, and its recorded death signal (HUP/INT traps in the stub) is a terminal-level SIGHUP or SIGINT — never a board-sent SIGTERM/SIGKILL

Three tests: `q`, Ctrl+C, and repeated in-flight dispatch-quit cycles leaving no board or child PID behind.

**Child-operation ownership**: The board dispatches actions as async fire-and-forget (`void confirmAction()`), so it holds no cancel path to the child and must not wait for it. The dispatch path now sets the agent child unref'd (`AgentLaunchRequest.detached` → `startAgent`/`spawnAndTee` `unrefChild`), so neither the child process nor its stdout/stderr pipes keep the Node event loop alive. `q`/Ctrl+C exits in tens of milliseconds with the action still in flight; under the PTY harness the child dies with the board's session (the board is session leader there — SIGHUP), while in a user terminal the same detached child simply keeps running. The test asserts the board-side rule (prompt exit, no board-sent cancel), not the child's fate.

**SC7 (no new abstractions)**: No `MissionRun`, `AgentAttempt`, `Attempt`, scheduler, daemon, event bus, or new domain entity introduced. `operationId` remains correlation metadata only.

**SC8 (verification gates)**: Both `./scripts/verify-local.sh static-analysis` and `./scripts/verify-local.sh all` reach terminal PASS.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC1: Operation B survives late op-A events | `test/task-2375-current-work-operation-repro.test.ts`, `"TASK-2375 SC1: the production current-work read keeps operation B standing after late op-A terminal events"` | PASS |
| SC2: Distinct operationId, no cross-termination | `test/task-2375-current-work-operation-repro.test.ts`, `"TASK-2375 SC2: two overlapping same-type invocations on one mission have distinct operationId and cannot cross-terminate"` | PASS |
| SC2: Real px active wiring assigns unique per-invocation operationIds | `test/task-2375-active-invocation-overlap.test.ts`, `"TASK-2375 SC2: the real px active command assigns a unique per-invocation operationId"` | PASS |
| SC2: Overlapping real px active runs cannot cross-terminate | `test/task-2375-active-invocation-overlap.test.ts`, `"TASK-2375 SC2: two overlapping real px active runs cannot cross-terminate each other"` | PASS |
| SC3: q terminates board with action demonstrably in flight | `test/task-2373-shutdown.test.ts`, `"TASK-2375 SC3: q terminates the real board while a dispatched action is demonstrably in flight"` | PASS |
| SC3: Ctrl+C terminates board with action demonstrably in flight | `test/task-2373-shutdown.test.ts`, `"TASK-2375 SC3: Ctrl+C terminates the real board while a dispatched action is demonstrably in flight"` | PASS |
| SC3: Repeated in-flight dispatch-quit cycles clean | `test/task-2373-shutdown.test.ts`, `"TASK-2375 SC3: repeated in-flight dispatch-quit cycles leave no board or child PID behind"` | PASS |
| SC4: Slow metrics cache reuse during AgentBlock | `test/task-2375-metrics-cache-and-liveness.test.ts`, `"TASK-2375 SC4: repeated refreshes during AgentBlock reuse slow metrics cache"` | PASS |
| SC5: Non-Linux liveness ages via TTL | `test/task-2375-metrics-cache-and-liveness.test.ts`, `"TASK-2375 SC5: probeProcessLiveness returns null when identity is null (non-Linux fallback)"` | PASS |
| SC5: Linux identity authoritative | `test/task-2375-metrics-cache-and-liveness.test.ts`, `"TASK-2375 SC5: probeProcessLiveness returns true when identity matches (Linux authoritative)"` | PASS |
| SC6: Nested publication + failover unchanged | `test/task-2375-current-work-operation-repro.test.ts` (nested phases test), `test/domain-agent-selection.test.ts` (9 tests), `test/task-1036-review-fallback.test.ts` (4 tests) | PASS |
| SC7: No new abstractions introduced | `git diff --stat 4644fc3879738f0e5017b61371ee125a47d1eeaf..HEAD -- src/domain/` — no output (no new domain files across the whole mission); `test/task-2375-current-work-operation-repro.test.ts`, `test/task-2375-metrics-cache-and-liveness.test.ts` exercise existing domain model only | PASS |
| SC8: static-analysis gate | `./scripts/verify-local.sh static-analysis` — ALL STAGES PASSED | PASS |
| SC8: all gate | `./scripts/verify-local.sh all` — 2315 tests PASS | PASS |
| Existing idle/modal shutdown tests green | `test/task-2373-shutdown.test.ts` (SC19, SC20, SC22, SC26, defect 6) — all PASS | PASS |
| TASK-2373.01 wording aligned | `test/task-2375-metrics-cache-and-liveness.test.ts` — SC5 tests verify `unverified` fallback matches TASK-2373.01 AC #4 (no wording change needed) | PASS |

## Files Changed

| File | Change |
|---|---|
| `src/adapters/backlog/concrete-current-work-read-adapter.ts` | Bounded read → all events (`findByType`) |
| `src/application/review-command-use-case.ts` | operationId: `review:${slug}:${randomUUID()}` |
| `src/application/integrate-command-use-case.ts` | operationId: `integrate:${slug}:${randomUUID()}` |
| `src/application/projections/board-readers.ts` | Cache key excludes volatile `agentAvailability` |
| `src/adapters/process/process-liveness.ts` | `identity === null` → `null` (unverifiable) |
| `test/task-2375-current-work-operation-repro.test.ts` | Added SC2 overlap + nested phase tests |
| `test/task-2375-metrics-cache-and-liveness.test.ts` | New: SC4 cache + SC5 liveness tests |
| `test/task-2373-shutdown.test.ts` | Added SC3 in-flight shutdown tests (real mission fixture + stub `claude`, start marker, signal traps, bounded waits) |
| `test/task-2375-active-invocation-overlap.test.ts` | New: real `px active` wiring — unique per-invocation operationId + overlap cannot cross-terminate |
| `src/adapters/cli/commands/active.ts` | operationId: `active:${slug}:${randomUUID()}`; forwards `unrefChild` to `selectLaunchAndRecord` |
| `src/application/controller/board-controller.ts` | Board dispatch sets `detached: true` on the execute request |
| `src/application/execute-mission-service.ts` | `ExecuteMissionRequest.detached` passed through to `AgentLaunchRequest` |
| `src/application/ports/execute-mission.ts` | `AgentLaunchRequest.detached` field |
| `src/adapters/mission/execute-mission-adapters.ts` | `detached` → `unrefChild` on the selected launch |
| `src/adapters/agents/agents.ts` | `StartAgentOptions.unrefChild` threaded to `spawnAndTee` |
| `src/adapters/process/spawn-tee.ts` | `unrefChild`: unref child + stdout/stderr pipes after spawn |
| `test/task-2373-liveness.test.ts` | SC13 updated for null-return semantics |
| `test/task-2373-repro.test.ts` | Defect 5 updated for unbounded reads |

Next action: All checkpoints complete, both gates PASS. Mission ready for handoff.
