# CP-1: Correct weekly review-stat aggregation (task-2213)

## Summary

Round-5 completion. The round-4 blocker (locked mission required
implementer-family rows while the round-3 human review required per-model
rows) was resolved by the owner amending the mission contract in this session:
`missions/task-2213/MISSION.md` now specifies model-level agent rows with
implementer fallback (commit `69008d6d8`), matching the round-3 human
direction.

With the contract unambiguous, three defects were fixed:

1. The `completedOnly` filter in `computeAgentMissionGroups` dropped individual
   non-closed rows *before* attribution. On real CSV data, completion is recorded
   on a blank-model `default`-stage rollup row while the mission's model lives on
   its non-closed stage rows — so most completed missions lost their model and
   collapsed into implementer-family buckets (`claude 8`, `codex 12`), exactly
   the inconsistency with main's per-model representation reported by the owner.
   The fix keys `completedOnly` off the mission, not the row
   (`lib/commands/stats.ts:872`-`877`): a mission is included when any of its
   valid window rows is `closed: 'yes'`, and *all* of its window rows stay
   available for model attribution and the stored fix-round fallback.

2. Attribution previously inferred ownership from any model compatible with the
   row's implementer family. That is wrong after a handoff. `closed: yes` is a
   mission-level completion marker, not ownership evidence: it may appear on a
   rollup or reviewer row. The fix uses it only to include the mission, then
   selects the latest model-bearing non-review implementation row
   (`lib/commands/stats.ts:930`-`952`).

3. The `custom` family heuristic treated a later `mistral` reviewer model as a
   custom model. That could reassign a completed mission away from the agent who
   actually completed it. The new regression proves that a reviewer row marked
   closed cannot replace the latest custom `qwen3.6-27b-q8` follow-up row.

On the live CSV the weekly table now shows per-model rows with correct averages
(`node px.js stats`: 23 completed missions, e.g. `claude-sonnet-5 6 1.17`,
`gpt-5.4 7 0.29`, `mistral 3 1.00`), replacing both main's all-`0.00` averages
and the branch's implementer-collapsed rows.

Retained corrections from earlier rounds:

- Mission counts and fix-round averages include only completed missions inside
  the selected weekly window; each mission contributes to exactly one row.
- Each row's average PR fix rounds is computed solely from that row's own
  completed missions; the stored fallback takes the highest `pr_fix_rounds`
  across the mission's window rows, so the rollup-row count is not discarded.
  Local review-events-derived ground truth still overrides the stored value.
- The spend-by-stage table keeps live active-stage telemetry (grouping helper
  called without `completedOnly`).
- Missing-metadata handling is explicit: a completed row with no model and no
  implementer renders as an `unknown` row with a `0.00` average; a missing
  `pr_fix_rounds` counts as zero.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Each completed mission contributes to exactly one agent row, keyed by its latest non-review implementation model (implementer fallback, `unknown` when both absent), only inside the weekly window | `lib/commands/stats.ts:930`; `lib/commands/stats.ts:941`; `task-2213: a closed reviewer row does not replace the final implementer after a handoff` | PASS |
| Row mission counts equal the completed missions assigned to that row; active and out-of-window missions excluded | `task-2213: agent performance counts and fix-round averages use only each model row's completed missions`; `task-2213: weekly agent performance table excludes active-stage agents`; `task-2213: range agent performance table excludes active-stage agents` | PASS |
| Average PR fix rounds per row uses only that row's completed missions; other rows cannot affect it | `lib/commands/stats.ts:1014`; `task-2213: models sharing an implementer family keep separate rows and averages`; `task-2213: completed missions keep per-model rows with per-model averages` | PASS |
| Rows with zero review-fix rounds are preserved and render `0.00` | `test/review-stats.test.js`; `task-2213: models sharing an implementer family keep separate rows and averages` | PASS |
| Missing model/implementer or review-round metadata handled explicitly | `task-2213: completed rows with missing attribution or review-round metadata are explicit, not silent skew`; `task-2213: summarizeAgentWindow falls back to the recorded implementer when the telemetry model is blank` | PASS |
| Final implementation telemetry wins over reviewer telemetry even when the reviewer row is closed | `lib/commands/stats.ts:941`-`952`; `task-2213: a closed reviewer row does not replace the final implementer after a handoff` | PASS |
| Regression demonstrated red before this correction and green after, no `.only`/unannotated `.skip` | `npm test -- test/review-stats.test.js test/stats-active-breakdown.test.js test/stats.test.js` — 83/83 pass | PASS |
| Full local gate passed on the final tree | `./scripts/verify-local.sh static-analysis` — ALL STAGES PASSED | PASS |

Next action: Hand off for re-review of the handoff-aware implementation-row attribution correction.
