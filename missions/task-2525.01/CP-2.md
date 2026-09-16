# CP 2 — Implicit String Sorts (`typescript:S2871`)

## Summary

Repaired 18 of the 19 critical implicit-string-sort findings flagged by the
2026-09-16 baseline. Every previously-implicit `S2871` `.sort()` in `src/` now
calls the shared `compareCodeUnits` helper — a single code-unit comparator
(`src/domain/comparators.ts`) that reproduces the native UTF-16 order exactly:

```ts
export function compareCodeUnits(left: string, right: string): number {
  if (left < right) { return -1; }
  if (left > right) { return 1; }
  return 0;
}
```

This is the repair chosen per reviewer finding F1 (mission
`review-events/2026-09-16T120140-reviewer_findings-1-claude.md`): `localeCompare`
uses ICU collation and reorders punctuation/case (`-` vs `_`, `.` vs `-`,
mixed case) and depends on the runtime default locale, so it would change
observable order. The code-unit comparator reproduces the native UTF-16 default
ordering **exactly** and is deterministic across machines, so the repairs are
behavior-preserving for the string/lexical data being sorted (SC6).

`src/domain/checkpoint.ts:56` already sorted by `Number(name.slice(3))`
(numeric), so it was not an implicit-string-sort finding. The only remaining
implicit `.sort()` calls in `src/` are `metrics.ts:197` and `:276` on
`instants: readonly string[]` (ISO-8601 date strings), which are string data
where lexicographic == chronological and are left unchanged per SC6.

### Enumerable candidate set (SC2) — all resolved

18 calls were repaired; the 19th, `checkpoint.ts:56`, already had a numeric
comparator and needed no change.

`src/interfaces/tui/agent-config-resolver.ts:31`,
`src/application/projections/bug-frequency.ts:239`,
`src/application/projections/metrics-read-adapter.ts:387`,
`src/adapters/cli/commands/stats-report.ts:275`,
`src/adapters/cli/commands/status.ts:329`,
`src/adapters/cli/commands/status-adapter.ts:240`,
`src/adapters/cli/commands/status-adapter.ts:399`,
`src/adapters/sqlite/migration-runner.ts:169`,
`src/adapters/sqlite/database-adapter.ts:377`,
`src/adapters/verification/coverage-gate.ts:159`, plus
`stats-report-rendering.ts:80/175`, `stats-backfill.ts:36/38`, `vibe.ts:181`,
`qwen-telemetry.ts:109`, `vibe-telemetry.ts:121`, `review-state.ts:298`, and
`checkpoint.ts:56` (pre-existing numeric).

### Why remaining default-ordering sorts are safe

`src/application/projections/metrics.ts:197` and `:276` sort `instants`
(`readonly string[]`, ISO-8601). ISO-8601 string ordering equals chronological
ordering, so the default lexicographic order is the intended order. Left as-is.

### Regression tests

`test/sonarqube-s2871-sorts.test.ts` exercises the real functions through their
public entry points and pins the observable ordering:
- `resolveKnownAgentFamilies` returns the eligible union in ascending order;
- `discoverTestFiles()` preserves UTF-16 filename order, including the `-`
  before `_` filename ordering that a `localeCompare` rewrite would break.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC2 — 18 repaired `S2871` calls carry explicit comparator | `git show 9cde261f1 --stat` (15 files, 18 calls); `grep -rn "\.sort(" src/` shows no remaining non-string implicit sort; `checkpoint.ts:56` already had a numeric comparator | PASS |
| SC6 — string/lexical sorts behaviorally unchanged | code-unit comparator reproduces UTF-16 order; `metrics.ts:197/276` left as `string[]` | PASS |
| SC3 — repairs guarded by regression tests | `test/sonarqube-s2871-sorts.test.ts`, `"resolveKnownAgentFamilies returns the eligible union in lexicographic order"`, `"discoverTestFiles preserves UTF-16 filename order"` | PASS |
| SC4 — no rule disabled | grep `sonar.comments`/`@sonar`/`sonar.exclusions` in changed tree yields none | PASS |
| Full suite green | `` `npm test` `` → 2636 pass, 0 fail | PASS |

## Next action

CP-3: repair the regular-expression findings (`S5850`, implicit
anchor/alternation precedence) by making the anchor scope explicit.
