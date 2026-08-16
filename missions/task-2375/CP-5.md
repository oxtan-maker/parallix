# CP-5: Round-1 review resolution

## Summary

Round-1 review (Forgejo PR #300) returned REQUEST_CHANGES with four findings. All
are resolved:

**F1 (blocking, SC2) — `px active` operationId was slug-only.**
`src/adapters/cli/commands/active.ts` now builds `active:${slug}:${randomUUID()}`,
matching the review/integrate per-invocation IDs. New
`test/task-2375-active-invocation-overlap.test.ts` drives the **real command
wiring** (real `active()` command + real `ExecuteMissionService` + real
`CurrentWorkRecorder`/read adapter/`reconcileCurrentWork` over a real migrated
SQLite DB) — no hand-written operationIds — and proves both unique per-invocation
IDs and the exact overlap scenario from the finding: the first run's late
`blocked` event cannot clear the second run's standing current work.

**F2 (blocking, SC3) — in-flight shutdown tests did not prove a dispatched
action was in flight, nor the ownership outcome.**
The three SC3 tests in `test/task-2373-shutdown.test.ts` were rewritten: a real
mission fixture (git repo, `mission/task-2375shut` branch, active classified
task, mission dir) plus a stub `claude` whose real launch writes a start marker
with its own PID before blocking. The test asserts the marker exists and the
child PID is alive **before** pressing the key (explicit, bounded synchronization
— no sleeps), then asserts the board PID is gone within 5 s, the terminal is
restored, and the child is reaped within a bounded window with a recorded
terminal-level death signal (SIGHUP/SIGINT) — never a board-sent SIGTERM/SIGKILL.
The ownership rule proved: board dispatch is fire-and-forget; the board holds no
cancel path to the child and must not wait for it. To make that exit real, the
dispatch path now unrefs the launched child and its pipes
(`board-controller` → `ExecuteMissionRequest.detached` → `AgentLaunchRequest.detached`
→ `startAgent`/`spawnAndTee` `unrefChild`); `q`/Ctrl+C exits in ~100 ms with the
action still in flight. The stub traps HUP/INT and points stderr at /dev/null so
dash's "Hangup" job report cannot EPIPE-kill the shell before the trap records
the death signal.

**F3 (minor, SC4) — CP-3 evidence cited the flaky test.**
`CP-3.md` now leads with the deterministic red→green test
("fresh agent availability delivered on cache hit" — distinct `untilMs` values
make the old key red regardless of timing) and labels the repeated-refresh test
as supplementary (its redness depends on three builds landing in distinct
milliseconds).

**F4 (minor, SC7) — CP-4 cited the wrong commit slice.**
`CP-4.md` SC7 now diffs the whole mission against its baseline:
`git diff --stat 4644fc3879738f0e5017b61371ee125a47d1eeaf..HEAD -- src/domain/`
(no output — no new domain files across the entire mission, not just the last
two commits).

**Line-anchor maintenance.** The `unrefChild` additions to
`src/adapters/agents/agents.ts` shifted line numbers cited by
`src/application/consumer-domain-requirements.ts` (six `file:line` anchors);
the anchors were re-pointed at the same code, keeping the
`domain-consumer-requirements` verification green.

**SC2/SC3 checkpoint rows refreshed.** `CP-1.md`, `CP-2.md`, and `CP-4.md`
Goal Check rows now cite the real-wiring `px active` tests and the demonstrably
in-flight SC3 tests; `CP-4.md` Files Changed lists the detach/unref plumbing.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| F1: `px active` operationId unique per invocation | `src/adapters/cli/commands/active.ts` (`active:${slug}:${randomUUID()}`); `test/task-2375-active-invocation-overlap.test.ts`, `"TASK-2375 SC2: the real px active command assigns a unique per-invocation operationId"` — real command wiring, matches `^active:task-9101:<uuid>$` | PASS |
| F1: overlapping real `px active` runs cannot cross-terminate | `test/task-2375-active-invocation-overlap.test.ts`, `"TASK-2375 SC2: two overlapping real px active runs cannot cross-terminate each other"` — A's late `blocked` leaves B standing/WORKING; B clears itself on its own id | PASS |
| F2: SC3 action demonstrably in flight before quit | `test/task-2373-shutdown.test.ts` — start marker (child PID) exists and PID alive asserted before the key; bounded polling waits only, no sleeps | PASS |
| F2: board exits promptly with action in flight | `test/task-2373-shutdown.test.ts`, 3 SC3 tests — board PID gone ≤ 5 s (`SHUTDOWN_BUDGET_MS`) and terminal restored for `q`, Ctrl+C, and 3 in-flight cycles | PASS |
| F2: ownership outcome (no board-sent cancel; child reaped) | Stub HUP/INT signal traps: recorded death signal is SIGHUP or SIGINT (terminal-level), never SIGTERM/SIGKILL; child reaped ≤ 3 s (`REAP_BUDGET_MS`); cycles leave no board or child PID behind | PASS |
| F2: board can exit while child + pipes held | `src/adapters/process/spawn-tee.ts` `unrefChild` (child + stdout/stderr unref'd); board dispatch sets `detached: true` — measured exit ~100 ms with the stub still running | PASS |
| F3: CP-3 SC4 evidence deterministic | `CP-3.md` — primary evidence is "fresh agent availability delivered on cache hit" (timing-independent red→green); refresh test marked supplementary | PASS |
| F4: CP-4 SC7 diff slice covers the whole mission | `CP-4.md` — `git diff --stat 4644fc3879738f0e5017b61371ee125a47d1eeaf..HEAD -- src/domain/` returns no output | PASS |
| Line anchors still verify | `test/domain-consumer-requirements.test.ts` — 11 tests PASS after re-pointing six `agents.ts` anchors | PASS |
| static-analysis gate | `./scripts/verify-local.sh static-analysis` — ALL STAGES PASSED | PASS |
| all gate | `./scripts/verify-local.sh all` — 2315 tests PASS, 0 fail, 89 s < 180 s suite budget | PASS |

## Files Changed

| File | Change |
|---|---|
| `src/adapters/cli/commands/active.ts` | operationId `active:${slug}:${randomUUID()}` (F1); forwards `unrefChild` to the launch |
| `test/task-2375-active-invocation-overlap.test.ts` | New: real `px active` wiring — unique per-invocation operationId + overlap cannot cross-terminate |
| `test/task-2373-shutdown.test.ts` | SC3 rewritten: real mission fixture + stub `claude`, start marker, signal traps, bounded waits, ownership assertions |
| `src/application/controller/board-controller.ts` | Board dispatch sets `detached: true` |
| `src/application/execute-mission-service.ts` | `ExecuteMissionRequest.detached` passed through to the launch |
| `src/application/ports/execute-mission.ts` | `AgentLaunchRequest.detached` field |
| `src/adapters/mission/execute-mission-adapters.ts` | `detached` → `unrefChild` on the selected launch |
| `src/adapters/agents/agents.ts` | `StartAgentOptions.unrefChild` threaded to `spawnAndTee` |
| `src/adapters/process/spawn-tee.ts` | `unrefChild`: unref child + stdout/stderr pipes after spawn |
| `src/application/consumer-domain-requirements.ts` | Six `agents.ts` line anchors re-pointed (same code, shifted lines) |
| `missions/task-2375/CP-3.md` | SC4 evidence: deterministic test primary, refresh test supplementary (F3) |
| `missions/task-2375/CP-4.md` | SC3 rows → in-flight tests; SC7 slice → mission baseline (F4); SC2 rows, summary, Files Changed refreshed |
| `missions/task-2375/CP-1.md`, `CP-2.md` | SC2 rows/summary include the `px active` per-invocation ID + real-wiring tests |

Next action: Round-1 findings resolved; gates green; awaiting round-2 review.
