# CP-7: Resolve review round 1 findings (F1–F7)

Round 1 review requested changes, and the operator asked to reuse the task-2510
implementation of one-commit version allocation. The built-in
`allocateLocalReleaseVersion` step in `px integrate` is replaced by task-2510's
repository-scoped `adapters.integrate.preCommitCommand` hook. The hook runs in
the mission worktree after the integration rebase and before the gates. Parallix
wires `scripts/bump-version.sh` there. The hook code, schema, config validation,
and tests match the `mission/task-2510` branch byte for byte. Rebasing task-2510
onto this mission should only need conflict resolution in
`scripts/refresh-global-px.sh` and its test, which both missions edited
differently. The release script
fixes cover gh authentication, the tagger identity, and npm error classification.

Findings disposition:

- F1 (unconditional `npm version` in every repo): fixed. Allocation now happens
  only when a repository configures `adapters.integrate.preCommitCommand`.
- F2 (no `GH_TOKEN` for `gh`): fixed. The release step sets `GH_TOKEN: ${{ github.token }}`.
- F3 (annotated tag needs a tagger identity): fixed. A lightweight tag at the
  trusted SHA needs no identity.
- F4 (npm lookup errors read as "absent"): fixed. Only E404 means absent. Any
  other `npm view` failure, and any `gh release view` failure other than "not
  found", now fails closed.
- F5 (abort leaves a staged bump in the base checkout): fixed. The bump is
  committed on the mission branch before the gates, and the base checkout is
  never touched. A retry keeps the already-allocated newer version.
- F6 (no executable coverage): fixed. There are now real git allocation tests,
  an e2e squash test, unit tests for the hook wrapper, and a full
  publish/tag/release flow test.
- F7 (allocation gated on a test env flag): fixed. The flag no longer affects
  allocation, and the `PARALLIX_TEST_ALLOW_INTEGRATION_GATE_BYPASS` lines this
  mission added to the task-2377.05 and task-2506 tests are removed.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC1 one mission commit with matching metadata | `test/task-2509-local-version-allocation.test.ts`, tests `task-2509: local allocation lands matching package metadata in the one mission commit`, `task-2509: local allocation never moves a stale mission version backwards`; `test/e2e-mission-lifecycle.test.ts`, test `pre-commit hook changes land inside the mission squash commit, not a follow-up commit (task-2510)` | PASS |
| F1/F7 allocation is repository-scoped configuration | `test/refresh-global-px-script.test.ts`, test `workflow.config.json wires local version allocation as the integrate pre-commit hook`; `test/post-integrate-hook.test.ts`, test `runPreCommitHook resolves the pre-commit command from the base worktree` | PASS |
| F5 hook failure aborts before gates, no stray commit | `test/integrate.test.ts`, tests `runPreCommitHookOrAbort aborts before the integration gates when the hook fails (task-2510)`, `runPreCommitHookOrAbort commits only the tracked files the hook modified onto the mission branch (task-2510)` | PASS |
| F2/F3 release flow tags and creates the release | `test/task-2509-release-publish.test.ts`, test `task-2509: release flow publishes, tags, and creates the matching release`; `test/task-2509-release-workflow.test.ts` | PASS |
| Rerun reuses an existing GitHub Release by its verified tag, not `targetCommitish` (codex review) | `test/task-2509-release-publish.test.ts`, test `task-2509: rerun reuses the existing GitHub Release by its verified tag` | PASS |
| F4 npm lookup errors fail closed | `test/task-2509-release-publish.test.ts`, test `task-2509: npm lookup errors fail closed` | PASS |
| SC9 docs describe the hook-based allocation | ADR 0046, `docs/config.md` | PASS |
| SC10 final gates | `./scripts/verify-local.sh all` (2599 pass, 0 fail), `./scripts/verify-local.sh static-analysis`, `./scripts/verify-local.sh docs` | PASS |

Next action: Return task-2509 to review. After it integrates, rebase `mission/task-2510` onto main. Its duplicated pre-commit-hook changes should drop out, leaving only its operator trust-configuration checkpoints.
