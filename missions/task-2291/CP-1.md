# CP-1: Measurement boundary and eligibility ledger

## Summary

Established the observation boundary for ADR 0051's first post-integration
reliability measurement and froze the cohort.

**Integration boundary (TASK-2290).** TASK-2290's task record reached
`backlog/completed/` in exactly one commit on `main`:

- Commit: `8aa9af505ff2f22ac35448dab62b2c7cc7a125cb`
- Committer date: `2026-07-21T14:26:24+02:00`
- Subject: `mission/task-2290: task-2290`

That same commit carries the TASK-2290 application-boundary production change
(`lib/commands/active.ts`, `lib/commands/stats-backfill.ts`,
`lib/adapters/legacy-active-adapter.ts`,
`lib/adapters/legacy-stats-backfill-adapter.ts`), so the code integration and
the durable completion transition are the same commit and the boundary is
unambiguous — no stop rule fires. Reproduce with:

```
git log main --oneline --no-renames --diff-filter=A -- 'backlog/completed/task-2290*'
git show --stat 8aa9af505
```

**Eligible transition enumeration.** Durable transitions into
`backlog/completed/` strictly after the boundary were enumerated with:

```
git log --reverse --no-renames --diff-filter=A --format='C|%H|%cI|%s' --name-only 8aa9af505..main -- backlog/completed/
```

- 103 add-events, resolving to **103 unique task IDs** (sub-IDs such as
  `TASK-2322.01` parsed as distinct missions).
- 0 of those IDs already had a completed-store record at the boundary commit
  (`git ls-tree -r --name-only 8aa9af505 backlog/completed/` lists 152 IDs, none
  overlapping), so no pre-boundary completion is admitted.
- 0 of the 103 were later removed from `main`'s completed store, so every
  enumerated transition is durable.
- Task creation date is never consulted; only the completed-store transition
  commit admits a mission.

103 ≥ 20, so the "fewer than 20" stop rule does **not** fire and the cohort is
frozen at the first 20.

**Deterministic tie-breaker (documented, applied in this order).**

1. Transition commit committer date ascending (`%cI`).
2. Then ancestry order on `main` (`git log --reverse` position).
3. Then task ID ascending among files added by the same commit.

No two cohort members share a committer date, so rules 2 and 3 were not needed
to resolve the first 20; they are recorded so the selection is reproducible.

**Frozen cohort (first 20 post-boundary durable completions).** Persisted to
`missions/task-2291/cohort-ledger.json`.

| # | Task ID | Transition commit | Committer date | Task record |
|---|---|---|---|---|
| 1 | TASK-2293 | `502d19b9e` | 2026-07-21T21:20:13+02:00 | `backlog/completed/task-2293 - Harden-legacy-TypeScript-test-mock-shapes.md:2` |
| 2 | TASK-2279 | `eafdc4d65` | 2026-07-21T22:00:49+02:00 | `backlog/completed/task-2279 - Move-runtime-to-ESM-src-tree-and-canonical-bundle.md:2` |
| 3 | TASK-2240 | `8463c6540` | 2026-07-22T07:13:44+02:00 | `backlog/completed/task-2240 - when-forgejo-is-activated-PR-is-not-updated-between-rounds.md:2` |
| 4 | TASK-2296 | `59b4b9329` | 2026-07-22T08:37:55+02:00 | `backlog/completed/task-2296 - test-failure.md:2` |
| 5 | TASK-2298 | `6f401e34a` | 2026-07-22T10:03:13+02:00 | `backlog/completed/task-2298 - Strengthen-the-defence.md:2` |
| 6 | TASK-2299 | `4b6773730` | 2026-07-23T12:00:22+02:00 | `backlog/completed/task-2299 - test-fixes.md:2` |
| 7 | TASK-2294 | `0e47b9938` | 2026-07-23T12:05:23+02:00 | `backlog/completed/task-2294 - Establish-canonical-Parallix-domain-model-and-settle-the-persistence-sync-async-seam.md:2` |
| 8 | TASK-2242 | `b6adc649a` | 2026-07-23T12:23:38+02:00 | `backlog/completed/task-2242 - backlog.md-changes-fast.md:2` |
| 9 | TASK-2300 | `2ae43d87b` | 2026-07-23T14:59:02+02:00 | `backlog/completed/task-2300 - Make-final-integration-gates-unavoidable.md:2` |
| 10 | TASK-2244 | `78ceae000` | 2026-07-23T15:13:55+02:00 | `backlog/completed/task-2244 - backlog.md-check-reading-from-wrong-place.md:2` |
| 11 | TASK-2295 | `e5d9036bc` | 2026-07-23T15:22:52+02:00 | `backlog/completed/task-2295 - Re-home-bounded-SQLite-operator-state-onto-the-canonical-domain-model-supersedes-task-2280.md:2` |
| 12 | TASK-2281 | `85cd06759` | 2026-07-23T17:36:27+02:00 | `backlog/completed/task-2281 - Build-operator-board-projections-events-and-guarded-controller.md:2` |
| 13 | TASK-2238 | `88c185550` | 2026-07-23T18:16:01+02:00 | `backlog/completed/task-2238 - change-pi-tech.md:2` |
| 14 | TASK-2302 | `d4e057d39` | 2026-07-24T06:24:56+02:00 | `backlog/completed/task-2302 - Implement-concrete-repository-read-adapters-as-the-single-board-materialization-path.md:2` |
| 15 | TASK-2310 | `075d94ea9` | 2026-07-24T07:31:52+02:00 | `backlog/completed/task-2310 - Fix-ADR-halcuinactions.md:2` |
| 16 | TASK-2303 | `0dcb2c566` | 2026-07-25T15:44:06+02:00 | `backlog/completed/task-2303 - Record-lifecycle-lane-transition-events-and-typed-board-metrics-schema.md:2` |
| 17 | TASK-2282 | `026dd79d0` | 2026-07-25T21:32:11+02:00 | `backlog/completed/task-2282 - Implement-Ink-TUI-over-shared-application-contracts.md:2` |
| 18 | TASK-2311 | `93afd6641` | 2026-07-25T21:47:07+02:00 | `backlog/completed/task-2311 - after-pi-tech-change-console-is-empty.md:2` |
| 19 | TASK-2304 | `2fdee7315` | 2026-07-26T06:47:28+02:00 | `backlog/completed/task-2304 - Ink-TUI-wave-2-lane-columns-mission-cards-and-responsive-terminal-layout.md:2` |
| 20 | TASK-2233 | `1c9e40f41` | 2026-07-26T06:53:33+02:00 | `backlog/completed/task-2233 - check-the-bounce-on-review-errors.md:2` |

First excluded (rank 21): TASK-2243 at 2026-07-26T06:59:40+02:00 (`a60b41108`).

No repository workflow data, task label, status, or production file was
modified; only `missions/task-2291/` artifacts were written.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| TASK-2290's integration cutoff recorded as an exact commit and date | Cutoff commit `8aa9af505ff2f22ac35448dab62b2c7cc7a125cb`, 2026-07-21T14:26:24+02:00, reproducible with `git log main --no-renames --diff-filter=A -- 'backlog/completed/task-2290*'`; boundary record at `backlog/completed/task-2290 - Delegate-bounded-CLI-slices-through-application-boundary.md:2`; boundary rationale per ADR 0051 | PASS |
| Every cohort member's durable completion transition is strictly after the cutoff | `missions/task-2291/cohort-ledger.json:1` records all 20 transition commits in range `8aa9af505..main`; earliest member TASK-2293 at 2026-07-21T21:20:13+02:00 > cutoff; enumerated by `git log --reverse --no-renames --diff-filter=A --name-only 8aa9af505..main -- backlog/completed/` | PASS |
| If fewer than 20 eligible transitions exist, stop with exact counts | 103 eligible unique post-boundary durable transitions counted by `git log --reverse --no-renames --diff-filter=A --name-only 8aa9af505..main -- backlog/completed/`; 103 ≥ 20 so the stop rule does not fire and no partial rate is published | PASS (not triggered) |
| Report lists exactly 20 unique task IDs by a documented deterministic tie-breaker | 20 rows in `missions/task-2291/cohort-ledger.json:1` (`cohort` array), tie-breaker recorded in the same file's `tie_breaker` field; first excluded member TASK-2243 at `backlog/completed/task-2243 - Defer-integration-task-promotion-until-after-probe-merge.md:2` | PASS |
| Creation date, pre-boundary completion, and non-completed states excluded | Selection keys only on the `backlog/completed/` add-commit date; `git ls-tree -r --name-only 8aa9af505 backlog/completed/` yields 152 pre-boundary IDs with zero overlap against the 103 eligible IDs; `backlog/tasks/` (open/refined/active/review) is never enumerated | PASS |
| Measurement reads repository data only; no mutation, agents, network, or nested `px` | Only `git log` / `git ls-tree` / `git show --stat` were run; the only writes are `missions/task-2291/cohort-ledger.json` and this document; `backlog/tasks/task-2291 - Measure-post-boundary-bug-frequency-cohort.md:4` (`status: refined`) is untouched | PASS |

Next action: locate the TASK-2289 read-only bug-frequency report entry point,
run it against the 20 frozen cohort IDs, and independently recompute the exact
`bug` label union, bug/non-bug counts, `bug / total`, and `100 * bug / non-bug`
for CP-2.
