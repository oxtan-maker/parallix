# Mission: Codify the intended dependency graph (task-2332.01)

## Goal
Replace the current infrastructure-name import blacklist with an executable, layer-based dependency graph implementing ADR 0051's six intended layers. The guard must reject every non-allowlisted forbidden import edge while allowing the declared graph directions.

## Why Now
The intended architecture is already documented, but the current boundary enforcement is limited to name-based checks and cannot express all six layer relationships. Installing a graph guard now prevents new dependency violations while legacy violations are separately tracked for removal.

## Refinement Signals
- Predicted NEL bucket: Medium (81–235)
- Confidence: High
- Selection note: Ready to execute; the graph edges, legacy-transition mechanism, and verification target are explicitly defined in the backlog task.
- Main drivers: define six layer rules, discover the existing violating edges, record each legacy exception with ownership, and add test coverage for both permitted and newly forbidden edges.

## Scope
- Define import-layer classification and the exact permitted dependency graph: `domain → domain`; `application → domain, application`; `adapters → domain, application, adapters (local)`; `interfaces → domain, application, interfaces (local)`; `composition → all implementation layers`; `entry → composition and interface entrypoints`.
- Replace infrastructure-name blacklist enforcement with graph-based validation.
- Scan the six layers (`domain`, `application`, `adapters`, `interfaces`, `composition`, and `entry`) and add a temporary explicit allowlist for every current violating edge.
- Require every allowlist entry to name its owner task ID and removal mission.
- Add dependency-graph tests covering every layer and proving an unallowlisted violating edge fails.

## Out of Scope
- Moving, refactoring, or otherwise cleaning up production code solely to eliminate legacy violations.
- Redesigning ADR 0051 or adding layers beyond the six specified by the backlog task.
- Changing composition-root behavior beyond wiring the dependency guard where necessary.
- Removing temporary allowlist entries as part of this mission.
- Changing unrelated import-boundary tests or their assertions.

## Success Criteria
- SC1: The boundary enforcement uses layer classification plus allowed graph edges, rather than an infrastructure-name blacklist, to evaluate imports in all six layers.
- SC2: The enforced graph contains exactly these directions: `domain → domain`; `application → domain, application`; `adapters → domain, application, adapters (local)`; `interfaces → domain, application, interfaces (local)`; `composition → domain, application, adapters, interfaces, composition`; `entry → composition and interface entrypoints`.
- SC3: The validator evaluates imports in the `domain`, `application`, `adapters`, `interfaces`, `composition`, and `entry` layer roots and reports an edge when its source-to-target layer direction is not permitted.
- SC4: A temporary explicit allowlist records every pre-existing reported violation at guard-installation time; each record includes a concrete owner task ID and a concrete removal mission identifier.
- SC5: Dependency-graph test coverage contains a named test for each of the six layers that confirms no violation outside the allowlist is accepted.
- SC6: A named dependency-graph test demonstrates that one forbidden, unallowlisted edge fails validation immediately.
- SC7: The existing application-boundary assertions remain unchanged and continue to pass alongside the new graph tests.
- SC8: `./scripts/verify-local.sh static-analysis` and `./scripts/verify-local.sh all` complete successfully on the final tree.

## Risks and Assumptions
- Assumption: ADR 0051 and the backlog task's six-layer graph are the authoritative dependency policy; a conflict between them requires mission-owner direction.
- Assumption: the import analysis can resolve the repository's local static imports; unsupported dynamic or generated imports must be documented as a bounded limitation rather than silently treated as allowed.
- Risk: applying the graph may reveal a larger legacy set than expected. The allowlist is a transition device only, with owner and removal mission on every edge.
- Risk: a requirement to move production code would expand this mission into cleanup work, which is explicitly excluded.

## Checkpoints
- CP1 — Map the six layer roots and implement the graph-based classifier and validator. Record the exact graph directions in code and remove the infrastructure-name blacklist as the enforcement mechanism.
- CP2 — Run the validator against all six layer roots. Create the temporary allowlist from the observed legacy violations, with a task ID and removal mission on every entry; do not fix or move the violating production code.
- CP3 — Add dependency-graph tests: one named test for each layer, an explicit unallowlisted-forbidden-edge failure case, and coverage that the allowlist is honored. Confirm the existing application-boundary assertions are unchanged.
- CP4 — Run both verification commands. Write the final checkpoint’s goal-check evidence using the required references and identify any remaining legacy exceptions by their allowlist records.

### Checkpoint Documentation Requirements
Every checkpoint document (`CP-N.md`) must include a concrete work summary, then use the exact heading `## Goal Check` followed by this exact three-column table header:

| Criterion | Evidence | Status |
|---|---|---|

Include one row for each applicable success criterion. Accepted evidence forms that Parallix already verifies are existing file:line references, exact test names, ADR references, test file paths, and recognized repository commands or paths such as `npm ...`, `node ...`, `git ...`, `px ...`, or `./...`. Use references such as `test/dependency-graph.test.ts`, an exact test name from that file, `ADR 0051`, a real `path/to/file.ts:42`, or `./scripts/verify-local.sh all`.

Raw `stat`/`ls` output or generic prose alone is not adequate evidence: this is a weak-agent failure mode. If shell output is useful, pair it with at least one accepted file:line reference, exact test name, ADR reference, test file path, or recognized command/path. End each checkpoint with a concrete `Next action:` that names the next file, validation step, or decision.

## Gates
- [ ] ./scripts/verify-local.sh static-analysis
- [ ] ./scripts/verify-local.sh all

## Restricted Areas
- The ADR 0051 document is policy input and must not be rewritten by this mission.
- Existing production modules must not be moved or refactored to resolve allowlisted legacy edges.
- Existing application-boundary test assertions must remain unchanged; graph coverage is additive.
- Composition-root runtime behavior must not be altered except for the minimum guard integration required by scope.
- Other backlog tasks and mission contracts are not part of this mission.

## Stop Rules
- Stop and request direction if ADR 0051 and the backlog task specify incompatible layer edges.
- Stop and request a scope decision if enforcing the graph requires moving or refactoring production modules rather than recording an existing violation in the temporary allowlist.
- Stop and request a policy decision if an import cannot be assigned to one of the six layer roots or resolved by the repository’s import-analysis approach.
- Stop and report the failing file and exact verifier output if either required gate still fails after three targeted attempts on changes made by this mission.
