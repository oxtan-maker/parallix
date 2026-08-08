# CP-3: Targeted unit tests for telemetryToStatsFields and resolveAgentModel

## Summary

Added targeted unit tests for `resolveAgentModel` covering the `custom` agent family, and verified all existing tests in the three required test files pass.

**Tests added to `test/product-config.test.ts`:**
1. `"resolveAgentModel returns the configured model for the custom family (task-2337)"` — asserts `resolveAgentModel('custom', root)` returns `'qwen3.6-27b-q8'` when `adapters.agents.models.custom` is configured
2. `"resolveAgentModel returns null for custom when adapters.agents.models.custom is absent (task-2337)"` — asserts `resolveAgentModel('custom', root)` returns `null` when the config has no custom entry

**Existing test coverage verified (no additions needed):**
- `telemetryToStatsFields` model fallback chain: covered by `test/task-2337-repro.test.ts` (5 tests) and `test/stats.test.ts` task-1251 test
- `resolveAgentModel` general behavior: covered by existing `test/product-config.test.ts` tests (6 tests)
- `extractOpencodeTelemetryFromExport` fallback model: covered by `test/opencode-telemetry.test.ts` (28 tests)

**All required test files pass:**
- `test/stats.test.ts`: 62 tests pass
- `test/opencode-telemetry.test.ts`: 28 tests pass
- `test/product-config.test.ts`: 38 tests pass (36 existing + 2 new)

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| resolveAgentModel test for custom family with config | `test/product-config.test.ts`, `"resolveAgentModel returns the configured model for the custom family (task-2337)"` | PASS |
| resolveAgentModel test for custom family without config | `test/product-config.test.ts`, `"resolveAgentModel returns null for custom when adapters.agents.models.custom is absent (task-2337)"` | PASS |
| telemetryToStatsFields model fallback chain tests | `test/task-2337-repro.test.ts`, `"task-2337: telemetryToStatsFields uses model option when telemetry.model is null/empty"` | PASS |
| telemetryToStatsFields prefers telemetry.model | `test/task-2337-repro.test.ts`, `"task-2337: telemetryToStatsFields prefers telemetry.model over model option"` | PASS |
| extractOpencodeTelemetryFromExport fallback model tests | `test/opencode-telemetry.test.ts`, `"extractOpencodeTelemetryFromExport uses configured fallback model when JSON omits model"` | PASS |
| All stats tests pass | `npm test -- test/stats.test.ts`, 62 tests pass | PASS |
| All opencode-telemetry tests pass | `npm test -- test/opencode-telemetry.test.ts`, 28 tests pass | PASS |
| All product-config tests pass | `npm test -- test/product-config.test.ts`, 38 tests pass | PASS |
| Combined test run passes | `npm test -- test/stats.test.ts test/opencode-telemetry.test.ts test/product-config.test.ts`, 128 tests pass | PASS |
| Falsifiability rule | `ADR 0048` | PASS |

## Next action

CP-4: Validate legacy CSV reimport preserves model data. Run `px stats import-legacy` against a sample CSV with custom-agent rows and verify the `model` column is populated in the measurement database.
