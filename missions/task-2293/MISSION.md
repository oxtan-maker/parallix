# Mission: Harden legacy TypeScript test mock shapes (task-2293)

## Goal
Remove the temporary `@ts-nocheck -- TASK-2277` compatibility boundary from the 158 mission-base TypeScript test suites converted by TASK-2276, replacing it with narrow, behavior-preserving typing of legacy CommonJS mocks and assertions.

## Why Now
TASK-2276 completed the `.test.js` to `.test.ts` rename while deliberately preserving legacy mock shapes. The resulting blanket suppression hides TypeScript diagnostics in every converted suite, including stale `@ts-expect-error` directives and properties inferred as `{}`. Resolving those diagnostics now restores meaningful test typechecking without changing test execution tiers or allowing test doubles to escape into real Forgejo, agent, network, or expensive CLI calls.

## Refinement Signals
- Predicted NEL bucket: Large (235+)
- Confidence: High
- Selection note: activate as-is
- Main drivers: 158 converted test suites; removal of one file-level suppression per suite; legacy CommonJS mock typing; restoration of per-suite TypeScript diagnostics; preservation of isolated unit-test execution.

## Scope
- Identify the mission-base `test/**/*.test.ts` suites converted by TASK-2276 that carry `@ts-nocheck -- TASK-2277`.
- Remove that file-level directive from each identified converted suite.
- Replace diagnostics exposed by removal with local mock/type declarations, accurately reasoned `@ts-expect-error` directives, or justified `@ts-ignore` directives where the tested legacy behavior cannot be expressed otherwise.
- Remove or correct obsolete `@ts-expect-error` directives exposed by the migration.
- Keep every test double isolated so focused test execution does not access real Forgejo, agents, network services, or expensive CLI operations.
- Deliver changes in small suite or mock-helper batches, typechecking and executing each batch before proceeding.

## Out of Scope
- Production TypeScript refactors, runtime behavior changes, or changes to the project’s test runner configuration.
- Rewriting CommonJS test assertions or mocks solely to adopt a new test style.
- Extending test coverage beyond diagnostics and isolation changes needed to remove TASK-2277 suppressions.
- Changing execution tiers, enabling real external integrations, or making unit tests depend on Forgejo, agents, network services, or expensive CLI operations.
- Removing `@ts-nocheck` directives outside the TASK-2276 converted mission-base suites.

## Success Criteria
> **Falsifiability rule (ADR 0039 Part 2):** Each criterion must be falsifiable. Forbidden: subjective adjectives ("easy, fast, simple, intuitive, user-friendly, responsive, quick, efficient" without an attached metric) and vague quantifiers ("multiple, several, some, many, few, various"). For refactor / condense / migration missions, the criterion must enumerate the specific elements (rules, files, behaviours) that must survive — generic phrases like "preserve critical content" are not sufficient.

- SC1: Every mission-base `test/**/*.test.ts` suite converted by TASK-2276 that contains `@ts-nocheck -- TASK-2277` at the mission parent commit no longer contains that directive.
- SC2: `npx tsc --noEmit --project tsconfig.test.json` completes successfully after the suppression removals; no changed suite relies on an unused `@ts-expect-error` directive.
- SC3: Every changed suite is executed with `node --import tsx --test <test-path>` while retaining its test doubles; each focused command completes successfully without real Forgejo, agent, network-service, or expensive-CLI access.
- SC4: Each new `@ts-expect-error` in a changed suite includes a reason, and each new `@ts-ignore` is limited to a documented legacy typing incompatibility in the immediately associated mock or assertion.
- SC5: `./scripts/verify-local.sh static-analysis` and `./scripts/verify-local.sh all` complete successfully on the final mission tree.

## Risks and Assumptions
- Risk: Legacy mocks deliberately expose only partial module shapes; broad casts can conceal incorrect mock contracts. Mitigation: prefer local, minimal mock interfaces and type assertions adjacent to the mock setup.
- Risk: A typing cleanup can accidentally invoke a real dependency by altering mock construction or module-loading order. Mitigation: run each changed suite through its existing focused `node --import tsx --test` command and retain its current isolation boundary.
- Risk: The set of 158 suites may contain shared mock helpers, so one helper change can affect more than one suite. Mitigation: batch related suites and typecheck after each batch.
- Assumption: TASK-2276’s converted mission-base suites are identifiable from the `@ts-nocheck -- TASK-2277` marker and repository history; suites without that marker are not part of this mission unless they must be changed solely to maintain a shared mock helper used by an in-scope suite.

## Checkpoints
- CP 1: Inventory all `test/**/*.test.ts` files marked `@ts-nocheck -- TASK-2277`; group them by shared mock helper or dependency, record the initial file count, and choose the first isolated batch.
- CP 2: Remove suppressions and harden mock/assertion types for each batch; run `npx tsc --noEmit --project tsconfig.test.json` and the focused `node --import tsx --test <test-path>` command for every changed suite before starting the next batch.
- CP 3: Complete the remaining batches, audit new suppression comments for rationale and locality, and confirm no scoped TASK-2277 marker remains.
- CP 4: Run the static-analysis and all verification gates, then document final evidence against SC1–SC5.

### Checkpoint Documentation Requirements
Every checkpoint document (CP-N.md) MUST include:
- A concise summary naming the suites or mock-helper group completed.
- The exact heading `## Goal Check`.
- Immediately below that heading, the exact 3-column table header `| Criterion | Evidence | Status |`, with one evidence row for every applicable SC1–SC5 criterion.
- Verifiable evidence using file:line references, exact test names, ADR references, test file paths, and recognized repository commands or paths such as backticked `npm ...`, `node ...`, `git ...`, `px ...`, or `./...`. For this mission, record each focused `node --import tsx --test <test-path>` command and `npx tsc --noEmit --project tsconfig.test.json` where applicable.
- Raw `stat`/`ls` output or generic prose alone is not enough: it may be supplemental context only and must be paired with one of the accepted references above.
- A non-generic `Next action:` line at the bottom that names the next suite batch, audit, or gate.

## Gates
- [ ] npx tsc --noEmit --project tsconfig.test.json
- [ ] ./scripts/verify-local.sh static-analysis
- [ ] ./scripts/verify-local.sh all

## Restricted Areas
- Do not modify production behavior, test-runner configuration, execution tiers, or external-service configuration.
- Do not remove or weaken mocks that prevent real Forgejo, agents, network services, or expensive CLI operations from running during unit tests.
- Do not change suites outside the TASK-2276 converted mission-base population except for a shared mock helper required by an in-scope suite.
- Do not use a new file-level TypeScript suppression as a replacement for `@ts-nocheck -- TASK-2277`.

## Stop Rules
- Stop the current batch if its focused test command accesses or attempts to access real Forgejo, an agent, a network service, or an expensive CLI operation; restore isolation before continuing.
- Stop and split the batch if `npx tsc --noEmit --project tsconfig.test.json` exposes diagnostics outside the suites or shared mock helpers in the batch; do not mask unrelated diagnostics.
- Stop before changing production code, test-runner configuration, execution tiers, or external-service configuration; record the dependency and request a scoped follow-up mission.
- Stop and request direction if the TASK-2277-marked population cannot be reconciled with the stated 158 converted suites without expanding scope beyond the allowed shared mock helpers.
