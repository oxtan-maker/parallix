# Mission: Convert JavaScript test files to TypeScript with history-preserving renames (task-2276)

## Goal
Convert the mission-base inventory of `test/**/*.test.js` suites to corresponding `.test.ts` paths while retaining Git-detectable rename history, preserving test behavior and execution tiers, and accounting explicitly for any safely parked exception.

## Why Now
TASK-2229 established optional TypeScript test authoring; the remaining JavaScript test inventory creates a mixed test language surface. Completing this migration now aligns the suite with that direction while making history preservation and discovery coverage explicit, auditable requirements.

## Refinement Signals
- Predicted NEL bucket: Small (0–80) / Medium (81–235) / Large (235+)
- Confidence: High
- Selection note: activate as-is
- Main drivers: 158 baseline JavaScript test files, TypeScript test-authoring adoption from TASK-2229, Git rename traceability, and test-runner/configuration discovery coverage.

## Scope
- Capture a deterministic mission-base inventory of every `test/**/*.test.js` path and reconcile it against converted and explicitly parked paths at completion.
- Rename each safely convertible baseline test with `git mv` from `.test.js` to `.test.ts`, then make only the TypeScript compatibility edits required for typechecking and existing execution.
- Update `tsconfig.test.json`, `test/run-default-tests.js`, `scripts/test-hygiene.sh`, integration-gate discovery or allowlists, and other filename-specific references required for `.test.ts` suites to retain their current execution tiers.
- Audit conversion pairs against the mission base with Git rename detection at a 50% similarity threshold and sample `git log --follow` history across small, large, and integration-only suites.
- Use narrowly reasoned TypeScript suppressions only when necessary; create and document a file-specific follow-up backlog task for every test deliberately left as `.test.js`.
- Record inventories, rename evidence, suppression rationale, follow-up references, and verification results in checkpoint Goal Check tables.

## Out of Scope
- Changing test assertions, coverage intent, mocks, isolation model, unit-versus-integration classification, or runtime boundaries.
- Converting non-test JavaScript source files, production code, fixtures that are not baseline `.test.js` files, or unrelated documentation.
- Rewriting a test wholesale merely to satisfy TypeScript; a file that cannot remain at least 50% similar after minimal changes must be parked with a follow-up task.
- Changing dependency versions, CI platform behavior, or test architecture beyond discovery/configuration changes required by the renamed suites.

## Success Criteria
> **Falsifiability rule (ADR 0039 Part 2):** Each criterion must be falsifiable. Forbidden: subjective adjectives ("easy, fast, simple, intuitive, user-friendly, responsive, quick, efficient" without an attached metric) and vague quantifiers ("multiple, several, some, many, few, various"). For refactor / condense / migration missions, the criterion must enumerate the specific elements (rules, files, behaviours) that must survive — generic phrases like "preserve critical content" are not sufficient.

- The mission-base inventory accounts for every baseline `test/**/*.test.js` path exactly once as either its corresponding `.test.ts` path or an explicitly parked `.test.js` path.
- Each converted pair is reported as a rename at 50% similarity or higher by `git diff -M50%` against the mission base; no converted test is represented solely as an unrelated deletion and addition.
- Converted suites preserve their pre-migration assertions, mocks, isolation, execution tier, and external-dependency boundaries; no conversion causes a unit test to call real Forgejo, agents, or other external services.
- `tsconfig.test.json`, `test/run-default-tests.js`, `scripts/test-hygiene.sh`, and every changed test discovery/path allowlist recognize the converted `.test.ts` names without dropping a baseline suite.
- Every TypeScript suppression introduced by the mission is localized and reasoned: `@ts-expect-error` is used where applicable, any `@ts-ignore` explains why it is necessary, and any `@ts-nocheck` names a follow-up task.
- `git log --follow -- <converted-path>.test.ts` reaches pre-migration history for one small suite, one large suite, and one integration-only suite selected from the converted inventory.
- Each parked test has a new follow-up backlog task that names its exact path, concrete conversion blocker, proposed remediation, and verification plan; if none are parked, the final Goal Check states that outcome.
- `npx tsc --noEmit --project tsconfig.test.json`, `./scripts/verify-local.sh static-analysis`, the repository fast unit-test verifier, the integration-only workflow gate, and `./scripts/verify-local.sh all` complete successfully on the final tree.
- Reverting the migration commit restores the original JavaScript test paths and discovery configuration without additional manual repair.

## Risks and Assumptions
- Rename similarity can fall below 50% when TypeScript errors encourage structural rewrites; mitigate by using `git mv` first, batching conversions, and preferring localized, reasoned suppressions.
- Filename-specific runners, hygiene checks, and integration allowlists may silently omit `.test.ts` suites; mitigate with the base/final inventory reconciliation and verification of every changed discovery reference.
- Some legacy tests may not typecheck without broad changes; assume they may be parked only after documenting the concrete blocker and creating the required follow-up backlog task.
- Test edits must remain fast and mocked; assume existing test boundaries are intentional and must not be widened during conversion.

## Checkpoints
- CP 1: Capture and commit the mission-base `test/**/*.test.js` inventory and locate every filename-specific discovery, hygiene, runner, configuration, and gate reference that may need a `.test.ts` update.
- CP 2: Convert reviewable batches using `git mv` before TypeScript edits; record localized suppression reasons and immediately park any file that cannot retain 50% similarity without a broad rewrite.
- CP 3: Reconcile the final inventory, audit all rename pairs at `-M50%`, update required discovery/configuration paths, and create file-specific follow-up backlog tasks for parked tests.
- CP 4: Run the typecheck and repository verification plan; capture `git log --follow` samples for the required suite categories and document rollback evidence.

### Checkpoint Documentation Requirements
Every checkpoint document (CP-N.md) MUST include a summary of work done and the exact heading `## Goal Check`, followed by this exact 3-column table header:

| Criterion | Evidence | Status |

Include at least one evidence row for every Success Criterion. Accepted evidence forms are file:line references, exact repository test names, ADR references, existing test file paths, and recognized repository commands or paths such as backticked `npm ...`, `node ...`, `git ...`, `px ...`, or `./...`. For this mission, cite the base/final inventory artifact, converted test paths, `git diff -M50%` output paired with converted paths, `git log --follow` commands paired with their `.test.ts` paths, suppression locations, and any parked-test backlog task.

Raw `stat`/`ls` output or generic prose alone is not sufficient evidence; if shell output is included, pair it with one of the accepted references above. End each checkpoint document with a concrete `Next action:` line that identifies the next conversion batch, audit, or gate.

Example Goal Check table:

| Criterion | Evidence | Status |
|---|---|---|
| All baseline tests are accounted for | `git diff -M50% <mission-base>`, converted `test/...test.ts` paths, and any parked-test backlog task | PASS/FAIL |
| Converted tests retain discovery coverage | `tsconfig.test.json:<line>`, `test/run-default-tests.js:<line>`, and `scripts/test-hygiene.sh:<line>` | PASS/FAIL |
| Final verifier completed | `./scripts/verify-local.sh all` | PASS/FAIL |

## Gates
- [ ] ./scripts/verify-local.sh all

## Restricted Areas
- Do not modify production runtime behavior, dependency versions, CI infrastructure, or test semantics outside changes necessary to discover and execute the renamed `.test.ts` suites.
- Do not use broad rewrites to force a conversion; preserve 50% Git similarity or park the file with the required follow-up task.
- Do not introduce unmocked calls to Forgejo, agents, or other external systems into unit tests.
- Do not remove, rename, or alter backlog ownership fields; retain the existing backlog task and its assignee field.

## Stop Rules
- Stop converting an individual test when the minimal TypeScript changes would reduce Git similarity below 50%, alter its test intent or execution boundary, or require an unjustified file-wide suppression; restore/retain the `.test.js` path and create the required follow-up task.
- Stop before final completion if inventory reconciliation leaves any baseline test unaccounted for, any converted pair is not detected as a 50%-similarity rename, or a discovery path would silently omit a converted suite.
- Stop and escalate if verification indicates a unit test now reaches real Forgejo, agents, or another external dependency, or if the required typecheck/static-analysis/unit/workflow gates cannot be made green without expanding this mission's scope.
