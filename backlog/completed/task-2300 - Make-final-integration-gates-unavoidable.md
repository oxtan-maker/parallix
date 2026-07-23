---
id: TASK-2300
title: Make final integration gates unavoidable
status: done
assignee:
  - '@codex'
created_date: '2026-07-23 09:49'
updated_date: '2026-07-23 10:29'
labels:
  - ai_sdlc
dependencies: []
ordinal: 52000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Commit 6f401e34a changed rebase Git arguments to include -C <executionRoot>, but existing rebase test mocks still assumed the subcommand was args[0]. The failing tests were classified as integration tests, while the mission’s recorded verification ran only ./scripts/verify-local.sh all and static analysis.

  Task 2292 had already added an unconditional integration-suite gate, but task 2298’s integration record does not prove that gate ran against the final mission worktree. The repository also contains both legacy lib/ and canonical src/platform/runtime/ command paths, creating risk that the hook fix and executed runtime diverge.

  ## Requirements

  - Make px integrate fail closed unless the configured integration gates execute on the final mission worktree when parallix develops itself
 - ensure not hardcodings on when parallix develops itself is in the general product
  - Ensure npm run test:integration runs against the selected mission root, including:
      - cwd
      - PARALLIX_EXECUTION_ROOT
      - build output
      - test-runtime generation
      - test discovery
      - nested child processes

  - Ensure the canonical src/ runtime and any packaged/legacy runtime cannot disagree about integration-gate behavior.
  - Remove or clearly isolate stale duplicate command implementations.
  - Preserve the unconditional integration-suite gate for all mission integrations, including docs-only and unclassified diffs.
  - Reject --no-integration-gates during real integration, or require an explicit auditable emergency override that records the reason and prevents merge by default.
  - Add an integration-level test proving that a failing npm run test:integration stops before squash merge, branch deletion, backlog closeout, or post-integrate version bump.
  - Add a test proving the gate command executes in the selected mission worktree rather than the operator/primary checkout.
  - Add a test proving the final gate runs after the mission tree is finalized and before integration side effects begin.
  - Update the mission handoff/checkpoint contract so ./scripts/verify-local.sh integrate is mandatory whenever a mission is integrated; all alone is insufficient.
  - Fix the rebase test mocks to normalize -C <root> arguments and make the following tests pass:
      - rebase caps failed continue retries when rebase remains active
      - rebase reports git output on failed continue attempt

  - Audit nearby Git mocks for the same stale args[0]/args[1] assumptions.
  - Keep all tests hermetic: mock Git, Forgejo, agents, and recursive CLI calls; do not contact real services.

  ## Acceptance criteria

  - A deliberately failing integration-suite fixture prevents every integration side effect.
  - The failure output identifies the failed gate and mission slug.
  - The gate records the exact execution root and final commit/tree identity.
  - A wrong-root execution is detected and fails closed.
  - px integrate cannot complete successfully without the unconditional integration suite.
  - Canonical and packaged CLI entrypoints select the same gate plan and runtime behavior.
  - The two reported rebase tests pass.
  - ./scripts/verify-local.sh all passes.
  - ./scripts/verify-local.sh static-analysis passes.
  - ./scripts/verify-local.sh integrate passes on the final committed tree.
  - Checkpoint evidence records the exact integration command, selected root, commit identity, gate plan, and proof that no merge/closeout side effect occurred after a failed gate.
<!-- SECTION:DESCRIPTION:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Keep the lifecycle E2E fixture language-neutral: no package manifest, package-manager executable, or npm bypass.
2. Make final integration-tree capture validate the selected clean Git worktree and commit/tree identity without inferring project type.
3. Remove the generic unconditional pre-proof build; repository-specific build/release work remains exclusively in configured verification/integration hooks (Parallix uses its own config and refresh script).
4. Verify the lifecycle suite, integrate unit suite, full fast verifier, static analysis, diff hygiene, and refresh graphify output.
5. Return TASK-2300 to ready-for-integration for the mandatory final-tree integration gate.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Integration rerun exposed four lifecycle scenarios still invoking `px integrate --no-integration-gates`. The canonical runtime now correctly rejects that bypass. Graph/query and source inspection show the fixture also needs a committed `package.json` so final-tree capture recognizes it as a valid Parallix checkout; its existing `adapters.verification.command = ':'` provides the fast hermetic passing gate, while SC4 replaces that command with `exit 7`.

User rejected package-manager assumptions in tests and clarified that Parallix targets arbitrary languages. Revised approach removes the npm/package.json fixture workaround and moves build refresh behind explicit repository configuration.

Implemented the language-neutral correction. `captureFinalIntegrationTree` now checks existence, Git cleanliness, and commit/tree identity without requiring package.json. Removed `buildBeforeVerification`, its unconditional npm process launch, and npm-specific unit cases. The lifecycle fixture now commits review artifacts/config changes to model a finalized tree and calls plain `px integrate`; it contains no npm or package.json assumptions. Parallix-specific build/release behavior remains in repository-owned configuration and `scripts/refresh-global-px.sh`. Verification: lifecycle E2E 6/6; integrate unit 63/63; `./scripts/verify-local.sh all` 883/883; static-analysis all stages passed; `git diff --check` clean; `graphify update .` completed.
<!-- SECTION:NOTES:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 Verification gate ran and passed on the final tree with captured proof rather than an unverified claim
- [x] #2 Lint and static analysis report clean on every changed file
- [x] #3 No focused or unannotated skipped tests were introduced (no .only and no bare .skip)
- [ ] #4 Final checkpoint Goal Check table cites real evidence using file:line references and test names
- [ ] #5 Docs updated to reflect any workflow or user-facing behavior change
- [ ] #6 Bug-labeled missions include a red-to-green reproduction test that fails before the fix and passes after
<!-- DOD:END -->
