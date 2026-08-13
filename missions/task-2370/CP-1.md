# CP-1: Red-first reproduction of the board liveness defects

## Summary

Added `test/task-2370-repro.test.ts`, a hermetic red-first reproduction of the
three defects this mission fixes. The file launches no agent, opens no
database, runs no Git command, and performs no process scan: the mission,
review, gate, agent, Git, operation-log, and current-work authorities are all
in-memory fakes, and the interactive board is driven through Ink's `render`
with fake TTY streams.

The three tests map one-to-one onto the checkpoint's required reproductions:

- **A — `"TASK-2370 repro A: a live operation is projected as current work on the board card"`.**
  `BoardProjectionBuilder` is handed a current-work authority reporting a live
  `execute` operation on `task-0001` run by `claude`. The test asserts the
  projected `MissionCard.currentWork` carries that operation's phase, summary,
  and agent family. Today `src/application/projections/board-readers.ts`
  hard-codes `currentWork: null`, so nothing reaches the card.

- **B — `"TASK-2370 repro B: a live review phase is not misidentified as needing a human when the process scan sees nothing"`.**
  The mission is in the `review` lane with a live `review` operation run by
  `qwen`, while the OS-process scan (`loadRunningSessions`) attributes no
  session to the mission — the real behavior for `px review`, which the scan
  cannot attribute. The test asserts the authoritative family wins over process
  inference and that the mission's attention reason is `none` (WORKING) rather
  than `review-lane` (NEEDS YOU).

- **C — `"TASK-2370 repro C: an already-open interactive board rebuilds after an external board-relevant change"`.**
  An open `BoardShell` is given a `subscribeProjection` seam standing in for
  another `px` process changing shared state. The test asserts the shell
  subscribes while open and re-renders the externally changed mission
  (`task-after`) without a restart. Today the shell renders one static
  projection prop and never subscribes.

Parent commit for this mission: `6e647f7b4`. The red run below was taken on
that tree with only the new test file added.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC1: red-first reproduction test exists at the mission-declared path | `test/task-2370-repro.test.ts` (declared as `Reproduction-Test` in `missions/task-2370/MISSION.md`) | PASS |
| SC1(a): a live operation yields absent board `currentWork` at the parent commit | `npx tsx --test test/task-2370-repro.test.ts` → `"TASK-2370 repro A: a live operation is projected as current work on the board card"` fails with `AssertionError: a live operation must project current work rather than null` (`actual: null`) | PASS (red as required) |
| SC1(b): a live non-active phase is misidentified by process-derived liveness at the parent commit | `npx tsx --test test/task-2370-repro.test.ts` → `"TASK-2370 repro B: a live review phase is not misidentified as needing a human when the process scan sees nothing"` fails with `AssertionError: a live review operation must project current work` | PASS (red as required) |
| SC1(c): an open interactive board does not observe an external change at the parent commit | `npx tsx --test test/task-2370-repro.test.ts` → `"TASK-2370 repro C: an already-open interactive board rebuilds after an external board-relevant change"` fails with `AssertionError: the shell must subscribe to shared projection changes while it is open` | PASS (red as required) |
| Red run totals recorded | `npx tsx --test test/task-2370-repro.test.ts` reports `pass 0` / `fail 3` on parent commit `6e647f7b4` | PASS |
| Test is hermetic and admitted to the default fast suite | `test/task-2370-repro.test.ts` contains no process-spawn, Git, network, or SQLite boundary marker scanned by `test/lib/test-run-plan.ts`, so it is discovered by `npm test` rather than the integration list | PASS |
| Test file passes lint | `npx eslint test/task-2370-repro.test.ts` reports no findings | PASS |
| SC1 green result | Recorded in this document after the implementation lands (CP-2 through CP-4) | PENDING |

Next action: begin CP-2 — trace the existing authority path and implement the
mission-scoped current-work model and its publication lifecycle behind an
application port backed by the existing operational-fact store, keeping
`Mission` lifecycle, `AgentBlock`, progress, session metadata, gate state, and
process reconciliation as distinct authorities.
