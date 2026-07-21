# Mission: Extract UI-neutral application contracts and composition (task-2289)

## Goal
Establish the executable, UI-neutral application boundary selected by ADR 0051 for the `stats-backfill` query and the `active` execute-launch command: narrow application contracts and consumer-owned effect ports, adapter wrappers, one concrete composition root, and import/wiring enforcement. Preserve the selected CLI handlers' current public behavior and direct control flow pending TASK-2290.

## Why Now
TASK-2278 and ADR 0051 define the boundary that TASK-2290 will consume when it delegates CLI handlers. Landing the contracts, ports, and composition separately keeps the authority, output, and lifecycle migration out of this refactor, while making the future delegation depend on tested application services rather than command-specific dependency objects.

## Refinement Signals
- Predicted NEL bucket: Medium (81–235)
- Confidence: High
- Selection note: Begin only after TASK-2278/ADR 0051 is integrated and a human explicitly approves both the ADR decision and this implementation breakdown; automation or a passing documentation gate is not approval.
- Main drivers: two executable application slices; ADR 0051 contract semantics; strict fake-port, boundary, and composition coverage; no CLI delegation in this mission.

## Scope
- Define application-owned request/result, read-projection, progress/event, typed-error, cancellation, and capability contracts for `stats-backfill` and `active` that encode ADR 0051 semantics.
- Implement the two services against the minimum consumer-owned ports and test them with strict fakes.
- Add explicit wrappers for existing task-Markdown, Git, agent/subprocess, stats, configuration, and handoff behavior, retaining their current authority and policy.
- Add exactly one production composition root that assembles the complete concrete service graph, plus import- and wiring-boundary guards with violating fixtures.
- Add characterization coverage for the current public text, JSON, and exit behavior of `lib/commands/stats-backfill.ts` and `lib/commands/active.ts`.

## Out of Scope
- Delegating, re-parsing, or re-rendering either CLI handler; TASK-2290 owns handler delegation.
- Changing CLI text, JSON, exit codes, workflow/task/mission state, task-Markdown/Git authority, lifecycle policy, or authorization policy.
- Adding persistence, a service locator, a generic command executor, a database model, or a catch-all dependency bag at the application boundary.
- Refactoring other command families or calling real Forgejo, agents, network services, nested `px`, the verifier, or expensive external CLIs from tests.

## Success Criteria
> **Falsifiability rule (ADR 0039 Part 2):** Each criterion must be falsifiable. Forbidden: subjective adjectives ("easy, fast, simple, intuitive, user-friendly, responsive, quick, efficient" without an attached metric) and vague quantifiers ("multiple, several, some, many, few, various"). For refactor / condense / migration missions, the criterion must enumerate the specific elements (rules, files, behaviours) that must survive — generic phrases like "preserve critical content" are not sufficient.

- SC1: Contracts for both selected services encode one terminal outcome, source- and staleness-labelled projections, ordered operation IDs, safe cancellation boundaries, and capability rejection before mutation; every contract variant has a named positive or negative unit test.
- SC2: `stats-backfill` and `active` execute with strict fake ports, and their tests assert expected calls, call order and arguments where relevant, and absence of forbidden mutation calls.
- SC3: Each consumer-owned port contains only operations invoked by these services; application contracts admit no framework type, database row, legacy module object, optional function collection, generic executor, or catch-all dependency bag.
- SC4: Adapter wrappers cover task-Markdown, Git, agent/subprocess, stats, configuration, and handoff interactions without taking over policy or authority; an adapter failure cannot produce a `completed` result.
- SC5: One named production composition-root module is the sole complete concrete service-graph assembly point; repository wiring tests reject complete adapter construction and service-locator access elsewhere.
- SC6: Import-boundary enforcement rejects direct and transitive Ink, React, HTTP, SQLite, `node:fs`, Git, Forgejo, `node:child_process`, process-exit, and terminal-rendering dependencies from application/domain code, and violation fixtures demonstrate each guard fails.
- SC7: Failure-path tests show validation/capability rejection causes no mutation-port call, progress never becomes durable authority, and cancellation after a durable action reports partial evidence without claiming rollback.
- SC8: Characterization tests show the selected handlers retain their current public text, JSON, and exit behavior, remain direct rather than delegated, and write no workflow/task/mission state.
- SC9: New or changed boundary code has no placeholder implementation, default-success branch, empty catch, `TODO`, `FIXME`, `@ts-ignore`, unjustified `as any`, focused/skipped test, or unused exported contract.
- SC10: Focused contract and guard tests, `./scripts/verify-local.sh all`, and `./scripts/verify-local.sh static-analysis` complete successfully on the implementation tree.
- SC11: A revert can remove the application, port, adapter, composition, and test additions and restore export-only legacy edits without a persisted-state, CLI, or authority migration.

## Risks and Assumptions
- Assumption: TASK-2278/ADR 0051 has integrated before activation and human approval is recorded; otherwise this mission must not begin.
- Risk: Existing command modules may conceal authority or policy in dependencies. Mitigation: treat the named files as behavior inventory and stop rather than relocating authority.
- Risk: Port abstractions may become nominal wrappers around existing dependency objects. Mitigation: strict fakes and tests must prove each port operation is called and unexpected calls fail.
- Risk: Boundary checks can falsely appear effective when only compliant code is scanned. Mitigation: retain violation fixtures that must be rejected.

## Checkpoints
- CP 1: Confirm the integrated ADR 0051 decision and recorded human approval; capture `stats-backfill` and `active` characterization evidence, then create a contract-to-ADR/test matrix covering every contract rule and forbidden side effect.
- CP 2: Define and test the two executable application services, their request/result/projection/progress/error/cancellation/capability contracts, and only the port methods reached by those services using strict fake ports.
- CP 3: Add bounded adapter wrappers and the sole composition root; add repository guards and violating fixtures for composition, service-locator, and prohibited import paths.
- CP 5: Run focused tests and the required repository gates; document final goal-check evidence and rollback boundaries without delegating either CLI handler.

### Checkpoint Documentation Requirements
Every checkpoint document (CP-N.md) MUST include:
- A summary naming the contracts, ports, adapters, guards, or handler characterization changed in that checkpoint.
- The exact heading `## Goal Check`.
- The exact 3-column pipe-delimited table header `| Criterion | Evidence | Status |`, with at least one row for every applicable SC1–SC12 criterion.
- Evidence must use file:line references, exact test names, ADR references, test file paths, or recognized repository commands/paths such as backticked `npm ...`, `node ...`, `git ...`, `px ...`, or `./...`.
- For CP 1, cite ADR 0051, the contract-to-ADR/test matrix file:line, and the exact characterization test names or test paths. For CP 2–CP 3, cite the corresponding service, port, or adapter/composition/guard file:line and exact unit/fixture test names. For CP 5, cite the final test paths and commands executed.
- Raw `stat`/`ls` output or generic prose alone is not enough evidence; if shell output is included, pair it with an accepted reference above.
- A non-generic `Next action:` line at the bottom that identifies the next contract, boundary guard, verification command, or handoff artifact.

Example Goal Check table:

| Criterion | Evidence | Status |
|---|---|---|
| Draft prompt defines checkpoint evidence rules | `prompts/draft.md:28` | PASS |
| Repair loop has targeted incomplete-evidence coverage | `test/repair-handoff.test.ts`, `"buildRelaunchPrompt returns string containing Goal Check table and mission slug"` | PASS |
| Verification gate ran | `./scripts/verify-local.sh docs` | PASS |

## Gates
- [ ] ./scripts/verify-local.sh all
- [ ] ./scripts/verify-local.sh static-analysis

## Restricted Areas
- `lib/commands/stats-backfill.ts` and `lib/commands/active.ts` are behavior inventory only; permit only the smallest export-only edits needed by adapters and do not delegate their handlers.
- Do not modify CLI parsing, terminal rendering, public text/JSON/exit behavior, workflow/task/mission state, persistence, task-Markdown/Git authority, lifecycle policy, or authorization policy.
- Keep production changes bounded to `lib/application/`, explicit adapter wrappers, one composition root, and necessary export-only legacy edits; keep new tests under `test/` and fully mocked.
- Do not introduce direct or transitive UI, HTTP, SQLite, filesystem, Git/Forgejo, subprocess, process-exit, or terminal-rendering dependencies into application/domain modules.

## Stop Rules
- Stop before activation if TASK-2278/ADR 0051 is not integrated or explicit human approval of the ADR decision and breakdown is absent.
- Stop and request direction if correct implementation requires persistence, a change in task/Git authority, lifecycle or authorization policy, CLI output/exit behavior, or weakening a fail-closed path.
- Stop and split the mission if refined work exceeds 235 NEL or concrete wiring reaches an unrelated command family.
- Stop if satisfying a contract requires passing a legacy dependency object, service locator, generic executor, or framework/transport type across the application boundary.
