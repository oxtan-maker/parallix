# Mission: Reconcile Forgejo base before integration landing (task-2520)

## Goal
Make integration reconcile Forgejo's recorded base branch with the authoritative local base before landing, while preserving content safety and making interrupted landing/rebase recovery deterministic.

Reproduction-Test: test/task-2520-diverged-base-reconcile.test.ts

## Why Now
`px integrate task-2512` passed its gates but could not publish its landed commit because a local-main rewrite had left Forgejo main at an unrelated commit with the same tree. Retrying also exposed paths that rebase an already-landed mission and falsely report a paused rebase as successful, leaving a mission worktree unfinished.

## Refinement Signals
- Predicted NEL bucket: Medium (81–235)
- Confidence: High
- Selection note: activate as-is
- Main drivers: Forgejo-base reconciliation, lease-protected forced updates, content-loss protection, and integration/rebase recovery regression coverage.

## Scope
- Reconcile the fetched Forgejo base with the recorded local base before `sync-merged`: use a normal push when the remote base is an ancestor, otherwise use a lease pinned to the fetched remote SHA.
- Abort before overwriting a Forgejo base whose tree content is absent from the local base, with an actionable diagnostic.
- Record the old and new Forgejo base SHAs when a lease-protected overwrite occurs, and retain a clear diagnostic if the subsequent landed-commit push is rejected.
- Keep the mission branch rebased onto the current local base before squash/landing.
- Detect an existing mission squash on the local base before integration rebase, then resume landing closeout instead of replaying mission history.
- Detect a rebase in the mission worktree, never report it clean while it remains active, and leave a failed integration-time rebase with explicit recovery rather than a misleading success.
- Add focused regression coverage for content-equivalent divergence, content-different divergence, resumed landing, and paused mission-worktree rebase behavior.

## Out of Scope
- Changing the policy that the recorded local base is authoritative for integration.
- Introducing a blind force push, automatic discard of Forgejo-only content, or a new operator override flag.
- Repairing historical Forgejo branches or retroactively rewriting existing remote history outside an integration run.
- Changing unrelated review, branch-creation, or general-purpose rebase behavior.

## Success Criteria
> **Falsifiability rule (ADR 0039 Part 2):** Each criterion must be falsifiable. Forbidden: subjective adjectives ("easy, fast, simple, intuitive, user-friendly, responsive, quick, efficient" without an attached metric) and vague quantifiers ("multiple, several, some, many, few, various"). For refactor / condense / migration missions, the criterion must enumerate the specific elements (rules, files, behaviours) that must survive — generic phrases like "preserve critical content" are not sufficient.

- SC1: Before `sync-merged`, integration makes Forgejo's configured base equal the recorded local base: an ancestor remote base is updated by a normal push, and a non-ancestor but tree-equivalent remote base is updated with `--force-with-lease` pinned to the freshly fetched remote SHA.
- SC2: The forced-update diagnostic identifies both the fetched Forgejo base SHA and the local replacement SHA; the landed commit then reaches Forgejo through a fast-forward push, or the command fails with a diagnostic that identifies that final push failure.
- SC3: When the fetched Forgejo base contains tree content absent from the local base, integration aborts before any force push and reports that overwrite was refused.
- SC4: Integration verifies the mission branch is based on the current local base before squash/landing.
- SC5: A retry after `sync-merged` failed with the mission squash already on local base skips integration rebase and completes the landing closeout path.
- SC6: `px rebase` does not emit its clean-completion result while a rebase remains active in the mission worktree.
- SC7: Integration-time rebase checks the mission worktree for active rebase state and reports or cleans up the unfinished rebase with recovery instructions.
- SC8: Focused automated tests cover the content-equivalent divergence, content-different divergence, resumed-landing, and paused-rebase scenarios, and the required repository verification gates pass.

## Risks and Assumptions
- A remote SHA can change between fetch and push; `--force-with-lease=<base>:<fetched-sha>` must reject that race rather than overwrite it.
- Commit ancestry alone cannot prove that discarded remote history has no unique content; the reconciliation path must compare tree content before allowing a forced update.
- The recorded local base is assumed to be the integration authority. If that policy changes, this mission must stop rather than silently choosing a different authority.
- Existing test doubles must be capable of representing fetch, ancestry, tree-content, and rebase-in-progress outcomes; extend them only as required by these scenarios.

## Checkpoints
- CP 1 (RED — lock the bug first): Author a failing reproduction test that captures the 2026-09-15 regression before any fix. Scenario: local `main` has been rewritten so that Forgejo `main` points at a non-ancestor commit whose tree is content-equivalent to the local base (the diverged-but-equivalent scenario from AC #5). Assertion: at the mission's parent commit this test fails red because `syncMerged` performs a plain push and rejects with `push-primary-failed`; after the fix it goes green and the landed commit reaches Forgejo via a fast-forward. Once this test is red, move to CP 2. Do not write any fix before this test fails as intended.
- CP 2: Implement base reconciliation and landing diagnostics, then add coverage proving the landed commit follows reconciliation through the fast-forward path.
- CP 3: Repair retry and rebase-state handling: detect an existing local squash before rebase, inspect the mission worktree for an active rebase, and cover both incomplete and recovered outcomes.
- CP 4: Run the repository gates, record final evidence for every success criterion, and confirm no scoped behavior was omitted.

### Checkpoint Documentation Requirements
Every checkpoint document (CP-N.md) MUST include:
- A summary of work done and the exact heading `## Goal Check`.
- A 3-column pipe-delimited table with the exact header `| Criterion | Evidence | Status |` and one row for each applicable success criterion.
- Durable evidence first: exact test names, ADR references, test file paths, and recognized repository commands or paths such as `npm ...`, `node ...`, `git ...`, `px ...`, or `./...` in backticks. File:line references are accepted parenthetically when necessary but discouraged because line numbers rot.
- Raw `stat`/`ls` output or generic prose alone is not evidence; if included, pair it with one of the accepted references above.
- A non-generic `Next action:` line at the bottom.

Example Goal Check table:

| Criterion | Evidence | Status |
|---|---|---|
| Draft prompt defines checkpoint evidence rules | `prompts/draft.md` | PASS |
| Repair loop has targeted incomplete-evidence coverage | `test/repair-handoff.test.ts`, `"buildRelaunchPrompt returns string containing Goal Check table and mission slug"` | PASS |
| Verification gate ran | `./scripts/verify-local.sh docs` | PASS |

## Gates
- [ ] ./scripts/verify-local.sh all
- [ ] ./scripts/verify-local.sh static-analysis

## Restricted Areas
- Do not alter the authority of local base branches, force-push any branch without a SHA-pinned lease, or add an override that bypasses remote-only-content protection.
- Do not change workflow state transitions, review policy, or remote configuration outside the integration and rebase paths needed for this mission.
- Do not edit mission history or invoke live Forgejo operations in tests; tests must mock the external Git/Forgejo boundary.

## Stop Rules
- Stop and request direction if the recorded local base cannot be established as the integration authority.
- Stop before a forced update when comparison shows Forgejo-only tree content, a fresh remote SHA does not match the lease, or required repository data cannot be fetched.
- Stop if the existing test seam requires live Forgejo access; preserve the boundary with mocks instead.
