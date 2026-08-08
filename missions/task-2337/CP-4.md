# CP-4: Validate legacy CSV reimport preserves model data

## Summary

Verified that `px stats import-legacy` preserves the `model` column from the source CSV for custom-agent rows. Added two tests: a synthetic CSV test and a realistic fixture-based import test with 8 rows (5 custom-agent, 3 codex).

**Tests added to `test/legacy-stats-csv-import.test.ts`:**
- `"import-legacy preserves model column for custom-agent rows (task-2337)"` — synthetic CSV with 3 custom-agent rows (qwen3.6-27b-q8, cyankiwi/Qwen3.6-35B-A3B-AWQ-4bit, empty) verifies each model value is preserved
- `"import-legacy fixture import preserves model for custom-agent rows (task-2337)"` — realistic fixture `test/fixtures/sample-legacy-stats.csv` (8 rows, 5 custom-agent) verifies all custom-agent models preserved through full import pipeline

**Existing test coverage verified:**
- All 11 existing legacy CSV import tests pass unchanged (dry run, atomic apply, idempotent, malformed/ambiguous handling, source CSV preservation)

**All legacy CSV import tests pass:** 13 tests (11 existing + 2 new)

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Legacy CSV import preserves model for custom-agent rows | `test/legacy-stats-csv-import.test.ts`, `"import-legacy preserves model column for custom-agent rows (task-2337)"` | PASS |
| Model column in STATS_HEADERS includes model | `src/adapters/cli/commands/stats.ts:105`, `STATS_HEADERS` includes `'model'` | PASS |
| Populated model names preserved (qwen3.6-27b-q8) | `test/legacy-stats-csv-import.test.ts`, assertion `rows[0].model === 'qwen3.6-27b-q8'` | PASS |
| Long model names preserved (cyankiwi/) | `test/legacy-stats-csv-import.test.ts`, assertion `rows[1].model === 'cyankiwi/Qwen3.6-35B-A3B-AWQ-4bit'` | PASS |
| Empty model column preserved | `test/legacy-stats-csv-import.test.ts`, assertion `rows[2].model === ''` | PASS |
| All existing legacy CSV import tests pass | `npm test -- test/legacy-stats-csv-import.test.ts`, 13 tests pass | PASS |
| Legacy CSV import test file exists | `test/legacy-stats-csv-import.test.ts` | PASS |
| Falsifiability rule | `ADR 0048` | PASS |
| Fixture-based import test | `test/legacy-stats-csv-import.test.ts`, `"import-legacy fixture import preserves model for custom-agent rows (task-2337)"` | PASS |

## Next action

Fixture file: `test/fixtures/sample-legacy-stats.csv` (8 rows, 5 custom-agent with models: qwen3.6-27b-q8 x3, cyankiwi/Qwen3.6-35B-A3B-AWQ-4bit x1, granite-3.2-8b x1).
