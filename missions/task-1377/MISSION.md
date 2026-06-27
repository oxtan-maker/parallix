# Mission: show mission-phase telemetry after integration (task-1377)

## Goal

After `px integrate` completes, print the per-mission phase telemetry breakdown (the same report that `px stats task-<slug>` produces) alongside the existing weekly aggregate stats table, so the user sees both views without needing to run a second command.

## Why Now

The post-integration stats output was added in task-1314 to record telemetry and show weekly aggregates. However, the mission-phase breakdown — which shows provider, model, implementer, token counts, duration, and cost per phase (draft, execute, review, follow-up) — is only available by manually running `px stats task-<slug>`. Users integrating missions lose visibility into per-mission breakdown at the moment of integration, forcing a round-trip command.

## Refinement Signals

- Estimated agent % usage limit: 25-50%
- Confidence: High
- Selection note: activate as-is
- Main drivers: user-reported gap between weekly aggregate view and mission-detail view at integration time; zero new dependencies or schema changes required

## Scope

- Modify `recordPostIntegrationStats()` in `lib/commands/integrate.js` (lines 1218-1244) to call `stats.renderMissionPhaseReport()` with the rows from `recordIntegrationStats` and print the mission-phase report after the weekly stats table.
- The `stats` module is already imported at `lib/commands/integrate.js:13` and exports `renderMissionPhaseReport` (line 1709).
- Add a test in `test/integrate.test.js` verifying that `recordPostIntegrationStats` output includes both "weekly report" and "Mission telemetry by phase:" in the logged output.

## Out of Scope

- Changes to `lib/commands/stats.js` — the `renderMissionPhaseReport` function and all stats CSV logic remain untouched.
- New stats columns, schema changes, or CSV format modifications.
- Changes to the `px stats` CLI command or its flags.
- Changes to `recordIntegrationStats` return shape or the weekly report rendering.
- Any changes outside `lib/commands/integrate.js` and `test/integrate.test.js`.

## Success Criteria

1. **Mission-phase report printed after integration**: `recordPostIntegrationStats('task-XXXX', { rootDir })` logs a line starting with `[INFO] Mission telemetry by phase:` followed by the phase breakdown table. Verified by test assertion on `console.log` output in `test/integrate.test.js`.

2. **Weekly stats still printed**: The existing `[INFO] Workflow stats updated:` line and weekly report table continue to appear in the same order (weekly first, mission-phase second). Verified by existing test at `test/integrate.test.js:404` passing unchanged.

3. **Empty telemetry case handled gracefully**: When no mission-phase rows exist for the slug, `renderMissionPhaseReport` prints a table of dashes with the message "No telemetry rows recorded for mission" — the post-integration flow must not throw or crash. Verified by a test that mocks `recordIntegrationStatsFn` returning `{ data: { rows: [] } }` and asserts no exception is thrown.

4. **No behavioral regression on existing tests**: All existing `test/integrate.test.js` tests pass, including the three `recordPostIntegrationStats` tests (lines 370, 408, 448). Verified by `npm test`.

5. **`npm test` passes end-to-end**: The full test suite (`node --test test/*.test.js`) runs clean with no failures. Verified by `npm test` returning exit code 0.

## Risks and Assumptions

- **Assumption**: `recordIntegrationStats` populates `outcome.data.rows` with the full stats CSV content (including prior mission-phase rows). If rows are empty, `renderMissionPhaseReport` handles it gracefully (prints dashes + message) — no crash risk.
- **Risk**: If `outcome.data` is undefined in some edge case, `renderMissionPhaseReport(rows, slug)` would receive `undefined`. Mitigation: pass `(outcome.data?.rows || [])` to guard against missing data property.
- **Assumption**: The `stats` module export of `renderMissionPhaseReport` remains stable (it has been exported since task-1314). No version pinning or import changes needed.
- **Risk**: Existing tests mock `recordIntegrationStatsFn` without a `data.rows` field. Those tests must be updated to include `{ data: { rows: [...] } }` in the mock return value, otherwise the new call will break.

## Checkpoints

- CP 1: Confirm the change location in `integrate.js` and verify `renderMissionPhaseReport` signature matches the call site.
- CP 2: Implement the change — add the `renderMissionPhaseReport` call and print in `recordPostIntegrationStats`.
- CP 3: Add/update tests in `test/integrate.test.js` to cover the new output and the empty-rows edge case.
- CP 4: Run `npm test` to verify all tests pass.

## Gates

- [ ] ./scripts/verify-local.sh docs
- [ ] All `test/integrate.test.js` tests pass, including the three existing `recordPostIntegrationStats` tests and the new test for mission-phase output.

## Restricted Areas

- Do not modify `lib/commands/stats.js` — all rendering logic for mission-phase reports already exists there.
- Do not modify the stats CSV schema, headers, or any column definitions.
- Do not change the `recordIntegrationStats` function or its return shape.
- Do not introduce new dependencies or modify `package.json`.

## Stop Rules

- Stop immediately if `npm test` reveals a regression in any test outside the `recordPostIntegrationStats` test cluster.
- Stop if `renderMissionPhaseReport` throws or behaves unexpectedly with empty rows — this indicates an undocumented API contract change in stats.js.
- Stop if the change requires modifying more than `lib/commands/integrate.js` and `test/integrate.test.js` — the scope is narrowly defined to these two files.
