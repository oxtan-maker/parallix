# Mission: px stats aggregates by model instead of agent family (task-1376)

## Goal

Change `px stats` weekly and range agent performance tables to aggregate by the actual model name (e.g. `qwen3.5`, `llama3`) instead of the agent family label (currently `custom` for local AI). When the `model` column is populated in the stats CSV, the "Agent family" display column must show that model value; when `model` is empty, fall back to the current `implementer` behaviour so existing cloud-agent rows are unaffected.

## Why Now

The user runs local AI experiments and needs to see which specific model performs best in terms of mission throughput and PR fix rounds. Currently `px stats` collapses all local AI runs into a single "custom" row, making it impossible to compare model-level performance. This blocks the primary use case of the stats dashboard: evaluating local model iterations.

## Refinement Signals

- Estimated agent % usage limit: 25-50%
- Confidence: High
- Selection note: activate as-is
- Main drivers: user feedback on local AI observability, model-level granularity needed for experimentation

## Scope

- Modify `summarizeAgentWindow` in `lib/commands/stats.js` to use `model` as the grouping key when non-empty, falling back to `implementer` when `model` is blank.
- Update `renderWeeklyStatsReport` and `renderRangeStatsReport` table headers and rendering to reflect the new grouping key name ("Agent family" remains the column label; the values change).
- Update `colorAverageFixRounds` and `colorMissionCounts` so colouring applies to the new grouped rows.
- Update `summarizeAgentWindow` sorting to sort by the display key (model or implementer) alphabetically.
- Add/update unit tests in `test/stats.test.js` covering: (a) local AI rows grouped by model, (b) mixed cloud + local AI rows both present, (c) empty model falls back to implementer.

## Out of Scope

- Changes to `px stats <mission>` per-phase telemetry reports (those already show model per row).
- Changes to the legacy retrospective CSV report path (`generateMarkdownReport`).
- Changes to stats data ingestion, CSV schema, or `telemetryToStatsFields`.
- Changes to `px stats-backfill`.
- Any changes to the `fmt.agent` colouring logic beyond what is needed for the new display values.

## Success Criteria

> **Falsifiability rule (ADR 0039 Part 2):** Each criterion must be falsifiable.

1. **Model grouping replaces agent-family grouping for local AI:** When the stats CSV contains rows with `model` populated (e.g. `qwen3.5`, `llama3`) and `implementer` equal to `custom`, `summarizeAgentWindow` must produce separate groups keyed by the model name, not by `custom`. Verifiable by calling `stats._internals.summarizeAgentWindow` with test data containing `model: 'qwen3.5'` and `implementer: 'custom'` and asserting the returned array has entries keyed by `'qwen3.5'`, not `'custom'`.

2. **Empty model falls back to implementer:** When `model` is an empty string, `summarizeAgentWindow` must group by `implementer` exactly as it does today. Verifiable by passing rows with `model: ''` and `implementer: 'claude'` and asserting the result contains a `'claude'` entry with the same `missions` and `averageFixRounds` values as the pre-change baseline.

3. **Weekly report displays model values:** `renderWeeklyStatsReport` must show the model name in the "Agent family" column for rows where `model` is populated. Verifiable by asserting `renderWeeklyStatsReport` output matches `/qwen3\.5\s+\d+\s+\d+\.\d+/` when test data includes a `model: 'qwen3.5'` row.

4. **Range report displays model values:** `renderRangeStatsReport` must show the model name in the "Agent family" column identically to the weekly report. Verifiable by asserting `renderRangeStatsReport` output matches `/qwen3\.5\s+\d+\s+\d+\.\d+/` under the same test conditions.

5. **Cloud-agent rows unaffected:** Rows with `model` populated from cloud providers (e.g. `gpt-5`, `gemini-2.5-pro`) must continue to appear in the tables grouped by their model name. Verifiable by passing rows with `model: 'gpt-5'` and confirming the output contains a `'gpt-5'` entry.

6. **All existing tests pass:** `npm test` completes with zero failures. Specifically, the following existing tests must continue to pass: `renderWeeklyStatsReport calculates current and previous seven-day windows`, `renderRangeStatsReport filters inclusive boundary dates`, `renderWeeklyStatsReport sorts agent tables alphabetically`, `stats command prints workflow weekly tables`, and `stats command prints workflow arbitrary range tables`.

## Risks and Assumptions

- **Assumption:** The `model` column in the stats CSV is reliably populated for local AI telemetry. If `extractModelName` in `opencode-telemetry.js` fails to extract the model, rows will fall back to `implementer` grouping automatically.
- **Risk:** Changing the grouping key may affect downstream consumers that parse the `px stats` CLI output. The output format (column positions) stays the same; only cell values change.
- **Risk:** Mixed-agent missions where different models participate in different stages could create apparent "ghost" model entries. This is acceptable — the deduplication by `repo+mission` (line 611 of stats.js) already limits each mission to one row per implementer group.
- **Assumption:** The `model` field is stable within a mission's telemetry rows. If a mission records telemetry from multiple models across stages, the first row's model will be used for the implementer-level aggregation.

## Checkpoints

- CP 1: Identify the exact grouping logic in `summarizeAgentWindow` (stats.js:602-638) and confirm that `model` is populated in the CSV for local AI rows by inspecting sample telemetry output.
- CP 2: Implement the grouping change in `summarizeAgentWindow` — use `model` when non-empty, else `implementer`. Add unit tests.
- CP 3: Run `npm test` to verify all existing tests pass and new tests cover model grouping and fallback.

## Gates

- [ ] ./scripts/verify-local.sh docs
- [ ] npm test passes with zero failures

## Restricted Areas

- Do not modify the CSV schema or `STATS_HEADERS` array.
- Do not modify `telemetryToStatsFields`, `opencode-telemetry.js`, or `recordStageStats` — the model is already being recorded.
- Do not modify `generateMarkdownReport` (legacy retrospective path).
- Do not modify `px stats-backfill`.

## Stop Rules

- Stop if the `model` field is not reliably populated for local AI telemetry — escalate to investigate `opencode-telemetry.js` `extractModelName` first.
- Stop if changing the grouping key breaks 3+ existing tests — reassess the approach (consider whether a display-level transformation is cleaner than a grouping-level change).
- Stop if the fix requires changing the CSV write path or schema — scope is display/reporting only.
