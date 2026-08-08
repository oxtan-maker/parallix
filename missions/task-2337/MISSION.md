# Mission: Custom model name lost in stats display (task-2337)

## Goal
Fix the stats reporting bug so that custom agents display their actual configured model name (e.g. `qwen3.6-27b-q8`, `cyankiwi/Qwen3.6-35B-A3B-AWQ-4bit`) in the "Agent performance" table instead of the generic label `custom`. Reimport historical stats from the legacy CSV in `PARALLIX_HOME` so recoverable model names are preserved.

## Why Now
The stats table (`` `px stats` `` weekly/range reports) groups custom-agent missions under the family label `custom` because the `model` column in the measurement database is not populated with the actual model name. This makes it impossible to distinguish which local GPU models are being used across missions. The rendering logic already supports model-level display (verified by `test/stats.test.ts` task-2213 test), so the fix is scoped to the recording path and legacy reimport.

## Refinement Signals
- Predicted NEL bucket: Small (0–80)
- Confidence: High
- Selection note: activate as-is
- Main drivers: targeted fix in `recordStageStatsSafe` model resolution, regression test in `test/stats.test.ts`, legacy CSV reimport via `px stats import-legacy`

## Scope
- Fix the model propagation in `recordStageStatsSafe` (`src/adapters/review/review-loop.ts`) so that `resolveAgentModel('custom', worktree)` resolves the configured model from `adapters.agents.models.custom` in the product config instead of falling back to `null`.
- Ensure `telemetryToStatsFields` in `src/adapters/cli/commands/stats.ts` uses the resolved model name (not the `agentFamily` fallback) for custom-agent rows.
- Verify `extractOpencodeTelemetryFromExport` in `src/adapters/agents/opencode-telemetry.ts` correctly receives and uses the `fallbackModel` parameter from the launcher.
- Add a regression test in `test/stats.test.ts` that asserts custom-agent rows render with the actual model name (not `custom`) in the agent performance table.
- Reimport historical stats from the legacy CSV (`PARALLIX_HOME` old stats file) using `px stats import-legacy` so that any previously stored rows with blank `model` columns are updated.

## Out of Scope
- Adding a new config entry to `adapters.agents.models` for `custom` (the fix should work with any model already configured there).
- Changes to the opencode export JSON parsing logic (`extractModelName`) — that is already correct per `test/opencode-telemetry.test.ts`.
- Changes to the spend-by-stage table rendering — that already uses the model-level display key correctly.
- Modifying the `modelBelongsToImplFamily` function — its logic for `custom` family is correct; the issue is the stored model value, not the family matching.
- Adding a new CSV column or schema migration for the model field — the `model` column already exists in `STATS_HEADERS` and the measurement database schema.

## Success Criteria
> **Falsifiability rule (ADR 0039 Part 2):** Each criterion must be falsifiable. Forbidden: subjective adjectives ("easy, fast, simple, intuitive, user-friendly, responsive, quick, efficient" without an attached metric) and vague quantifiers ("multiple, several, some, many, few, various"). For refactor / condense / migration missions, the criterion must enumerate the specific elements (rules, files, behaviours) that must survive — generic phrases like "preserve critical content" are not sufficient.

- **SC-1**: `recordStageStatsSafe` passes a non-null `model` value to `accumulateStageStats` when `resolveAgentModel(implementer, worktree)` returns a configured model string for the agent family. Evidence: a test asserting the `model` parameter is not `null` for a custom agent with a configured model, using `test/stats.test.ts` or a new test file.
- **SC-2**: `telemetryToStatsFields` returns the actual model name (not `agentFamily`) in the `model` field when `telemetry.model` is null/empty but the `model` option is a non-empty string. Evidence: unit test in `test/stats.test.ts` asserting `telemetryToStatsFields(null, { agentFamily: 'custom', model: 'qwen3.6-27b-q8' }).model === 'qwen3.6-27b-q8'`.
- **SC-3**: The weekly stats report (`` `px stats` ``) renders the actual model name for custom-agent missions in the "Agent performance" table when the measurement row has a populated `model` column. Evidence: existing `test/stats.test.ts` task-2213 test (`assert.match(plain, /qwen3\.5/)` and `assert.doesNotMatch(spendSection, /custom/)`) passes with the fix, plus any new regression test added.
- **SC-4**: `resolveAgentModel('custom', rootDir)` returns the configured model string from `adapters.agents.models.custom` when that config entry exists. Evidence: existing `test/product-config.test.ts` test `"resolveAgentModel returns the configured model for a listed family"` extended to cover the `custom` family.
- **SC-5**: Legacy CSV reimport via `px stats import-legacy --csv-file <path> --apply` preserves the `model` column from the source CSV — rows with a populated model column retain that value in the measurement database. Evidence: existing `test/legacy-stats-csv-import.test.ts` tests pass unchanged.

## Risks and Assumptions
- **Risk**: The `adapters.agents.models.custom` config entry may not be set on all machines. The fix must handle `null` from `resolveAgentModel` gracefully — when no model is configured, falling back to `agentFamily` ("custom") is still the correct behavior for unconfigured environments.
- **Risk**: The legacy CSV may have an empty `model` column for custom-agent rows, meaning reimport alone cannot recover model names for those rows. The fix in the recording path ensures future rows are correct.
- **Assumption**: The opencode export JSON (`opencode export <session-id>`) contains the model name in a field parseable by `extractModelName` (e.g., `info.model.id`, `model`, `metadata.model`). The `test/opencode-telemetry.test.ts` test suite confirms this for current opencode versions.
- **Assumption**: The measurement database schema already includes the `model` column (it does — `STATS_HEADERS` includes `'model'` at index 7).
- **Assumption**: The `extractOpencodeTelemetryFromExport` call in `src/adapters/agents/opencode.ts:360` already passes `model || undefined` as the `fallbackModel` argument, so the configured model is available to the telemetry extraction.

## Checkpoints
- CP 1: Author a failing reproduction test that locks the bug before any fix is written. The test goes in `test/stats.test.ts` (or `test/task-2337-repro.test.ts`) and asserts that a custom-agent measurement row with a populated `model` column renders the model name (not `custom`) in the weekly stats report. The test must fail on the parent commit (the `model` column is missing or empty for custom rows in the recording path) and pass once the fix lands.
- CP 2: Fix the model propagation in the recording path — ensure `resolveAgentModel('custom', worktree)` is called and its result flows through `recordStageStatsSafe` → `accumulateStageStats` → `telemetryToStatsFields` → stored measurement row. Verify with the reproduction test turning green.
- CP 3: Add targeted unit tests for `telemetryToStatsFields` model fallback chain and `resolveAgentModel` for the `custom` family. Verify all existing tests in `test/stats.test.ts`, `test/opencode-telemetry.test.ts`, and `test/product-config.test.ts` pass.
- CP 4: Validate legacy CSV reimport preserves model data. Run `px stats import-legacy` against a sample CSV with custom-agent rows and verify the `model` column is populated in the measurement database.

### Checkpoint Documentation Requirements
Every checkpoint document (CP-N.md) MUST include:
- A summary of work done
- A `## Goal Check` section
- A 3-column pipe-delimited markdown table with columns: Criterion | Evidence | Status
- At least one evidence row per criterion using verifiable references. Parallix already accepts:
  1. **File:line references** — e.g., `src/adapters/cli/commands/stats.ts:1855` (must point to an existing file and line)
  2. **Test names** — e.g., `"task-2213: renderWeeklyStatsReport spend table groups a mission by its model row"` (must match a test name in the repo)
  3. **Test file paths** — e.g., `test/stats.test.ts` (must be an existing test file)
  4. **ADR references** — e.g., `ADR 0053` (must correspond to an existing file under `docs/adr/`)
  5. **Recognized repo commands or paths** — e.g., `` `npm test -- test/stats.test.ts` ``, `` `./scripts/verify-local.sh all` ``, or `` `node --test test/stats.test.ts` ``
- Raw `stat`/`ls` output or generic prose may appear as supplemental context, but pair them with one of the accepted references above
- A non-generic `Next action:` line at the bottom

Example Goal Check table:

| Criterion | Evidence | Status |
|---|---|---|
| Custom model renders in agent performance table | `test/stats.test.ts`, `"task-2213: renderWeeklyStatsReport spend table groups a mission by its model row"` | PASS |
| telemetryToStatsFields uses model option over agentFamily | `src/adapters/cli/commands/stats.ts:1855`, `` `node --test test/stats.test.ts` `` | PASS |
| Verification gate ran | `` `./scripts/verify-local.sh all` `` | PASS |

## Gates
- [ ] `./scripts/verify-local.sh all`

## Restricted Areas
- `src/adapters/cli/commands/stats.ts` — only modify the model propagation in `telemetryToStatsFields` and `recordStageStats`/`accumulateStageStats`; do not refactor other functions (the file is 2500+ lines with `@ts-nocheck`).
- `src/adapters/agents/opencode-telemetry.ts` — only verify the `fallbackModel` parameter is correctly used; do not modify the `extractModelName` parsing logic.
- `src/adapters/agents/opencode.ts` — only verify the `processResult` call to `extractOpencodeTelemetryFromExport` passes the model; do not change the launcher invocation or session handling.
- `src/adapters/review/review-loop.ts` — only modify the `model` argument in `recordStageStatsSafeFn` calls; do not change the review loop flow.
- `src/adapters/config/product-config.ts` — only verify `resolveAgentModel` works for the `custom` family; do not change the function.

## Stop Rules
- Stop if `resolveAgentModel('custom', worktree)` returns a valid model string but the fix still does not propagate it to the stored measurement row — the issue may be in a different code path (e.g., `recordStageStats` vs `accumulateStageStats`) and requires investigation.
- Stop if the legacy CSV reimport fails because the old stats file uses a schema that does not include the `model` column — the legacy import path is out of scope for schema migration.
- Stop if more than 2 files outside the recording path (`stats.ts`, `review-loop.ts`, `opencode-telemetry.ts`, `product-config.ts`) require changes — re-scope the mission.

Reproduction-Test: test/task-2337-repro.test.ts
