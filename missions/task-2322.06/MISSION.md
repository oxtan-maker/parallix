# Mission: Route review, integration, closure, and projections through application use cases (task-2322.06)

## Goal
Move the remaining Mission review lifecycle, integration and closure decisions, and Mission-facing projections behind checked application use cases and ports, while retaining one file-backed compatibility authority until TASK-2322.07.

## Why Now
TASK-2322.05 establishes the prior application boundary. The remaining direct file readers and writers in review, integration, closure, status, board, and TUI paths would otherwise let callers bypass version checks and transition policy before the TASK-2322.07 authority cutover. Completing this routing first makes the cutover a deletion of legacy access paths rather than a behavior migration.

## Refinement Signals
- Predicted NEL bucket: Large (235+)
- Confidence: High
- Selection note: activate after TASK-2322.05 is available on the mission base.
- Main drivers: review round and finding lifecycle coverage; checked integration and closure decisions that consume observed Git and verification facts; replacement of direct projection reads in CLI, TUI, and board paths; fast mocked contract tests for normal and failure outcomes; executable assignment of all remaining Mission-domain file access to TASK-2322.07 deletion.

## Scope
- Define or complete application commands and queries that load and mutate Mission review rounds, revisions, findings, resolutions, and review completion through checked Review state and application ports.
- Route integration and closure decisions through application use cases that combine Mission state with explicitly observed Git and verification facts supplied through ports.
- Route status, shared board, and TUI Mission projections through application queries rather than direct reads of task, checkpoint, review-state, or NEL files.
- Route UI commands through the same application use cases and transition policy used by CLI commands.
- Add fast unit or command-level tests with mocked ports for success, stale-version conflict, rejected transition, missing external fact, and persistence failure behavior.
- Produce an executable inventory that assigns each remaining Mission-domain file reader and writer to deletion in TASK-2322.07.

## Out of Scope
- Selecting SQLite or any other persistence implementation as production authority, synchronizing it with files, or adding dual write, shadow read, reconciliation, or database-to-file fallback.
- Deleting legacy Mission-domain file readers or writers; TASK-2322.07 owns that deletion after compatibility authority cutover.
- Copying Git repository state, provider state, or verification output into a competing Mission aggregate.
- Changing Git/provider integration semantics beyond observing the facts needed for checked integration and closure decisions.
- Unrelated board, TUI, or CLI redesign.

## Success Criteria
> **Falsifiability rule (ADR 0039 Part 2):** Each criterion must be falsifiable. Forbidden: subjective adjectives ("easy, fast, simple, intuitive, user-friendly, responsive, quick, efficient" without an attached metric) and vague quantifiers ("multiple, several, some, many, few, various"). For refactor / condense / migration missions, the criterion must enumerate the specific elements (rules, files, behaviours) that must survive — generic phrases like "preserve critical content" are not sufficient.

- Review rounds, revisions, findings, resolutions, and review completion are loaded, queried, and mutated only through checked Mission Review-state application commands, queries, and ports; their normal transition behavior remains observable through the CLI and UI entry points.
- Integration and closure application commands reject absent required observed Git or verification facts, apply Mission transition policy against the supplied facts, and do not persist Git or provider state in a competing Mission aggregate.
- Status, shared board, and TUI projection code obtains Mission current state through application queries; no production projection path directly reads task, checkpoint, review-state, or NEL files.
- UI commands and CLI commands invoke the same application use-case entry points for the covered review, integration, and closure transitions, with no UI-only persistence writer or transition-policy implementation.
- Focused mocked-dependency tests cover the observable success path, stale-version conflict, rejected transition, missing external fact, and persistence failure for the routed CLI or projection behavior; no new focused or unannotated skipped tests are introduced.
- Before TASK-2322.07, production selects exactly one file-backed compatibility authority and contains no dual write, shadow read, reconciliation, or database-to-file fallback path.
- The executable inventory names every remaining Mission-domain file reader and writer, identifies its path and access role, and assigns it to deletion in TASK-2322.07.
- `./scripts/verify-local.sh all` completes successfully on the completed mission tree, and the final checkpoint records accepted evidence for every criterion.

## Risks and Assumptions
- Assumes TASK-2322.05 supplies the foundational Mission application boundary and its abstractions can be extended without reopening its ownership decisions.
- Review state and projection readers may be reachable from runtime paths not named in the backlog references; implementation must inventory imports and call sites before declaring direct access removed.
- Git and verification observations can become stale between observation and command execution; stale or missing facts must be represented as explicit checked outcomes rather than silently refreshed persistence state.
- Compatibility wrappers may conceal direct file access. If a required caller cannot be routed without selecting a new authority or creating dual-write behavior, stop and obtain a boundary decision.
- SQLite adapter verification remains independent; tests must mock ports and must not access Forgejo or invoke expensive agent workflows.

## Checkpoints
- CP 1: Map all Mission-domain review, integration, closure, status, board, and TUI readers and writers; define the application command/query and port ownership for each path, and record the legacy accesses that TASK-2322.07 will delete.
- CP 2: Route review rounds, revisions, findings, resolutions, and completion through checked Review-state application use cases; add mocked tests for successful mutation, stale-version conflict, rejected transition, and persistence failure.
- CP 3: Route integration and closure through application use cases consuming explicit observed Git and verification facts; add mocked tests for valid facts, missing facts, rejected transitions, stale versions where applicable, and persistence failure.
- CP 4: Route status, board, and TUI projections and UI commands through application queries and the same commands used by CLI entry points; remove UI-only persistence and policy paths without changing the selected compatibility authority.
- CP 5: Complete the executable TASK-2322.07 deletion inventory, run required verification, and write checkpoint evidence demonstrating each success criterion and the absence of direct production projection reads.

### Checkpoint Documentation Requirements
Every checkpoint document (`CP-N.md`) MUST include:
- A concrete summary of the readers, writers, commands, queries, ports, tests, or inventory rows changed in that checkpoint.
- The exact heading `## Goal Check`.
- The exact 3-column pipe-delimited table header `| Criterion | Evidence | Status |`, followed by at least one row for every Success Criterion affected or verified by the checkpoint.
- Accepted evidence must use Parallix-verifiable forms: existing file:line references; exact repository test names; ADR references; existing test file paths; or recognized repository commands/paths such as backticked `npm ...`, `node ...`, `git ...`, `px ...`, or `./...`.
- For this mission, evidence should identify the application use case and port call site, the projection or UI/CLI entry point, the mocked test path and exact test name, and the TASK-2322.07 deletion-inventory entry when relevant.
- Raw `stat`/`ls` output or generic prose alone is not evidence. It may be supplemental only when paired with an accepted file:line reference, exact test name, ADR reference, test path, or recognized command/path above.
- A non-generic `Next action:` line at the bottom that identifies the next checkpoint operation or final verification action.

## Gates
- [ ] ./scripts/verify-local.sh all
- [ ] ./scripts/verify-local.sh static-analysis

## Restricted Areas
- Do not change the selected production compatibility authority before TASK-2322.07.
- Do not introduce SQLite-to-file or file-to-SQLite synchronization, dual writes, shadow reads, reconciliation, or fallback.
- Do not persist observed Git, provider, or verification facts as a competing Mission aggregate.
- Do not leave direct production reads of task, checkpoint, review-state, or NEL files in status, shared board, or TUI projections.
- Do not write tests that access real Forgejo, launch performance-heavy CLI commands, or invoke agents; dependency boundaries must be mocked.

## Stop Rules
- Stop before implementation if TASK-2322.05 is unavailable or its application boundary conflicts with the required routing; record the specific missing contract and request a dependency decision.
- Stop and request a decision if a proposed route requires selecting a new production authority, dual writing, shadow reading, reconciliation, or database-to-file fallback.
- Stop and request a domain-boundary decision if a required integration or closure behavior cannot be evaluated from Mission state plus explicitly observed Git and verification facts.
- Stop and request scope clarification if an unlisted caller requires deletion rather than routing, because deletion is reserved for TASK-2322.07.
