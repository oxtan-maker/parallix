# Mission: Establish one production composition boundary (task-2332.02)

## Goal
Make `src/composition/` the sole production composition boundary: it must construct the board projection graph, the TUI's production application capabilities, and the legacy active lifecycle dependencies. Remove the TASK-2332.02 allowlisted edges that currently place concrete construction in `src/application/` and `src/interfaces/`, or make an adapter resolve the composition root.

## Why Now
TASK-2332.01 now enforces ADR 0051's layer graph and records the existing violations explicitly. The highest-risk TASK-2332.02 entries show three competing roots: `createBoardProjectionBuilder()` constructs concrete backlog adapters in the application layer, `ui-command.ts` opens the production graph and constructs projection collaborators, and `LegacyActiveAdapter` calls `createMissionApplicationServices()`, creating a service-location cycle. Leaving these edges allowlisted permits new production paths to diverge in database lifetime and application-service identity.

## Refinement Signals
- Predicted NEL bucket: Medium (81–235)
- Confidence: High
- Selection note: Ready after TASK-2332.01; the allowlist identifies the production edges this mission must burn down and ADR 0051 defines the allowed dependency direction.
- Main drivers: relocate concrete board-projection wiring, relocate TUI production construction, inject the legacy active lifecycle dependency, establish one operator-database lifecycle, and preserve CLI/TUI behavior with fast mocked characterization coverage.

## Scope
- Create or use `src/composition/` as the one production construction location for the complete board projection graph, including concrete backlog read adapters and the required operator-state ports.
- Change `src/application/projections/create-board-projection-builder.ts` so application code exposes an application-owned builder contract or accepts already-constructed ports; it must not import or instantiate concrete adapters.
- Move the production setup currently in `src/interfaces/tui/ui-command.ts`—operator-state resolution, board projection construction, mission-detail query construction, and active-controller dependency selection—behind a composition-owned entrypoint; retain the TUI as a rendering and input adapter.
- Replace `LegacyActiveAdapter`'s runtime lookup of `createMissionApplicationServices()` with an explicitly supplied mission-lifecycle dependency constructed by composition.
- Define and implement one owner for opening, migrating, sharing, and closing the operator SQLite database for each CLI process, so CLI and TUI consumers receive ports from the same constructed application capability graph.
- Update the TASK-2332.02 entries in `src/platform/runtime/lib/architecture/dependency-graph-allowlist.ts` as each corresponding forbidden edge is removed, while retaining unrelated TASK-2332.03 entries.
- Add or update focused mocked characterization and boundary tests covering the shared composition path, database lifecycle, CLI/TUI capability identity, and prohibited import directions.

## Out of Scope
- SQLite authority cutover, database-schema changes, migration content changes, or changes to the persistence authority defined by ADR 0053.
- Moving the TASK-2332.03 application-to-SQLite-port violations or any allowlist entry owned by another task.
- A general rewrite of CLI command handlers, the full application/domain layering migration, or a web-board implementation.
- Changing CLI text, JSON payload schemas, exit-code behavior, task-transition authority, or the active launch/record/rollback policy except where dependency injection preserves the existing behavior.
- Replacing Ink components, changing TUI interaction design, or adding a second persistent store or UI-owned lifecycle writer.

## Success Criteria
> **Falsifiability rule (ADR 0039 Part 2):** Each criterion must be falsifiable. Forbidden: subjective adjectives ("easy, fast, simple, intuitive, user-friendly, responsive, quick, efficient" without an attached metric) and vague quantifiers ("multiple, several, some, many, few, various"). For refactor / condense / migration missions, the criterion must enumerate the specific elements (rules, files, behaviours) that must survive — generic phrases like "preserve critical content" are not sufficient.

- SC1: Every production `new Concrete*ReadAdapter`, `new ConcreteMetricsReadAdapter`, `new BoardProjectionBuilder`, and `new MissionProjectionQuery` required by board projection is located under `src/composition/`; `src/application/projections/create-board-projection-builder.ts` imports no module beneath `src/adapters/`.
- SC2: `src/interfaces/tui/ui-command.ts` imports no module beneath `src/composition/`, `src/adapters/`, or `src/platform/runtime/`, does not open or migrate SQLite, and receives its production board projection, mission-detail query, and active-command capability through an interface/application contract constructed by composition.
- SC3: `src/platform/runtime/lib/adapters/legacy-active-adapter.ts` does not import or dynamically load `createMissionApplicationServices()`; its lifecycle synchronization uses an injected application-owned mission transition capability supplied by the composition root.
- SC4: One explicitly tested composition-owned operator-database lifecycle opens and applies migrations at most once per CLI process, passes the same database-backed ports to every CLI and TUI consumer that requires them, and closes that database once during process shutdown.
- SC5: The CLI and TUI obtain the same constructed application-capability instances for shared board reads and active lifecycle dispatch; a named mocked test proves identity rather than equivalent-but-separate construction.
- SC6: Dependency-boundary coverage proves that no application module imports a concrete adapter implementation, no adapter imports `src/composition/`, and no interface module opens or migrates SQLite; the TASK-2332.02 allowlist records in `dependency-graph-allowlist.ts` are removed or reduced to only edges still demonstrably outside this mission's stated scope.
- SC7: Characterization tests retain the current board projection data flow, static TUI rendering/headless exit behavior, and active lifecycle launch-before-record, rollback-on-failure, handoff, CLI text, JSON, and exit-code contracts without accessing real Forgejo or launching real agents.
- SC8: `./scripts/verify-local.sh static-analysis` and `./scripts/verify-local.sh all` complete successfully with no focused or unannotated skipped tests introduced by this mission.

## Risks and Assumptions
- Assumption: ADR 0051's dependency direction and TASK-2332.01's allowlist are the governing policy; `src/composition/` may depend outward, while application, adapter, and interface modules may not depend on composition.
- Assumption: the production entrypoint can own a process-lifetime close hook without changing existing CLI exit-code semantics; the implementation must make shutdown ownership observable in a mocked test.
- Risk: the TUI’s current empty-repository rollback behavior may conceal database construction failures. Preserve graceful degradation only when it continues to use composition-provided capabilities and does not create a second open/migration path.
- Risk: `LegacyActiveAdapter` currently bridges old command behavior and the checked mission lifecycle. Injection can expose initialization-order cycles; resolve this by passing a narrow application-owned transition port from composition, not by reintroducing service location.
- Risk: relocating imports can reveal additional boundary violations. Only remove the TASK-2332.02 allowlist entries named in scope; stop for a new policy decision if a required removal belongs to another task.

## Checkpoints
- CP1 — Map every TASK-2332.02 allowlist edge to its current constructor, caller, and test coverage. Define the composition-owned capability interfaces and database-lifetime owner before moving production wiring; record the exact removal target for each in-scope allowlist entry.
- CP2 — Move board projection construction and TUI production capability assembly into `src/composition/`. Change application and TUI modules to consume injected/application-owned contracts, then add boundary tests for the eliminated application-to-adapter and interface-to-composition edges.
- CP3 — Inject the mission-lifecycle transition capability into `LegacyActiveAdapter` from composition. Establish the single operator SQLite open/migrate/share/close lifecycle and add mocked identity and lifecycle tests proving CLI and TUI share the constructed capabilities without real Forgejo, subprocesses, or agents.
- CP4 — Remove the resolved TASK-2332.02 allowlist entries, run characterization and dependency-boundary coverage, execute both required gates, and write the final Goal Check with exact file, test, ADR, and command evidence.

### Checkpoint Documentation Requirements
Every checkpoint document (`CP-N.md`) must include a concrete work summary, then use the exact heading `## Goal Check` followed by this exact three-column table header:

| Criterion | Evidence | Status |
|---|---|---|

Include one row for each applicable success criterion. Parallix already verifies evidence in these forms: existing file:line references, exact test names, ADR references, test file paths, and recognized repository commands or paths such as `npm ...`, `node ...`, `git ...`, `px ...`, or `./...`. Use concrete references such as `src/composition/production-services.ts:42`, an exact test name in `test/adapters/single-path-guardrail.test.ts`, `ADR 0051`, `test/legacy-active-adapter.test.ts`, or `./scripts/verify-local.sh all`.

Raw `stat`/`ls` output or generic prose alone is not enough; this is a weak-agent failure mode. If shell output is useful, pair it with at least one accepted file:line reference, exact test name, ADR reference, test file path, or recognized repository command/path. End each checkpoint with a concrete `Next action:` that names the next file, validation step, or decision.

## Gates
- [ ] ./scripts/verify-local.sh static-analysis
- [ ] ./scripts/verify-local.sh all

## Restricted Areas
- Do not change the persistence authority, SQLite schema, migration files, or ADR 0053 decisions.
- Do not alter ADR 0051, TASK-2332.01's dependency-graph policy, or allowlist entries owned by TASK-2332.03 or another task.
- Do not add a UI-owned state writer, a second database connection lifecycle, direct composition imports from adapters, or concrete adapter imports from application modules.
- Do not change public CLI text, JSON payloads, exit codes, active lifecycle policy, or TUI interaction behavior except for dependency delivery that preserves those contracts.
- Unit tests must mock filesystem, Git, Forgejo, subprocess, and agent dependencies; they must not contact real Forgejo or start real agents.

## Stop Rules
- Stop and request direction if satisfying SC1–SC5 requires a SQLite authority cutover, schema migration, or a second persistent writer.
- Stop and request an architecture decision if the only way to inject the legacy active lifecycle capability is for an adapter, application module, or interface module to import `src/composition/`.
- Stop and request scope direction if a required boundary removal is owned by TASK-2332.03 or an allowlist task other than TASK-2332.02.
- Stop and report the exact file, test name, and verifier output if a characterization contract changes or either required gate still fails after three targeted attempts on this mission’s changes.
