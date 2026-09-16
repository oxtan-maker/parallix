# CP 1 — Triage & Baseline Categorization

## Summary

Tried the 2026-09-16 SonarQube reliability baseline into the categorized list
required by SC1. The dated per-finding export (rule id + file:line for all 35)
is **not present** in this worktree: `graphify-out/2026-09-16/` is a graphify
snapshot, not a findings export, and no SARIF / findings `*.json` feed exists
anywhere under the repo or in reachable Git history (verified with
`git rev-list --all --objects` and `git grep` across all branches). The mission
contract therefore supplies a target count and the finding **categories**, plus
the explicit enumerable list of the 19 critical `S2871` files in SC2.

Method for the sort findings: enumerate every implicit `.sort()` in `src/` with
`grep -rn "\.sort(" src/`. Every implicit (no-comparator) `.sort()` in `src/`
now resolves to either a string/lexical element (safe default order) or an
already-present explicit comparator. There is **no** non-string `.sort()`
without an explicit comparator remaining.

**Classification result**

- **(a) implicit-string-sort repair:** 18 of the 19 critical `S2871` implicit
  sorts — repaired with a shared code-unit comparator that reproduces the native
  UTF-16 default order exactly (see CP-2). `src/domain/checkpoint.ts:56` already
  carried a numeric comparator, so it was the 19th finding and needed no repair.
- **(b) correct-as-is default sort (string/lexical data):** the only remaining
  implicit sorts, `src/application/projections/metrics.ts:197` and `:276` on
  `instants: readonly string[]` (ISO-8601 date strings), are string data where
  lexicographic == chronological; left unchanged per SC6.
- **(c) justified false positive:** none of the sorts.

The 16 non-sort findings (regular-expression, control-character,
constant-conditional) are described by category only. A pattern review
reconstructed the demonstrable instances per category and repaired them (CP-3/4/5).
No rule was disabled, suppressed, or downgraded (SC4).

### S2871 triage table (19 critical findings)

| # | File:line | Element type | Action |
|---|-----------|--------------|--------|
| 1 | src/domain/checkpoint.ts:56 | records by `Number(name.slice(3))` | already had numeric comparator |
| 2 | src/interfaces/tui/agent-config-resolver.ts:31 | agent family names (string) | code-unit comparator |
| 3 | src/application/projections/bug-frequency.ts:239 | `Set<string>` labels | code-unit comparator |
| 4 | src/application/projections/metrics-read-adapter.ts:387 | ISO-8601 timestamps | code-unit comparator |
| 5 | src/adapters/cli/commands/stats-report.ts:275 | stage names (string) | code-unit comparator |
| 6 | src/adapters/cli/commands/status.ts:329 | agent names (string) | code-unit comparator |
| 7 | src/adapters/cli/commands/status-adapter.ts:240 | agent names (string) | code-unit comparator |
| 8 | src/adapters/cli/commands/status-adapter.ts:399 | agent names (string) | code-unit comparator |
| 9 | src/adapters/sqlite/migration-runner.ts:169 | fixed-width `.sql` names | code-unit comparator |
| 10 | src/adapters/sqlite/database-adapter.ts:377 | fixed-width ms suffixes | code-unit comparator |
| 11 | src/adapters/verification/coverage-gate.ts:159 | test file paths | code-unit comparator |
| 12 | src/adapters/review/review-state.ts:298 | `.md` filenames | code-unit comparator |
| 13 | src/adapters/cli/commands/stats-report-rendering.ts:80 | dates (string) | code-unit comparator |
| 14 | src/adapters/cli/commands/stats-report-rendering.ts:175 | `Object.keys` months | code-unit comparator |
| 15 | src/adapters/cli/commands/stats-backfill.ts:36 | year dir names | code-unit comparator |
| 16 | src/adapters/cli/commands/stats-backfill.ts:38 | slug dir names | code-unit comparator |
| 17 | src/adapters/agents/vibe.ts:181 | `session_*` dir names | code-unit comparator |
| 18 | src/adapters/agents/qwen-telemetry.ts:109 | `token-usage-*.jsonl` names | code-unit comparator |
| 19 | src/adapters/agents/vibe-telemetry.ts:121 | `session_*` dir names | code-unit comparator |

### Non-sort findings (16) — reconstructed by category

Baseline categories: regular-expression (`S5850`), control-character (`S6324`),
constant-conditional (`S3923`). Exact per-finding export unavailable.
Repaired demonstrable instances per category (see CP-3/4/5), guarded by
regression tests. Pattern review found no other always-true `if`/`switch`
conditional and no runtime control character in `src/`.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC1 — all 35 findings accounted for | 19 `S2871` enumerated above by file:line; 16 non-sort reconstructed by category; the dated export is absent from repo + all Git history | BLOCKED (baseline export unavailable; demonstrable findings repaired) |
| SC2 — non-string default-ordering `.sort()` count is zero | `grep -rn "\.sort(" src/` shows only `metrics.ts:197/276` implicit (string `instants`); 18 repaired `S2871` calls carry code-unit comparators in `git show 9cde261f1` (19th, `checkpoint.ts:56`, already had one) | PASS |
| SC4 — no rule disabled/suppressed | grep `sonar.comments` / `@sonar` / `@SuppressWarnings` / `sonar.exclusions` in changed tree yields none | PASS |
| Baseline triage recorded | this `missions/task-2525.01/CP-1.md` + `git show 9cde261f1 --stat` | PASS |

## Next action

CP-2: repair the 19 critical `S2871` implicit-string sorts with code-unit
comparators (preserve native UTF-16 order) and add regression tests.
