# Mission: Establish UI-neutral application architecture and ADR 0051 (task-2278)

## Goal
Research, decide, and integrate ADR 0051 for a UI-neutral Parallix application boundary. Produce implementation-ready, bounded follow-up missions for the selected read and lifecycle slices, but do not extract application code in this mission. The follow-up work may begin only after this ADR has been integrated and a human has approved the decision and implementation breakdown.

## Why Now
ADR 0044 establishes a headless CLI, Ink TUI, and eventual local web board, but the current workflow code still exposes interface and infrastructure concerns directly to command handlers. The linked board design supplies useful operator intent, yet adopting its component state model would create a second workflow authority. Establishing the boundary now limits future TUI/web work to adapters and prevents UI interactions from bypassing lifecycle rules or task Markdown records.

## Architecture Research and Decision Protocol
This is an architecture mission in an agent-driven codebase with demonstrated false-positive completion risks. The implementation must not turn generic "clean architecture", CQRS, ports-and-adapters, event-stream, or web-board patterns into product policy by assertion. Before ADR 0051 is written or application code is extracted, perform and capture a repository-specific decision record that answers which smallest boundary solves the observed problems without duplicating workflow authority or weakening existing controls.

The research must inspect the current selected CLI read and lifecycle paths, their callers, persistence writes, output modes, error/cancellation behavior, and tests. It must also use the following evidence already produced by this repository:

- ADR 0044, especially its accepted three-client boundary, headless/UI isolation, composition-root, repository-versus-operator authority, and L2 rollback requirements.
- ADR 0048 and completed task-1384: 23 checks across five lifecycle phases and eight failure classes show why agent prose, unchecked completion, and implicit policy are insufficient evidence.
- `test/e2e-real-agent-smoke.test.js`, `test/e2e-mission-lifecycle.test.js`, and completed tasks 2205, 2236, and 2269: real-agent runs have exposed runner/configuration failures, phantom drafts, zero-tool-call claims, environment/resource failures, long/expensive execution, and workstation-dependent tests. These are design constraints, not merely test implementation details.
- The feasibility evidence from TASK-2277, plus the current source layout and focused tests for the two candidate slices.

The research output in ADR 0051 must distinguish observations from inferences, cite exact paths/test names or measured command output, and compare at least these alternatives:

1. Keep command handlers as the shared API and add UI-specific adapters around them.
2. Extract only the two bounded use cases behind application-owned contracts and declared effect ports, retaining current task/Git authority.
3. Make a UI/store/event model the workflow authority.
4. Rewrite a command family or introduce a generalized framework before proving a representative slice.

For each alternative, assess authority ownership, dependency direction, compatibility risk for text/JSON/exit codes, deterministic testability, cancellation/progress/error semantics, rollback, scope/NEL, and its resistance to the observed agent-driven failure modes. ADR 0051 must select or reject the alternatives based on that evidence. If the evidence contradicts the currently proposed seam, stop for an architecture decision rather than implementing a fashionable abstraction.

## Refinement Signals
- Predicted NEL bucket: Medium (81–235)
- Confidence: High
- Selection note: ADR-first architecture decision and post-ADR implementation planning; TASK-2277 supplies feasibility evidence for the decision.
- Main drivers: ADR 0051 authoring and index entry; repository-specific architecture research; explicit command/query/projection/progress/error/cancellation/capability contracts; and bounded, human-approved follow-up planning for one read and one lifecycle slice.

## Scope
- Author `docs/adr/0051-*.md` and add its exact entry to `docs/adr/index.md`; define dependency direction among domain, application, ports, adapters, CLI, Ink TUI, and web transport.
- Use the repository ADR format rather than a lightweight design note: `# ADR 0051` title, `Status`, `Date`, `Related`, then `Context`, `Inputs`/research evidence, `Options Evaluated`, `Decision`, concrete contracts and dependency direction, `Consequences` (positive and negative), implementation/verification and rollback conditions, and `See Also`. Keep the decision, trade-offs, and evidence in the ADR; do not hide them only in mission checkpoints or implementation comments.
- Record a shared command request/result contract, read-projection contract, progress/event contract, error contract, cancellation contract, and capability/authorization contract.
- Record the board's intended operator concerns: repository identity; attention queue; backlog, refined, active, review, integrate, and shipped views; agent availability; WIP and cycle-flow signals; guarded lifecycle actions; and command/event log.
- Create one or more `backlog/tasks/` follow-up missions covering all implementation previously planned after CP 2: application contracts/ports and composition wiring; CLI delegation for one selected read and lifecycle slice; behavior-equivalence, mocked-port unit, and import-boundary tests; and final verification. Each follow-up mission must name exact candidate files and tests from the research, a NEL estimate, dependencies on TASK-2278, and the human-approval prerequisite below.
- Record in every generated follow-up mission that it is blocked until (1) TASK-2278/ADR 0051 is integrated and (2) a human explicitly approves the ADR decision and the proposed implementation breakdown. Do not treat an automated review verdict, an agent assertion, or a passing documentation gate as that approval.

## Out of Scope
- Implementing an Ink TUI, local web board, HTTP server/transport, React components, or board styling.
- Introducing SQLite as workflow authority or migrating canonical task records away from `backlog/tasks/`, `backlog/completed/`, `backlog/archive/`, or Git-owned mission state.
- Changing `backlog.md` semantics, which remain optional, or changing persisted task/mission data formats.
- Extracting application interfaces, ports, adapters, composition-root wiring, or CLI delegation. Those are post-ADR follow-up work.
- Adding or modifying behavior-equivalence, mocked-port, or import-boundary tests except where a documentation-only test is necessary to validate the ADR/task artifacts.
- Altering supported CLI text, JSON schemas, exit-code behavior, lifecycle validation rules, authorization policy, or persisted state.

## Success Criteria
> **Falsifiability rule (ADR 0039 Part 2):** Each criterion must be falsifiable. Forbidden: subjective adjectives ("easy, fast, simple, intuitive, user-friendly, responsive, quick, efficient" without an attached metric) and vague quantifiers ("multiple, several, some, many, few, various"). For refactor / condense / migration missions, the criterion must enumerate the specific elements (rules, files, behaviours) that must survive — generic phrases like "preserve critical content" are not sufficient.

- ADR 0051 exists under `docs/adr/`, is indexed in `docs/adr/index.md`, and specifies dependency direction for domain, application commands/queries, ports, adapters, CLI, Ink TUI, and web transport.
- ADR 0051 follows the established ADR format and records repository-specific research before its decision: it cites ADRs 0044 and 0048, TASK-2277, completed tasks 1384/2205/2236/2269, the real-agent and deterministic lifecycle E2E suites, the selected current code paths, and an evidence-backed comparison of the four listed architecture alternatives.
- ADR 0051 specifies one interface-neutral command request/result contract, one read projection contract, one progress/event contract, one error contract, one cancellation contract, and one capability/authorization contract available to all three interface types.
- ADR 0051 documents repository identity, attention queue, backlog/refined/active/review/integrate/shipped views, agent availability, WIP and cycle-flow signals, guarded lifecycle actions, and command/event log as board intent; it rejects direct UI workflow-state mutation and requires UI interactions to request application commands.
- ADR 0051 states that task Markdown in `backlog/tasks/`, `backlog/completed/`, and `backlog/archive/` plus Git-owned mission state remain canonical, and that a separate authority ADR is required before a web board can replace those records.
- One or more new backlog missions partition the selected post-ADR implementation without overlap. Together they cover application contracts/ports, composition wiring, one read and one lifecycle-command delegation, behavior equivalence, mocked dependencies, import boundaries, required gates, and rollback.
- Every follow-up mission names its exact candidate files/tests and NEL estimate, depends on TASK-2278, and states that a human must approve the integrated ADR and implementation breakdown before it may enter `px draft` or `px active`.
- `./scripts/verify-local.sh all` completes successfully on the ADR/planning tree.

## Risks and Assumptions
- Risk: existing CLI handlers may combine parsing, rendering, lifecycle policy, and effects, making an apparently small implementation slice exceed the Medium NEL estimate. Assumption: select the narrowest representative read and mutation paths after inventory, and split or rescope the follow-up missions if either needs unrelated command migration.
- Risk: output-equivalence tests may omit a supported mode. Assumption: capture the selected command's current text, JSON, and nonzero-exit scenarios before rewiring and preserve those exact assertions.
- Risk: the board artifact could be treated as an implementation blueprint. Assumption: ADR 0051 may use it only for operator-facing intent; application contracts remain repository-owned and UI-neutral.
- Risk: a new boundary can accidentally relocate infrastructure imports without isolating effects. Assumption: ports name required capabilities and import-boundary tests scan domain/application modules; concrete filesystem, Git, Forgejo, subprocess, and rendering access remains in adapters.
- Risk: task-file authority may be implicitly changed by projections or actions. Assumption: projections are read models and lifecycle commands retain the current task Markdown/Git persistence path; no new authority store is introduced.

## Checkpoints
- CP 1: Research before design. Inventory the selected read and lifecycle-command paths, their CLI handlers, output modes, lifecycle validation, persistence writes, error/cancellation behavior, and effectful dependencies. Review the listed ADR, task, and E2E evidence; record observations separately from inferences and compare the four architecture alternatives against authority, compatibility, deterministic testing, fail-closed behavior, rollback, and NEL.
- CP 2: Author and index ADR 0051 from that research. Use the established ADR section structure; define the selected/rejected alternatives, six shared contracts, allowed dependency direction, board intent, UI-command-only mutation rule, continued Markdown/Git authority, named vertical slices, declared ports, verification, and rollback.
- CP 3: Create and cross-link the post-ADR implementation mission(s). Split the former code extraction, delegation, test, verification, and rollback work into review-sized scopes based on the ADR's selected slices. Each must depend on TASK-2278 and carry the explicit human-approval prerequisite. Do not begin implementation work.
- CP 4: Verify the ADR/planning tree with `./scripts/verify-local.sh all`, document evidence for every success criterion, and confirm that the mission contains no production-code, application-seam, CLI-wiring, or test-behavior changes.

### Checkpoint Documentation Requirements
Every checkpoint document (CP-N.md) MUST include:
- A concise summary of the completed checkpoint work.
- The exact heading `## Goal Check`.
- The exact 3-column pipe-delimited table header `| Criterion | Evidence | Status |`, with at least one row for every Success Criterion.
- Verifiable evidence in each row using one or more accepted forms Parallix verifies today: an existing file:line reference; an exact repository test name; an existing test file path; an ADR reference such as `ADR 0051`; or a recognized repository command/path such as backticked `npm ...`, `node ...`, `git ...`, `px ...`, or `./...`.
- For the selected CLI slices, cite the exact test name and test file path that cover text, JSON, and exit-code behavior. For the boundary rule, cite the import-boundary test name/path. For architecture decisions, cite the ADR and concrete file:line references.
- Raw `stat`/`ls` output or generic prose alone is not enough: when shell output is included, pair it with an accepted file:line reference, exact test name, ADR reference, test file path, or recognized repository command/path.
- A concrete `Next action:` line at the bottom, naming the next file, command, or verification action.

Example Goal Check table:

| Criterion | Evidence | Status |
|---|---|---|
| Draft prompt defines checkpoint evidence rules | `prompts/draft.md:28` | PASS |
| Repair loop has targeted incomplete-evidence coverage | `test/repair-handoff.test.js`, `"buildRelaunchPrompt returns string containing Goal Check table and mission slug"` | PASS |
| Verification gate ran | `./scripts/verify-local.sh docs` | PASS |

## Gates
- [ ] ./scripts/verify-local.sh all

## Restricted Areas
- Do not modify existing canonical task records or Git-owned mission state formats; CP 3 may create only the new, explicitly required follow-up records under `backlog/tasks/`.
- Do not introduce a web transport/server, Ink screen, React dependency, SQLite authority, direct UI-state mutation, or styling system.
- Do not change CLI public behavior, including text output, JSON output, exit codes, lifecycle validation, or authorization checks.
- Do not create domain/application modules, ports, adapters, or composition-root wiring in this mission.
- Do not change test behavior or add tests that access real Forgejo, launch agents, contact remotes, or perform expensive external CLI work.

## Stop Rules
- Stop and request a scope decision if TASK-2277 is not complete enough to interpret the feasibility evidence, or if current code cannot identify canonical task authority and safe representative lifecycle slices.
- Stop and request an architecture decision if repository research does not support the proposed two-use-case application seam, if no alternative can preserve the current authority and CLI contract, or if the proposed decision rests on generic framework guidance rather than the cited repository and E2E evidence.
- Stop and create a separate decision or implementation mission if the ADR needs a web/TUI interface, HTTP transport, SQLite authority, a canonical-record migration, a lifecycle/authorization-policy change, or a code/test spike to resolve an unknown.
- Stop before handoff if the implementation cannot be partitioned into follow-up missions with exact candidate files/tests, bounded NEL, dependencies, rollback, and the human-approval prerequisite.
