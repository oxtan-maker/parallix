# Mission: Next round of stat fixes (task-2369)

## Goal
Eliminate four live correctness defects so that exactly one runtime path completes an integrated Mission, completion timestamps come from the landed commit, unknown review-fix counts stay unknown, and telemetry never regains completion authority.

## Why Now
TASK-2367 fixed the main production symptom (telemetry no longer owns completion, integration-time stats read lifecycle, historical DB repaired). Post-mission review found these four correctness defects still in live code. They distort rolling-7-day statistics, bias agent comparisons, and leave two completion paths with different semantics. Fix before stats drive a decision window.

## Refinement Signals
- Predicted NEL bucket: Medium (81–235)
- Confidence: High
- Selection note: activate as-is
- Main drivers: 8 acceptance criteria clusters across 3 source files; regression set (R1–R8) exercises CLI orchestration not just service units; no new dependencies or architecture

## Scope
- **Part A** — Remove premature Mission completion from `promoteTaskForIntegrationIfNeeded()` in `src/adapters/cli/commands/integrate.ts`. Promotion does `review → approved` only; no `Mission → done`.
- **Part B** — Preserve correct normal integration path: `persistLandedIntegrationOrAbort()` → `MissionIntegrationService.decideIntegration()` → `integration → done`. Idempotent (retry = same count, resume after an already-landed integration reconciles exactly once).
- **Part C** — Pass landed commit timestamp as `occurredAt` to `decideIntegration()` in `persistLandedIntegrationOrAbort()`. Covers both normal and resumed integration, and partial-closeout recovery, through one timestamp resolution path. The timestamp must be resolved from the *specific* landed commit, not from `git log -1` / HEAD, unless the code has already proven HEAD is exactly that commit.
  - Delivery `completedAt` (the `integration → done` lifecycle event) stays distinct from administrative `closedAt`. If administrative closure intentionally uses closeout/retry time, document that distinction. Do not move the delivery completion timestamp merely to match administrative closure.
- **Part D** — Fix `reviewFixRounds` nullability through the live writer path. Audit and fix where necessary: `defaultPrFixRounds`, `recordActiveStats`, `recordReviewStats`, `recordStageStats`, `accumulateStageStats`, `recordIntegrationStats`. `defaultPrFixRounds()` must not collapse unknown to `'0'`.
  - Carry-forward rule: a real known prior count may be carried forward, but NULL/unavailable records are ignored when searching for a prior known maximum. `[NULL, NULL]` → unknown; `[NULL, 0]` → known 0; `[NULL, 2]` → known 2.
  - A measurement-store read error must not silently manufacture zero — return unknown or fail per existing telemetry-error semantics.
- **Part E** — Fix string-shaped compatibility seam: `measurementToStatsRow()` must not convert `pr_fix_rounds` NULL to `'0'`; round-trip NULL → unknown → NULL via `statsRowToMeasurement()` and `canonicalizeStatsRow()`.
- **Part F** — Contemporary telemetry completion invariant: no legacy `closed`/`isCompletedStatisticsRow` field in live StatsRow/report paths can decide Mission completion.
- **Part G** — Canonical repository identity: new telemetry writes use `resolveCanonicalRepositoryId()` (already in place via `resolveStatsRepoName()`). Verify and add regression if not covered.
- **Part H** — Stats-surface agreement: integration-time report, `npm run dev -- stats`, and BoardMetrics observe same completed population after fix.

## Out of Scope
- Structural splitting or cleanup of `integrate.ts` / `stats.ts` (owned by TASK-2369.x extraction tasks)
- BoardMetrics redesign
- Legacy CSV support removal
- Telemetry redesign
- Broad statistics architecture changes
- Any behavior change outside the four named defects

## Success Criteria
- SC01: `promoteTaskForIntegrationIfNeeded()` does NOT call `missionServices.lifecycle.transition()` with `command: { type: 'integrate' }`. Promotion only changes backlog task status.
- SC02: Exactly one production call path produces `Mission → done`: `persistLandedIntegrationOrAbort()` → `missionServices.integration.decideIntegration()`.
- SC03: `persistLandedIntegrationOrAbort()` resolves landed commit timestamp from git and passes it as `occurredAt` to `decideIntegration()`.
- SC04: `decideIntegration()` lane event `occurredAt` equals landed commit timestamp (not `new Date()`), for both normal and resumed integration.
- SC05: `defaultPrFixRounds()` returns `undefined` (not `'0'`) when no known measurement exists and no prior known value is found.
- SC06: `measurementToStatsRow()` preserves `pr_fix_rounds` NULL as `undefined` (not `'0'`).
- SC07: `canonicalizeStatsRow()` leaves `pr_fix_rounds` as `undefined` when input is unknown (does not apply generic `USAGE_NUMBERS` NULL → `'0'` default).
- SC08: `[0, 2, unknown, unknown]` aggregates to exactly 2 observations in report/cohort output.
- SC09: No contemporary telemetry field (`closed`, `isCompletedStatisticsRow`, `isFinal`) in live StatsRow decides Mission completion.
- SC10: New telemetry writes use `resolveCanonicalRepositoryId()` as repo identity; `product.name` is at most a legacy read alias.
- SC11: Integration-time stats report reads lifecycle history and agrees with `npm run dev -- stats` and BoardMetrics/FLOW on completed Mission population.
- SC12: Regression R1 (promotion cannot complete Mission) fails at baseline and passes after fix.
- SC13: Regression R2 (normal integration completes once) passes; retry remains one.
- SC14: Regression R3 (review-origin integration completes only after landing) passes.
- SC15: Regression R4 (resumed integration uses landed timestamp T1, not retry T2) fails at baseline and passes after fix.
- SC16: Regression R5 (live reviewFixRounds known-zero vs unknown) fails at baseline and passes after fix.
- SC17: Regression R6 (report n excludes unknown) passes.
- SC18: Regression R7 (telemetry cannot complete Mission) passes.
- SC19: Regression R8 (canonical repo identity) passes.
- SC20: `./scripts/verify-local.sh all` passes on final tree.
- SC21: Resume after an already-landed integration reconciles completion exactly once — done event count stays 1, not 2.
- SC22: R4 also asserts decision-window membership follows T1 (the landed timestamp), not T2 (the retry timestamp).
- SC23: The landed timestamp is resolved from the specific landed commit; a bare `git log -1` / HEAD read is not accepted unless HEAD is already proven equal to the landed commit.
- SC24: Delivery completion timestamp is distinct from administrative closeout time where those semantics differ, and the distinction is documented.
- SC25: A measurement-store read failure returns unknown (or fails) — it never manufactures `reviewFixRounds` zero. Carry-forward ignores NULL rows when finding a prior known maximum.
- SC26: No historical/lifetime population re-enters current decision metrics; rolling current/previous 7-day semantics unchanged.
- SC27: `git diff --check` passes; no `.only` and no bare `.skip` introduced; no agent, LLM, mission runner, or network is used by certification tests.

## Risks and Assumptions
- **Risk**: `persistLandedIntegrationOrAbort()` is called from multiple code paths (normal integration and resume) — fix must cover all callers. Mitigation: single timestamp resolution in the function body.
- **Risk**: TASK-2369.01 extraction may change `integrate.ts` seams while this mission runs. Mitigation: adapt to extracted owner rather than duplicating.
- **Risk**: `defaultPrFixRounds()` callers may depend on string return. Mitigation: `recordStageStats()` already accepts `undefined` for `pr_fix_rounds`.
- **Assumption**: Baseline tree has TASK-2367 changes merged (telemetry completion removed, lifecycle-authoritative stats).
- **Assumption**: SQLite measurement store is available in test fixtures for R5/R6.

## Checkpoints
- CP 1: Record `git rev-parse HEAD` as BASELINE_SHA and `git status --short`. Trace current call paths for all 4 defects. Confirm each defect still present (or already fixed with proof). Author red regression tests R1, R4, R5 that fail for the expected reason before any fix is written. R1 (promotion cannot complete Mission) is the primary reproduction test locking the most critical defect.
- CP 2: Fix Part A (remove premature completion from promotion) + Part B (preserve normal path). Verify R1 turns green, R2/R3 pass. Run contradiction sweep for `command: { type: 'integrate' }` in promotion path.
- CP 3: Fix Part C (landed timestamp in `persistLandedIntegrationOrAbort`). Verify R4 turns green. Confirm both normal and resume callers pass `occurredAt`.
- CP 4: Fix Parts D+E (reviewFixRounds nullability through `defaultPrFixRounds`, `measurementToStatsRow`, `canonicalizeStatsRow`). Verify R5/R6 turn green. Round-trip NULL → unknown → NULL.
- CP 5: Fix Parts F+G+H (telemetry completion invariant, canonical repo identity, stats-surface agreement). Verify R7/R8 pass. Final `./scripts/verify-local.sh all` plus `git diff --check`.
  - Contradiction sweep (part of CP 5): search the final tree and classify every relevant match for `command: { type: 'integrate' }`, `promoteTaskForIntegrationIfNeeded`, `decideIntegration`, `new Date().toISOString()`, `pr_fix_rounds ?? 0`, `reviewFixRounds ?? 0`, `defaultPrFixRounds`, `measurementToStatsRow`, `closed`, `isCompletedStatisticsRow`, `product.name`, `resolveStatsRepoName`. Do not bulk-replace search results — classify each one.

### Mutation sensitivity (required for R1, R4, R5)
Explain explicitly why each test would fail under the old implementation. Where practical, prove it locally:
- Temporarily reintroduce `promotion → mission lifecycle integrate` and prove R1 turns red.
- Temporarily use `new Date()` instead of the landed commit timestamp and prove R4 turns red.
- Temporarily restore `unknown → 0` and prove R5/R6 turn red.

Restore correct code immediately. Do not commit mutations.

Reproduction-Test: test/task-2369-regressions.test.ts

### Checkpoint Documentation Requirements
Every checkpoint document (CP-N.md) MUST include:
- A summary of work done
- A `## Goal Check` section
- A 3-column pipe-delimited markdown table with columns: Criterion | Evidence | Status
- At least one evidence row per criterion using durable, verifiable references. Parallix already accepts:
  1. **Recognized repo commands or paths** — e.g., `` `npm test -- test/task-2369-regressions.test.ts` ``, `` `./scripts/verify-local.sh all` ``
  2. **Test names** — e.g., `"promotion cannot complete Mission (R1)"` (must match a test name in the repo)
  3. **Test file paths** — e.g., `test/task-2369-regressions.test.ts` (must be an existing test file)
  4. **ADR references** — e.g., `ADR 0039` (must correspond to an existing file under `docs/adr/`)
  5. **File:line references** — accepted when needed, but line numbers eventually rot; prefer the forms above
- Raw `stat`/`ls` output or generic prose may appear as supplemental context, but pair them with one of the accepted references above
- A non-generic `Next action:` line at the bottom

Example Goal Check table:

| Criterion | Evidence | Status |
|---|---|---|
| Promotion does not complete Mission | `test/task-2369-regressions.test.ts`, `"R1: review promotion cannot complete Mission"` | PASS |
| Landed timestamp used for completion | `test/task-2369-regressions.test.ts`, `"R4: resumed integration uses landed timestamp"` | PASS |
| Unknown reviewFixRounds stays unknown | `test/task-2369-regressions.test.ts`, `"R5: live reviewFixRounds known-zero vs unknown"` | PASS |
| Verification gate ran | `./scripts/verify-local.sh all` | PASS |

## Gates
- [ ] `./scripts/verify-local.sh all`
- [ ] `git diff --check`

## Slop Guards
- **No focused or unannotated skipped tests** (no `.only`, no bare `.skip`) — enforced by `test/test-hygiene.test.ts` inside the verification gate.
- **No-agent certification:** no test starts Codex, Claude, or Pi, invokes an LLM, runs a Parallix agent mission, or makes a network call. Use injected Git and process seams plus real temporary persistence.
- **Do not fix the test instead of the code.** Do not change a fixture from `taskStatus = review` to `taskStatus = approved` to bypass the premature path. Both must be tested.
- **Critical regressions must exercise the defective caller**, not only a helper or application service. Testing `MissionIntegrationService.decideIntegration()` proves that service works — it does not prove `px integrate` calls it at the right time. At least one regression must drive the integration CLI orchestration far enough to prove the ordering around review promotion, squash/commit landing, and Mission completion.
- **Do not satisfy R1 by mocking away promotion.** The production promotion logic must execute. Do not substitute `MissionIntegrationService(merged=false)` — that bypasses the premature CLI path.
- **Do not satisfy R4 by injecting the expected timestamp directly into a service test.** The integration orchestration must resolve the timestamp from the landed commit and pass it onward.
- **Do not satisfy reviewFixRounds only at repository level.** A direct `insert NULL → read NULL` test is insufficient; the live convenience writer and the compatibility mapping must be exercised.
- **Do not preserve "compatibility" that changes semantics.** CSV/string-shaped compatibility must not turn unknown into `0`.
- **Do not create another integration coordinator.** Use the existing integration service.
- **Do not broaden this into TASK-2369.x cleanup.** Correctness only.
- **Red before green.** Each regression must fail for the expected reason before its production fix lands. A helper-level test that bypasses the defective caller is insufficient.
- **Already fixed at baseline?** Record proof and do not churn the code.

## Restricted Areas
- Do not split `integrate.ts` or `stats.ts` into smaller modules (TASK-2369.x scope)
- Do not redesign telemetry schema or BoardMetrics
- Do not remove legacy CSV support
- Do not introduce new completion helpers or services beyond `MissionIntegrationService`
- Do not change rolling-7-day window semantics or historical population logic, and do not let historical/lifetime population re-enter current decision metrics
- Do not introduce a renamed telemetry completion flag (`closed` / `completed` / `isFinal` / `isClosed` / `isCompletedStatisticsRow` or any equivalent). Any remaining legacy `closed` field must be strictly confined to explicit legacy import/read compatibility, or removed from contemporary StatsRow/report paths
- Do not compensate for lifecycle bugs by making telemetry imply completion; statistics readers stay lifecycle-authoritative
- Do not modify `mission-lifecycle-service.ts` transition logic beyond removing the promotion-side `integrate` command
- Do not add new dependencies

## Stop Rules
- Stop if TASK-2369.01 extraction changes a seam this mission touches — adapt to extracted owner, do not duplicate.
- Stop if a defect is already fixed at baseline — record proof (test output or grep), do not churn code.
- Stop if fixing a defect requires touching more than 3 source files for one part — document the boundary and defer the rest to a follow-up task.
- Stop if `./scripts/verify-local.sh all` fails on the parent branch — do not start the mission.
