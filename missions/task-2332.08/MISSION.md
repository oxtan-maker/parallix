# Mission: Make architecture guards prove responsibility ownership (task-2332.08)

## Goal
Replace the directory-based architecture allowlist with executable responsibility-ownership guards that classify every production module, enforce the ownership boundaries between application, interfaces, composition, entry, domain, and adapter code, and emit actionable failures when a module violates its assigned responsibility.

## Why Now
TASK-2332.15 re-homes command workflow ownership so the canonical production tree can satisfy strict responsibility rules without preserving prior placement as an exception. The current coarse adapter-to-adapter allowance can accept a relabeled monolith or copied command orchestration merely because of its path; this mission turns the intended ownership model into regression-resistant proof.

## Refinement Signals
- Predicted NEL bucket: Medium (81–235)
- Confidence: High
- Selection note: Activate after TASK-2332.15 is complete and its command-ownership tree is present in the worktree.
- Main drivers: production-module responsibility classifier, named cross-adapter dependency rules and application-owned ports, guard diagnostics, biting fixtures and mutation coverage, architecture documentation.

## Scope
- Replace the coarse layer allowlist in `src/adapters/architecture/boundary-guards.ts` with responsibility classifications covering every production module under `src/`.
- Define and enforce ownership rules for application, interfaces, composition, entry, domain, and adapter responsibilities.
- Replace the blanket adapter-to-adapter permission with explicit named package-level dependency rules or application-owned ports.
- Add guard fixtures and mutation tests in the architecture-guard coverage rooted at `test/dependency-graph.test.ts` for prohibited direct imports, hidden service-location, adapter-owned multi-integration workflow sequencing, and an unclassified production module.
- Make diagnostics state the offending file, failed responsibility rule, and expected owner.
- Update architecture documentation to describe the layer DAG, responsibility rules, and fixtures that prove the guards bite.
- Keep the architecture guard fast and hermetic within the static-analysis workflow.

## Out of Scope
- Re-homing commands or changing command workflow ownership beyond the completed dependency TASK-2332.15.
- Changing product-facing CLI behavior, integration behavior, or domain business rules.
- Adding production exceptions, grandfather lists, or path-only bypasses for existing architectural debt.
- Broad restructuring unrelated to responsibility ownership, including a general rewrite of adapter implementations.

## Success Criteria
> **Falsifiability rule (ADR 0039 Part 2):** Each criterion must be falsifiable. Forbidden: subjective adjectives ("easy, fast, simple, intuitive, user-friendly, responsive, quick, efficient" without an attached metric) and vague quantifiers ("multiple, several, some, many, few, various"). For refactor / condense / migration missions, the criterion must enumerate the specific elements (rules, files, behaviours) that must survive — generic phrases like "preserve critical content" are not sufficient.

- SC1: The architecture scan classifies every production module under `src/` as application, interfaces, composition, entry, domain, or adapter, and the guard fails with the module path and expected owner when any production module has no classification.
- SC2: The guard rejects cross-adapter imports unless the dependency matches a named package-level rule or an application-owned port; no blanket adapters-to-adapters permission remains in the guard configuration.
- SC3: A fixture that places multi-integration command workflow sequencing beneath an arbitrary `src/adapters/` path fails without adding or changing guard configuration, and the failure identifies that adapter code is not the expected owner.
- SC4: Mutation coverage proves the architecture gate fails for each of: a prohibited direct import, hidden service-location, adapter-owned workflow sequencing, and a new unclassified production module.
- SC5: The complete canonical production tree passes the responsibility-ownership guard with zero allowlist exceptions, while application, interfaces, composition, entry, domain, and adapter ownership rules are each exercised by a passing or failing test case.
- SC6: Guard diagnostics for every added negative fixture name the offending file, the responsibility rule that failed, and the expected owner.
- SC7: `src/adapters/README.md` (or its canonical architecture documentation replacement) documents the layer DAG, the six responsibility categories, cross-adapter dependency constraints, and the named fixtures that demonstrate failure behavior.
- SC8: `./scripts/verify-local.sh all` passes after the guard, its fast hermetic tests, and documentation changes are complete.

## Risks and Assumptions
- Assumption: TASK-2332.15 has completed before implementation starts; if command workflows remain under adapters, strict enforcement will conflate prerequisite debt with this mission's changes.
- Risk: Static heuristics may incorrectly classify boundary modules that have legitimate composition or entry responsibilities; mitigate with explicit responsibility definitions and focused fixture coverage, not allowlist exceptions.
- Risk: Replacing blanket adapter access can expose legitimate integration contracts; mitigate by expressing each allowed relationship as a named package-level rule or an application-owned port.
- Risk: Architecture tests can become slow or invoke real integrations; all guard tests must operate on local fixture trees and mocked dependencies only.
- Assumption: Existing architecture documentation and ADR 0039 remain the source of truth for vocabulary and falsifiability expectations.

## Checkpoints
- CP 1: Inspect the post-TASK-2332.15 production tree, `src/adapters/architecture/boundary-guards.ts`, and `test/dependency-graph.test.ts`; record the complete responsibility classification model, the current blanket adapter dependency behavior, and the concrete named dependency/port rules required for the canonical tree.
- CP 2: Implement the responsibility classifier and ownership/dependency checks in the architecture guard, removing the blanket adapter-to-adapter permission; add actionable diagnostics and prove every production module is classified without an exception list.
- CP 3: Add hermetic fixtures and mutation tests through `test/dependency-graph.test.ts` for prohibited direct imports, hidden service-location, arbitrary-path adapter workflow sequencing, and unclassified production modules; confirm each mutation fails for its intended rule.
- CP 4: Update architecture documentation with the layer DAG, ownership model, cross-adapter constraints, and biting-fixture evidence; run the required verification gate and complete the final Goal Check.

### Checkpoint Documentation Requirements
Every checkpoint document (`CP-N.md`) MUST include:
- A summary of work done and a concrete `Next action:` line that identifies the next classifier, rule, fixture, documentation update, or verification action.
- The exact heading `## Goal Check`.
- The exact 3-column pipe-delimited table header `| Criterion | Evidence | Status |` and at least one row for every Success Criterion.
- Evidence that Parallix already verifies: existing file:line references; exact test names; ADR references; existing test file paths; and recognized repository commands or paths such as backticked `npm ...`, `node ...`, `git ...`, `px ...`, or `./...`.
- For this mission, cite the responsibility guard implementation and configuration by file:line, exact negative-fixture test names and test file paths, `ADR 0039` where applicable, and the executed `./scripts/verify-local.sh all` command.
- Raw `stat`/`ls` output or generic prose alone is insufficient evidence. Shell output may be supplemental only when paired with at least one accepted file:line reference, exact test name, ADR reference, test file path, or recognized repository command/path above.

## Gates
- [ ] ./scripts/verify-local.sh all

## Restricted Areas
- Do not modify command re-homing or reassign command workflow ownership; treat TASK-2332.15's resulting tree as an input to this mission.
- Do not add production guard allowlists, directory-placement exemptions, or blanket adapter-to-adapter permissions.
- Do not make architecture tests access Forgejo, real integrations, network services, or performance-heavy CLI/agent commands.
- Limit source changes to architecture guard implementation, its local fixtures/tests, and the architecture documentation necessary to describe the new enforced rules.

## Stop Rules
- Stop and report a prerequisite blocker if TASK-2332.15 is not complete or the canonical tree still contains command workflow sequencing under adapter ownership.
- Stop and request direction if a legitimate production dependency cannot be represented as a named package-level rule or application-owned port without changing product behavior.
- Stop and report the ambiguity if any production module cannot be assigned to one of the six responsibilities using existing architecture decisions; do not resolve it with an allowlist or path-only exception.
- Stop and fix the test isolation before proceeding if an architecture test reaches a real Forgejo instance, integration, network service, agent, or expensive CLI process.
