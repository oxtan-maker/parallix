# CP-3: Slice findings, non-causation limit, and successor ownership

## Summary

**Slice definition.** The "extracted slices" are the two command paths ADR 0051
delegated through the application boundary in TASK-2290:
`src/adapters/cli/commands/stats-backfill.ts:428`,
`src/adapters/cli/commands/active.ts:787`,
`src/application/stats-backfill-service.ts:13`,
`src/adapters/mission/stats-backfill-adapter.ts`, `src/interfaces/cli/active.ts`,
their pre-ESM `lib/commands/`, `lib/application/`, and
`lib/adapters/legacy-*-adapter.ts` predecessors, and the tests
`test/stats-backfill.test.ts:27` and `test/active.test.ts:35`. Membership was
computed by matching every file in each cohort member's transition commit
against `stats-backfill|active-service|legacy-active|/active\.(ts|js)$|/active\.test\.ts$`.

**Finding: zero completed bug missions in this cohort touch either slice.**

| Cohort bug mission | Slice files touched | Files actually changed |
|---|---|---|
| TASK-2240 (`8463c6540`) | none | `src/platform/runtime/lib/review/review-loop.ts`, `test/forgejo-pr-round-sync.test.js` |
| TASK-2296 (`59b4b9329`) | none | `test/px-shell-init.test.ts`, `test/task-1107-repro.test.ts` |
| TASK-2311 (`93afd6641`) | none | `src/platform/runtime/lib/agents/pi.ts`, `test/pi-runner.test.ts`, `test/task-2311-console-empty-repro.test.ts` |
| TASK-2233 (`1c9e40f41`) | none | `src/platform/runtime/lib/commands/repair-handoff.ts`, `src/platform/runtime/lib/review/review-loop.ts`, `test/repair-handoff.test.ts` |

Reproduce per mission with `git show --pretty=format: --name-only <commit>`.

For completeness — and so the empty result is not mistaken for a broken
matcher — four cohort members **do** touch the slices, and all four are
non-bug:

| Cohort member (non-bug) | Slice files touched |
|---|---|
| TASK-2293 (`502d19b9e`) | `test/active.test.ts`, `test/stats-backfill.test.ts` |
| TASK-2279 (`eafdc4d65`) | `lib/commands/active.ts`, `lib/commands/stats-backfill.ts`, `lib/application/active-service.ts`, `lib/application/stats-backfill-service.ts`, `lib/adapters/legacy-active-adapter.ts`, `lib/adapters/legacy-stats-backfill-adapter.ts` (under the `src/platform/runtime/` ESM path) |
| TASK-2295 (`e5d9036bc`) | `lib/commands/active.ts`, `lib/commands/stats-backfill.ts`, `lib/adapters/legacy-active-adapter.ts` |
| TASK-2303 (`0dcb2c566`) | `lib/commands/active.ts`, `lib/adapters/legacy-active-adapter.ts`, `test/active.test.ts` |

The bug set `{TASK-2240, TASK-2296, TASK-2311, TASK-2233}` and the slice-touching
set `{TASK-2293, TASK-2279, TASK-2295, TASK-2303}` are disjoint.

**Non-causation limitation.** The aggregate 4 / 20 = 20.0% is not evidence that
the ADR 0051 boundary caused fewer bugs. Nothing here isolates the boundary as a
cause: the four bug missions landed in `review-loop.ts`, `agents/pi.ts`, and
`repair-handoff.ts` — code the boundary never touched — so the aggregate is
dominated by work outside the extracted slices. Zero slice-related bugs at n = 4
bugs is also consistent with no effect: the slices are two of many command paths
in the cohort's change surface, and an expected count near zero cannot
distinguish a real reduction from ordinary variation. This remains an early
signal in the ADR 0051 sense, not a durable trend, and no speed or throughput
figure is offered to strengthen or offset it.

**Successor ownership.** No integrated automated recurring bug-frequency report
exists to own ADR 0051's requirement — `grep -rl "bug-frequency" --exclude-dir=node_modules --exclude-dir=.git .`
and `git log --all -S"bug-frequency"` return only ADR, task, and mission prose,
and TASK-2289's acceptance criterion #8 at
`backlog/completed/task-2289 - Extract-UI-neutral-application-contracts-and-composition.md:60`
was never implemented (CP-2). The successor is therefore created as a task
record:

`backlog/tasks/task-2361 - Measure-the-second-post-boundary-20-completed-mission-cohort.md:2`
(`id: TASK-2361`, `dependencies: [TASK-2291]`), which fixes cohort 2's start at
TASK-2233's transition commit `1c9e40f41`, reuses the frozen tie-breaker from
`missions/task-2291/cohort-ledger.json`, carries cohort 1's 20 / 4 / 16 result
and the unchanged ADR 0051 baseline forward as comparison inputs, and requires
either implementing the missing TASK-2289 report or recording a decision to keep
the measurement script-based. TASK-2361 was created with the next free ID above
`main`'s current maximum (TASK-2360); it is a new record, and no existing task's
status, assignee, labels, or lifecycle metadata was modified —
`backlog/tasks/task-2291 - Measure-post-boundary-bug-frequency-cohort.md:4`
still reads `status: refined`.

**Gate.** `./scripts/verify-local.sh all` exits 0 with `ℹ fail 0` (2014 tests,
67 suites, 1 skipped). The `[FAIL] [coverage-gate] failed to spawn test runner:
ENOENT` lines in the log are asserted fixture output from the coverage-gate
negative-path tests, immediately followed by `✔ coverage-gate dry-run exits 0
and lists files`, not a gate failure.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Completed bug missions touching `stats-backfill` or `active` are listed separately with task and file evidence | Zero of the four bug members match the slice set; per-mission file lists reproducible via `git show --pretty=format: --name-only 8463c6540` (TASK-2240), `59b4b9329` (TASK-2296), `93afd6641` (TASK-2311), `1c9e40f41` (TASK-2233); slice anchors `src/adapters/cli/commands/stats-backfill.ts:428`, `src/adapters/cli/commands/active.ts:787`, `src/application/stats-backfill-service.ts:13`, `test/stats-backfill.test.ts:27`, `test/active.test.ts:35` | PASS |
| The aggregate ratio is not presented as proof of architectural causation | "Non-causation limitation" paragraph above; the four bug missions land in `src/platform/runtime/lib/review/review-loop.ts`, `src/platform/runtime/lib/agents/pi.ts`, `src/platform/runtime/lib/commands/repair-handoff.ts` — outside the ADR 0051 slices | PASS |
| A lower rate is an early signal, not a durable trend; no speed/throughput qualification | Stated in this document and in `missions/task-2291/CP-2.md`; ADR 0051's two-cohort requirement at `docs/adr/0051-ui-neutral-application-boundary.md:525` | PASS |
| Cohort membership, cutoff, and arithmetic remain reproducible from committed evidence | `missions/task-2291/cohort-ledger.json` (cutoff `8aa9af505`, 20 IDs, tie-breaker), `missions/task-2291/cohort-measurement.json` (20 / 4 / 16, 20.0%, 25.0), rerunnable with `node missions/task-2291/audit-cohort.mjs` | PASS |
| Before handoff, the next 20-completed-mission cohort measurement is created or linked | `backlog/tasks/task-2361 - Measure-the-second-post-boundary-20-completed-mission-cohort.md:2`; no recurring automated report exists (`git log --all -S"bug-frequency"` returns only prose; unmet criterion at `backlog/completed/task-2289 - Extract-UI-neutral-application-contracts-and-composition.md:60`) | PASS |
| No repository authority or task classification mutated by measurement | `backlog/tasks/task-2291 - Measure-post-boundary-bug-frequency-cohort.md:4` still `status: refined`; all other writes are new files under `missions/task-2291/` plus the new TASK-2361 record; no `px active`, `px review`, `px integrate`, agent, Forgejo, or network call was made | PASS |
| Mission gate passes | `./scripts/verify-local.sh all` exit code 0, `ℹ fail 0`, 2014 tests / 67 suites; documentation phase `PASS: authored documentation contains no volatile implementation evidence and relative links resolve` | PASS |

Next action: hand off task-2291 for review with `missions/task-2291/CP-1.md`,
`CP-2.md`, and `CP-3.md` committed, and let TASK-2361 own the cohort-2
measurement once 20 further missions durably enter `backlog/completed/` after
TASK-2233's transition commit `1c9e40f41`.
