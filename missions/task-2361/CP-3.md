# CP-3: Publish, conclude, hand off

## Summary

Published ADR 0051's second post-integration completed-mission bug-frequency
measurement (cohort 2) and gave the repeated measurement a reproducible,
read-only home.

**Three separately compared series** — `missions/task-2361/cohort-measurement.json`
holds `baseline`, `cohort_1`, and `cohort_2` as sibling objects that are not
summed, averaged, or pooled:

| Series | total | bug | nonBug | bug / total | 100 · bug / non-bug | Source |
|---|---|---|---|---|---|---|
| ADR 0051 baseline | 129 | 39 | 90 | 0.3023 (30.2%) | 43.33 | `docs/adr/0051-ui-neutral-application-boundary.md:63` |
| Cohort 1 (TASK-2291) | 20 | 4 | 16 | 0.2 (20.0%) | 25.0 | `missions/task-2291/cohort-measurement.json` |
| Cohort 2 (this mission) | 20 | 6 | 14 | 0.3 (30.0%) | 42.86 | `missions/task-2361/cohort-measurement.json` (read time `2026-08-27T04:55:57Z`) |

Cohort 2 bug IDs: `TASK-2243, TASK-2312, TASK-2261, TASK-2297, TASK-2319,
TASK-2318`. Cohort 2 aborts: the known `task-2359` filename/frontmatter-ID
mismatch (`backlog/tasks/task-2359 - Prevent-PR-history-noise-from-blocking-mission-reviews.md:2
filename id TASK-2359 != frontmatter id TASK-2358`), reported per ADR 0051 and
out of scope for repair.

**SC6 conclusion.** Both cohorts fall below the ADR 0051 baseline in both
metrics (cohort 1 20.0% / 25.0; cohort 2 30.0% / 42.86 vs 30.2% / 43.3), so the
two-cohort direction is consistent: the post-integration completed-mission bug
frequency sits below the pre-integration baseline. A direction claim is
permitted; no claim of improved reliability, speed, throughput, cycle-time,
cost, or token qualification is made, and no architectural causation is claimed
(ADR 0051: one cohort is an early signal, not proof of a durable trend).
Cohort 2's 30.0% sits marginally below the 30.2% baseline — the narrow margin is
disclosed as calibrated language, not as a trend.

**Cohort-2 bug missions touching the ADR 0051 extracted slices.** Per ADR 0051,
which bug missions touch the extracted `stats-backfill` or `active` slices:
`TASK-2261` touches the `active` slice (`src/platform/runtime/lib/commands/active.ts`,
added in `dc5e1bea0`). None touch `stats-backfill`. The overall frequency alone
cannot attribute causation to the architecture.

**Reproducible report (SC5).** `scripts/bug-frequency-report.ts` + pure module
`src/application/projections/bug-frequency.ts` + fixture tests
`test/task-2361-bug-frequency.test.ts`. Re-run cohort 2 with:
`tsx scripts/bug-frequency-report.ts --ledger missions/task-2361/cohort-ledger.json`
Re-run the self-check (cohort 1) with:
`tsx scripts/bug-frequency-report.ts --ledger missions/task-2291/cohort-ledger.json`
→ reproduces 20 / 4 / 16.

**Cohort-3 successor (SC8).** `backlog/tasks/task-2421 - Measure-the-third-post-boundary-20-completed-mission-cohort.md`
fixes cohort 3's boundary at cohort 2's last member TASK-2322's transition
commit `d8628021e9d33d925718675914459e59fb689677` and reuses the same frozen
tie-breaker. TASK-2421 verified free against `main`
(`git ls-tree -r --name-only main -- backlog/completed backlog/tasks backlog/archive`).

**SC7 no-mutation.** The only writes by this mission:
`missions/task-2361/cohort-ledger.json`, `missions/task-2361/cohort-measurement.json`,
`missions/task-2361/CP-1.md`, `missions/task-2361/CP-2.md`,
`missions/task-2361/CP-3.md`, `scripts/bug-frequency-report.ts`,
`src/application/projections/bug-frequency.ts`, `test/task-2361-bug-frequency.test.ts`,
`backlog/tasks/task-2361 - Measure-the-second-post-boundary-20-completed-mission-cohort.md`
(this mission's own record), and `backlog/tasks/task-2421 - ...md` (cohort-3
successor). No `backlog/completed/` or `backlog/archive/` path changed; no task
label/status/assignee/ordinal/lifecycle metadata mutated; no `px active`/`review`/
`integrate`, agent, or network call was made by the measurement (read-only
`git log`/`tsx`/`node --test` only). `git status --porcelain` confirms the above.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC1 cohort-2 ledger frozen | `missions/task-2361/cohort-ledger.json` (`boundary.commit`=`1c9e40f41`, `tie_breaker` string-equal to `missions/task-2291/cohort-ledger.json`, 20 members, `next_after_cohort`=TASK-2322.01); re-runnable with `git log --reverse --no-renames --diff-filter=A --name-only 1c9e40f41..main -- backlog/completed/` (list-added files between the cohort-2 boundary commit `1c9e40f41` and `main`); | PASS |
| SC2 fewer-than-20 guard | `missions/task-2361/cohort-ledger.json` (`eligible_unique_total`=`173` ≥ `cohort_size`=`20`; full 20-member cohort published; guard not triggered); enumeration re-runnable with `git log --reverse --no-renames --diff-filter=A --name-only 1c9e40f41..main -- backlog/completed/` | PASS (not triggered) |
| SC3 three separate series published | `missions/task-2361/cohort-measurement.json`: `baseline` (39/129/90, 0.3023, 43.33 from `docs/adr/0051-ui-neutral-application-boundary.md:63`), `cohort_1` (20/4/16 from `missions/task-2291/cohort-measurement.json`), `cohort_2` (20/6/14, 0.3, 42.86) as sibling objects; per-row `copies`/`copyPaths`/`labelUnion` present | PASS |
| SC4 exact `bug` label, cross-store union, report-time read | `src/application/projections/bug-frequency.ts`; runner scans 4 stores; `test/task-2361-bug-frequency.test.ts` `counts only the exact bug label, not lookalikes or title keywords` | PASS |
| SC5 report implemented + tested | `src/application/projections/bug-frequency.ts` (pure), `scripts/bug-frequency-report.ts` (IO), `test/task-2361-bug-frequency.test.ts` (`npm test -- test/task-2361-bug-frequency.test.ts` → 9 pass); six scenarios covered | PASS |
| SC6 conclusion direction-constrained | Both cohorts below ADR 0051 baseline (30.2% / 43.3); write-up states direction only, no speed/throughput/cost/token/causation qualifier (this document) | PASS |
| SC7 no task-record mutation | `git status --porcelain` shows only mission artifacts + `backlog/tasks/task-2421 - ...md`; zero `backlog/completed/`/`backlog/archive/` changes; no `px active`/`review`/`integrate` | PASS |
| SC8 cohort-3 successor | `backlog/tasks/task-2421 - Measure-the-third-post-boundary-20-completed-mission-cohort.md`, boundary = TASK-2322 transition commit `d8628021`, same frozen tie-breaker; free on `main` (`git ls-tree -r --name-only main -- backlog/completed backlog/tasks backlog/archive`) | PASS |
| SC9 verification gate | `./scripts/verify-local.sh all` → exit 0, 2167 tests pass / 0 fail; `eslint` + `tsc --noEmit --project tsconfig.scripts.json` clean on new files | PASS |

Next action: commit the mission artifacts (CP-1/2/3, ledger, measurement,
runner, module, test, and the `backlog/tasks/task-2421` cohort-3 successor)
locally; do not push to `origin` (mission branch), and do not run
`px active`/`review`/`integrate`.
