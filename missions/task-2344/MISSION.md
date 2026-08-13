# Mission: Project full review round history into px status (task-2344)

## Goal
Make `px status <slug>` display the complete persisted review-round history for a mission, including reviewer and implementer families, disposition, findings, fixes, and pushbacks for each recorded round.

## Why Now
The reviewer workflow promises that `px status <slug>` preserves review continuity across reviewer-family reroutes, but the current read adapter projects only the current round and discards history already stored in SQLite. The stated review contract is therefore unsatisfiable and hides the information needed to resume an in-progress review safely.

## Refinement Signals
- Predicted NEL bucket: Medium (81–235)
- Confidence: High
- Selection note: activate as-is
- Main drivers: hydrate the persisted review aggregate through the existing read adapter; retain per-round findings, resolutions, and events in the board projection; lock the rendered status contract with a red-to-green multi-round regression test.

## Scope
- Add a red-to-green status-output regression test under `test/` that creates a mission with recorded review rounds and verifies the rendered `Review:` block contains the earlier rounds as well as the current round.
- Change `ConcreteReviewReadAdapter.loadReview()` to read the persisted mission review aggregate through the existing mission store rather than synthesize a one-round review from flat `ReviewState`.
- Project each persisted round's reviewer family, implementer family, disposition, findings, implementer resolutions, and review events into the existing review-history model consumed by `px status`.
- Verify that the rendered status history exposes findings and `fixed:` / `pushback:` resolution lines for the round to which they belong.
- Reconcile the reviewer-prompt claim in `prompts/review.md` with the shipped command behavior: retain the claim if the implementation satisfies it, otherwise amend the claim in the same change.

## Out of Scope
- The `pullRequest`, gate-status, checkpoint-parsing, and SQLite lifecycle-persistence gaps owned by task-2343.
- Changes to `BoardProjection` or `MissionCard` type shapes.
- TUI layout or printer redesign; the existing status renderer remains the display surface.
- Changes to the recording, mutation, or lifecycle rules for review rounds, findings, resolutions, or events.
- Introducing new read-adapter interfaces.

## Success Criteria
> **Falsifiability rule (ADR 0039 Part 2):** Each criterion must be falsifiable. Forbidden: subjective adjectives ("easy, fast, simple, intuitive, user-friendly, responsive, quick, efficient" without an attached metric) and vague quantifiers ("multiple, several, some, many, few, various"). For refactor / condense / migration missions, the criterion must enumerate the specific elements (rules, files, behaviours) that must survive — generic phrases like "preserve critical content" are not sufficient.

- A regression test under `test/` fails at the mission parent commit because `px status <slug>` omits recorded prior rounds, then passes after the change and asserts the rendered `Review:` block identifies every seeded round.
- For every seeded round in the regression fixture, status output contains that round's reviewer family, implementer family, and disposition; the fixture includes a first round with `PUSHBACK_ALL` and a final round with `BLOCKED`.
- A finding recorded for an earlier seeded round is present in that round's projected `findingSummaries` and is rendered by `px status <slug>`.
- Implementer resolutions recorded for earlier seeded rounds are rendered as both `fixed:` and `pushback:` lines in the corresponding status-history entries.
- `px status task-2337` can project its persisted six review rounds, including round 1 `PUSHBACK_ALL` and round 6 `BLOCKED`, when run against the operator database containing that mission history.
- The final implementation uses the existing `ConcreteReviewReadAdapter` and mission-store read path without adding a read-adapter interface or changing `BoardProjection` or `MissionCard` shapes.
- The reviewer prompt's history statement matches the final command behavior, and `./scripts/verify-local.sh all` completes successfully on the final tree.

## Risks and Assumptions
- Assumption: `SqliteMissionStore` continues to hydrate review rounds, findings, resolutions, and events as one mission aggregate; the adapter can consume that aggregate without a schema migration.
- Risk: task-2343 is editing the same concrete read adapter. Coordinate ownership before changing adjacent code, and limit this mission's edits to the review-round-history path.
- Risk: ordering and association of findings, resolutions, and events can be lost while translating persistence records into domain rounds. The regression fixture must use distinct round identifiers and unique content so incorrect grouping is observable.
- Risk: `task-2337` database data is operator state and may not be available in automated tests. Treat it as manual integration evidence only; the deterministic test fixture is the required automated proof.

## Checkpoints
- CP 1: Create `test/task-2344-review-history-status-repro.test.ts` before any production change. Seed a multi-round persisted mission review with earlier and current rounds, an earlier-round finding, and fixed and pushback resolutions; assert that `px status <slug>` renders every round's families and disposition plus the earlier finding and resolution lines. At the mission parent commit the assertion is red because the adapter returns only the current round; it becomes green after the read-path fix.
- CP 2: Implement the aggregate-backed review read in `ConcreteReviewReadAdapter`, preserving each persisted round's decisions, findings, resolutions, and events while leaving existing type shapes and interfaces intact.
- CP 3: Complete the status-output regression coverage, reconcile `prompts/review.md` with the delivered behavior, and run the required repository verification gate.

Reproduction-Test: test/task-2344-review-history-status-repro.test.ts

### Checkpoint Documentation Requirements
Every checkpoint document (CP-N.md) MUST include:
- Begin evidence with durable references Parallix verifies today: exact test names, ADR references, test file paths, and recognized repository commands or paths such as `npm ...`, `node ...`, `git ...`, `px ...`, or `./...`.
- Use the exact heading `## Goal Check`.
- Under that heading, include the exact 3-column pipe-delimited table header `| Criterion | Evidence | Status |` and at least one evidence row for every success criterion.
- Cite the red and green state of `test/task-2344-review-history-status-repro.test.ts` by its exact test name and path; cite the final gate with `./scripts/verify-local.sh all`.
- File:line references are accepted when necessary but discouraged because line numbers rot; prefer test names, ADR references, test paths, and recognized repository commands or paths.
- Raw `stat`/`ls` output or generic prose alone is not enough. Shell output may be supplemental only when paired with one of the accepted references above.
- End with a non-generic `Next action:` line describing the next implementation or verification action.

Example Goal Check table:

| Criterion | Evidence | Status |
|---|---|---|
| Red-to-green status history regression is locked | `test/task-2344-review-history-status-repro.test.ts`, exact test name | PASS |
| Final verification gate ran | `./scripts/verify-local.sh all` | PASS |

## Gates
- [ ] ./scripts/verify-local.sh all

## Restricted Areas
- Do not modify the task-2343-owned `pullRequest`, gate-status, checkpoint-parsing, or SQLite lifecycle-persistence behavior while resolving review history.
- Do not alter `BoardProjection`, `MissionCard`, status-printer layout, persistence schema, or review-write workflows.
- Do not introduce a read-adapter interface; use the existing concrete adapter and mission-store capability.
- Do not use live Forgejo or operator SQLite state in unit tests; tests must be fast and use mocked or fixture-controlled dependencies.

## Stop Rules
- Stop and request coordination if task-2343 has an unmerged or conflicting change in `ConcreteReviewReadAdapter` that cannot be cleanly separated by review-history responsibility.
- Stop and request a decision if the existing mission-store aggregate cannot provide per-round findings, resolutions, or events without a schema migration or a new public interface.
- Stop and request product direction if satisfying the reviewer prompt requires changing status output beyond the existing `Review:` history block or changing the documented review-continuity contract.
