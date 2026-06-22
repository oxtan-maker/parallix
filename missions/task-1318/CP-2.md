# CP-2: Subsystem Audit (corrected)

Ground truth = Forgejo PRs + on-disk review artifacts
(`missions/<slug>/review-events/*.md`, `review-state.json`). The stats CSV is a
derived projection and is not trusted.

## Subsystem 1 — PR fix-round derivation (the core bug)

Path: `recordIntegrationStats` → `deriveImplementerAndFixRounds` (stats.js).

Findings:
- **Broken commit-format regex.** `deriveFixRoundsFromReviewStateHistory` matched
  `round N (reviewing <implementer>)`. Real subjects are
  `review-state(<slug>): round N (reviewing) [<reviewer> -> <implementer>]`
  (confirmed via `git log` for task-1316/1318). The regex never matched, so the
  function fell back to `Math.max(0, round-1)` — a guess unrelated to real fix
  rounds.
- **Authoritative event store never read.** `review-events/*.md` carry, per round,
  a `reviewer_outcome` (verdict `request-changes`/`approve`) and an
  `implementer_disposition` authored by the implementer (parsed by
  `review-events.js#readAllEvents`). The derivation consulted only Forgejo →
  commit regex → review-state → task text. The richest, most reliable LOCAL
  source was ignored.
- **Fix rounds conflated with integration.** Per-stage rows always wrote
  `pr_fix_rounds=0`; only the `default` integration row carried a count. Missions
  not yet integrated (most of codex's in-window missions) therefore read 0.

Root cause: fix-round derivation was both wrong (regex) and incomplete (no event
store), and the count only existed on integration rows.

## Subsystem 2 — Agent attribution

- `recordReviewStats` originally passed `implementer || reviewer`; the shallow
  pass changed it to `implementer: reviewer`. That **breaks the weekly
  per-implementer summary** (it groups by `implementer`, so review rows would
  credit reviewers with missions they only reviewed) while only papering over a
  render problem.
- The writer already records `reviewer_agent`. Bug 2 ("review row shows the
  implementer") is purely that `renderMissionPhaseReport` used
  `implementer_agent || implementer` for every phase instead of `reviewer_agent`
  for the review phase.

Root cause: a render omission, mis-diagnosed as a writer bug.

## Subsystem 3 — Token counting

- `message_start.usage.input_tokens` is the *uncached* prompt delta; cached
  context is in `cache_read_input_tokens`. A value of 1 with a large cache read is
  correct, not an artifact. The only legitimate rewrite is the existing
  truncation fallback (no `message_start`/`message_delta` survived → use the
  `result` aggregate).

Root cause: the reported "artifact" was a display/interpretation issue; the
heuristic that "fixed" it corrupted correct data.

## Subsystem 4 — Cost reporting

- `renderMissionPhaseReport` omitted the `cost_usd` column from headers/rows/
  totals, and (when added) must format it as a fractional dollar value, not via
  `parseInt`.

## Summary of fixes (CP-3)

| # | Area | Fix |
|---|------|-----|
| 1 | Fix-round derivation | Read the review event store first; fix the branch-history regex to `[reviewer -> implementer]`; new precedence; stamp counts on implementer rows independent of integration |
| 2 | Attribution | Keep mission implementer for grouping; render `reviewer_agent` for the review phase |
| 3 | Token display | Remove the clobbering heuristic; keep values truthful; show `Cached` honestly |
| 4 | Cost | Add `Cost ($)` column with fractional formatting |
| 5 | Render trust | `summarizeAgentWindow` trusts the local event store over a stale stored value when available |

## Next action: implement and add regression tests (CP-3).
