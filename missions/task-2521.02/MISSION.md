# Mission: First-class mission execution context and bounded checkpoint evidence (task-2521.02)

## Goal
Make the bounded execution context and checkpoint Goal Check evidence needed by the current mission lifecycle available as typed, persisted application/domain state, so an agent can start and resume a mission without treating `MISSION.md` or `CP-N.md` as an authority source.

## Why Now
TASK-2521.01 establishes the preceding persistence work. The remaining lifecycle, refinement, handoff, and review flows still need mission intent, declared constraints, gates, dependencies, and bounded checkpoint evidence to be readable after a restart. Modeling only the facts consumed by those flows is the prerequisite for retiring repository Markdown authority without replacing it with an opaque document blob.

## Refinement Signals
- Predicted NEL bucket: Medium (81–235)
- Confidence: High
- Selection note: dependency TASK-2521.01 must be integrated or otherwise available in this worktree before implementation begins.
- Main drivers: existing mission lifecycle consumers, SQLite persistence/migration boundary, application-owned context and checkpoint contracts, restart round trips, and optimistic-concurrency preservation.

## Scope
- Trace the execution, refinement, handoff, and review consumers to enumerate the bounded Mission facts they actually require: goal, context/why, scope, constraints, refinement signals, declared gates, and required dependency or predecessor facts.
- Add typed domain and application contracts only for the enumerated facts, with explicit semantics and validation appropriate to each bounded field.
- Persist those facts through the established SQLite migration and Mission persistence mechanisms, including the existing stale-write/optimistic-concurrency behavior.
- Provide application-owned read/write behavior for mission execution context and for recording/retrieving bounded `CheckpointData` Goal Check evidence without a checkpoint-file parse or write round trip.
- Store large or unbounded evidence as references rather than embedding it in Mission/checkpoint SQLite state, in accordance with ADR 0053.
- Add focused round-trip and restart coverage proving context and checkpoint evidence survive store/process reopening and are retrieved as identical domain facts.

## Out of Scope
- Deleting, renaming, or migrating existing `MISSION.md` or `CP-N.md` files.
- Persisting a raw mission document or raw checkpoint document as an opaque Markdown/blob authority.
- Adding fields merely because they appear in historical mission-document templates when no current consumer requires them.
- Changing unrelated board, agent, review, or repository metadata semantics.
- Redesigning the complete mission lifecycle beyond the context and bounded-evidence contracts required by current consumers.

## Success Criteria
> **Falsifiability rule (ADR 0039 Part 2):** Each criterion must be falsifiable. Forbidden: subjective adjectives ("easy, fast, simple, intuitive, user-friendly, responsive, quick, efficient" without an attached metric) and vague quantifiers ("multiple, several, some, many, few, various"). For refactor / condense / migration missions, the criterion must enumerate the specific elements (rules, files, behaviours) that must survive — generic phrases like "preserve critical content" are not sufficient.

- A caller can obtain every bounded execution fact currently consumed to start a mission agent through the Mission/application read contract, without reading `MISSION.md`; the covered facts are goal, why/context, scope, constraints, refinement signals, declared gates, and each currently consumed dependency/predecessor reference or outcome.
- Application behavior records and retrieves a checkpoint's bounded Goal Check evidence as `CheckpointData` without creating, reading, or parsing a `CP-N.md` file.
- SQLite schema and persistence contain typed bounded fields and reference-valued large/unbounded evidence only; no new raw Mission Markdown or raw checkpoint Markdown authority column, blob, or serialization is introduced.
- Each newly persisted field has a named current execution/refinement/handoff/review consumer and an explicit domain/application meaning recorded in implementation evidence.
- A round-trip/restart test writes execution context and checkpoint evidence, closes and reopens the SQLite store, and asserts retrieval of the same domain facts without repository metadata.
- Existing Mission lifecycle invariants and stale-write protection remain covered and passing for the changed persistence path.

## Risks and Assumptions
- Assumption: TASK-2521.01 supplies its promised prerequisite persistence foundation; if it is absent or incompatible, stop rather than duplicating or bypassing it.
- Risk: historical document headings may suggest data that no live consumer needs. Mitigation: enumerate consumers first and reject fields lacking a demonstrated consumer.
- Risk: evidence text can become unbounded. Mitigation: enforce the ADR 0053 boundary and persist references for large/unbounded material.
- Risk: adding persistence fields can accidentally weaken revision checks. Mitigation: exercise stale-write behavior alongside restart/round-trip coverage.
- Risk: a file-backed checkpoint path may remain an implicit authority. Mitigation: test application recording/retrieval with no CP file round trip.

## Checkpoints
- CP 1: Map the current execution/refinement/handoff/review consumers and record the exact bounded facts, checkpoint evidence elements, and large-evidence reference boundary they require; confirm TASK-2521.01's usable prerequisite interface.
- CP 2: Define and implement the minimal typed Mission and application contracts, SQLite migration, and persistence mapping for the proven facts while retaining revision/stale-write semantics.
- CP 3: Complete application-owned checkpoint Goal Check evidence recording and retrieval; add round-trip, restart, stale-write, and no-file-round-trip tests.
- CP 4: Run the required repository verification, inspect changed contracts for opaque-Markdown authority or unsupported fields, and document the final Goal Check.

### Checkpoint Documentation Requirements
Every checkpoint document (CP-N.md) MUST include:
- Start the evidence with durable forms Parallix verifies today: exact test names, ADR references (including `ADR 0053`, `ADR 0048`, and `ADR 0032` where applicable), test file paths, and recognized repository commands or paths such as `npm ...`, `node ...`, `git ...`, `px ...`, or `./...`.
- Use the exact heading `## Goal Check`.
- Under that heading, use the exact 3-column table `| Criterion | Evidence | Status |` and include at least one evidence row for every Success Criterion.
- Cite exact test names and their test file paths for consumer coverage, no-file checkpoint recording, restart round trip, and stale-write behavior; cite the SQLite migration and application/domain contract paths where they establish the persisted boundary.
- Use `./scripts/verify-local.sh all` as verification evidence after it has run. File:line references are accepted parenthetically when needed but discouraged because line numbers rot.
- Raw `stat`/`ls` output or generic prose alone is not enough: when included, pair it with an accepted command/path, test name, test file path, or ADR reference above.
- End with a non-generic `Next action:` line naming the next consumer, contract, migration, test, or verification action.

Example Goal Check table:

| Criterion | Evidence | Status |
|---|---|---|
| Execution context is available without document authority | exact context-read test name and test file path | PASS/FAIL |
| Checkpoint Goal Check evidence round-trips through application behavior | exact checkpoint test name and test file path | PASS/FAIL |
| Required verification completed | `./scripts/verify-local.sh all` | PASS/FAIL |

## Gates
- [ ] ./scripts/verify-local.sh all

## Restricted Areas
- Do not delete, rename, or bulk-convert existing mission or checkpoint Markdown during this mission.
- Do not introduce raw `MISSION.md` or `CP-N.md` content as SQLite authority, including JSON wrappers around raw Markdown.
- Do not change fields, migrations, or adapters unrelated to the proved execution-context and bounded-evidence path.
- Do not bypass established migration, application-port, or optimistic-concurrency mechanisms.
- Do not update authored documentation unless the implemented behavior changes durable user-facing meaning; if documentation changes, follow `docs/doc-standards.md` and run its required documentation verification.

## Stop Rules
- Stop and request direction if TASK-2521.01 is not available or exposes an incompatible persistence contract.
- Stop before adding any proposed field for which no current execution, refinement, handoff, or review consumer can be demonstrated.
- Stop before persisting evidence whose size or semantics require a reference under ADR 0053 rather than bounded SQLite state.
- Stop and resolve the design if a context/evidence write cannot retain the existing Mission stale-write protection.
- Stop and request direction if satisfying a live consumer requires deleting or treating repository Markdown as an authority source in this mission.
