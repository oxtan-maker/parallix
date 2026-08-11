# CP-2: Execute and audit the read-only measurement

## Summary

**The TASK-2289 report does not exist.** TASK-2289's acceptance criterion #8
(`backlog/completed/task-2289 - Extract-UI-neutral-application-contracts-and-composition.md:60`)
required a reproducible read-only bug-frequency report, but TASK-2289's mission
scope never covered it (`missions/task-2289/MISSION.md` contains no occurrence
of "bug"), and no implementation exists in any revision:

```
grep -rl "bug-frequency" --exclude-dir=node_modules --exclude-dir=.git .
git log --all --oneline -S"bug-frequency"
```

Both return only ADR, task, and mission prose — never a source or test file.
`src/adapters/cli/commands/cohort-report.ts:16` is TASK-2347's cycle-time
cohort table and carries no bug-label column. Building the report is explicitly
out of scope for this mission ("Changing application-boundary production code,
reporting implementation, or task classification logic"), so this checkpoint
does not create one; the gap is disclosed here and given a successor owner in
CP-3.

Because there is no report to disagree with, the mission's "report vs audit
disagreement" stop rule cannot fire on a single computation. The measurement was
therefore performed by **two independent read-only recomputations** of the same
quantity, which agree exactly:

1. `node missions/task-2291/audit-cohort.mjs` — frontmatter parser over
   `backlog/tasks`, `backlog/completed`, `backlog/archive`,
   `backlog/archive/tasks`, unioning labels across every copy of a task ID.
2. An independent `awk` pass over the 20 cohort files handling both the block
   (`labels:` + `  - bug`) and inline (`labels: [ai_sdlc, bug]`) frontmatter
   forms.

Pass 1 and pass 2 return the identical bug set `{TASK-2240, TASK-2296,
TASK-2311, TASK-2233}`. An earlier `awk` formulation that handled only the block
form returned 2 and was rejected as an incomplete parser, not as a disagreement
about the data — TASK-2311 and TASK-2233 carry inline labels
(`backlog/completed/task-2311 - after-pi-tech-change-console-is-empty.md:7`,
`backlog/completed/task-2233 - check-the-bounce-on-review-errors.md:7`).

**Classification rules applied.** Only the exact `bug` label counts; no title
keyword is consulted. Labels are recomputed at report time from the working tree
(so a label added after completion is still seen), unioned across every copy of
a task ID in every backlog store. Zero cohort IDs have more than one copy, so
the union is an identity here and is recorded as such rather than assumed.
All 20 cohort records carry `status: done` in `backlog/completed/`.

**Aggregate result (cohort frozen in CP-1, cutoff `8aa9af505`,
2026-07-21T14:26:24+02:00).**

| Quantity | Value |
|---|---|
| Completed total | 20 |
| Bug | 4 |
| Non-bug | 16 |
| `bug / total` | 4 / 20 = 0.200 (20.0%) |
| `100 * bug / non-bug` | 100 × 4 / 16 = 25.0 |

Bug members: TASK-2240, TASK-2296, TASK-2311, TASK-2233.
Non-bug members: TASK-2293, TASK-2279, TASK-2298, TASK-2299, TASK-2294,
TASK-2242, TASK-2300, TASK-2244, TASK-2295, TASK-2281, TASK-2238, TASK-2302,
TASK-2310, TASK-2303, TASK-2282, TASK-2304.

**ADR 0051 baseline comparison (compared separately, never blended).**

| Measure | This cohort | ADR 0051 baseline | Difference |
|---|---|---|---|
| `bug / total` | 4 / 20 = 20.0% | 39 / 129 = 30.2% | −10.2 percentage points |
| `100 * bug / non-bug` | 100 × 4 / 16 = 25.0 | 100 × 39 / 90 = 43.3 | −18.3 |

Baseline row source: `docs/adr/0051-ui-neutral-application-boundary.md:79`. The
baseline is quoted unchanged; the cohort size, denominator, label rule, and
observation start were not adjusted to obtain this result.

**Calibrated reading.** The measured 20.0% is *lower* than the 30.2% baseline.
That is an early signal only. One 20-mission cohort is not a durable trend: at
n = 20 a single reclassified mission moves `bug / total` by 5 percentage points,
and no second post-boundary cohort exists yet to corroborate the direction. No
speed, throughput, or elapsed-time figure is offered here, and none would be
offered to offset the result had it been equal or higher.

**Task mix (label frequency across the 20 members).** `user_value` 12,
`ai_sdlc` 8, `bug` 4, `application` 3, `architecture` 3, `board` 3, `ink` 2,
`observability` 2, `persistence` 2, `react` 2, `tui` 2, `typescript` 2, `ui` 2,
and one each of `adapters`, `adr`, `build`, `domain-model`, `esm`, `migration`,
`tech-debt`, `tests`. Per-member labels are in
`missions/task-2291/cohort-measurement.json`.

**Malformed records.** Zero warnings and zero aborts inside the cohort. One
out-of-cohort defect is disclosed rather than silently dropped:
`backlog/tasks/task-2359 - Prevent-PR-history-noise-from-blocking-mission-reviews.md:2`
declares `id: TASK-2358`, colliding with
`backlog/tasks/task-2358 - Board-review-projection-discards-all-prior-review-rounds.md:2`.
Both are `status: backlog`, neither is in `backlog/completed/`, and neither is a
cohort member, so no cohort classification depends on it. It was not repaired —
editing task records is a restricted area for this mission.

No task label, status, or workflow record was mutated; the only writes are under
`missions/task-2291/`.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Bug classification uses only the exact `bug` label | `missions/task-2291/audit-cohort.mjs` matches `union.has('bug')` with no title heuristic; bug-label lines at `backlog/completed/task-2240 - when-forgejo-is-activated-PR-is-not-updated-between-rounds.md:10`, `backlog/completed/task-2296 - test-failure.md:9`, `backlog/completed/task-2311 - after-pi-tech-change-console-is-empty.md:7`, `backlog/completed/task-2233 - check-the-bounce-on-review-errors.md:7` | PASS |
| Labels are unioned across duplicate task-file copies and recomputed at report time | `node missions/task-2291/audit-cohort.mjs` scans `backlog/tasks`, `backlog/completed`, `backlog/archive`, `backlog/archive/tasks` and reports `multi-copy ids []` (every cohort ID has exactly one copy); labels are read from the tree at run time, not from the CP-1 ledger | PASS |
| Warns for each unambiguous malformed record; aborts on ambiguous classification | `node missions/task-2291/audit-cohort.mjs` reports 0 in-cohort warnings/aborts and surfaces the out-of-cohort id collision at `backlog/tasks/task-2359 - Prevent-PR-history-noise-from-blocking-mission-reviews.md:2` vs `backlog/tasks/task-2358 - Board-review-projection-discards-all-prior-review-rounds.md:2` | PASS |
| Open/backlog/refined/active/review missions excluded from both sides | All 20 members read `status: done` from `backlog/completed/`, e.g. `backlog/completed/task-2293 - Harden-legacy-TypeScript-test-mock-shapes.md:4` and `backlog/completed/task-2233 - check-the-bounce-on-review-errors.md:4`; `backlog/tasks/` records such as `backlog/tasks/task-2291 - Measure-post-boundary-bug-frequency-cohort.md:4` are never admitted | PASS |
| Report states exact bug, non-bug, total, `bug / total`, `100 * bug / non-bug`, reproducible from the listed IDs | 20 / 4 / 16, 4 ÷ 20 = 20.0%, 100 × 4 ÷ 16 = 25.0; recomputable by `node missions/task-2291/audit-cohort.mjs` against `missions/task-2291/cohort-ledger.json`; per-member rows in `missions/task-2291/cohort-measurement.json` | PASS |
| Each value compared separately with ADR 0051's 39 / 129 (30.2%) baseline | Baseline row quoted unchanged from `docs/adr/0051-ui-neutral-application-boundary.md:79`; comparison table above reports −10.2 pp on `bug / total` and −18.3 on `100 * bug / non-bug` as two separate rows, with no blended figure — see ADR 0051 | PASS |
| A lower rate is stated as an early signal, not a durable trend | "Calibrated reading" paragraph above; ADR 0051 requirement at `docs/adr/0051-ui-neutral-application-boundary.md:525` (two cohorts needed before a trend claim) | PASS |
| TASK-2289 report availability | No implementation exists: `grep -rl "bug-frequency" --exclude-dir=node_modules --exclude-dir=.git .` and `git log --all -S"bug-frequency"` hit only prose; unmet criterion recorded at `backlog/completed/task-2289 - Extract-UI-neutral-application-contracts-and-composition.md:60`; substituted by two independent recomputations that agree | DISCLOSED GAP |
| No repository authority or classification mutated by measurement | Writes confined to `missions/task-2291/audit-cohort.mjs` and `missions/task-2291/cohort-measurement.json`; `backlog/tasks/task-2291 - Measure-post-boundary-bug-frequency-cohort.md:4` still reads `status: refined`; no `px`, agent, network, or Forgejo call was made | PASS |

Next action: identify which of TASK-2240, TASK-2296, TASK-2311, TASK-2233 touch
the extracted `stats-backfill` or `active` slices using per-mission commit file
evidence, state the non-causation limitation, and create or link the successor
20-completed-mission cohort measurement (plus an owner for TASK-2289's missing
report) in CP-3.
