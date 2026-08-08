# Mission: Fix review state persistence and human notes dedup (task-2342)

## Goal
Fix `persistReviewStateOrThrow` so it passes `missionStore` to `writeReviewState`, and add dedup key to `consumeHumanNotes` so PR comments are not re-processed each review round.

## Why Now
Review loop crashes after reviewer completes with "Operator database unavailable" because `persistReviewStateOrThrow` calls `writeFn(slug, state, worktree)` — omits 4th param `missionStore`. Every call site in `review-loop.ts` (19 sites) inherits this. Secondary: `consumeHumanNotes` fetches ALL PR comments every call with no dedup key, causing same comments to be re-processed each round.

## Refinement Signals
- Predicted NEL bucket: Small (0–80)
- Confidence: High
- Selection note: activate as-is
- Main drivers: Signature fix in `persistReviewStateOrThrow` (+ pass `missionStore` through 19 call sites), dedup set in `consumeHumanNotes`, repro test, and unit tests

## Scope
- `src/adapters/review/review-state.ts` — fix `persistReviewStateOrThrow` signature to accept `missionStore` param and forward it to `writeFn(slug, state, worktree, missionStore)`
- `src/adapters/review/review-loop.ts` — pass `missionStore` at all 19 `persistReviewStateOrThrow` call sites
- `src/adapters/review/review-commands.ts` — fix `persistReviewStateOrThrow` call sites
- `src/adapters/review/review-artifacts.ts` — fix `persistReviewStateOrThrow` call sites
- `src/adapters/review/review-events.ts` — add dedup key (comment body hash or unique identifier) to `consumeHumanNotes` so already-processed comments are skipped on re-invocation
- `test/review-state.test.ts` or new test file — repro test for `persistReviewStateOrThrow` missing `missionStore`
- `test/review-events.test.ts` — test for `consumeHumanNotes` dedup behavior

## Out of Scope
- Changes to `createEvent` or `CreateEventOptions` (those already receive `missionStore` correctly)
- Schema migrations or database changes
- Changes to `readReviewState`, `resetReviewState`, or `writeReviewState` function bodies
- Changes to event persistence path (events already work via `CreateEventOptions.missionStore`)
- Refactoring the 19 call sites into a helper; only add the missing arg

## Success Criteria
- SC1: `persistReviewStateOrThrow` accepts `missionStore` as 5th parameter (after `worktree`) and passes it as 4th arg to `writeFn(slug, state, worktree, missionStore)`
- SC2: All 19 `persistReviewStateOrThrow` call sites in `review-loop.ts` pass `missionStore`
- SC3: All `persistReviewStateOrThrow` call sites in `review-commands.ts` and `review-artifacts.ts` pass `missionStore`
- SC4: `consumeHumanNotes` tracks processed comments by a stable dedup key and skips re-creating events for already-seen comments on subsequent invocations
- SC5: Reproduction test for the `missionStore` bug fails on parent commit (red) and passes after fix (green)
- SC6: `./scripts/verify-local.sh all` passes on final tree
- SC7: No new `.only` or bare `.skip` tests introduced

## Risks and Assumptions
- Risk: Some call sites in `review-loop.ts` may not have `missionStore` in local scope — may need to thread it from the top-level function params. Mitigation: trace `missionStore` availability from `reviewLoop` entry point.
- Risk: Dedup key choice for `consumeHumanNotes` — using comment body hash vs a server-side comment ID. Assumption: comments have a stable identifier (e.g., `id` field from PR comment API). If not, body hash suffices.
- Assumption: `missionStore` is available at review-loop entry and can be threaded to all call sites without requiring new composition changes.
- Assumption: TASK-2334 (review state mapping) does not conflict with these changes; both touch `review-state.ts` but on different functions.

## Checkpoints
- CP 1: Author failing reproduction test for `persistReviewStateOrThrow` missing `missionStore`. Test file: `test/task-2342-missionstore-repro.test.ts`. Scenario: call `persistReviewStateOrThrow(writeReviewState, slug, state, worktree)` with no `missionStore` — assert that `writeReviewState` is called with 4 args including `missionStore`. Test fails on parent commit (writeFn called with 3 args), passes after fix (writeFn called with 4 args).
- CP 2: Fix `persistReviewStateOrThrow` signature in `review-state.ts` and update all call sites in `review-loop.ts`, `review-commands.ts`, `review-artifacts.ts`. Repro test turns green.
- CP 3: Add dedup key to `consumeHumanNotes` in `review-events.ts`. Add unit test confirming same comment processed twice creates only one event.
- CP 4: Run `./scripts/verify-local.sh all`, fix any lint/type errors. Final verification.

Reproduction-Test: test/task-2342-missionstore-repro.test.ts

### Checkpoint Documentation Requirements
Every checkpoint document (CP-N.md) MUST include:
- A summary of work done
- A `## Goal Check` section
- A 3-column pipe-delimited markdown table with columns: Criterion | Evidence | Status
- At least one evidence row per criterion using verifiable references. Parallix already accepts:
  1. **File:line references** — e.g., `src/adapters/review/review-state.ts:75` (must point to an existing file and line)
  2. **Test names** — e.g., `"persistReviewStateOrThrow passes missionStore to writeFn"` (must match a test name in the repo)
  3. **Test file paths** — e.g., `test/task-2342-missionstore-repro.test.ts` (must be an existing test file)
  4. **ADR references** — e.g., `ADR 0039` (must correspond to an existing file under `docs/adr/`)
  5. **Recognized repo commands or paths** — e.g., `` `./scripts/verify-local.sh all` ``, `` `node --import tsx test/review-state.test.ts` ``
- Raw `stat`/`ls` output or generic prose may appear as supplemental context, but pair them with one of the accepted references above
- A non-generic `Next action:` line at the bottom

Example Goal Check table:

| Criterion | Evidence | Status |
|---|---|---|
| persistReviewStateOrThrow accepts missionStore param | `src/adapters/review/review-state.ts:81` | PASS |
| Repro test passes | `test/task-2342-missionstore-repro.test.ts`, `"persistReviewStateOrThrow passes missionStore to writeFn"` | PASS |
| Verification gate ran | `./scripts/verify-local.sh all` | PASS |

## Gates
- [ ] `./scripts/verify-local.sh all`

## Restricted Areas
- `src/application/` — do not modify composition or domain-ports for this fix; `missionStore` flows through existing injection paths
- `src/domain/mission.ts` — no changes to the Mission domain model
- Event persistence (`createEvent`, `CreateEventOptions`) — already correct, do not modify
- `config/integration-pipelines.json` — no pipeline changes

## Stop Rules
- Stop if `missionStore` is not available at 3+ call sites in `review-loop.ts` without requiring new function params — re-evaluate threading strategy
- Stop if dedup key requires a new database column or schema migration — defer dedup to separate mission
- Stop if TASK-2334 introduces conflicting changes to `persistReviewStateOrThrow` — coordinate with that mission
- Do not add new dependencies to `package.json`
