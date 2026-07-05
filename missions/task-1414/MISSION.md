# Mission: Extend weekly stats with per-stage usage-spend breakdown (task-1414)

## Goal
Add a new weekly stats table to `px stats` that shows, for each agent row already surfaced in `Agent performance this week`, where that agent spent its tracked usage across the workflow stages `draft`, `execute`, `review`, `follow-up`, `default`, and `total`, using the correct spend metric per agent family/model group.

## Why Now
The current weekly stats output tells us how many missions each agent completed and its average PR fix rounds, but it does not show where an agent's quota or cost is being consumed. The backlog request is specifically asking for stage attribution, not just totals: operators need to see whether a model is spending its budget in draft, execute, review, or follow-up so routing decisions can be based on actual spend patterns instead of mission counts alone. The existing stats schema already records the needed raw inputs by stage (`openai_usage_after`, `duration_minutes`, `cost_usd`, `stage`, `model`, `implementer`), so the missing piece is the report-level aggregation and presentation.

## Refinement Signals
- Predicted NEL bucket: Small (0–80)
- Confidence: Medium
- Selection note: activate as-is
- Main drivers: report-only change inside `lib/commands/stats.ts`, existing stage telemetry schema already present, likely isolated regression coverage in `test/stats.test.js`

## Scope
- Extend the weekly stats rendering path in `lib/commands/stats.ts` so the default `px stats` report includes a second agent-oriented table after `Agent performance this week` for the current-week window.
- Use the same row identity/grouping that `summarizeAgentWindow()` currently uses for `Agent performance this week`, including model-name grouping when present and fallback to implementer family when not.
- Aggregate stage spend across the current-week window using the canonical report stages:
  - `draft`
  - `execute` (stored as stage `active`, displayed as `execute`)
  - `review`
  - `follow-up`
  - `default`
  - `total`
- Define one metric family per row based on the grouped agent identity and/or stored row provenance:
  - Codex / OpenAI-backed rows use usage percentage snapshots from `openai_usage_after`
  - Claude rows use dollar spend from `cost_usd`
  - Mistral rows use dollar spend from 'cost_usd'
  - Custom/local-model rows use `duration_minutes`
- Render each populated cell as `<metric> (<share %>)`, where the percentage is that stage's share of the row's `total` for the same metric family, rounded consistently and shown only when the total is non-zero.
- Preserve existing current-week and previous-week mission count tables plus the existing `Agent performance` tables; this mission adds the new breakdown table and does not remove or rename the old ones.
- Add focused tests in `test/stats.test.js` that cover the new table layout, stage aliasing (`active` -> `execute`), row grouping parity with the existing agent table, and metric-family-specific aggregation rules.

## Out of Scope
- Changing the persisted stats CSV schema or adding new columns.
- Backfilling historical rows or rewriting existing telemetry data.
- Changing mission-level `px stats <slug>` phase reports.
- Changing how telemetry is captured for Codex, Claude, Custom/OpenCode, or Mistral launches.
- Adding arbitrary date-range or previous-week stage-spend tables unless the existing implementation path makes that effectively free and non-disruptive.
- Reworking the existing `Agent performance this week` grouping semantics beyond what is required to keep the new table aligned with it.

## Success Criteria
> **Falsifiability rule (ADR 0039 Part 2):** Each criterion must be falsifiable. Forbidden: subjective adjectives ("easy, fast, simple, intuitive, user-friendly, responsive, quick, efficient" without an attached metric) and vague quantifiers ("multiple, several, some, many, few, various"). For refactor / condense / migration missions, the criterion must enumerate the specific elements (rules, files, behaviours) that must survive — generic phrases like "preserve critical content" are not sufficient.

- SC-1: The default weekly report from `renderWeeklyStatsReport()` in [lib/commands/stats.ts](/home/magnus/code/parallix-task-1414/lib/commands/stats.ts) contains a new current-week agent spend table whose columns are exactly `draft`, `execute`, `review`, `follow-up`, `default`, and `total`.
- SC-2: The rows in the new table use the same display keys and ordering as `Agent performance this week` for the same input dataset; a model-grouped local agent row (for example `qwen3.5`) appears under that model name rather than collapsing back to `custom`.
- SC-3: For a Codex/OpenAI row with current-week stage rows carrying `openai_usage_after` values in more than one stage, the new table shows per-stage usage values and percentages derived from those usage numbers, and the `execute` column is fed by stored stage `active`.
- SC-4: For a Claude row with current-week stage rows carrying `cost_usd`, the new table shows dollar values and percentages derived from `cost_usd`, not token counts, duration, or `openai_usage_after`.
- SC-5: For a Custom/local-model row with current-week stage rows carrying `duration_minutes`, the new table shows duration values and percentages derived from `duration_minutes`, not cost or usage percentage.
- SC-6: Rows with no non-zero spend for a given metric family render a stable empty-state value rather than misleading `0%` share math or provider-inappropriate numbers.
- SC-7: Existing assertions in [test/stats.test.js](/home/magnus/code/parallix-task-1414/test/stats.test.js) covering the current and previous week summary tables and the existing `Agent performance this week` table still pass without reducing their coverage scope.
- SC-8: `./scripts/verify-local.sh all` passes on the final tree, and because execution will touch `lib/`, `./scripts/verify-local.sh static-analysis` is listed as a required execution/integration gate even if not run during draft.

## Risks and Assumptions
- Risk: `openai_usage_after` is a stage snapshot/max-style metric, not a true additive consumption metric. Assumption for this mission: the requested Codex view is the stored usage number already surfaced elsewhere, aggregated consistently enough to provide stage attribution.
- Risk: The grouping key from `summarizeAgentWindow()` may mix rows whose spend metric families differ if provider/model data is inconsistent. Mitigation: keep the report aligned with existing grouping logic and stop if the data model forces ambiguous mixed-metric rows.
- Risk: Historical rows may omit `stage`, `model`, or `cost_usd`, which can create sparse cells. Mitigation: the new table should degrade honestly rather than fabricate values.
- Assumption: `follow-up` and `default` must be explicit columns even when a dataset has no rows for those stages, because the backlog request names them directly.
- Assumption: This is a `user_value` mission, not `ai_sdlc`, because it changes operator-visible stats behavior rather than workflow internals alone.
- Risk: Previous-week or range-report parity may be requested later. This mission is scoped to the default current-week view first unless implementation reveals a low-risk reuse path.

## Checkpoints
- CP 1: Confirm the exact insertion point and row source in `renderWeeklyStatsReport()` and identify whether a new helper should sit next to `summarizeAgentWindow()` or inside the render path.
- CP 2: Define the spend aggregation contract in code comments/tests before final formatting:
  - Codex/OpenAI rows aggregate `openai_usage_after`
  - Claude rows aggregate `cost_usd`
  - Custom/local rows aggregate `duration_minutes`
  - Stage `active` is displayed as `execute`
- CP 3: Implement the current-week spend table and keep it keyed to the same grouped identities as `Agent performance this week`.
- CP 4: Add regression tests in `test/stats.test.js` for one Codex row, one Claude row, and one Custom/local row, each with stage-distributed data and expected `<metric> (<share %>)` cells.
- CP 5: Run `./scripts/verify-local.sh all` and record whether any follow-up is needed for static-analysis or formatting-only issues before activation.

## Gates
- [x] ./scripts/verify-local.sh all
- [x] ./scripts/verify-local.sh static-analysis

## Restricted Areas
- Do not change `STATS_HEADERS`, row canonicalization rules, or the persisted stats CSV shape in [lib/commands/stats.ts](/home/magnus/code/parallix-task-1414/lib/commands/stats.ts).
- Do not modify telemetry capture modules under `lib/agents/`; this mission consumes stored telemetry rather than changing collection.
- Do not change mission-level phase report semantics in `renderMissionPhaseReport()` unless a shared helper extraction is needed with no output regression.
- Do not alter backlog ownership metadata (`assignee`) or workflow state transitions from this draft.

## Stop Rules
- Stop if the existing stats data model cannot identify one unambiguous spend metric family per grouped row without changing the CSV schema or telemetry capture contracts.
- Stop if keeping the new table aligned with `Agent performance this week` would require changing that table's grouping semantics in a way that would alter current mission counts or agent labels.
- Stop if the requested percentage display cannot be defined consistently for Codex because the stored usage values are non-additive in a way that produces misleading totals; escalate with a concrete counterexample rather than guessing.
- Stop if implementation pressure expands into telemetry backfill, CSV migration, or mission-phase report redesign; those belong in separate follow-up tasks.
