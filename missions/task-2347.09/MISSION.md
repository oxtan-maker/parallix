# Mission: Project experiment cohorts for mission comparison (task-2347.09)

## Goal
Enable cohort-based mission comparison so operators can answer "did this workflow change improve delivery?" by grouping completed missions by experiment dimension (label, model/provider, implementer, date range) and reporting per-cohort metrics always with sample size `n`.

## Why Now
`ConcreteMetricsReadAdapter.usageRecordsToOutcomes` (`src/application/projections/metrics-read-adapter.ts:162`) builds `MissionOutcome` carrying only mission id, repository id, summed duration, and fix-round count, and sets `runs: []`. Labels, implementer, model, provider, tokens, cost, tool calls, and `closedAt` are all discarded — even though `CompletedMissionStatistics` (`src/domain/usage.ts:114`) already models them and `usage_statistics` stores them. The board has no dimension to slice by and no way to attach a sample size to a comparison. TASK-2347.08 (statistics projection fix) is the prerequisite and must merge first.

## Refinement Signals
- Predicted NEL bucket: Medium (81–235)
- Confidence: High
- Selection note: activate as-is after TASK-2347.08 merges
- Main drivers: extend `MissionOutcome` type with 7+ fields, new cohort grouping/computation module, `px stats` cohort subcommand, board presentation update, 4+ targeted tests

## Scope
- Extend `MissionOutcome` (`src/domain/usage.ts`) to carry `labels`, `implementer`, `modelsInvolved`, `totalTokens`, `totalCostUsd`, `totalToolCalls`, `closedAt`
- Extend `usageRecordsToOutcomes` (`src/application/projections/metrics-read-adapter.ts`) to populate all new fields from `UsageRecord` rows and `ClosedMission` data
- Add cohort grouping function: group completed missions by experiment dimension (mission label first, then model/provider/implementer, date range)
- Add per-cohort metrics: `n`, median and p75 end-to-end cycle time, median dwell in `active` and `review`, review bounce rate, tokens/runtime/cost per completed mission, net engineering lines
- Derive review bounce rate from `review → active` lifecycle transitions in `board_lane_events`, not from `usage_statistics` `pr_fix_rounds`
- Expose cohort comparison through `px stats` CLI (new subcommand or flag) and the board read model
- Every cohort figure rendered with its sample size `n`; cohorts below a stated threshold marked as low-sample

## Out of Scope
- Statistical significance testing (t-tests, confidence intervals)
- Persisting experiment definitions as first-class entities
- Charting beyond tabular comparison
- Real-time cohort updates (batch-computed on `px stats` invocation)

## Success Criteria
> **Falsifiability rule (ADR 0039 Part 2):** Each criterion must be falsifiable. Forbidden: subjective adjectives ("easy, fast, simple, intuitive, user-friendly, responsive, quick, efficient" without an attached metric) and vague quantifiers ("multiple, several, some, many, few, various"). For refactor / condense / migration missions, the criterion must enumerate the specific elements (rules, files, behaviours) that must survive — generic phrases like "preserve critical content" are not sufficient.

- SC1: `MissionOutcome` interface declares `labels`, `implementer`, `modelsInvolved`, `totalInputAndOutputTokens`, `totalCostUsd`, `totalToolCalls`, `closedAt` — verified by a test that asserts each field is present on a constructed outcome
- SC2: `usageRecordsToOutcomes` populates all 7 new fields from `UsageRecord` rows and `BoardLaneEventEntry` data — verified by a test with known input records and asserted output values
- SC3: A cohort comparison over two label groups returns `n`, median cycle time, p75 cycle time, median active dwell, median review dwell, review bounce rate, tokens/mission, cost/mission, NEL — asserted against hand-computed values from 6+ seeded missions
- SC4: Review bounce rate computed from `review → active` transitions in `board_lane_events` (not `pr_fix_rounds`) — verified by a test with 3 missions where 2 have `review → active` transitions and expected bounce rate is `2/3`
- SC5: No cohort figure rendered without its sample size `n` — verified by a presentation test that asserts every cohort row includes `n` column
- SC6: Cohort with `n < 5` marked as low-sample (not presented as comparable) — verified by a test asserting the low-sample flag on a cohort of 3 missions
- SC7: `./scripts/verify-local.sh all` passes on the final tree

## Risks and Assumptions
- TASK-2347.08 merges before this mission starts; `usageRecordsToOutcomes` signature stable after 2347.08
- `ClosedMission` data (labels, assignee, netEngineeringLines) available via `MissionReadAdapter` for the cohort computation step
- `board_lane_events` table contains complete `review → active` transition history for missions in the comparison window
- Existing `px stats` report structure accommodates a new cohort subcommand without breaking current `--weekly`/`--range` modes
- NEL values are populated on all completed missions (guarded by `StatisticsRuleViolation` in `completedMissionStatistics`)

## Checkpoints
- CP 1: Extend `MissionOutcome` type and `usageRecordsToOutcomes` to carry labels, implementer, models, tokens, cost, tool calls, closedAt. Tests: `test/domain-outcomes.test.ts` — new test asserts all 7 fields present and populated from known input records
- CP 2: Build cohort grouping function and per-cohort metrics (n, median/p75 cycle time, median dwell, bounce rate, tokens/runtime/cost/mission, NEL). Tests: `test/task-2347.09-cohort-metrics.test.ts` — hand-computed values for 2 label groups with 6+ seeded missions
- CP 3: Derive review bounce rate from `review → active` lifecycle transitions. Tests: `test/task-2347.09-bounce-rate.test.ts` — 3 missions, 2 bounces, expected rate 0.667
- CP 4: `px stats` cohort subcommand + board presentation. Sample size always shown. Low-n threshold (n < 5) marked. Tests: `test/task-2347.09-cohort-presentation.test.ts` — asserts n column present, low-sample flag on small cohort
- CP 5: Verification gate. `./scripts/verify-local.sh all` passes. Final Goal Check table with file:line evidence

### Checkpoint Documentation Requirements
Every checkpoint document (CP-N.md) MUST include:
- A summary of work done
- A `## Goal Check` section
- A 3-column pipe-delimited markdown table with columns: Criterion | Evidence | Status
- At least one evidence row per criterion using verifiable references. Parallix already accepts:
  1. **File:line references** — e.g., `src/domain/usage.ts:96` (must point to an existing file and line)
  2. **Test names** — e.g., `"cohort comparison returns n for each group"` (must match a test name in the repo)
  3. **Test file paths** — e.g., `test/task-2347.09-cohort-metrics.test.ts` (must be an existing test file)
  4. **ADR references** — e.g., `ADR 0053` (must correspond to an existing file under `docs/adr/`)
  5. **Recognized repo commands or paths** — e.g., `` `npm test -- test/task-2347.09-cohort-metrics.test.ts` ``, `` `./scripts/verify-local.sh all` ``
- Raw `stat`/`ls` output or generic prose may appear as supplemental context, but pair them with one of the accepted references above
- A non-generic `Next action:` line at the bottom

Example Goal Check table:

| Criterion | Evidence | Status |
|---|---|---|
| MissionOutcome carries labels field | `src/domain/usage.ts:96` | PASS |
| Cohort comparison returns n for each group | `test/task-2347.09-cohort-metrics.test.ts`, `"cohort comparison returns n for each group"` | PASS |
| Verification gate ran | `./scripts/verify-local.sh all` | PASS |

## Gates
- [ ] `./scripts/verify-local.sh all`

## Restricted Areas
- `src/domain/mission.ts` — modify only to add fields needed by `MissionOutcome` extension; do not change `MissionData`, `ClosedMission`, or `MissionStatus` types
- `src/application/projections/metrics.ts` (`buildMetrics`) — do not change existing metric series; add cohort metrics as a new optional field on `BoardMetrics`
- `src/adapters/cli/commands/stats.ts` — add cohort subcommand without modifying `--weekly`, `--range`, or `--mission` paths
- `src/domain/usage.ts` — `completedMissionStatistics()` signature and existing return fields unchanged; only `MissionOutcome` interface extended

## Stop Rules
- Stop if TASK-2347.08 has not merged and `usageRecordsToOutcomes` signature is unstable
- Stop if cohort grouping requires `ClosedMission` data unavailable from `MissionReadAdapter` (would need adapter change outside scope)
- Stop if `board_lane_events` lacks `review → active` transitions for the comparison window (bounce rate cannot be derived)
- Stop if static analysis (`./scripts/verify-local.sh static-analysis`) fails on changed files after 3 rounds of fixes — escalate to mission review
