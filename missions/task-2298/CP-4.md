# CP-4: Final defense audit and gate record

## Summary

Required final gates passed after the selected-root changes. The completed
implementation hardens checkpoint, handoff, review verification, rebase,
integration-gate execution, default test runner, `verify-local` launcher, and
Forgejo publication proof identity. The original mission scope still includes
defense families not yet converted to the selected-root contract (workflow E2E,
real-agent smoke, and hook paths). This checkpoint deliberately records the
remaining work rather than treating passing gates as proof of full coverage.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Audited root-resolution calls are recorded with invalid sites identified | `missions/task-2298/CP-1.md`, `src/platform/runtime/lib/commands/rebase.ts:53` | PARTIAL — the inventory identifies residual defense families still requiring conversion. |
| Selected root is propagated through checkpoint, rebase, and nested integration execution | `src/platform/runtime/lib/commands/checkpoint.ts:30`, `src/platform/runtime/lib/commands/rebase.ts:54`, `src/platform/runtime/lib/commands/integrate.ts:554`, `"checkpoint preserves the selected mission root for verification and Git"` | PASS for the changed families |
| Default runner and verify-local preserve a selected execution root | `test/run-default-tests.js:12`, `scripts/verify-local.sh:33`, `"default test runner preserves an explicitly selected execution root for every child process"` | PASS |
| Handoff and review verification preserve the selected mission root | `src/platform/runtime/lib/commands/handoff.ts:33`, `src/platform/runtime/lib/review/review-commands.ts:617`, `"verifyReview preserves the selected worktree for its verification gate and review state"` | PASS |
| Nested child/root failures are prevented by tests | `"executeIntegrationGates rejects an omitted execution root before launching a child"`, `test/integration-pipelines.test.ts` | PASS for the integration executor; remaining named families are not yet covered. |
| Publication rejects mismatched root, tree, and branch before push | `src/platform/runtime/lib/core/verification.ts:328`, `src/platform/runtime/lib/tools/forgejo.ts:535`, `"createPr rejects a verification proof for a different branch before any push"` | PASS |
| Retained primary-root exception is proof-guarded | `src/platform/runtime/lib/tools/forgejo.ts:886`, `src/platform/runtime/lib/tools/forgejo.ts:898`, `"createPr rejects a verification proof from a different checkout before syncing primary baseline"` | PASS |
| Required general verification gate passed | `./scripts/verify-local.sh all` | PASS — 925 tests passed. |
| Required static-analysis gate passed | `./scripts/verify-local.sh static-analysis` | PASS |

Next action: continue the inventory in CP-1 by converting workflow E2E, real-agent smoke, and hook/pre-push paths, adding two-worktree fixtures for each before requesting lifecycle handoff.
