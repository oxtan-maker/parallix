# Mission: Sync Forgejo pull-request updates between agent rounds (task-2240)

## Goal
Ensure that, once Forgejo integration is activated, the mission workflow pushes each round's committed source changes to the mission pull request before the next round begins, so a human reviewer sees the current diff without manually updating the pull request.

## Why Now
Agent rounds can exchange and commit source changes locally while the associated Forgejo pull request remains unchanged. This leaves final human review looking at a stale or empty diff and requires a manual update, defeating the purpose of activated Forgejo review.

## Refinement Signals
- Predicted NEL bucket: Small (0–80)
- Confidence: High
- Selection note: The reported pull request demonstrates a bounded workflow regression: the between-round synchronization path is missing or bypassed after Forgejo activation.
- Main drivers: Forgejo activation state, round-transition orchestration, mission-branch commits, remote push/update behavior, and regression coverage.

## Scope
- Trace the Forgejo-enabled mission-round lifecycle to identify where commits made during a completed round should be pushed to the mission pull request.
- Add a regression test under `test/` that creates the activated-Forgejo, multi-round scenario and proves the pull request receives the first round's source commit before the second round starts.
- Correct the responsible workflow/orchestration path so each eligible completed round synchronizes committed mission-branch changes to Forgejo.
- Preserve existing behavior when Forgejo is not activated and when a round has no new committed source changes.

Reproduction-Test: test/forgejo-pr-round-sync.test.js

## Out of Scope
- Changing Forgejo server configuration, credentials, webhook behavior, or pull-request UI rendering.
- Rewriting historical pull requests or backfilling commits that were not synchronized before this fix.
- Changing agent dialogue, reviewer workflow, mission status transitions, or unrelated Git remote synchronization.
- Adding new Forgejo features beyond keeping the existing mission pull request current between rounds.

## Success Criteria
> **Falsifiability rule (ADR 0039 Part 2):** Each criterion must be falsifiable. Forbidden: subjective adjectives ("easy, fast, simple, intuitive, user-friendly, responsive, quick, efficient" without an attached metric) and vague quantifiers ("multiple, several, some, many, few, various"). For refactor / condense / migration missions, the criterion must enumerate the specific elements (rules, files, behaviours) that must survive — generic phrases like "preserve critical content" are not sufficient.

- SC1: `test/forgejo-pr-round-sync.test.js` contains a reproduction test that fails at the mission parent commit because the Forgejo pull request does not contain the round-one committed source change before round two begins, and passes after the fix.
- SC2: With Forgejo activated, a mission that completes round one with a committed source change has that commit pushed to the mission pull-request branch before round two starts; the regression test asserts the pull request's branch/ref contains the round-one commit or changed file content at that boundary.
- SC3: A second completed round with a committed source change updates the same mission pull request rather than creating a replacement pull request; the regression test asserts one pull-request identity and both round commits on its branch/ref.
- SC4: A Forgejo-inactive mission and an activated-Forgejo round with no committed source change do not attempt the Forgejo pull-request update path; focused automated coverage asserts those two conditions.
- SC5: The final implementation introduces no focused or unannotated skipped tests and passes `./scripts/verify-local.sh all`.

## Risks and Assumptions
- Assumption: an activated Forgejo mission already has a stable mission branch and pull-request identity that the workflow can update.
- Assumption: the test harness can observe branch/ref contents or the relevant Forgejo client call at the round boundary without contacting a live Forgejo server.
- Risk: pushing before the round's commit is finalized could publish an incomplete tree; synchronize only after the workflow's existing successful commit boundary.
- Risk: retry/error handling may make an update call observable more than once; preserve the repository's existing retry semantics and assert final remote state rather than a brittle call count unless the contract explicitly guarantees one call.
- Risk: a broad change to shared Git synchronization could alter non-Forgejo workflows; keep the trigger explicitly gated by activated Forgejo state.

## Checkpoints
- CP 1: Lock the regression before any production fix. Add `test/forgejo-pr-round-sync.test.js` with an activated-Forgejo mission that completes round one, commits a known source change, reaches the round-two start boundary, and asserts the mission pull-request branch/ref already contains that commit or change. Record that it is red at the mission parent commit and will be green after the fix.
- CP 2: Map the round completion, commit-finalization, and Forgejo pull-request update path; implement the smallest activated-Forgejo-only synchronization change after the existing successful commit boundary. Add or extend coverage for round two updating the same pull request and for the inactive/no-change guards.
- CP 3: Run the required verifier, inspect the final diff for scope and test-hygiene compliance, and write the checkpoint handoff with evidence for every success criterion.

### Checkpoint Documentation Requirements
Every checkpoint document (`CP-N.md`) MUST include a concise summary of completed work, then the exact heading `## Goal Check` followed by this exact 3-column table header:

| Criterion | Evidence | Status |
|---|---|---|

Include at least one evidence row for every Success Criterion. Accepted evidence forms Parallix already verifies are:
  1. **File:line references** — e.g., `lib/commands/handoff.ts:292` (must point to an existing file and line)
  2. **Test names** — e.g., `"real custom-agent launcher smoke: full lifecycle with hello-world task (SC3/SC4/SC5/SC6/SC7)"` (must match a test name in the repo)
  3. **Test file paths** — e.g., `test/e2e-real-agent-smoke.test.js` (must be an existing test file)
  4. **ADR references** — e.g., `ADR 0048` (must correspond to an existing file under `docs/adr/`)
  5. **Recognized repo commands or paths** — e.g., `` `npm ...` ``, `` `node ...` ``, `` `git ...` ``, `` `px ...` ``, or `` `./...` `` commands/paths, including `./scripts/verify-local.sh all`

Raw `stat`/`ls` output or generic prose alone is not sufficient evidence. It may be supplemental only when paired with an accepted file:line reference, exact test name, ADR reference, test file path, or recognized repository command/path. End each checkpoint with a concrete `Next action:` line that names the remaining action or confirms the next workflow handoff.

## Gates
- [ ] ./scripts/verify-local.sh all

## Restricted Areas
- Do not change Forgejo credentials, server settings, webhooks, or external Forgejo data.
- Do not alter mission status transitions, review/integration commands, or generic Git synchronization unless the change is required for the activated-Forgejo round-update path.
- Do not modify files outside the identified workflow implementation, its directly related tests, and documentation that accurately describes the changed behavior.
- Do not add a live-network Forgejo dependency to automated tests; use the repository's existing test doubles or local harness patterns.

## Stop Rules
- Stop and request direction if the fix requires changing Forgejo server configuration, credentials, permissions, or an external pull request outside the mission branch.
- Stop and request direction if reproducing the issue requires a live Forgejo instance rather than a repository-supported local test seam.
- Stop and request direction if the proposed correction must change inactive-Forgejo behavior, mission lifecycle semantics, or shared Git behavior beyond the round-to-pull-request synchronization path.
- Stop and request direction if the reproduction test cannot be made red at the mission parent commit; document the observed behavior and identify the missing test seam instead of writing an unproven fix.
