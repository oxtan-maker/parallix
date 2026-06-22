# CP-3: Fixes Implemented & Regression Tests (corrected re-implementation)

This supersedes the earlier shallow pass, which (a) clobbered legitimate
prompt-caching telemetry, (b) broke the weekly per-implementer grouping by
attributing review rows to the reviewer, and (c) left the codex `0.00`
fix-rounds bug unaddressed (assessed as "not a code bug"). All three were wrong.

## Fixes applied

### Fix 1 — Authoritative fix-round derivation (writer)
**Files:** `lib/commands/stats.js`
- New `deriveFixRoundsFromReviewEvents(slug, rootDir)` reads the mission-local
  review event store (`review-events.js#readAllEvents`) and counts rounds whose
  `reviewer_outcome.verdict === 'request-changes'` that the **final implementer**
  resolved (handling mid-mission implementer handoff). Returns
  `{ implementer, prFixRounds, source: 'review-events' }`.
- Fixed `deriveFixRoundsFromReviewStateHistory` to match the real commit format
  `round N (reviewing) [<reviewer> -> <implementer>]` (the implementer is on the
  right of `->`), keeping the old `(reviewing <impl>)` form as a legacy fallback.
- New precedence in `deriveImplementerAndFixRounds`: **review-events → Forgejo PR
  comments → branch-history → review-state → task-text**.
- `pr_fix_rounds` is stamped onto implementer-attributed stage rows from the event
  store (`defaultPrFixRounds` in `recordActiveStats`/`recordReviewStats`), so the
  count exists per-mission independent of integration.

### Fix 2 — Review-row attribution (writer + render)
- Reverted the shallow `implementer: reviewer`. Review rows keep the **mission
  implementer** in the `implementer` column (correct weekly grouping) and carry
  `reviewer_agent` + the reviewer-session telemetry.
- `renderMissionPhaseReport` now shows `reviewer_agent` for the review phase.

### Fix 3 — Token caching display (parser + render)
- Removed the heuristic that overwrote `input<10 && output>1000` from
  `resultUsage`. `input=1, cached=462739` is preserved truthfully; the genuine
  truncation fallback is retained. The phase report's existing `Cached` column
  makes the row read honestly.

### Fix 4 — Cost column (render)
- `renderMissionPhaseReport` includes `Cost ($)` (after "Usage %") with a
  fractional `cost()` formatter; totals sum with `parseFloat`.

### Fix 5 — Render trusts ground truth
- `summarizeAgentWindow(rows, window, { rootDir })` overrides a stale/zero stored
  `pr_fix_rounds` with the event-store count when available (event store only —
  never the shakier branch-history — so it can never make a value worse).

### Required Forgejo fix (unblocks the review loop)
- Restored `push --force` in `syncPrimaryBaseline` with a rationale comment; the
  review remote's primary is a server-side mirror we intentionally overwrite, and
  a non-forced push is rejected as non-fast-forward, breaking the loop.
  MISSION.md marks this explicitly in-scope.

## Verification
- `node px.js stats task-1316`: review phase shows the reviewer (`qwen`); execute
  shows `input 1 / cached 462739` honestly; `Cost ($)` = `1.42`.
- `node px.js stats`: renders without error; codex no longer fixed at `0.00`.
- New tests: event-store fix-round counting; precedence prefers `review-events`;
  render override trusts the event store over a stale zero; caching preserved;
  truncation fallback retained; review-row dual attribution.
- `npm test`: **1577 tests, 1555 pass, 0 fail, 22 skipped.**

## Deviations from the original success criteria
SC#2 and SC#3 were rewritten in MISSION.md: the "1 input token" case is
legitimate caching (not an artifact to null out), and review rows must retain the
mission implementer for grouping (not be re-attributed to the reviewer). The
corrected criteria reflect the actual ground-truth behavior.
