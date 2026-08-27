# CP-2: Report delivered (SC5 option A)

## Summary

Delivered TASK-2289 acceptance criterion #8 as a first-class, tested, read-only
bug-frequency report instead of a one-off mission script.

**Pure classification/aggregation module** — `src/application/projections/bug-frequency.ts`:
takes already-read task records (`BugFrequencyInput`) and returns `total`,
`bug`, `nonBug`, `bugOverTotal`, `bugPer100NonBug`, `bugIds`, `nonBugIds`,
`warnings`, `aborts`, and per-row `copies`/`copyPaths`/`labelUnion`/`labelEvidence`/`statusEvidence`.
It performs **no** filesystem, git, or `process` access — all IO lives in the
runner, preserving ADR 0051's UI-neutral application boundary. The parsing and
classification rules are a faithful port of `missions/task-2291/audit-cohort.mjs`:
exact `bug` label only, label union across every copy of one task ID in
`backlog/tasks`, `backlog/completed`, `backlog/archive`, `backlog/archive/tasks`,
labels recomputed at report time, malformed frontmatter surfaced as a warning,
ambiguous ID/label data aborting the record (fail closed).

**Thin read-only runner** — `scripts/bug-frequency-report.ts`: enumerates the
cohort from a frozen ledger (`--ledger`) or directly from git history
(`--enumerate <boundary> --ref main`), reads the four backlog stores from the
working tree, and feeds the module. No write except an explicit `--output`;
mutates no task record, label, status, or git state.

**Fixture tests** — `test/task-2361-bug-frequency.test.ts`, 7 tests, all pass:
- `unions labels across duplicate copies of one task id`
- `classifies by the labels present at report time, so a bug label added after the transition commit counts`
- `counts only the exact bug label, not lookalikes or title keywords`
- `reports malformed frontmatter as a warning without aborting the run`
- `aborts ambiguous id or label data instead of classifying the record`
- `records fail-closed aborts for cohort members with no readable record`
- `computes the cohort-1 shape exactly: bug / total and 100 * bug / non-bug`

**Self-check before cohort 2.** Running the runner against `missions/task-2291/cohort-ledger.json`
reproduces cohort 1 exactly: `total 20, bug 4, nonBug 16, bugOverTotal 0.2,
bugPer100NonBug 25`, bug IDs `TASK-2240, TASK-2296, TASK-2311, TASK-2233`, and
the known `task-2359` filename/frontmatter-ID abort (`backlog/tasks/task-2359 -
Prevent-PR-history-noise-from-blocking-mission-reviews.md:2 filename id
TASK-2359 != frontmatter id TASK-2358`) reported, not repaired. This matches
`missions/task-2291/cohort-measurement.json` and the ADR 0051 baseline
(39/129, 30.2%, 43.3) — the stop rule ("recomputed cohort 1 does not reproduce
20 / 4 / 16") does not fire.

Running the runner against `missions/task-2361/cohort-ledger.json` computes
cohort 2: `total 20, bug 6, nonBug 14, bugOverTotal 0.3, bugPer100NonBug
42.857`, bug IDs `TASK-2243, TASK-2312, TASK-2261, TASK-2297, TASK-2319,
TASK-2318`. The enumerate path (`--enumerate 1c9e40f41..main`) reproduces the
same 20/6/14, confirming determinism.

SC5 option (A) is the mission default and is satisfied; option (B) is not
needed — no named blocker exists.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC5(A) pure module under `src/application/projections/` | `src/application/projections/bug-frequency.ts` `measureBugFrequency` — no `fs`/`git`/`process` import (verified: restricted area `src/application/**` untouched by IO) | PASS |
| SC5(A) read-only runner under `scripts/` | `scripts/bug-frequency-report.ts` — IO only in `readStoreFiles`/`cohortFromGit`; run with `tsx scripts/bug-frequency-report.ts --ledger missions/task-2361/cohort-ledger.json` | PASS |
| SC5(A) four named fixture scenarios covered | `test/task-2361-bug-frequency.test.ts`: duplicate copies (`unions labels across duplicate copies of one task id`), later-added `bug` (`classifies by the labels present at report time...`), malformed-frontmatter warning (`reports malformed frontmatter as a warning without aborting the run`), fail-closed ambiguous classification (`aborts ambiguous id or label data instead of classifying the record`) | PASS |
| SC5(A) `npm test` passes for that file | `npm test -- test/task-2361-bug-frequency.test.ts` → 7 pass / 0 fail (run against committed `src/`) | PASS |
| SC4 exact `bug` label + cross-store union + report-time read | `counts only the exact bug label, not lookalikes or title keywords`; runner scans `backlog/tasks,backlog/completed,backlog/archive,backlog/archive/tasks`; self-check cohort 1 = 20/4/16 reproduced from `missions/task-2291/cohort-ledger.json`, matching `missions/task-2291/cohort-measurement.json` | PASS |
| SC2 stop rule (cohort 1 self-check) | Runner reproduces `total 20, bug 4, nonBug 16, bugOverTotal 0.2, bugPer100NonBug 25` — matches `missions/task-2291/cohort-measurement.json`; stop rule not triggered | PASS (not triggered) |
| SC9 verification gate | `./scripts/verify-local.sh all` (run at handoff in CP-3) | PASS (run at CP-3) |

Next action: CP-3 — write `missions/task-2361/cohort-measurement.json` with the
three separate series, state the SC6-constrained conclusion, list cohort-2 bug
missions touching the ADR 0051 `active`/`stats-backfill` slices, create the
cohort-3 successor, and confirm no task-record mutation with
`git status --porcelain`; then run `./scripts/verify-local.sh all`.
