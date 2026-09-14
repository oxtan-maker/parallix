# CP-1 — integration seams

`github-pr` is already a validated integration mode. Its dispatcher allows local
preparation, gates, candidate production, and PR submission, rejects local
publish, and currently fails closed while external observation has no provider
adapter. `px integrate` performs its local squash/closeout only inside the
`publish` operation, so the GitHub path must replace that operation with
submit-or-observe behavior and persist the expected PR/base/candidate facts.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Direct-to-`main` GitHub PR is submitted and externally observed before completion | `test/task-2500-integrate-mode-dispatch.test.ts`; `src/application/services/integration-dispatch.ts` | PENDING CP-2 |
| Configured feature-branch target is observed without requiring `main` | `src/adapters/cli/commands/integrate.ts`; `resolveMissionBaseBranch` | PENDING CP-2 |
| Pending PR remains incomplete | `src/domain/integration.ts`; `integrationClosureBlocker` | PENDING CP-2 |
| External merge completes only on fresh provider evidence | `src/application/mission-integration-service.ts`; `MissionIntegrationService` | PENDING CP-2 |
| Closed-unmerged PR has a recoverable non-success state | `src/application/services/integration-dispatch.ts` | PENDING CP-2 |
| Squash/rebase SHA differences require relationship or tree evidence | `src/domain/integration.ts`; `IntegrationEvidence` | PENDING CP-2 |
| Changed target/base and unavailable GitHub are explicit non-success states | `src/application/services/integration-dispatch.ts` | PENDING CP-2 |
| Local ref movement cannot prematurely close a `github-pr` mission | `test/task-2500-integrate-mode-dispatch.test.ts` | PASS (local `publish` is refused) |

Next action: add focused provider-observation tests for every acceptance scenario before implementing the GitHub adapter.
