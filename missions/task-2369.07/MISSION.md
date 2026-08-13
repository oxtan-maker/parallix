# Mission: Split review command CLI and workflow adapter (task-2369.07)

## Goal
Separate CLI-flag utilities and the `ReviewWorkflowAdapter` from `review-commands.ts` into focused review-adapter modules without changing the review command surface or behavior.

## Why Now
`src/adapters/review/review-commands.ts` currently combines command execution with reusable flag parsing, handoff lookup, and workflow-adapter construction. This makes the review command module unusually large and makes either concern harder to change or test in isolation.

## Refinement Signals
- Predicted NEL bucket: Medium (81–235)
- Confidence: High
- Selection note: The requested extraction names and destination modules are enumerated, while behavior must remain stable.
- Main drivers: separate CLI parsing from command implementations; isolate `ReviewWorkflowAdapter`; retain existing imports through compatibility re-exports.

## Scope
- Create `src/adapters/review/review-cli-flags.ts` and move `REVIEW_FLAGS`, `REVIEW_VALUE_FLAGS`, `unknownReviewFlags()`, `flagValue()`, `repeatedFlagValues()`, `readTextFlag()`, `unwrapHandoffModule()`, `getHandoff()`, and `DEFAULT_MAX_ATTEMPTS` into it.
- Create `src/adapters/review/review-workflow-adapter.ts` and move `ReviewWorkflowAdapter` and `createReviewWorkflowAdapter()` into it.
- Update `src/adapters/review/review-commands.ts` to remove the extracted implementations and re-export the extracted public symbols needed by current consumers.
- Add or update focused unit tests for the extracted CLI utilities and workflow-adapter factory/class where current coverage does not directly establish the preserved behavior.

## Out of Scope
- Changing review command flags, accepted values, defaults, error messages, or command behavior.
- Changing workflow, handoff, Forgejo, or review-state semantics.
- Renaming unrelated review modules or performing additional review-command refactors.
- Modifying public package exports beyond the compatibility exports required from `review-commands.ts`.

## Success Criteria
> **Falsifiability rule (ADR 0039 Part 2):** Each criterion must be falsifiable. Forbidden: subjective adjectives ("easy, fast, simple, intuitive, user-friendly, responsive, quick, efficient" without an attached metric) and vague quantifiers ("multiple, several, some, many, few, various"). For refactor / condense / migration missions, the criterion must enumerate the specific elements (rules, files, behaviours) that must survive — generic phrases like "preserve critical content" are not sufficient.

- `src/adapters/review/review-cli-flags.ts` exports exactly the extracted flag-facing elements: `REVIEW_FLAGS`, `REVIEW_VALUE_FLAGS`, `unknownReviewFlags()`, `flagValue()`, `repeatedFlagValues()`, `readTextFlag()`, `unwrapHandoffModule()`, `getHandoff()`, and `DEFAULT_MAX_ATTEMPTS`.
- `src/adapters/review/review-workflow-adapter.ts` exports `ReviewWorkflowAdapter` and `createReviewWorkflowAdapter()`; the implementation of that class and factory no longer resides in `src/adapters/review/review-commands.ts`.
- `src/adapters/review/review-commands.ts` retains compatibility re-exports for every extracted symbol imported elsewhere in the repository, and its review command implementations consume the extracted modules rather than duplicate their logic.
- Flag parsing preserves the existing handling of known flags, unknown flags, flags with values, repeated flag values, text-flag validation, handoff-module unwrapping, handoff retrieval, and the default maximum-attempt value.
- Focused tests cover the preserved CLI utility and adapter behavior affected by the extraction, and `./scripts/verify-local.sh static-analysis` completes successfully.
- `src/adapters/review/review-commands.ts` is reduced by approximately 400 lines relative to the mission parent commit, with the removed code accounted for by the two named extraction modules rather than deleted behavior.

## Risks and Assumptions
- Existing consumers may import helper symbols from `review-commands.ts`; compatibility re-exports are required unless a repository-wide consumer update is demonstrably complete.
- The moved helpers may rely on import order, module initialization, or type-only dependencies; preserve those semantics when establishing the new module boundaries.
- The approximately 400-line reduction is a target rather than a reason to move unrelated code.
- The mission assumes this is a structural refactor: observed command output and review-workflow behavior must not change.

## Checkpoints
- CP 1: Map the current exports, internal call sites, and tests for the nine CLI/handoff elements and the adapter class/factory; record the compatibility exports and behavior that must survive before moving code.
- CP 2: Extract the CLI/handoff elements into `src/adapters/review/review-cli-flags.ts`, update `review-commands.ts` imports/re-exports, and add or adjust focused tests that demonstrate retained parsing and handoff behavior.
- CP 3: Extract `ReviewWorkflowAdapter` and `createReviewWorkflowAdapter()` into `src/adapters/review/review-workflow-adapter.ts`, retain necessary compatibility exports, confirm the review-command line reduction, and complete the required static-analysis gate.

### Checkpoint Documentation Requirements
Every checkpoint document (`CP-N.md`) MUST lead its evidence with durable forms Parallix verifies today: exact test names, ADR references, test file paths, and recognized repository commands or paths such as `npm ...`, `node ...`, `git ...`, `px ...`, or `./...`. File:line references are accepted when necessary but discouraged because line numbers rot.

Every checkpoint document MUST include:
- A summary of work done.
- The exact heading `## Goal Check`.
- The exact 3-column pipe-delimited table header `| Criterion | Evidence | Status |` with at least one row for every Success Criterion.
- Evidence that names the affected test file and exact test name where tests establish a criterion; use an ADR reference where it establishes an invariant; and record a recognized command/path for verification evidence.
- A non-generic `Next action:` line at the bottom that identifies the remaining extraction, compatibility, test, or verification work.

Raw `stat`/`ls` output or generic prose alone is not enough for Goal Check evidence. It may be supplemental, but it must be paired with an accepted command, path, exact test name, or ADR reference above.

## Gates
- [ ] ./scripts/verify-local.sh static-analysis
- [ ] ./scripts/verify-local.sh all

## Restricted Areas
- Do not change review command semantics, supported flags, review workflow behavior, handoff behavior, or Forgejo integration behavior.
- Do not edit files outside the review adapter modules and focused tests required to prove this extraction, except for mission checkpoint documentation.
- Do not remove a `review-commands.ts` export while it has a repository consumer; preserve it through a re-export or update every verified consumer within this mission.

## Stop Rules
- Stop and request direction if preserving an existing `review-commands.ts` export requires a public API change outside the listed review modules.
- Stop and request direction if extraction reveals that review-command behavior depends on an undocumented side effect that cannot be preserved by imports and re-exports alone.
- Stop and request direction if the required static-analysis gate fails for an unrelated pre-existing failure after confirming the failure is outside the mission files.
