# Mission: Audit and fix parallix stats data bugs (task-1318)

## Goal

Audit the parallix stats reporting pipeline — including `lib/commands/stats.js`, `lib/agents/*-telemetry.js`, `lib/agents/stage-telemetry.js`, and the Forgejo review integration path — to identify every source of incorrect or fabricated data in the weekly summary tables, per-mission phase telemetry, and cost reporting. Produce a prioritized fix plan and implement the highest-confidence fixes so that: (a) PR fix-round counts derive from review-state history or Forgejo PR comments (never from regex on task markdown alone), (b) per-mission phase telemetry attributes tokens to the correct agent family (Claude rows show Claude agents, not self-reviewed), (c) token counts are honest zeros when telemetry is genuinely absent (not 1-token artifacts), and (d) the `cost_usd` column is populated from Claude's `total_cost_usd` and Codex's cost data when available.

## Why Now

The stats output published last week showed clearly implausible values: Claude recorded 1 input token across 4010 output tokens, Claude appears as its own reviewer, Codex reports 0.00 average fix rounds despite 9 missions, and the cost column is absent from the phase breakdown table. These bugs undermine trust in every metric the workflow dashboard presents, and they indicate systemic problems in how telemetry flows from agent launchers through `recordStageStats` into the CSV and back through `renderWeeklyStatsReport` and `renderMissionPhaseReport`. The sooner we fix the data pipeline, the sooner future missions produce trustworthy stats.

## Scope

### In Scope
- **PR fix-round derivation audit**: Trace `deriveImplementerAndFixRounds` (stats.js:976-1016) and its callees (`deriveFixRoundsFromReviewStateHistory`, `deriveFixRoundsFromTaskText`, `deriveImplementerAndFixRoundsFromPrComments`). Identify when the fallback path (regex on task markdown text) produces inflated or zero counts, and verify the precedence order: PR-comments → branch-history → review-state → backlog-fallback.
- **Agent attribution audit**: Trace `recordStageStats` (stats.js:1168-1197) and `recordReviewStats` (stats.js:203-206). The review path sets `implementer: implementer || reviewer` — verify that when only a reviewer is present, the row attributes to the reviewer correctly and does NOT duplicate the implementer. Check `telemetryToStatsFields` (stats.js:1144-1161) for how `agentFamily` propagates into `provider` and `model`.
- **Token counting audit**: Trace `extractClaudeTelemetryFromStdout` (claude-telemetry.js:177-221) and `extractCodexTelemetry` (codex-telemetry.js). The "1 input token" artifact likely comes from `messageStarts[0].inputTokens` being a partial parse (e.g., a truncated JSONL line or an empty message_start). Verify the fallback to `resultUsage` fires correctly. Check that `telemetryToStatsFields` handles `null` telemetry gracefully (it should produce '0' for all token columns).
- **Cost column audit**: Verify that `claude-telemetry.js` extracts `total_cost_usd` from the Claude `result` event and that `telemetryToStatsFields` maps it to `cost_usd`. Verify that `renderMissionPhaseReport` (stats.js:750-815) includes `cost_usd` in its output table (currently it does NOT — the table headers end at "Usage %" and the cost column is omitted).
- **Weekly summary aggregation audit**: Trace `summarizeAgentWindow` (stats.js:565-590) and `summarizeMissionWindow` (stats.js:543-563). Verify deduplication logic by (repo, mission) key is correct and that multi-stage rows don't inflate agent mission counts. Check that `pr_fix_rounds` selection (highest per mission) produces sensible averages when integration rows carry the real count.
- **Fix implementation**: Patch the identified bugs in `stats.js` and/or agent telemetry modules. At minimum: add `cost_usd` to the phase report table, fix any telemetry null-handling that produces non-zero artifacts, and ensure review rows don't attribute to the wrong agent.
- **Tests**: Add or update tests in `test/stats.test.js` and/or `test/mission-phase-stats.test.js` to cover the fixed behaviors.

### Out of Scope
- Changes to the CSV schema (column additions/removals) — the `cost_usd` column already exists in STATS_HEADERS.
- Changes to the Forgejo API integration layer (`lib/tools/forgejo.js`) beyond (a) what is needed for PR comment parsing in `deriveImplementerAndFixRoundsFromPrComments`, and (b) the `syncPrimaryBaseline` force-push fix described below.
- Changes to the `px` CLI entry point or command routing.
- Changes to milestone management, backlog task creation, or handoff orchestration.
- Adding new agent telemetry modules.

## Success Criteria

1. **Cost column present**: `renderMissionPhaseReport` output for a mission with recorded rows includes a `Cost ($)` column (positioned after "Usage %") with non-empty values from `cost_usd` telemetry data. Verified by unit test assertion on rendered table text.
2. **"1 input token" is treated as legitimate prompt caching, not an artifact**: A `message_start` reporting a tiny uncached `input_tokens` (even 1) alongside a large `cache_read_input_tokens` is recorded truthfully — `extractClaudeTelemetryFromStdout` must NOT rewrite/clobber the value from `resultUsage`. The genuine truncation fallback (no surviving `message_start`/`message_delta` at all → use the `result` event's aggregate) is retained. The phase report shows the (already-present) `Cached` column so the row reads honestly. Verified by tests with the real caching shape and the truncation shape.
3. **Review rows attribute correctly across both axes**: `recordReviewStats({ reviewer, implementer })` keeps the **mission implementer** in the `implementer` column (so the weekly per-implementer summary does not credit reviewers for missions they only reviewed) while recording the reviewer in `reviewer_agent` and the reviewer-session telemetry on the row. `renderMissionPhaseReport` surfaces `reviewer_agent` for the review phase. Verified by unit tests + rendered output.
4. **PR fix rounds derived from authoritative ground truth (not integration)**: `deriveImplementerAndFixRounds` reads the mission-local review event store first (`source: 'review-events'`), then Forgejo PR comments, then the (corrected) branch-history regex matching the real `round N (reviewing) [reviewer -> implementer]` commit format, then review-state, then task text. Fix rounds are a review-loop quantity stamped onto implementer-attributed rows independently of whether the mission was integrated. Verified by tests with a synthetic event store and by `px stats` no longer reporting codex `0.00`.
5. **Null telemetry produces zeros**: `telemetryToStatsFields(null, { agentFamily: 'claude' })` returns all token columns as `'0'` and `cost_usd: '0'`. Verified by unit test.
6. **Mission deduplication correct**: `summarizeAgentWindow` with multiple rows for the same (repo, mission) reports the agent with 1 mission (not N), and trusts local ground truth (the event store) over a stale stored value when available. Verified by unit tests.
7. **`npm test` passes** with zero failures after fixes and new tests are added.

## Required Forgejo fix

`syncPrimaryBaseline` in `lib/tools/forgejo.js` pushes the local primary branch
(`main`) to the review remote so the review PR has an accurate baseline to diff
against. The review remote's primary branch can legitimately diverge from local
(rebases, amended baseline commits, prior mission history). A non-forced push is
then **rejected** as a non-fast-forward, which aborts baseline sync and **breaks
the review loop** — no further review rounds can run.

The push therefore MUST use `--force`: this ref is a server-side mirror of our
local primary that we intentionally overwrite, not a shared branch with
independent commits to preserve. This is a required, in-scope fix. Reviewers
must NOT request reverting it to a plain `push`.

## Intentional changes — reviewers must NOT force reverts of these

This mission corrects a shallow first attempt. The decisions below are
deliberate, evidence-backed, and approved by the maintainer. A reviewer (which
may be a fresh agent with no prior context) MUST NOT request reverting any of
them on the basis of "it differs from the original spec" or "it looks
surprising." Only request a change if you can cite NEW evidence that the decision
is factually wrong (and say what evidence). Each item names where the rationale
and validation live.

1. **Forgejo `syncPrimaryBaseline` uses `push --force`.** Required to keep the
   review loop running; a non-forced push is rejected as non-fast-forward. See
   "Required Forgejo fix" + the code comment at `lib/tools/forgejo.js`.

2. **"1 input token" is kept as-is (legitimate prompt caching), not nulled.** The
   prior heuristic that overwrote `input<10 && output>1000` from `resultUsage`
   was REMOVED because it clobbered correct data. Evidence: real rows show
   `input=1, cached=462739` — Anthropic streaming reports only the uncached
   prompt delta as `input_tokens`. Reverting to the heuristic would re-introduce
   the corruption. (Supersedes original SC#2.) See CP-1/CP-2/CP-3.

3. **Review rows keep the MISSION implementer in `implementer`** (the shallow
   `implementer: reviewer` was reverted). Reason: the weekly "missions as
   implementer" table groups by `implementer`; attributing review rows to the
   reviewer credits reviewers with missions they only reviewed. The reviewer is
   recorded in `reviewer_agent` and shown by the phase report for the review
   phase. (Supersedes original SC#3, which was self-contradictory.) Tests:
   `test/stats.test.js` review-attribution + `test/mission-phase-stats.test.js`.

4. **Fix rounds derive from the on-disk review event store first**, then Forgejo,
   then a corrected branch-history regex (`round N (reviewing) [reviewer ->
   implementer]`), then review-state, then task text. Fix rounds are stamped on
   implementer rows independently of integration ("integration ≠ pr round").
   Validated against an independent parser across 36 missions (0 mismatches).

5. **A mid-round handoff is attributed to the LATEST disposition** in that round
   (not the first iterated). Without this, rounds where one agent starts and
   another finishes were mis-owned (over-counting). Regression test:
   `deriveFixRoundsFromReviewEvents attributes a mid-round handoff...`.

6. **The last weeks of missions in the stats CSV were backfilled** from ground
   truth (event stores in `Workflow`/visualBoard + `parallix`). This is external
   state, not part of the branch diff; backups saved as `stats.csv.bak-*`. The
   maintainer authorized this explicitly. Codex's weekly average went from a
   false `0.00` to a real `1.44`.

7. **`summarizeAgentWindow` trusts the local event store over a stale stored
   value** when available, and only the event store (never branch-history), so it
   can never make a number worse. Test: `summarizeAgentWindow trusts local
   ground truth...`.

If you (reviewer) disagree with any item, raise it as a discussion/finding with
the contradicting evidence — do not unilaterally revert.

## Risks and Assumptions

- Assumption: The `cost_usd` column already exists in the 21-column STATS_HEADERS schema (confirmed at stats.js:24) and only the phase report rendering omits it.
- RESOLVED (was an assumption): "1 input token" is NOT a parsing artifact — it is legitimate prompt caching (tiny uncached `input_tokens` + large `cache_read_input_tokens`). The fix is in the display layer (the `Cached` column already shows it); the parser keeps the value truthful. See "Intentional changes" #2.
- Note: `recordReviewStats` keeps the mission implementer in the `implementer` column on purpose (weekly grouping correctness); the reviewer is recorded in `reviewer_agent` and surfaced by the phase report. See "Intentional changes" #3.
- Risk: The PR comment parsing path (`deriveImplementerAndFixRoundsFromPrComments`) has complex regex patterns; changes to the precedence order could silently switch to a less accurate fallback. Test with real PR comment data where possible.
- Assumption: The `telemetryToStatsFields` null-handling bug, if it exists, is in the caller (stage-telemetry.js or the launcher) passing a partially-initialized telemetry object rather than `null`.
- Risk: Adding the cost column to the phase report table may shift column positions and affect downstream consumers that parse the table text. Verify no other code depends on the exact column layout.

## Checkpoints

- CP 1: Reproduce the reported bugs locally by running `px stats` commands against the existing stats CSV data and the phase report for task-1316. Document the exact discrepancies between expected and actual output.
- CP 2: Complete the audit of all four subsystems (PR fix rounds, agent attribution, token counting, cost reporting). Document root causes and proposed fixes in a shared scratchpad or the task's implementation notes.
- CP 3: Implement fixes. Add regression tests. Run `npm test` to verify zero regressions.

## Gates

- [ ] All 7 (revised) success criteria verified via unit tests or manual inspection.
- [ ] `npm test` passes with zero failures.
- [ ] Production changes are confined to `lib/commands/stats.js`, `lib/agents/claude-telemetry.js`, the blessed `lib/tools/forgejo.js` force-push, and test files (plus this mission's docs).
- [ ] The cost column appears in the phase report table output.
- [ ] The phase report shows the reviewer (`reviewer_agent`) for the review phase; the `implementer` column keeps the mission implementer for correct weekly grouping.

## Restricted Areas

- Do not modify `lib/tools/forgejo.js` except for (a) minor adjustments to `deriveImplementerAndFixRoundsFromPrComments` regex patterns (if needed for correctness), and (b) the `syncPrimaryBaseline` force-push described under "Required Forgejo fix" — this change is explicitly in scope and reviewers MUST NOT request its reversion.
- Do not modify the CSV schema (STATS_HEADERS, LEGACY_HEADERS, USAGE_NUMBERS).
- Do not modify `px.js`, `lib/commands/active.js`, `lib/commands/review.js`, or any command routing code.
- Do not modify the backlog task file's `assignee` field.
- Do not create or modify milestone files.
- Do not commit or push changes; the harness manages version control.
- Do not modify other missions' files. For THIS mission (`missions/task-1318/`), the checkpoint docs (CP-1/2/3, MISSION.md) were rewritten to reflect the corrected root causes, and the round-1 review state (`review-state.json`, `review-events/`) was reset for a clean re-review — both intentional and maintainer-approved (the "restart"). See "Intentional changes".

## Stop Rules

- Stop before rewriting the entire stats pipeline from scratch — focus on targeted fixes for the identified bugs.
- Stop before changing the CSV storage format or migration logic.
- Stop before adding new CLI flags or subcommands to the stats command.
- Stop before modifying the Forgejo API client or authentication logic, EXCEPT the `syncPrimaryBaseline` force-push (see "Required Forgejo fix").
- The original "leave historical CSV rows unchanged" rule is SUPERSEDED for this mission: the maintainer explicitly authorized a one-time backfill of the last weeks of missions, re-deriving `pr_fix_rounds` from ground truth (the review event stores in the `Workflow`/visualBoard and `parallix` repos). Backups were taken (`stats.csv.bak-*`). This is intentional — see "Intentional changes" #6. It does not change the CSV schema.
- Stop if a root cause cannot be identified within the scoped files — instead, document the hypothesis and defer.
