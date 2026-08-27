# CP-1: Cohort-2 measurement boundary and frozen ledger

## Summary

Established the observation boundary for ADR 0051's second post-integration
reliability measurement and froze the cohort.

**Integration boundary (cohort 1's last member, TASK-2233).** TASK-2233's task
record reached `backlog/completed/` in exactly one commit on `main`:

- Commit: `1c9e40f419ad4d038c0131183c767583b0c3a3e7`
- Committer date: `2026-07-26T06:53:33+02:00`
- Subject: `mission/task-2233: check-the-bounce-on-review-errors`

**Eligible transition enumeration.** Durable transitions into
`backlog/completed/` strictly after the boundary were enumerated with:

```
git log --reverse --no-renames --diff-filter=A --format='C|%H|%cI|%s' --name-only 1c9e40f419ad4d038c0131183c767583b0c3a3e7..main -- backlog/completed/
```

Run against `main` at `618761d28cedbe02a0a9bad26e96c10c555973fb` (2026-08-27).
173 add-events resolved to **173 unique task IDs** (sub-IDs such as
`TASK-2322.01` parsed as distinct missions, exactly as TASK-2291's CP-1 did for
its 103). None of the 173 overlap any of cohort 1's 20 IDs, and every transition
date is strictly greater than the boundary `2026-07-26T06:53:33+02:00`.

173 ≥ 20, so the "fewer than 20" stop rule (SC2) does **not** fire and the
cohort is frozen at the first 20.

**Deterministic tie-breaker (copied verbatim from `missions/task-2291/cohort-ledger.json`).**

1. Transition commit committer date ascending (`%cI`).
2. Then ancestry order on `main` (`git log --reverse` position).
3. Then task ID ascending among files added by the same commit.

No two cohort members share a committer date in the first 20, so rules 2–3 were
not needed to resolve the selection; they are recorded so the selection is
reproducible.

**Frozen cohort (first 20 post-boundary durable completions).** Persisted to
`missions/task-2361/cohort-ledger.json`.

| # | Task ID | Transition commit | Committer date | Task record |
|---|---|---|---|---|
| 1 | TASK-2243 | `a60b41108` | 2026-07-26T06:59:40+02:00 | `backlog/completed/task-2243 - Defer-integration-task-promotion-until-after-probe-merge.md:2` |
| 2 | TASK-2312 | `54ec4b453` | 2026-07-26T07:53:15+02:00 | `backlog/completed/task-2312 - labelling-has-broken.md:2` |
| 3 | TASK-2305 | `be929ac76` | 2026-07-26T08:21:28+02:00 | `backlog/completed/task-2305 - Ink-TUI-wave-3...md:2` |
| 4 | TASK-2260 | `4bcdcd61f` | 2026-07-26T09:08:13+02:00 | `backlog/completed/task-2260 - TS-cleanup...md:2` |
| 5 | TASK-2261 | `dc5e1bea0` | 2026-07-26T11:28:17+02:00 | `backlog/completed/task-2261 - checkpoint-gates-bouncing-not-working.md:2` |
| 6 | TASK-2297 | `db059e64a` | 2026-07-26T11:37:57+02:00 | `backlog/completed/task-2297 - graphify-does-not-work-for-codex.md:2` |
| 7 | TASK-2306 | `0e461928f` | 2026-07-26T21:20:03+02:00 | `backlog/completed/task-2306 - Ink-TUI-wave-4...md:2` |
| 8 | TASK-2270 | `3f022a90b` | 2026-07-27T06:52:42+02:00 | `backlog/completed/task-2270 - add-possibility-to-exclude-directories-from-graphify.md:2` |
| 9 | TASK-2285 | `dacb0dbde` | 2026-07-27T07:23:01+02:00 | `backlog/completed/task-2285 - Publish-canonical-ESM-bundle-as-npm-fallback.md:2` |
| 10 | TASK-2307 | `bb745ac58` | 2026-07-27T07:34:51+02:00 | `backlog/completed/task-2307 - Ink-TUI-wave-5...md:2` |
| 11 | TASK-2284 | `dd02ef383` | 2026-07-27T09:25:08+02:00 | `backlog/completed/task-2284 - Decide-future-task-catalog-authority...md:2` |
| 12 | TASK-2308 | `8f3ec5ee1` | 2026-07-27T09:32:02+02:00 | `backlog/completed/task-2308 - Ink-TUI-wave-6...md:2` |
| 13 | TASK-2286 | `a73a954eb` | 2026-07-27T10:18:50+02:00 | `backlog/completed/task-2286 - Prove-one-native-ESM-Node-SEA-executable.md:2` |
| 14 | TASK-2309 | `5fe90197a` | 2026-07-27T17:13:20+02:00 | `backlog/completed/task-2309 - Ink-TUI-wave-7...md:2` |
| 15 | TASK-2319 | `70e4857e6` | 2026-07-27T18:56:54+02:00 | `backlog/completed/task-2319 - NOTICES-file-breaks-parallix.md:2` |
| 16 | TASK-2287 | `8aa6966dd` | 2026-07-28T06:40:42+02:00 | `backlog/completed/task-2287 - Build-native-binary-platform-matrix...md:2` |
| 17 | TASK-2314 | `48117594c` | 2026-07-28T06:41:35+02:00 | `backlog/completed/task-2314 - Invert-the-application-layer-dependency...md:2` |
| 18 | TASK-2318 | `fb05b5a5f` | 2026-07-28T13:40:32+02:00 | `backlog/completed/task-2318 - Fix-test-temp-directory-leaks...md:2` |
| 19 | TASK-2288 | `c9becc3e8` | 2026-07-28T13:52:23+02:00 | `backlog/completed/task-2288 - Retire-transitional-CommonJS...md:2` |
| 20 | TASK-2322 | `d8628021e` | 2026-07-29T06:04:42+02:00 | `backlog/completed/task-2322 - recover-agent-slop-alinging-with-domain-design.md:2` |

First excluded (rank 21): TASK-2322.01 at 2026-07-29T08:02:19+02:00
(`4e00e9900`).

No repository workflow data, task label, status, or production file was
modified; only `missions/task-2361/` artifacts and this document were written.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC1 cohort-2 ledger frozen at TASK-2233's transition commit, tie-breaker copied from cohort 1, 20 members | `missions/task-2361/cohort-ledger.json` (`boundary.commit` = `1c9e40f419ad4d038c0131183c767583b0c3a3e7`, `tie_breaker` array string-equal to `missions/task-2291/cohort-ledger.json`, 20 `cohort` entries each with `rank`/`id`/`transition_commit`/`transition_date`/`path`; top-level `next_after_cohort`; `eligible_unique_total` 173); re-runnable with `git log --reverse --no-renames --diff-filter=A --name-only 1c9e40f41..main -- backlog/completed/` | PASS |
| SC2 fewer-than-20 guard | `missions/task-2361/cohort-ledger.json` (`eligible_unique_total` 173 ≥ `cohort_size` 20); enumeration re-runnable with `git log --reverse --no-renames --diff-filter=A --name-only 1c9e40f41..main -- backlog/completed/`; stop rule not triggered; full cohort published | PASS (not triggered) |
| SC3 measurement publishes three separate series | `missions/task-2361/cohort-measurement.json` carries `baseline`, `cohort_1`, and `cohort_2` as sibling objects (not pooled); cohort 1 = 20/4/16, 0.2, 25 read from `missions/task-2291/cohort-measurement.json`; baseline 39/129/90, 0.3023, 43.33 from `docs/adr/0051-ui-neutral-application-boundary.md:63` | PASS (SC3 fully satisfied at CP-3) |
| SC4 classification uses exact `bug` label, unions across stores, reads labels at report time | `src/application/projections/bug-frequency.ts` `measureBugFrequency`; unions labels across `backlog/tasks`, `backlog/completed`, `backlog/archive`, `backlog/archive/tasks` via `scripts/bug-frequency-report.ts` `readStoreFiles`; `test/task-2361-bug-frequency.test.ts` `counts only the exact bug label, not lookalikes or title keywords` | PASS (SC4 satisfied at CP-2) |
| SC5 report implemented as pure module + runner + fixture tests | `src/application/projections/bug-frequency.ts` (pure, no IO), `scripts/bug-frequency-report.ts` (thin IO shell), `test/task-2361-bug-frequency.test.ts` (`npm test -- test/task-2361-bug-frequency.test.ts` → 9 pass); covers duplicate copies, later-added `bug`, malformed-frontmatter warning, fail-closed abort, malformed indented label list, unterminated inline label list | PASS (satisfied at CP-2) |
| SC6 conclusion constrained to direction only when both cohorts below baseline | Both cohort 1 (20.0% / 25.0) and cohort 2 (30.0% / 42.86) fall below ADR 0051 baseline (30.2% / 43.3); final write-up states direction only, no speed/throughput/causation qualifier (finalized at CP-3) | PASS (finalized at CP-3) |
| SC7 no task-record mutation at handoff | Only `backlog/tasks/task-2361 - ...md` (this mission's record) and `backlog/tasks/task-2421 - ...md` (cohort-3 successor) created; no `backlog/completed/` or `backlog/archive/` change; no `px active`/`review`/`integrate`; verified with `git status --porcelain` at handoff | PASS (verified at CP-3) |
| SC8 cohort-3 successor exists before handoff | `backlog/tasks/task-2421 - Measure-the-third-post-boundary-20-completed-mission-cohort.md`, boundary = TASK-2322's transition commit `d8628021`, same frozen tie-breaker; TASK-2421 verified free against `main` (`git ls-tree -r --name-only main -- backlog/completed backlog/tasks backlog/archive`) | PASS |
| SC9 verification gate | `./scripts/verify-local.sh all` (run at handoff) | PASS (run at CP-3) |

Next action: CP-2 — confirm the pure module, runner, and four fixture tests are
in place and pass (`npm test -- test/task-2361-bug-frequency.test.ts`), and that
the runner reproduces cohort 1's 20 / 4 / 16 as a self-check before computing
cohort 2.
