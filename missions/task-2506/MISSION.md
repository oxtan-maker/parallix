# Mission: Rebase before `px integrate` runs integration gates (task-2506)

## Goal
Make `px integrate` bring a mission branch up to its resolved local primary/parent branch before it runs integration gates or performs its probe merge, using the established rebase workflow and conflict handling.

## Why Now
`main` can advance after review approval. Integration currently validates a stale mission branch, then fails at its probe merge and requires a manual rebase plus a second gate run. Task-2481 exposed this as a repeated integration failure.

## Refinement Signals
- Predicted NEL bucket: Medium (81–235)
- Confidence: High
- Selection note: activate as-is
- Main drivers: integration ordering, shared primary-branch resolution, dry-run non-mutation, and regression coverage

## Scope
- Trace the `px integrate` path and the existing `px rebase` / review-round rebase path to identify where integration stopped invoking the shared workflow.
- Invoke the established rebase workflow after resolving the mission's local primary/parent branch and before integration gates and the probe merge.
- Preserve the mission identity through a successful integration-time rebase.
- Route an integration-time rebase conflict through the existing agent-assisted rebase conflict workflow.
- Make `px integrate --dry-run` report required or conflicting rebases without changing the branch.
- Add focused regression coverage for a conflict-free non-backlog primary-branch change that leaves a mission behind the primary branch.

## Out of Scope
- Changing the primary/parent branch resolution policy defined by ADR 0043.
- Changing squash, post-integration cleanup, Forgejo/GitHub, or backlog-only merge-conflict recovery behavior.
- Rewriting the rebase workflow, conflict prompt, or integration gate configuration.
- Adding new integration strategies or changing unrelated review-round rebase behavior.

## Success Criteria
> **Falsifiability rule (ADR 0039 Part 2):** Each criterion must be falsifiable. Forbidden: subjective adjectives ("easy, fast, simple, intuitive, user-friendly, responsive, quick, efficient" without an attached metric) and vague quantifiers ("multiple, several, some, many, few, various"). For refactor / condense / migration missions, the criterion must enumerate the specific elements (rules, files, behaviours) that must survive — generic phrases like "preserve critical content" are not sufficient.

- `px integrate` resolves the same local primary/parent target used by `px rebase` and completes its rebase attempt before running any configured integration gate and before its probe merge.
- When the rebase is clean, `px integrate` continues without a manual rebase command and retains the mission's identifier throughout the integration flow.
- Integration gates execute against the rebased mission branch, demonstrated by a test whose primary branch contains a conflict-free non-backlog commit absent from the mission branch before `px integrate` starts.
- When the integration-time rebase conflicts, the command enters the existing agent-assisted rebase conflict path built around `buildRebasePrompt` and the rebound kernel; it does not stop with instructions to run `git rebase` manually.
- `px integrate --dry-run` reports whether the branch needs a rebase or that the rebase would conflict, and leaves the mission branch's HEAD unchanged.
- Regression coverage in `test/integrate.test.ts` proves the behind-primary, conflict-free case integrates without a manual rebase.
- `./scripts/verify-local.sh all` succeeds on the completed mission tree.

## Risks and Assumptions
- The shared rebase workflow can be called from integration without changing its review-round callers.
- Rebasing rewrites the mission branch; dry-run must remain observational.
- Primary branch movement between target resolution and rebase is an existing concurrency boundary; this mission does not add locking or retry policy.
- Integration tests must mock external boundaries and remain within the repository's unit-test timing constraints.

## Checkpoints
- CP 1: Map the integration, rebase, dry-run, gate, and conflict paths; record the shared insertion point and the relevant existing test coverage.
- CP 2: Add the focused integration regression tests for clean rebase ordering, preserved mission identity, conflict delegation, and dry-run non-mutation; confirm they fail before the behavior change where applicable.
- CP 3: Implement the smallest reuse of the existing rebase workflow in `px integrate`, then run the mission gate and record final Goal Check evidence.

### Checkpoint Documentation Requirements
Every checkpoint document (CP-N.md) MUST include durable evidence first: exact test names, ADR references such as `ADR 0043`, test file paths such as `test/integrate.test.ts`, and recognized repository commands or paths such as `npm test -- test/integrate.test.ts`, `node ...`, `git ...`, `px ...`, or `./scripts/verify-local.sh all`. File:line references are accepted when needed but discouraged because line numbers rot.

Every checkpoint document (CP-N.md) MUST include:
- A summary of work done.
- The exact heading `## Goal Check`.
- The exact 3-column pipe-delimited table header `| Criterion | Evidence | Status |` with one evidence row per success criterion.
- Evidence tied to the accepted durable forms above. Raw `stat`/`ls` output or generic prose alone is not enough; pair shell output with an accepted command, test name, ADR reference, or repository path.
- A non-generic `Next action:` line at the bottom.

## Gates
- [ ] ./scripts/verify-local.sh all

## Restricted Areas
- Do not alter ADR 0043 target-selection semantics.
- Do not change integration strategy selection, remote publishing, or post-integration cleanup unless required to pass the rebase workflow through its established interfaces.
- Do not add dependencies, configuration switches, or a second rebase implementation.
- Do not push the mission branch to `origin`; mission-branch review pushes target `review` only.

## Stop Rules
- Stop and request direction if the shared rebase workflow cannot be invoked by integration without changing ADR 0043 target resolution or public integration strategy semantics.
- Stop and request direction if preserving dry-run non-mutation requires a new persistence model or a new external dependency.
- Stop and request direction if the required regression scenario needs real Forgejo, real agents, or tests that cannot remain in the repository's permitted test tier.
