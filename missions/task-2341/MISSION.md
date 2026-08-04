# Mission: Wire MissionStore into ConcreteReviewReadAdapter to fix review state on board projection (task-2341)

## Goal
Fix the bug where `px status` reports "Review: not started" for missions whose review state lives in the operator database but `ConcreteReviewReadAdapter` never queries it (missing `missionStore` param). Root cause: `ConcreteReviewReadAdapter` calls `readReviewState(slug, rootDir)` without passing a `MissionStore`, so `resolveMissionStore()` returns `null` and the DB is never queried.

## Why Now
Inconsistent across missions — review loop works in some (e.g. task-2333) but fails in others (e.g. task-2337). The missing `missionStore` param causes `ConcreteReviewReadAdapter` to skip the DB query on every call path that does not hand the store through, so missions whose review state lives only in SQLite report "not started" on the board. Missions whose review artifacts landed in file-based storage (legacy `review-state.json`) still render correctly, masking the bug for those cases. Blocks operator visibility into review-loop state for any mission relying on the DB path.

Reproduction-Test: test/task-2341-review-store-wiring.test.ts

## Refinement Signals
- Predicted NEL bucket: Small (0–80)
- Confidence: High
- Selection note: activate as-is
- Main drivers: missing `missionStore` param in adapter constructor and composition wiring; `BoardProjectionBuilder.build()` calls only `loadReviewApproval()` (not `loadReview()`) so full review never merged into mission card

## Scope
- Wire `MissionStore` through `composeBoardProjection()` into `ConcreteReviewReadAdapter`
- Update `ConcreteReviewReadAdapter` constructor to accept `missionStore` and pass it to `readReviewState()` calls in `loadReview()` and `loadReviewApproval()`
- Update `BoardProjectionBuilder.build()` to call `loadReview()` and merge the review into the mission before `projectMissionCard()`
- Add failing reproduction test that asserts review state is non-null when DB has review data
- Update `board-readers.test.ts` mock review adapter to cover the enriched path

## Out of Scope
- `ConcreteMissionReadAdapter` — its `mission.review` is `null` because the mission itself is read without review enrichment; the fix merges review at projection time instead of changing the mission adapter
- UI/TUI display logic changes — `projectMissionCard` output contract unchanged, only fills previously-null fields
- `readReviewRounds()` or `resolveReviewIdentity()` — same root cause but out of scope for this fix
- Legacy `review-state.json` backfill — unaffected by this wiring change

## Success Criteria
> **Falsifiability rule (ADR 0039 Part 2):** Each criterion must be falsifiable. Forbidden: subjective adjectives ("easy, fast, simple, intuitive, user-friendly, responsive, quick, efficient" without an attached metric) and vague quantifiers ("multiple, several, some, many, few, various"). For refactor / condense / migration missions, the criterion must enumerate the specific elements (rules, files, behaviours) that must survive — generic phrases like "preserve critical content" are not sufficient.

- SC1: `ConcreteReviewReadAdapterOptions` includes a `missionStore` property of type `MissionStore | null` (file: `src/adapters/backlog/concrete-review-read-adapter.ts`)
- SC2: `ConcreteReviewReadAdapter.loadReview()` passes `missionStore` to `readReviewState()` call (file: `src/adapters/backlog/concrete-review-read-adapter.ts`)
- SC3: `ConcreteReviewReadAdapter.loadReviewApproval()` passes `missionStore` to `readReviewState()` call (file: `src/adapters/backlog/concrete-review-read-adapter.ts`)
- SC4: `composeBoardProjection()` passes a `MissionStore` instance to `ConcreteReviewReadAdapter` constructor (file: `src/composition/board-projection.ts`)
- SC5: `BoardProjectionBuilder.build()` calls `loadReview(mission.id)` and merges returned `Review` into mission object before `projectMissionCard()` (file: `src/application/projections/board-readers.ts`)
- SC6: Reproduction test `test/task-2341-review-store-wiring.test.ts` fails on parent commit (asserts `reviewPhase !== null` for mission with DB review) and passes after fix
- SC7: Static analysis gate (`./scripts/verify-local.sh static-analysis`) reports zero errors on all changed files
- SC8: No new `.only` or bare `.skip` in any test file

## Risks and Assumptions
- `composeBoardProjection()` can access a `MissionStore` instance — assumes `BoardProjectionCompositionDeps` can be extended with a store, or the store is created inline (as `SqliteMissionStore` is in `application-services.ts`)
- `projectMissionCard()` accepts a `Mission` with `review` set to a non-null `Review` — existing code already branches on `mission.review` being truthy, so merging review is additive
- `readReviewState()` with a valid `MissionStore` returns `ReviewState` for missions with DB review — assumed from `review-state.ts` implementation
- No circular dependency introduced by adding `MissionStore` to `ConcreteReviewReadAdapter` — `MissionStore` is an interface from `domain-ports.js`, already imported by `review-state.ts`

## Checkpoints
- CP 1: Author failing reproduction test `test/task-2341-review-store-wiring.test.ts`. Test mocks `MissionStore` returning a mission with review data, then asserts `ConcreteReviewReadAdapter.loadReview()` returns non-null `Review` when `missionStore` is wired (green) vs null when store is absent (red). Test fails on parent commit because `missionStore` param does not exist yet.
- CP 2: Wire `MissionStore` into `ConcreteReviewReadAdapter` — add `missionStore` to options interface, constructor, and both `readReviewState()` calls.
- CP 3: Wire `MissionStore` into `composeBoardProjection()` — create or accept store, pass to `ConcreteReviewReadAdapter`.
- CP 4: Merge `loadReview()` into `BoardProjectionBuilder.build()` — call review adapter, attach review to mission before projection.
- CP 5: Verify reproduction test passes (red→green). Run full verification gate.

### Checkpoint Documentation Requirements
Every checkpoint document (CP-N.md) MUST include:
- A summary of work done
- A `## Goal Check` section
- A 3-column pipe-delimited markdown table with columns: Criterion | Evidence | Status
- At least one evidence row per criterion using verifiable references. Parallix already accepts:
  1. **File:line references** — e.g., `src/adapters/backlog/concrete-review-read-adapter.ts:72` (must point to an existing file and line)
  2. **Test names** — e.g., `"ConcreteReviewReadAdapter returns Review when missionStore is wired"` (must match a test name in the repo)
  3. **Test file paths** — e.g., `test/task-2341-review-store-wiring.test.ts` (must be an existing test file)
  4. **ADR references** — e.g., `ADR 0053` (must correspond to an existing file under `docs/adr/`)
  5. **Recognized repo commands or paths** — e.g., `` `./scripts/verify-local.sh static-analysis` ``, `` `npm test -- test/task-2341-review-store-wiring.test.ts` ``, or `` `px status task-2341` ``
- Raw `stat`/`ls` output or generic prose may appear as supplemental context, but pair them with one of the accepted references above. Weak-agent failure mode: raw `stat`/`ls` output or generic prose alone is not enough — always pair shell output with a file:line reference, test name, test file path, ADR reference, or recognized repo command.
- A non-generic `Next action:` line at the bottom

Example Goal Check table:

| Criterion | Evidence | Status |
|---|---|---|
| missionStore in adapter options | `src/adapters/backlog/concrete-review-read-adapter.ts:52` | PASS |
| Reproduction test passes | `test/task-2341-review-store-wiring.test.ts`, `"loadReview returns non-null Review when store wired"` | PASS |
| Static analysis clean | `./scripts/verify-local.sh static-analysis` | PASS |

## Gates
- [ ] `./scripts/verify-local.sh all`

## Restricted Areas
- `src/domain/review.ts` — domain model unchanged by this fix
- `src/adapters/review/review-state.ts` — `readReviewState` signature unchanged (missionStore is optional 3rd param, already exists)
- `src/application/projections/mission-board.ts` — `projectMissionCard` unchanged (already handles `mission.review` being non-null)
- `src/application/domain-ports.ts` — `MissionStore` interface unchanged

## Stop Rules
- Do not change `MissionStore` interface or `readReviewState()` signature
- Do not modify `projectMissionCard()` output shape — only fill previously-null review fields
- Do not add new dependencies (no new npm packages)
- If circular import detected between `board-projection.ts` and `concrete-review-read-adapter.ts`, use dynamic import for `SqliteMissionStore` (same pattern used in `status.ts`)
- If `BoardProjectionBuilder.build()` merge introduces type error on `Mission.review`, use spread: `{ ...mission, review }` (domain `Mission` has `review?: Review`)
