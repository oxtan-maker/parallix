# Mission: Board review projection discards all prior review rounds (task-2358)

## Goal
Fix `ConcreteReviewReadAdapter.toDomainReview()` so it reads persisted review rounds from `mission_review_rounds` (plus findings, resolutions, events) instead of synthesising a single round from the flat `ReviewState` compatibility artifact. After fix, `px status <slug>` and the TUI render all N persisted rounds for any mission.

## Why Now
Every prior review round's reviewer/implementer families, verdict, findings, fixes, and pushbacks are invisible to the operator. This blocks reviewers from determining whether a finding was already settled in an earlier round. The defect was raised as a review finding on nine consecutive rounds of TASK-2332.13 without an owner — it is self-perpetuating.

## Refinement Signals
- Predicted NEL bucket: Medium (81–235)
- Confidence: High
- Selection note: activate as-is
- Main drivers: one adapter method rewritten against existing store queries; findings/resolutions/event joins; regression fixture. No schema change — rows already exist.

## Scope
- Rewrite `ConcreteReviewReadAdapter.toDomainReview()` to query `mission_review_rounds`, `mission_review_findings`, `mission_review_resolutions`, and `mission_review_events` from the mission store
- Map each persisted round row to a `ReviewRound` domain object with correct `round_number`, `reviewer`, `implementer`, `phase`, `disposition`, `decision`, and `response`
- Join `mission_review_findings` (by `round_position`) into each round's `decision.findings`
- Join `mission_review_resolutions` (by `round_position`) into each round's `response.resolutions`
- Populate `reviewEvents` from `mission_review_events` instead of hardcoding `[]`
- Keep flat `ReviewState` as fallback for missions with zero persisted rounds (backward compat)
- Add 3-round regression fixture test that fails on pre-fix tree

## Out of Scope
- `projectReviewHistory()` — already handles N rounds correctly
- `src/interfaces/cli/status.ts` — renderer already loops rounds
- `src/adapters/cli/commands/status.ts` — CLI command already passes rounds through
- TUI mission detail view — already renders round list
- Schema migration — tables `mission_review_rounds`, `mission_review_findings`, `mission_review_resolutions`, `mission_review_events` already exist with needed columns
- `loadReviewApproval()` — approval path uses flat state intentionally; not affected by round collapse

## Success Criteria
- SC1: `ConcreteReviewReadAdapter.loadReview()` returns a `Review` whose `rounds` array length equals the row count of `mission_review_rounds WHERE mission_id = ?` for any mission with persisted rounds
- SC2: Each `ReviewRound` in the returned array carries the persisted `round_number`, `reviewer`, `implementer`, `phase`, and `disposition` from its corresponding `mission_review_rounds` row — values differ across rounds, not repeated
- SC3: Rounds whose `decision_kind = 'changes-requested'` carry `decision.findings` populated from `mission_review_findings` rows matching that round's `round_position`
- SC4: Rounds whose `responded_at` is non-null carry `response.resolutions` populated from `mission_review_resolutions` rows matching that round's `round_position`
- SC5: `review.reviewEvents` array length equals row count of `mission_review_events WHERE mission_id = ?` (not hardcoded `[]`)
- SC6: `px status <slug>` on a mission with 3+ persisted rounds prints exactly N `Round <n>` lines, each with distinct reviewer/implementer/disposition values matching the database
- SC7: Missions with zero rows in `mission_review_rounds` still return a valid `Review` via the flat `ReviewState` fallback path — no null or empty-rounds result
- SC8: Regression test file exists, runs, and fails on the parent commit (asserts 3-round fixture does not collapse to 1 round)

## Risks and Assumptions
- Assumption: `mission_review_rounds`, `mission_review_findings`, `mission_review_resolutions`, and `mission_review_events` tables carry all columns needed for domain mapping (verified in backlog analysis)
- Assumption: `MissionStore` exposes the raw query methods or the `loadMission()` result includes `reviewRounds`, `findings`, `resolutions`, `reviewEvents` arrays that the adapter can access
- Risk: `ConcreteReviewReadAdapter` currently receives `MissionStore` as optional (`null` allowed). If the store is null, the adapter cannot query rounds — fallback to flat `ReviewState` must handle this case explicitly
- Risk: `loadReviewApproval()` also calls `readReviewState()` — ensure it is not inadvertently affected by changes to `toDomainReview()`
- Risk: The `ReviewRound` domain type has optional fields (`itemDispositions`, `implementerResponseContent`, `blockedReason`) that have DB column counterparts — verify these map correctly or default to undefined

Reproduction-Test: test/task-2358-multi-round-repro.test.ts

## Checkpoints
- CP 1: Author failing regression test (`test/task-2358-multi-round-repro.test.ts`) that asserts a 3-round fixture does not collapse to 1 round. Test must fail on parent commit (red) and pass after fix (green). Scenario: seed a mission with 3 distinct rounds in `mission_review_rounds` with different reviewer/implementer/disposition values, load via `ConcreteReviewReadAdapter`, assert `rounds.length === 3` and each round's fields match seeded values.
- CP 2: Rewrite `ConcreteReviewReadAdapter.toDomainReview()` to read from persisted rounds, findings, resolutions, and events. Wire up the mission store query path. Keep flat `ReviewState` fallback for zero-round missions. Verify regression test turns green.
- CP 3: Run static analysis gate and verify end-to-end with `px status` on a real multi-round mission. Confirm round count matches DB row count.

### Checkpoint Documentation Requirements
Every checkpoint document (CP-N.md) MUST include:
- A summary of work done
- A `## Goal Check` section
- A 3-column pipe-delimited markdown table with columns: Criterion | Evidence | Status
- At least one evidence row per criterion using verifiable references. Parallix already accepts:
  1. **File:line references** — e.g., `src/adapters/backlog/concrete-review-read-adapter.ts:142` (must point to an existing file and line)
  2. **Test names** — e.g., `"multi-round fixture does not collapse to 1 round"` (must match a test name in the repo)
  3. **Test file paths** — e.g., `test/task-2358-multi-round-repro.test.ts` (must be an existing test file)
  4. **ADR references** — e.g., `ADR 0039` (must correspond to an existing file under `docs/adr/`)
  5. **Recognized repo commands or paths** — e.g., `` `./scripts/verify-local.sh all` ``, `` `npm test -- test/task-2358-multi-round-repro.test.ts` ``, or `` `px status task-2332.13` ``
- Raw `stat`/`ls` output or generic prose may appear as supplemental context, but pair them with one of the accepted references above. Weak-agent failure mode: shell output alone without a file:line, test name, or command reference is not sufficient evidence.
- A non-generic `Next action:` line at the bottom

Example Goal Check table:

| Criterion | Evidence | Status |
|---|---|---|
| Adapter reads persisted rounds | `src/adapters/backlog/concrete-review-read-adapter.ts:142` | PASS |
| Regression test passes | `test/task-2358-multi-round-repro.test.ts`, `"3-round fixture does not collapse to 1 round"` | PASS |
| Static analysis clean | `` `./scripts/verify-local.sh all` `` | PASS |

## Gates
- [ ] `./scripts/verify-local.sh all`

## Restricted Areas
- `src/application/projections/mission-board.ts` — `projectReviewHistory()` already handles N rounds; do not modify
- `src/interfaces/cli/status.ts` — renderer already loops rounds; do not modify
- `src/adapters/cli/commands/status.ts` — CLI command already passes rounds through; do not modify
- TUI mission detail view — already renders round list; do not modify
- `src/domain/review.ts` — domain types are correct; do not modify
- `src/adapters/sqlite/mission-store.ts` — store queries return correct data; do not modify
- `src/adapters/review/review-state.ts` — flat `ReviewState` is the compatibility artifact; do not modify its schema
- Only `src/adapters/backlog/concrete-review-read-adapter.ts` and its test file should change

## Stop Rules
- Stop for human direction if populating rounds requires a schema migration (current assessment: no migration needed)
- Stop for human direction if `MissionStore` is null in production paths where rounds are expected — clarify whether the store is always available for board projection
- Stop if `loadReviewApproval()` behavior changes unexpectedly after adapter rewrite — verify approval path independently
- Stop if the regression test does not fail on the parent commit — re-examine fixture setup
