# Mission: Delegate bounded CLI slices through application boundary (task-2290)

## Goal
Delegate the `stats-backfill` read/projection handler and the `active` execute-launch lifecycle handler to the approved TASK-2289 application services. Keep each CLI handler responsible only for argument parsing, rendering, and existing exit-code mapping while preserving all specified public behavior, lifecycle ordering, and failure semantics.

## Why Now
TASK-2289 provides the UI-neutral contracts, strict ports, adapters, composition root, and boundary guards required for delegation. Completing these two bounded slices proves that the chosen ADR 0051 boundary can absorb real CLI orchestration without changing canonical task-Markdown/Git authority or creating a parallel runtime path.

## Refinement Signals
- Predicted NEL bucket: Medium (81–235)
- Confidence: High
- Selection note: Begin only after TASK-2278/ADR 0051 and TASK-2289 are integrated and a human explicitly approves the ADR decision and this implementation breakdown; automation, an agent assertion, or a passing documentation gate is not approval.
- Main drivers: two handler delegations; exact CLI characterization and equivalence coverage; lifecycle failure/rollback order; application-boundary no-bypass guards; strict mocked unit tests.

## Scope
- Characterize every selected success and failure branch of `lib/commands/stats-backfill.ts` and `lib/commands/active.ts` before changing their orchestration.
- Delegate `stats-backfill` computation to the TASK-2289 read/projection service while retaining help parsing, text/JSON rendering, `--apply` presentation, and exit mapping at the CLI edge.
- Delegate `active` lifecycle orchestration to the TASK-2289 execute-launch service while retaining usage/preflight rendering and existing exit mapping at the CLI edge.
- Update only the supporting composition/wiring and explicit adapters required to invoke the approved services, then remove the superseded handler orchestration rather than retaining a fallback.
- Add focused handler, application, and import/wiring-boundary tests under `test/` using strict mocks; candidate files are `test/stats-backfill.test.ts`, `test/active.test.ts`, `test/index.test.ts`, and TASK-2289's boundary test.

## Out of Scope
- Ink, React, web-board, HTTP, SQLite, persistence, canonical-record, workflow-authority, lifecycle-policy, or authorization-policy changes.
- New CLI options or changes to public `stats-backfill` text, JSON shape, `--apply` behavior, `active` text, or either command's exit codes; `active --json` remains unsupported.
- Delegation or refactoring of command families beyond `stats-backfill` and `active`, a service locator, generic command executor, or dependency bag that bypasses declared ports.
- Real Forgejo, Git, agents, network, nested `px`, nested test runners, or full verifier calls from unit tests.

## Success Criteria
> **Falsifiability rule (ADR 0039 Part 2):** Each criterion must be falsifiable. Forbidden: subjective adjectives ("easy, fast, simple, intuitive, user-friendly, responsive, quick, efficient" without an attached metric) and vague quantifiers ("multiple, several, some, many, few, various"). For refactor / condense / migration missions, the criterion must enumerate the specific elements (rules, files, behaviours) that must survive — generic phrases like "preserve critical content" are not sufficient.

- SC1: Before rewiring, named characterization tests cover `stats-backfill` help, text, JSON, report-only, `--apply`, skipped/malformed records, write failure, stdout/stderr, exit code, writes, and ordered collaborator calls; the same tests pass after delegation without broad snapshots or weakened assertions.
- SC2: Every non-help `stats-backfill` computation path crosses the approved application service; report-only performs no write, `--apply` writes only after projection, skipped/malformed records retain their current representation, and a write failure neither renders nor returns success.
- SC3: Named `active` tests cover usage-limit rejection, preflight rejection, agent selection and launch, launch-callback record ordering, launch throw, nonzero launch return, rollback failure, handoff failure, cancellation before launch, cancellation after durable transition, deferred worktree synchronization, stdout/stderr, and exact nonzero exit propagation.
- SC4: Every in-scope `active` lifecycle path crosses the approved application service; handler code contains no shadow task-transition, Git, stats-write, handoff, or agent-launch orchestration, including error and rollback branches.
- SC5: Application tests with strict ports assert the ordered calls and arguments for each selected success/failure path, assert no later port calls after a failure, and preserve durable partial evidence when rollback is unsafe or fails.
- SC6: Typed results keep `rejected`, `failed`, and `cancelled` distinct; adapter exceptions cannot become `completed`; exactly one terminal progress event is emitted; capability/staleness rejection occurs before every mutation port and causes no mutation call.
- SC7: CLI equivalence retains `stats-backfill` text/JSON/report-only/`--apply` behavior and retains `active` text and exit behavior, including rejection of unsupported `active --json`.
- SC8: TASK-2289 import and composition guards remain green: complete concrete wiring exists only in its composition root, application/domain modules have no CLI parsing, rendering, `process.exit`, direct infrastructure import, or framework/transport type, and no service locator or dependency bag is introduced.
- SC9: Changed production and test code contains no placeholder/default-success branch, empty catch, `TODO`, `FIXME`, `@ts-ignore`, unjustified `as any`, focused/skipped test, deleted compatibility assertion, or dead legacy orchestration copy.
- SC10: Focused equivalence and negative tests, `./scripts/verify-local.sh all`, and `./scripts/verify-local.sh static-analysis` pass on the implementation tree.
- SC11: A revert restores the two handler implementations and removes delegation-only wiring/modules without changing persisted records, lifecycle/authorization policy, text/JSON output, or exit codes.
- SC12: The final checkpoint cites the exact repository command used for the ADR 0051 bug-frequency baseline and records the ADR 0051 integration-boundary cohort instruction without asserting an unmeasured reliability or speed improvement.

## Risks and Assumptions
- Assumption: TASK-2278/ADR 0051 and TASK-2289 are integrated, and a human has recorded explicit approval before this mission activates; otherwise no implementation may begin.
- Risk: the legacy handlers may contain unrecognized authority or failure behavior. Mitigation: build a branch/path table before rewiring and stop when an undocumented authority change is discovered.
- Risk: output equivalence can be weakened by snapshots, normalization, or broad mocks. Mitigation: preserve precise stdout, stderr, exit, write, and call-order assertions with strict mocked ports.
- Risk: a partial delegation can leave a legacy happy or error path authoritative. Mitigation: handler-level no-bypass assertions and removal of superseded orchestration are required.
- Risk: the slice may exceed its NEL boundary. Mitigation: stop and split if refined work exceeds 235 NEL or reaches unrelated lifecycle, persistence, UI, or command-family migration.

## Checkpoints
- CP 1: Confirm TASK-2278/ADR 0051 and TASK-2289 are integrated and human approval is recorded. Inventory every selected branch in both handlers in a path table covering legacy branch, application outcome, CLI rendering/exit mapping, mutation order, rollback, and exact test; add missing characterization tests before changing orchestration.
- CP 2: Delegate `stats-backfill` through the approved read/projection service. Prove help remains at the CLI edge, report-only performs no write, `--apply` projects before writing, skips/malformed records retain representation, and write failure cannot render or return success; remove replaced handler orchestration.
- CP 3: Delegate `active` through the approved execute-launch service. Prove preflight, launch callback ordering, nonzero/throw rollback, unsafe rollback partial evidence, handoff, cancellation, deferred synchronization, output channel, and exit propagation; remove replaced handler orchestration.
- CP 4: Add or strengthen strict-port no-bypass, import-boundary, and composition-wiring tests; audit changed code for legacy fallback paths, placeholders, weakened assertions, and tests that could reach real external systems.
- CP 5: Run focused tests and both repository gates. Record final criterion evidence, the ADR 0051 baseline command/cohort instruction, and the precise Git-revert boundary.

### Checkpoint Documentation Requirements
Every checkpoint document (CP-N.md) MUST include:
- A summary naming the handler branches, service delegation, port order, boundary guard, or verification work completed in that checkpoint.
- The exact heading `## Goal Check`.
- The exact 3-column pipe-delimited table header `| Criterion | Evidence | Status |`, with at least one row for every applicable SC1–SC12 criterion.
- Evidence must use forms Parallix already verifies today: existing file:line references; exact repository test names; ADR references; existing test file paths; or recognized repository commands/paths such as backticked `npm ...`, `node ...`, `git ...`, `px ...`, or `./...`.
- CP 1 must cite `ADR 0051`, the branch/path table file:line, and exact characterization test names or test paths. CP 2–CP 4 must cite changed handler/service/guard file:line references and exact unit or violation-fixture test names. CP 5 must cite the executed test paths and commands, plus the exact ADR 0051 baseline command and cohort instruction.
- Raw `stat`/`ls` output or generic prose alone is not enough evidence; pair any shell output with an accepted reference above.
- A non-generic `Next action:` line at the bottom naming the next handler branch, test, guard, verification command, or handoff artifact.

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
- Do not start implementation unless TASK-2278/ADR 0051 and TASK-2289 are integrated and the required human approval is recorded.
- Keep CLI handlers limited to parsing, rendering, and existing exit mapping; do not alter public text, JSON, CLI arguments, exit codes, workflow/task/mission state formats, or canonical task-Markdown/Git authority.
- Keep application/domain code free of `process.exit`, console/terminal rendering, CLI parsing, UI/framework/transport types, and direct filesystem, Git, Forgejo, subprocess, HTTP, or SQLite imports.
- Confine production changes to the two selected handlers, approved TASK-2289 application/composition/adapters, and necessary exports; confine new tests to `test/` with fully mocked dependencies.
- Do not use service locators, generic command executors, catch-all dependency bags, dual runtime paths, feature-flag fallbacks, real external services, or unrelated command-family refactors.

## Stop Rules
- Stop before activation if TASK-2278/ADR 0051 or TASK-2289 is not integrated, or if explicit human approval of the ADR decision and this breakdown is absent.
- Stop and request direction if characterization reveals undocumented authority, compatibility requirements that conflict with ADR 0051, or a need to change persistence, UI, security, lifecycle, or authorization policy.
- Stop and split if the refined scope exceeds 235 NEL or reaches another command family, a canonical-record migration, or unrelated infrastructure work.
- Stop and request an architecture decision if implementation would require a framework/transport type, legacy dependency object, service locator, generic executor, or direct infrastructure access to cross the application boundary.
- Stop if preserving behavior requires weakening a fail-closed guard, accepting an untested external call, swallowing an error, or retaining old orchestration as a runtime fallback.
