# Mission: Post-2322 cleanup — Ports and adapters architecture (task-2332)

## Goal
Complete and certify the ordered post-2322 cleanup sequence so the production dependency graph conforms to the ports-and-adapters boundaries established by ADR 0051 and ADR 0053, with one composition boundary, capability-owned application ports, one inbound command-dispatch path, and no migration scaffold.

## Why Now
TASK-2322.12 certifies the ADR 0053 cutover; the remaining transition code and boundary exceptions would otherwise become permanent architecture. The six child missions share the same dependency seams, so they must be integrated in their prescribed order to avoid reintroducing legacy ownership or composition imports.

## Refinement Signals
- Predicted NEL bucket: Small (0–80) / Medium (81–235) / Large (235+)
- Confidence: High
- Selection note: activate as-is
- Main drivers: sequential removal of post-cutover migration seams; executable enforcement of ADR 0051 boundaries; consolidation of composition, contracts, mission execution, and command dispatch.

## Scope
- Integrate TASK-2332.01 through TASK-2332.06 in this exact order: dependency-graph validation, production composition boundary, application-port ownership, active-mission execution ownership, inbound command dispatch, then migration-scaffold removal and certification.
- Require each child mission to retain behavior outside its stated acceptance criteria and to add characterization coverage before deleting legacy behavior.
- Certify the final dependency graph against ADR 0051 and ADR 0053, including removal of temporary exceptions and compatibility façades introduced by the 2322 migration.
- Update architecture documentation only where the completed graph changes the durable supported boundary or rationale.

## Out of Scope
- Changing user-visible CLI or TUI behavior except where a child mission’s accepted dispatch consolidation requires it.
- New product capabilities, new command families, or persistence-model changes unrelated to eliminating the 2322 migration seams.
- Parallel implementation of the six children, reordering them, or merging an unfinished child into the sequence.
- Replacing the ADR 0051 or ADR 0053 architectural decisions rather than implementing and certifying them.

## Success Criteria
> **Falsifiability rule (ADR 0039 Part 2):** Each criterion must be falsifiable. Forbidden: subjective adjectives ("easy, fast, simple, intuitive, user-friendly, responsive, quick, efficient" without an attached metric) and vague quantifiers ("multiple, several, some, many, few, various"). For refactor / condense / migration missions, the criterion must enumerate the specific elements (rules, files, behaviours) that must survive — generic phrases like "preserve critical content" are not sufficient.

- All six child missions, TASK-2332.01, TASK-2332.02, TASK-2332.03, TASK-2332.04, TASK-2332.05, and TASK-2332.06, are integrated in that order after TASK-2322.12.
- TASK-2332.01 provides executable import-boundary validation for the ADR 0051 graph, with every temporary allowlist entry named and justified.
- TASK-2332.02 establishes exactly one production composition root and the validated graph contains no adapter-to-composition import.
- TASK-2332.03 places application ports in capability-organized owning-layer modules, with callers updated to use those ports rather than transitional contract locations.
- TASK-2332.04 replaces `LegacyActiveAdapter` for active mission execution with the application-layer `ExecuteMission` use case while characterization tests demonstrate equivalent execution behavior.
- TASK-2332.05 routes CLI and TUI inbound commands through one canonical command-dispatch path.
- TASK-2332.06 removes migration scaffolding, deferred migration TODOs, compatibility façades, and dependency-graph exceptions; architecture documentation and the executable graph agree.
- `./scripts/verify-local.sh static-analysis` and `./scripts/verify-local.sh all` pass on the final integrated tree.

## Risks and Assumptions
- Shared seams make child missions order-sensitive; integrating a later child first can recreate a temporary façade that an earlier child was intended to remove.
- Import validation can initially expose legitimate composition wiring that must be represented by a narrowly justified rule, not by broadening layer permissions.
- Deleting legacy mission-execution code without characterization coverage can alter lifecycle, persistence, or command-handling behavior.
- Assumption: TASK-2322.12 has completed its ADR 0053 cutover certification before this mission begins.
- Assumption: ADR 0051 and ADR 0053 remain the authoritative architecture decisions throughout the sequence.

## Checkpoints
- CP 1: Complete TASK-2332.01. Add the ADR 0051 import-boundary validation and document every allowlist entry, including the owning dependency direction and removal condition.
- CP 2: Complete TASK-2332.02. Establish the single production composition root and demonstrate that adapters do not import composition.
- CP 3: Complete TASK-2332.03. Relocate application ports to capability-owned modules and preserve the callers’ contract behavior through focused tests.
- CP 4: Complete TASK-2332.04. Introduce `ExecuteMission` as the active-mission use case, retain characterization evidence, and remove `LegacyActiveAdapter` only after that evidence is green.
- CP 5: Complete TASK-2332.05. Consolidate CLI and TUI entry paths onto the canonical command dispatcher and prove both surfaces reach it.
- CP 6: Complete TASK-2332.06. Remove remaining transition scaffolding and exceptions, align durable architecture documentation, then run final certification gates.

### Checkpoint Documentation Requirements
Every checkpoint document (CP-N.md) MUST include a summary of work done, then the exact heading `## Goal Check` followed by this exact 3-column table header: `| Criterion | Evidence | Status |`.

For every success criterion, record at least one durable, verifiable evidence reference. Lead with exact test names, ADR references (`ADR 0051` or `ADR 0053` where applicable), existing or added test file paths, and recognized repository commands or paths such as `npm test -- <test-file>`, `node <script>`, `git <command>`, `px <command>`, or `./scripts/verify-local.sh static-analysis`. File:line references are accepted parenthetically when necessary but discouraged because line numbers rot.

For CP 1, evidence must identify the import-boundary test name and path plus its allowlist assertions. For CP 2, it must identify the composition-boundary test or validation assertion. For CP 3 through CP 5, it must name the focused characterization or dispatch tests that preserve the migrated behavior. For CP 6, it must cite the zero-exception validation and the final recognized verification commands. Raw `stat`/`ls` output or generic prose alone is not enough; if included, pair it with one of the accepted references above. End each checkpoint with a specific `Next action:` that names the next child mission or the final certification action.

Example Goal Check table:

| Criterion | Evidence | Status |
|---|---|---|
| TASK-2332.01 import boundaries are enforced | exact validation test name, its `test/` path, and `ADR 0051` | PASS/FAIL |
| Final graph has no migration exception | exact zero-exception assertion and `ADR 0053` | PASS/FAIL |
| Final certification ran | `./scripts/verify-local.sh all` | PASS/FAIL |

## Gates
- [ ] ./scripts/verify-local.sh static-analysis
- [ ] ./scripts/verify-local.sh all

## Restricted Areas
- Do not modify production behavior outside the acceptance criteria of the active child mission.
- Do not remove legacy mission-execution or dispatch code before its named characterization coverage is present and passing.
- Do not add broad import-boundary exemptions; each exception must be explicit, narrowly scoped, and scheduled for removal by TASK-2332.06.
- Do not push this mission branch to `origin`; mission-branch review uses the `review` remote only.

## Stop Rules
- Stop before starting a child if its predecessor has not integrated cleanly or its checkpoint lacks a complete `## Goal Check` table with durable evidence.
- Stop and resolve with the architecture owner if satisfying a child requires changing the dependency direction specified by ADR 0051 or the authority boundary specified by ADR 0053.
- Stop before deleting a legacy adapter, façade, or scaffold if the corresponding characterization test fails or cannot demonstrate the preserved behavior.
- Stop final certification if any import-boundary exception, compatibility façade, or deferred migration TODO remains without an approved removal in TASK-2332.06.
