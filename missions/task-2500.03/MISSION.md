# Mission: Implement standard collaborative GitHub PR integration mode (github-pr) (task-2500.03)

## Goal
Add the `github-pr` integration mode so Parallix completes mission work, review, and local verification while GitHub remains the authority that merges the mission pull request into its configured target branch; mark the mission complete only after fresh external merge evidence is observed.

## Why Now
The parent trust-pipeline work needs a standard collaborative mode for repositories whose protected primary branch and pull-request policy are enforced by GitHub. Treating a local branch update as completion would bypass that authority and can close missions before the reviewed change is integrated.

## Refinement Signals
- Predicted NEL bucket: Large (235+)
- Confidence: High
- Selection note: activate as-is
- Main drivers: integration-mode dispatch, externally observed GitHub PR state, configurable target branches, recovery-state coverage, and integration lifecycle tests.

## Scope
- Define and implement the `github-pr` integration-mode behavior used by `px integrate`.
- Submit or update the mission PR for the configured integration target branch after Parallix review and local gates succeed.
- Observe fresh GitHub evidence for the expected PR and its completed integration before closing the mission.
- Support both direct missions targeting `main` and missions targeting a configured developer feature branch.
- Verify GitHub squash or rebase integrations by the appropriate relationship or resulting-tree evidence rather than by equality with the mission-head SHA.
- Represent and recover from a pending PR, an unmerged closed PR, branch updates after review, unexpected integration results, changed target branches, and unavailable GitHub.

## Out of Scope
- Changing GitHub branch-protection rules, required checks, review policy, or merge strategy.
- Replacing the existing Forgejo integration mode or changing its completion semantics.
- Making Parallix merge a GitHub PR, push directly to protected `main`, or infer GitHub state from local refs.
- Delivering the later dogfood rollout of protected GitHub `main` described by the parent task.

## Success Criteria
> **Falsifiability rule (ADR 0039 Part 2):** Each criterion must be falsifiable. Forbidden: subjective adjectives ("easy, fast, simple, intuitive, user-friendly, responsive, quick, efficient" without an attached metric) and vague quantifiers ("multiple, several, some, many, few, various"). For refactor / condense / migration missions, the criterion must enumerate the specific elements (rules, files, behaviours) that must survive — generic phrases like "preserve critical content" are not sufficient.

- A mission configured for `github-pr` and targeting `main` submits or updates its GitHub PR after Parallix review and local gates, remains incomplete while that PR is pending, and completes only after fresh GitHub evidence records its merge.
- A mission configured for `github-pr` can target a configured developer feature branch; its observed integration is into that branch and does not require that branch to have merged into `main`.
- `px integrate` in `github-pr` mode does not close a mission because local `main`, the configured target branch, or another local ref changes; completion requires externally observed evidence for the expected PR or integration result.
- A GitHub-owned squash or rebase merge whose resulting commit SHA differs from the Parallix mission head is accepted only when the implementation verifies the required relationship or resulting-tree evidence.
- A PR closed without merge leaves the mission incomplete and exposes a recoverable state rather than reporting integration success.
- A branch update after Parallix review, an unexpected resulting tree after merge, a changed target/base branch, and unavailable GitHub each produce an explicit non-success state with a defined recovery path.
- Automated coverage exists for: direct-to-`main`; developer-feature-branch target; pending PR; successful external merge; unmerged closed PR; squash/rebase with different SHA; target/base change; and prevention of premature closure.

## Risks and Assumptions
- GitHub API results can be stale, unavailable, or describe merge commits that differ from the mission head; completion must use fresh, mode-specific external evidence.
- The configured base branch may change while a mission is in flight; the expected PR target must be persisted or compared deliberately so observation cannot silently approve a different target.
- Existing integration and lifecycle modes may share dispatch or completion paths; changes must preserve their current semantics.
- Assumption: Mission 1 (TASK-2500.01) supplies the integration-mode foundation this mission depends on.

## Checkpoints
- CP 1: Trace the existing integration-mode dispatch, mission completion transition, GitHub/Forgejo boundary, configuration contract, and relevant lifecycle tests; record the state model and the specific seams that need `github-pr` behavior.
- CP 2: Add test coverage first for all eight acceptance scenarios, including externally pending/merged/closed PR outcomes, configured feature-branch targets, differing squash/rebase SHAs, changed targets, unavailable GitHub, and no-local-ref premature closure.
- CP 3: Implement the smallest mode-specific integration and observation path that satisfies the tests, keeping GitHub merge ownership external and preserving other modes.
- CP 4: Run the mission verification gate, inspect the final behavior against every success criterion, and write the final checkpoint evidence.

### Checkpoint Documentation Requirements
Every checkpoint document (CP-N.md) MUST lead its evidence with durable forms Parallix recognizes today: exact test names, ADR references, test file paths, and recognized repository commands or paths such as `npm ...`, `node ...`, `git ...`, `px ...`, or `./...`. It MUST include a summary of work and then the exact heading `## Goal Check` followed by this exact 3-column table header:

| Criterion | Evidence | Status |

Provide one row for every Success Criterion. File:line references are accepted when needed but discouraged because line numbers rot. For this mission, cite the tests that prove the eight acceptance scenarios, `test/task-2500-integrate-mode-dispatch.test.ts`, the implemented integration-mode contract, and `./scripts/verify-local.sh all` at the appropriate checkpoint. Raw `stat`/`ls` output or generic prose alone is not enough; if included, pair it with an accepted reference above. End each checkpoint with a concrete `Next action:` line naming the next mission action.

Example Goal Check table:

| Criterion | Evidence | Status |
|---|---|---|
| `github-pr` mode is dispatched through the integration workflow | `test/task-2500-integrate-mode-dispatch.test.ts` | PASS/FAIL |
| Required external-integration lifecycle behavior is covered | test path created for this mission and its exact scenario test name | PASS/FAIL |
| Required verification gate ran | `./scripts/verify-local.sh all` | PASS/FAIL |

## Gates
- [ ] ./scripts/verify-local.sh all

## Restricted Areas
- Do not alter GitHub repository policy, protected branches, pull-request settings, or remote branch state outside the mission's normal PR submission/update flow.
- Do not make `github-pr` completion depend on local target-branch movement or mission-head SHA equality.
- Do not regress existing integration modes, lifecycle persistence, or mission-review ownership.
- Do not expand this mission into the protected-main dogfood rollout or unrelated GitHub provider features.

## Stop Rules
- Stop and report if TASK-2500.01 does not provide the required integration-mode foundation or its contract conflicts with `github-pr` requirements.
- Stop before declaring success if GitHub observation cannot obtain fresh evidence for the expected PR, target branch, and integration result.
- Stop and report an explicit recovery state if the PR is closed without merge, its target changes unexpectedly, or the resulting tree cannot be verified.
- Stop and request direction if satisfying the contract requires changing GitHub policy, force-pushing protected branches, or broadening other integration modes.
