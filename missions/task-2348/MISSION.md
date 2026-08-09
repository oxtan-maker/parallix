# Mission: Fix implementer attribution and review-round counting (task-2348)

## Goal
`px stats` misattributes missions when a mission had multiple implementers over its lifecycle. Two defects:

1. **Wrong implementer credited** — The agent-performance table can credit a mission to a previous implementer or a reviewer instead of the **reported implementer** (the one recorded on the closed/integration rollup row by `deriveImplementerAndFixRounds`). This happens because `computeAgentMissionGroups` picks the latest implementation-stage telemetry row as the owner, which may be an earlier implementer's row or a review-stage row whose actor is the reviewer.

2. **Review rounds include previous implementer's rounds** — The `pr_fix_rounds` stored on the closed row by the `review-aggregate` path of `deriveImplementerAndFixRounds` counts _all_ `changes-requested` rounds across the mission, including rounds from any previous implementer. The branch-history path already handles this correctly (it finds `firstFinalImplementerRound` and subtracts), but the review-aggregate path does not filter by implementer.

After this mission:
- The implementer credited for a completed mission is always the **reported implementer** from the closed rollup row (`deriveImplementerAndFixRounds` output), never a reviewer or a previous implementer.
- The `pr_fix_rounds` value counts only the review rounds the reported implementer went through — rounds from any previous implementer are excluded.

Reproduction-Test: `test/task-2348-implementer-attribution.test.ts`

## Why Now
Evidence from the 2026-08-02 → 2026-08-08 weekly report (backlog task description):

- `mistral` shows 1 mission "as implementer" with 0.00 fix rounds. `mistral` ran as **reviewer** that week (`$3.75` of `$5.21` spend in the review column). The `recordStageStats` fallback `implementer: implementer || reviewer || 'unknown'` at `src/adapters/cli/commands/stats.ts:1717` lets a reviewer-only row become the credited implementer.
- `custom` shows 7 missions and average 0.43 fix rounds — some of those missions likely had earlier implementers whose review rounds inflate or deflate the average.
- The `review-aggregate` path at `src/adapters/cli/commands/stats.ts:1425` counts `rounds.filter(r => r.decision?.kind === 'changes-requested').length` — no filter on `round.implementer`, so previous implementer's rounds leak into the reported implementer's count.

Every agent-mix decision (which family to weight in `config/agents.json`) is made on numbers that credit the wrong agent and miscount its effort.

## Refinement Signals
- Predicted NEL bucket: Small (20–80)
- Confidence: High
- Selection note: activate as-is
- Main drivers: two focused fixes in `src/adapters/cli/commands/stats.ts` — (a) `deriveImplementerAndFixRounds` review-aggregate path filters rounds by implementer, (b) `computeAgentMissionGroups` uses the closed rollup row's implementer as the authority. Test file in `test/`.

## Scope
- Author `test/task-2348-implementer-attribution.test.ts` locking both defects: (a) a mission with two implementers credits the reported (final) implementer, not the earlier one; (b) `pr_fix_rounds` counts only the reported implementer's `changes-requested` rounds.
- Fix `deriveImplementerAndFixRounds` review-aggregate path (`src/adapters/cli/commands/stats.ts:1421-1429`) to filter rounds by `round.implementer === reportedImplementer` before counting `changes-requested`. This aligns the review-aggregate path with the branch-history path (which already does `round - firstFinalImplementerRound`).
- Fix `computeAgentMissionGroups` (`src/adapters/cli/commands/stats.ts:834-935`) so the implementer identity for a completed mission comes from the closed rollup row's `implementer` field (the reported implementer), not from the latest implementation-stage telemetry row. The model/provider for display can still come from the implementation-stage row.
- Update `summarizeAgentWindow` (`src/adapters/cli/commands/stats.ts:944-995`) to read `pr_fix_rounds` from the closed rollup row (the authoritative value from `deriveImplementerAndFixRounds`), not the max across all rows.
- Update `test/stats.test.ts`, `test/stats-report.test.ts`, and `test/mission-phase-stats.test.ts` where they assert the old behavior.
- Update `docs/` and `README.md` wherever agent-performance attribution is described.

## Out of Scope
- Any SQLite migration under `src/adapters/sqlite/migrations/`.
- Backfilling or rewriting historical measurement rows (`px stats-backfill` behaviour unchanged).
- Changing agent selection, weights, or eligibility (`config/agents.json`, `src/domain/agents.ts`).
- Cost/usage/duration metric derivation and `usage`/`cost`/`duration` family classification.
- The mission-count / classification tables, NEL, and cycle-time reporting.
- Review-loop state, Forgejo interaction, and `src/adapters/review/*`.
- Introducing a `(family, model)` composite key for report rows — that is a separate concern (model-level granularity vs. implementer identity).
- The `mixed` merge sentinel from `mergeLabel` — that is a separate cosmetic issue.
- Renaming the `Implementer` column on the single-mission phase report.

## Success Criteria
> **Falsifiability rule (ADR 0039 Part 2):** Each criterion must be falsifiable. Forbidden: subjective adjectives ("easy, fast, simple, intuitive, user-friendly, responsive, quick, efficient" without an attached metric) and vague quantifiers ("multiple, several, some, many, few, various"). For refactor / condense / migration missions, the criterion must enumerate the specific elements (rules, files, behaviours) that must survive — generic phrases like "preserve critical content" are not sufficient.

1. `test/task-2348-implementer-attribution.test.ts` exists and fails at the mission's parent commit `c06b0ada6` with at least one assertion per defect: (a) a mission with two implementers (earlier `claude`, reported `custom`) credits `custom` as the implementer in the agent-performance grouping, not `claude`; (b) a mission whose review aggregate has 3 total `changes-requested` rounds but only 2 belong to the reported implementer stores `pr_fix_rounds: 2`, not `3`.
2. The same test file passes on the final tree, and no assertion in it is skipped or annotated `.skip` / `.only`.
3. `deriveImplementerAndFixRounds` review-aggregate path (`src/adapters/cli/commands/stats.ts:1425`) filters `rounds` by `round.implementer === reportedImplementer` before counting `changes-requested`. A unit test asserts the count excludes previous implementer's rounds.
4. `computeAgentMissionGroups` uses the closed rollup row's `implementer` field as the implementer identity for completed missions. The display key (model or implementer name) may still come from the implementation-stage row. A unit test asserts a mission with earlier implementer `claude` and reported implementer `custom` groups under `custom`.
5. `summarizeAgentWindow` reads `pr_fix_rounds` from the closed rollup row (authoritative value from `deriveImplementerAndFixRounds`), not the max across all rows. A test asserts the fix-rounds value matches the closed row.
6. A row whose `implementer_agent` is empty and whose `reviewer_agent` is set resolves to role `reviewer` and is excluded from implementer mission counts, asserted by a test.
7. `./scripts/verify-local.sh all` passes on the final tree with no new failures relative to the parent commit's baseline, and the recorded totals are captured in the final checkpoint.
8. `docs/` and `README.md` mentions of agent-performance attribution match the shipped behavior (grep for implementer attribution returns no stale description of reviewer-as-implementer).

## Risks and Assumptions
- Risk: existing report tests encode the current implementer-picking logic; a mechanical change can green them while leaving the grouping bug. Mitigation: the reproduction test asserts *implementer identity and round counts*, not header text, and is written before any production edit.
- Risk: `pr_fix_rounds` on the closed row might be 0 for some missions (e.g. no review needed). Assumption: 0 is the correct value and the max-across-rows fallback was masking the real issue.
- Assumption: `implementer_agent` and `reviewer_agent` are populated for all rows written after task-1342 (`src/adapters/cli/commands/stats.ts:1725-1726`); older rows may only carry `implementer`, so the resolver must fall back to it.
- Assumption: the closed rollup row always carries the correct `implementer` and `pr_fix_rounds` from `deriveImplementerAndFixRounds` (called by `recordIntegrationStats`). If the closed row is missing or stale, the mission was not properly integrated and is out of scope.
- Risk: baseline suite noise (known `tui-command-flow` flake). Mitigation: rerun a failing test solo before treating it as a regression, and record both runs in the checkpoint.

## Checkpoints
- CP 1 (red): author `test/task-2348-implementer-attribution.test.ts` only. Build in-memory/temp-db measurement rows for two scenarios: (i) mission A with two implementers — earlier stage rows for `claude` (including a review stage with `reviewer_agent=vibe`), closed rollup row with `implementer=custom`; assert agent-performance groups credit `custom`, not `claude`. (ii) mission B with review aggregate of 3 `changes-requested` rounds, 2 belonging to reported implementer `custom` and 1 to previous implementer `claude`; assert `pr_fix_rounds` is `2`, not `3`. Checkpoint document must show the test failing at parent commit `c06b0ada6` with the exact failing assertion messages. No production file may change in CP 1.
- CP 2 (fix review-aggregate rounds): filter `rounds` by `round.implementer === reportedImplementer` in `deriveImplementerAndFixRounds` review-aggregate path. CP 1 assertion (b) goes green.
- CP 3 (fix implementer identity): route `computeAgentMissionGroups` to use closed rollup row's `implementer` as the identity; route `summarizeAgentWindow` to read `pr_fix_rounds` from the closed row. CP 1 assertion (a) goes green; criteria 4, 5 satisfied.
- CP 4 (regression sweep + docs): update `test/stats.test.ts`, `test/stats-report.test.ts`, `test/mission-phase-stats.test.ts` expectations; update `docs/` and `README.md`; run `./scripts/verify-local.sh all` and record totals.

### Checkpoint Documentation Requirements
Every checkpoint document (CP-N.md) MUST include:
- A summary of work done
- A `## Goal Check` section
- A 3-column pipe-delimited markdown table with columns: Criterion | Evidence | Status
- At least one evidence row per criterion using verifiable references. Parallix already accepts:
  1. **File:line references** — e.g., `src/adapters/cli/commands/stats.ts:1425` (must point to an existing file and line)
  2. **Test names** — e.g., `"task-2348: review-aggregate rounds filtered to reported implementer"` (must match a test name in the repo)
  3. **Test file paths** — e.g., `test/task-2348-implementer-attribution.test.ts` (must be an existing test file)
  4. **ADR references** — e.g., `ADR 0048` (must correspond to an existing file under `docs/adr/`)
  5. **Recognized repo commands or paths** — e.g., `` `npm test -- test/task-2348-implementer-attribution.test.ts` ``, `` `px stats --mission task-2348` ``, or `` `./scripts/verify-local.sh all` ``
- Raw `stat`/`ls` output or generic prose may appear as supplemental context, but pair them with one of the accepted references above. A checkpoint whose evidence column contains only `ls -la` output, only a token count, or only prose such as "verified the grouping is now correct" is incomplete and will be bounced: name the test, the test file, or the `file:line` that proves it.
- For CP 1 specifically, the red evidence must be the exact test name plus the `npm test -- test/task-2348-implementer-attribution.test.ts` invocation and the quoted failing assertion line.
- A non-generic `Next action:` line at the bottom

Example Goal Check table:

| Criterion | Evidence | Status |
|---|---|---|
| Review rounds filtered to reported implementer | `src/adapters/cli/commands/stats.ts:1425`, `"task-2348: review-aggregate rounds filtered to reported implementer"` | PASS |
| Implementer identity from closed rollup row | `src/adapters/cli/commands/stats.ts:905`, `"task-2348: mission with two implementers credits reported implementer"` | PASS |
| Verification gate ran | `./scripts/verify-local.sh all` | PASS |

## Gates
- [ ] `./scripts/verify-local.sh all`

## Restricted Areas
- `src/adapters/sqlite/migrations/` — no new or edited migration files.
- `src/domain/agents.ts`, `config/agents.json`, `config/agents.local.json` — agent families, eligibility, and weights are untouched.
- `src/adapters/review/` and `src/domain/review.ts` — review-loop behaviour is out of scope even though it produces the rounds data.
- `src/adapters/cli/commands/stats-backfill.ts` — no historical rewrite.
- Do not edit the `assignee` field of `backlog/tasks/task-2348 - implementer-attribution-is-wrong.md`.

## Stop Rules
- Stop and report if the closed rollup row's `implementer` field is empty or stale for missions in the reporting window — that indicates `recordIntegrationStats` did not run or `deriveImplementerAndFixRounds` returned wrong data, which is a separate mission.
- Stop and report if fixing the implementer identity requires a schema migration (i.e. `implementer_agent` / `reviewer_agent` turn out to be unpopulated for rows in the reporting window).
- Stop if `./scripts/verify-local.sh all` fails with a failure unrelated to stats attribution that also fails at parent commit `c06b0ada6`: record the baseline failure and do not repair production code to green a stale test.
- Stop if the reproduction test cannot be made to fail at the parent commit — a non-red repro means the defect has been mischaracterized and the mission must be re-drafted.
- Stop before touching more than the files named in Scope; report the needed file instead of editing it.
