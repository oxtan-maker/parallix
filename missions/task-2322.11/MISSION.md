# Mission: Complete operator-state repositories and shared UI projection wiring (task-2322.11)

## Goal
Make SQLite the production authority for operator state and expose that state through application ports and shared projections, so the CLI, TUI, and web-board consumers all receive the same Mission, repository, agent-block, preference, and operational-history view without directly accessing persistence.

## Why Now
Missions TASK-2322.07 and TASK-2322.10 established the domain and persistence boundaries, but presentation surfaces still need the complete production wiring. Closing this gap prevents each surface from retaining or recreating its own durable-state authority before the web board is introduced.

## Refinement Signals
- Predicted NEL bucket: Large (235+)
- Confidence: Medium
- Selection note: complete the post-cutover persistence and projection seam after confirming the ports introduced by TASK-2322.07 and TASK-2322.10.
- Main drivers: SQLite repository completion; application query and port contracts; one production composition root; removal or test confinement of in-memory and adapter-specific presentation shortcuts; isolated unit coverage for persistence failures and operator-state edge cases.

## Scope
- Implement checked SQLite-backed repositories for KnownRepository observations and UI preferences, and bind them in the production composition root.
- Preserve KnownRepository identity by RepositoryId while replacing observation metadata when a repository path changes or a repository is rediscovered.
- Route approved LaneTransitionEvent and other operational-history writes through application behavior; expose history as a query result without using it to rebuild current Mission state.
- Complete application query/port contracts and shared projection assembly for Mission, repository, AgentBlock, UI preference, and history data consumed by CLI, TUI, and the planned web board.
- Refactor CLI commands, TUI modules, and shared web-board projection consumers to receive supplied ports/projections from the single production composition root.
- Remove production in-memory repositories and adapter-specific projection shortcuts, retaining fakes only where test-only dependency injection requires them.
- Add fast, dependency-mocked tests for repository path change, preference persistence across restart, event ordering, unavailable history, blocked agents, and database failure; tests must not contact Forgejo or launch agents.

## Out of Scope
- Creating or shipping the web-board UI, routes, or browser integration.
- Changing Mission lifecycle rules, lane-transition policy, RepositoryId semantics, or domain authority boundaries established by ADR 0051 and ADR 0053.
- Migrating unrelated persistence adapters, changing the database engine, or redesigning SQLite schema beyond migrations necessary for the named operator-state repositories.
- Adding real Forgejo, real agent-launcher, or external-service coverage to unit tests.
- Reconstructing current Mission state from operational-history records.

## Success Criteria
> **Falsifiability rule (ADR 0039 Part 2):** Each criterion must be falsifiable. Forbidden: subjective adjectives ("easy, fast, simple, intuitive, user-friendly, responsive, quick, efficient" without an attached metric) and vague quantifiers ("multiple, several, some, many, few, various"). For refactor / condense / migration missions, the criterion must enumerate the specific elements (rules, files, behaviours) that must survive — generic phrases like "preserve critical content" are not sufficient.

- KnownRepository observations are persisted and queried by RepositoryId; a changed path or rediscovery replaces observation metadata without creating another Mission identity.
- Production UI-preference reads and writes use the checked SQLite repository, and a newly composed application instance reads preferences previously persisted by the same database; no production memory or JSON preference authority remains.
- LaneTransitionEvent and each additional approved operational-history record are emitted through application behavior in stored order; a history repository/query failure is represented to callers without deriving current Mission state from those records.
- The shared application projection/query contracts provide Mission, repository, AgentBlock, preference, and history data, and CLI, TUI, and web-board projection consumers use those contracts rather than separate adapter-specific assemblies.
- The production CLI/TUI composition path initializes persistence and supplies all ports from one composition root; no presentation or command module opens SQLite, runs migrations, issues SQL, or reads durable persistence files.
- Production in-memory operator-state repositories and adapter-specific projection shortcuts are removed or test-confined, with every remaining test fake instantiated through test-only wiring.
- Focused mocked tests cover: repository path replacement, preference restart persistence, ordered event history, unavailable history, blocked-agent projection, and database failure; the test code neither contacts Forgejo nor launches an agent.
- `./scripts/verify-local.sh all` completes successfully on the completed mission tree.

## Risks and Assumptions
- Assumption: TASK-2322.07 and TASK-2322.10 provide stable domain types, ports, and persistence seams; if either contract is absent or incompatible, stop for an explicit dependency decision rather than duplicating it.
- Risk: moving composition responsibilities can leave a hidden CLI or TUI direct-persistence path. Mitigate by inventorying every production entry and presentation constructor before deleting shortcuts.
- Risk: legacy persisted data may not satisfy new observation or preference invariants. Restrict migrations to backwards-compatible defaults and verify existing database opening behavior.
- Risk: history availability and database failures can be confused with an empty history. Preserve an explicit unavailable/error result through the application query and cover it with mocks.
- Risk: broad production wiring can make tests invoke expensive external integrations. Mock database and launcher/Forgejo ports at unit-test boundaries and retain only fast local fixtures.

## Checkpoints
- CP 1: Inventory current operator-state authorities and define the completed application-port/shared-projection contract. Map the production CLI, TUI, and web-board projection entry points; identify each direct SQLite, migration, SQL, durable-file, in-memory repository, and adapter-specific projection path targeted for replacement or test confinement.
- CP 2: Complete SQLite repositories and application behavior for KnownRepository observations, UI preferences, AgentBlock state, and approved operational history. Add mocked tests for path replacement, preference restart, ordered events, unavailable history, blocked agents, and database failures before connecting presentation consumers.
- CP 3: Wire the repositories and shared query/projection contracts through one production composition root. Convert CLI, TUI, and web-board projection consumers to injected ports, remove production fallback authorities/shortcuts, and run the repository verification gate.

### Checkpoint Documentation Requirements
Each CP-N.md must summarize the completed checkpoint, then include the exact heading `## Goal Check` followed by this exact 3-column table shape:

| Criterion | Evidence | Status |
|---|---|---|

Include one row for every Success Criterion, with a PASS, FAIL, or PARTIAL status and evidence that can be verified. Accepted evidence forms are file:line references, exact test names, ADR references, existing test file paths, and recognized repository commands or paths such as `npm ...`, `node ...`, `git ...`, `px ...`, or `./...`. Cite ADR 0051 or ADR 0053 where an authority-boundary decision is relevant; cite the specific persistence, composition-root, projection, or test file lines for implementation claims. Raw `stat`/`ls` output or generic prose alone is not enough: pair any shell output with at least one accepted reference above. End each checkpoint document with a concrete `Next action:` naming the next repository, port, consumer, test, or verification command to address.

## Gates
- [ ] ./scripts/verify-local.sh all

## Restricted Areas
- Do not modify the lifecycle or authority rules defined by `docs/adr/0051-domain-model-and-runtime-dependency-boundaries.md` or `docs/adr/0053-operational-persistence-and-authority-boundaries.md` without a separately approved ADR.
- Do not let `src/entry/px.ts`, CLI command modules, `src/interfaces/tui`, or shared web-board projection consumers initialize SQLite, run migrations, execute SQL, inspect persistence files, or select a repository implementation outside the single production composition root.
- Do not use operational history as a source from which to reconstruct current Mission state.
- Do not introduce tests that invoke real Forgejo, real agents, or performance-heavy CLI workflows; mock those dependencies.

## Stop Rules
- Stop and request direction if TASK-2322.07 or TASK-2322.10 lacks the required stable port/domain contract, or completing it would require redefining the ADR 0051/0053 authority boundaries.
- Stop and request a migration decision if existing persisted data cannot be opened with backwards-compatible defaults for the named operator-state repositories.
- Stop and request product direction if the planned web-board requires data or commands beyond the shared Mission, repository, AgentBlock, preference, and history projection contracts.
- Stop and investigate before handoff if any CLI, TUI, or web-board projection path still directly accesses persistence, or if the required mocked test suite triggers a real Forgejo or agent launch.
