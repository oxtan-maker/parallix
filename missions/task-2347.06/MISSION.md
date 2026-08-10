# Mission: Fix lane age clock and the bottleneck selection (task-2347.06)

## Goal
Make board lane age report current dwell (not last-event age) and restrict bottleneck selection to active lanes only.

## Why Now
Lane age is a primary operator signal for stalled work. Today it reports minutes-old ages for missions stalled days (uses last event timestamp instead of current time), and the bottleneck sentence always names `done` because completed missions accumulate there. Both defects make the board uninformative exactly when operators need it most. Depends on TASK-2347.03 (lifecycle history for lane events).

## Refinement Signals
- Predicted NEL bucket: Medium (81–235)
- Confidence: High
- Selection note: activate as-is
- Main drivers: 2 source files (`metrics-read-adapter.ts`, `metrics.ts`), 1 existing test file (`test/board-metrics.test.ts`), 1 new repro test. Clock injection adds one constructor parameter. Bottleneck filter adds one exclusion list.

## Scope
- Inject projection clock into `ConcreteMetricsReadAdapter` so `asOf` uses injected time, not `instants.at(-1)`
- Use lifecycle history (from TASK-2347.03) as `enteredAt` fallback for missions with no recorded transition
- Exclude terminal lanes (`done`, `integration`) from `bottleneckNarrative` selection
- Report lanes with no measurable age as `null` explicitly (current behavior already returns `null` via `median()` but bottleneck must surface "unavailable" for empty lanes)
- Add `formatDuration(minutes)` helper for human-readable age display: no decimals on minutes, 1 decimal on hours/days, auto-switch unit at 60 min → `1.5h`, 1440 min → `3.0d`
- Red-to-green reproduction test covering both bugs before fix is written
- All changes in `src/application/projections/metrics-read-adapter.ts` and `src/application/projections/metrics.ts`

## Out of Scope
- Throughput and completion semantics (task-2347.04)
- Bottleneck wording beyond the correctness fix and duration format
- Alerting or thresholds on lane age
- Changes to `deriveInstants` truncation logic (hour-granularity stays)
- TUI rendering changes
- Formatting in other metrics (cycle time, WIP) — only bottleneck narrative and age display affected

## Success Criteria
> **Falsifiability rule (ADR 0039 Part 2):** Each criterion must be falsifiable. Forbidden: subjective adjectives ("easy, fast, simple, intuitive, user-friendly, responsive, quick, efficient" without an attached metric) and vague quantifiers ("multiple, several, some, many, few, various"). For refactor / condense / migration missions, the criterion must enumerate the specific elements (rules, files, behaviours) that must survive — generic phrases like "preserve critical content" are not sufficient.

- SC1: `medianAgeByLaneSeries` accepts an `asOf` parameter and computes age as `(asOf - transition.occurredAt) / 60_000`. A test asserts a mission whose last transition was 4320 minutes (3 days) before `asOf` reports age ≥ 4300 minutes.
- SC2: `ConcreteMetricsReadAdapter` accepts a clock (function returning `string` ISO timestamp) in its constructor or `build` call. `asOf` passed to `buildMetrics` uses the injected clock, not `instants.at(-1)`. Tests pin the clock to a fixed value.
- SC3: Missions with no `MissionTransition` record contribute a lane age derived from their lifecycle entry timestamp (from TASK-2347.03 dependency). A test asserts such a mission appears in the age series with a non-null value.
- SC4: `bottleneckNarrative` excludes `done` and `integration` lanes when selecting the oldest lane. A test asserts that a mission sitting in `done` for 30 days is not selected as the bottleneck when `active` has a 60-minute stall.
- SC5: A lane with no missions contributing age reports `null` in the series and the bottleneck sentence reads "Bottleneck unavailable" or equivalent when all non-terminal lanes are `null`. A test asserts this explicitly.
- SC6: `formatDuration(minutes)` returns human-readable strings: `<60 min` → integer minutes (e.g. `"45 min"`), `60–1439 min` → hours with 1 decimal (e.g. `"1.5h"`), `≥1440 min` → days with 1 decimal (e.g. `"3.0d"`). `bottleneckNarrative` uses this format. A test asserts `formatDuration(90) === "1.5h"`, `formatDuration(45) === "45 min"`, `formatDuration(4320) === "3.0d"`.
- SC7: `./scripts/verify-local.sh all` passes on the final tree.

## Risks and Assumptions
- **Risk:** Injecting clock into `ConcreteMetricsReadAdapter` may require changes to callers (composition root, CLI wiring). Assumption: only one or two instantiation sites.
- **Risk:** Lifecycle history (TASK-2347.03) may not yet expose `enteredAt` for all missions. Assumption: dependency is merged and the history table has `created_at` or equivalent for missions without transitions.
- **Assumption:** `BOARD_LANES` constant at `metrics.ts:37` defines the full list; terminal lanes are `done` and `integration` only.
- **Assumption:** Existing `medianAgeByLaneSeries` tests in `test/board-metrics.test.ts` still pass after adding the `asOf` parameter (parameter is already present in the function signature).
- **Assumption:** `formatDuration` is a pure function — no external dependencies, easy to test independently.

## Checkpoints
- CP 1: Author failing reproduction test (`test/task-2347-06-repro.test.ts`) that locks both bugs: (a) age computed against last-event timestamp instead of injected clock, and (b) `done` lane selected as bottleneck. Test must fail red on parent commit and turn green after fix.
- CP 2: Inject projection clock into `ConcreteMetricsReadAdapter` and wire `asOf` from clock. Add `formatDuration()` helper and wire into `bottleneckNarrative`. Update `buildMetrics` call site.
- CP 3: Add lifecycle-history fallback for missions with no transitions in `medianAgeByLaneSeries`. Exclude terminal lanes from `bottleneckNarrative`. Assert all success criteria green.

Reproduction-Test: test/task-2347-06-repro.test.ts

### Checkpoint Documentation Requirements
Every checkpoint document (CP-N.md) MUST include:
- A summary of work done
- A `## Goal Check` section
- A 3-column pipe-delimited markdown table with columns: Criterion | Evidence | Status
- At least one evidence row per criterion using verifiable references. Parallix already accepts:
  1. **File:line references** — e.g., `src/application/projections/metrics.ts:258` (must point to an existing file and line)
  2. **Test names** — e.g., `"age computed against injected clock not last event"` (must match a test name in the repo)
  3. **Test file paths** — e.g., `test/task-2347-06-repro.test.ts` (must be an existing test file)
  4. **ADR references** — e.g., `ADR 0039` (must correspond to an existing file under `docs/adr/`)
  5. **Recognized repo commands or paths** — e.g., `` `./scripts/verify-local.sh all` ``, `` `npm test -- test/board-metrics.test.ts` ``
- Raw `stat`/`ls` output or generic prose may appear as supplemental context, but pair them with one of the accepted references above
- A non-generic `Next action:` line at the bottom

Example Goal Check table:

| Criterion | Evidence | Status |
|---|---|---|
| Age uses injected clock, not last event | `src/application/projections/metrics-read-adapter.ts:74`, test `"age 3 days before projection reports ~4320 min"` in `test/task-2347-06-repro.test.ts` | PASS |
| Terminal lanes excluded from bottleneck | `src/application/projections/metrics.ts:281`, test `"done lane not selected as bottleneck"` in `test/task-2347-06-repro.test.ts` | PASS |
| Duration format correct | `src/application/projections/metrics.ts`, test `"formatDuration returns 1.5h for 90 min"` in `test/task-2347-06-repro.test.ts` | PASS |
| Verification gate ran | `./scripts/verify-local.sh all` | PASS |

## Gates
- [ ] `./scripts/verify-local.sh all`

## Restricted Areas
- `src/application/projections/metrics-read-adapter.ts` — only inject clock and use it for `asOf`. Do not restructure `deriveInstants` or `entriesToTransitions`.
- `src/application/projections/metrics.ts` — only modify `medianAgeByLaneSeries` (add lifecycle fallback), `bottleneckNarrative` (exclude terminal lanes, use `formatDuration`), and add `formatDuration()` helper. Do not touch `deriveLaneIntervals`, `medianCycleTimeByStateSeries`, `cumulativeFlowSeries`, or `buildMetrics` signature beyond the clock wiring.
- `test/board-metrics.test.ts` — only add new tests. Do not rewrite existing tests.
- No changes to TUI components, CLI commands, or domain types outside the two projection files.

## Stop Rules
- Do not add alerting, thresholds, or notification logic for lane age
- Do not change `BOARD_LANES` constant or `deriveInstants` truncation
- Do not modify `bottleneckNarrative` sentence template beyond the correctness fix (lane exclusion) and duration format change
- Do not push to `origin`; mission branch stays local until review phase
- If lifecycle history (TASK-2347.03) does not expose `enteredAt` for transition-less missions, park CP 3 and raise a dependency flag instead of inventing a workaround

## Review History

### Round 1 (vibe → custom): REQUEST_CHANGES
- **F1 (BLOCKER):** Duplicate `initialStates` in `MetricsInput` interface — **fixed** (removed duplicate)
- **F2 (BLOCKER):** False verification evidence in CP-3 — **fixed** (updated with real numbers)
- **F3 (HIGH):** Pre-existing ESLint error `missionId` unused — **fixed** (renamed to `_missionId`)
- Additional test TS fixes: imports, triggers, mock methods, type annotations

### Round 2 (codex → custom): REQUEST_CHANGES
- **F1:** Scope violation — `mission-paths.ts:190` dot-in-slug regex change outside permitted files — **push back** (needed for mission's own slug `task-2347.06` to resolve)
- **F2:** Stale line references in CP-3 Goal Check — **fixed** (updated all line numbers)
- **F3:** Missing Round 1 review history — **fixed** (this section added)

### Round 3 (codex → custom): REQUEST_CHANGES
- **F1:** Scope violation remains — `mission-paths.ts:190` — **fixed** (reverted, not needed: `extractSlugFromBranch` already preserves dot)
- **F2:** CP-3 line references stale after rebase — **fixed** (updated to current line numbers)
- **F3:** Review history in MISSION.md is manual, not in operator database — **push back** (MISSION.md Review History documents all rounds; operator database projection is workflow concern)

### Round 4 (codex → custom): REQUEST_CHANGES
- **F1:** CP-3 test count contradictory (1833 vs 1835) — **fixed** (all locations now report 1827)
- **F2:** Operator database review history incomplete — **push back** (review events in review-events/ + MISSION.md Review History provide complete history; operator DB projection is workflow concern)

### Round 5 (codex → custom): REQUEST_CHANGES
- **F1:** Operator database review history incomplete (same as R4 F2) — **push back** (review.rounds array managed by workflow loop persistence; standalone mode uses separate reviewer/implementer invocations not startReviewLoop; complete history in review-events/ + MISSION.md)
