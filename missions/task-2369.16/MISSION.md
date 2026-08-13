# Mission: Reduce the review-setup module by extracting real concerns (task-2369.16)

## Goal
Split the 1,216-line `setup-review.ts` into cohesive, implemented modules so no review-setup source file exceeds 500 lines, while retaining the existing `setup-review.ts` import surface and setup behavior.

## Why Now
`setup-review.ts` mixes Forgejo HTTP and token handling, repository/bootstrap work, configuration and readiness checks, and interactive command flow. The previous attempt only added forwarding files, so it did not reduce the largest implementation file or create useful ownership boundaries. This mission restores the baseline and makes real moves that do both.

## Refinement Signals
- Predicted NEL bucket: Medium (81–235)
- Confidence: High
- Selection note: activate as-is
- Main drivers: reduce the largest review-setup source file below 500 lines; keep imports stable; isolate the three independently testable concerns already present in the module.

## Scope
- Keep `src/adapters/review/setup-review.ts` as the public compatibility module and the owner of CLI-facing prompt collection plus the `setupReview`, `setupWizard`, and `bootstrapReviewSurface` orchestration flows.
- Extract complete implementations, not forwarding wrappers:
  - `setup-review-auth.ts` owns Forgejo HTTP requests, token naming/creation/retry, token-file paths and writes, and authentication-result handling.
  - `setup-review-repository.ts` owns repository, Forgejo-user, collaborator, and Git review-remote operations.
  - `setup-review-config.ts` owns workflow/review configuration construction and writing, configured review-remote lookup, and review-readiness evaluation.
- Move the existing helpers to their owner modules and import them directly where used. `setup-review.ts` re-exports every established public helper so existing callers and tests retain their import path.
- Preserve prompt order and defaults; token scopes, names, file locations, permissions, and retry behavior; Forgejo request payloads and error results; repository/collaborator/remote behavior; workflow configuration output; review-readiness results; and interactive and non-interactive command behavior.
- Add only focused hermetic regression coverage needed to characterize a moved boundary. Inject HTTP, prompt, Git, filesystem, and process seams; do not call real Forgejo or expensive commands.

## Out of Scope
- Changing the CLI questions or output, configuration schema, token format/scopes, Forgejo authorization policy, repository or collaborator policy, remote naming, or public setup-review exports.
- Adding a fifth catch-all utility module, a dependency-injection framework, or a new test harness.
- Refactoring review modules outside this setup dependency graph.

## Success Criteria
> **Falsifiability rule (ADR 0039 Part 2):** Each criterion must be falsifiable. Forbidden: subjective adjectives ("easy, fast, simple, intuitive, user-friendly, responsive, quick, efficient" without an attached metric) and vague quantifiers ("multiple, several, some, many, few, various").

- `src/adapters/review/setup-review.ts`, `setup-review-auth.ts`, `setup-review-repository.ts`, and `setup-review-config.ts` each contain at most 500 lines.
- `setup-review-auth.ts`, `setup-review-repository.ts`, and `setup-review-config.ts` each contain executable implementations for their scoped concern and do not re-export from `setup-review.ts` or each other.
- `setup-review.ts` retains the established public exports required by current callers, including `apiRequest`, `bootstrapReviewSurface`, `evaluateReviewSetup`, `setupReview`, `setupWizard`, and the helpers imported by `test/setup-review.test.ts` and `test/task-2364-owner-assumption.test.ts`.
- The dependency direction is one way: `setup-review-auth.ts` has no imports from the other setup modules; `setup-review-repository.ts` may import auth; `setup-review-config.ts` may import auth and repository; `setup-review.ts` may import all three. None imports `setup-review.ts`.
- Hermetic tests cover token retry and persistence, Forgejo repository/bootstrap behavior, remote setup, configuration writing, readiness evaluation, and interactive plus non-interactive setup paths without a real Forgejo instance.
- `./scripts/verify-local.sh static-analysis` and `./scripts/verify-local.sh all` complete successfully.

## Risks and Assumptions
- `bootstrapReviewSurface` is shared with handoff, so it remains a top-level orchestration function in the public module rather than being mislabeled as repository or wizard code.
- Readiness evaluation combines configuration, local token state, remote state, and an injected API probe; `setup-review-config.ts` owns that policy and imports lower-level operations rather than creating a reverse dependency.
- Module-mock tests rely on live imports. Preserve dependency injection and namespace access where a test replaces a dependency.

## Checkpoints
- CP 1: Restore the pre-mission implementation; record the public exports, callers, and baseline line counts; add only the characterization needed for moved seams.
- CP 2: Extract auth and repository implementations, wire direct imports and facade re-exports, and run their focused hermetic tests.
- CP 3: Extract configuration/readiness implementation, leave orchestration in `setup-review.ts`, and show all four review-setup source files are at most 500 lines with no forwarding-only module.
- CP 4: Run the required gates and record a final Goal Check against every success criterion.

### Checkpoint Documentation Requirements
Every checkpoint document (CP-N.md) MUST include:
- A summary of work done
- The exact heading `## Goal Check`
- The exact 3-column pipe-delimited markdown table header `| Criterion | Evidence | Status |`
- At least one evidence row for every success criterion, using durable evidence such as exact test names, test paths, and recognized repository commands.
- A non-generic `Next action:` line at the bottom

## Gates
- [ ] ./scripts/verify-local.sh static-analysis
- [ ] ./scripts/verify-local.sh all

## Restricted Areas
- Do not change the backlog task assignee, mission workflow state, review state, or integration state during implementation.
- Do not alter setup behavior beyond relocating its implementation.
- Do not introduce real Forgejo access, real CLI execution, or external services into tests.

## Stop Rules
- Stop and request direction if retaining the established public exports requires a reverse module dependency or cycle.
- Stop and request direction if a behavior cannot be characterized hermetically without real Forgejo credentials or an expensive command.
