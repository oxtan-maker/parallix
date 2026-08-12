# CP-3: Regression Tests and Verification Gate

## Summary

Added 27 focused regression tests in `test/review-artifact-dispatcher.test.ts` covering all scoped artifact categories, per-role retry independence, retry exhaustion to stranded state, in-memory state sync, infrastructure-failure classification, and HumanOnly failure isolation. All tests use mocked dependencies — no real Forgejo access or agent execution. Static analysis gate passes.

### Test Inventory

| Test | Coverage |
|---|---|
| `consumeReviewerArtifacts returns diagnostic when findings are missing` | Reviewer findings absent -> diagnostic includes "findings" |
| `consumeReviewerArtifacts returns diagnostic when outcome is missing` | Reviewer outcome absent -> diagnostic includes "outcome" |
| `consumeReviewerArtifacts returns diagnostic when verdict is missing` | Reviewer verdict absent -> diagnostic includes "verdict" |
| `consumeReviewerArtifacts returns diagnostic when persist fails` | Reviewer persist failure -> diagnostic includes "persist" |
| `consumeImplementerArtifacts returns diagnostic when round-resolution is missing` | Implementer resolution absent -> diagnostic includes "round-resolution" |
| `consumeImplementerArtifacts returns diagnostic when disposition is missing` | Implementer disposition absent -> diagnostic includes "disposition" |
| `consumeImplementerArtifacts returns diagnostic when persist fails` | Implementer persist failure -> diagnostic includes "persist" |
| `dispatchArtifactFailure returns relaunch for reviewer on first failure` | Reviewer retry 1 -> relaunch, counter = 1 |
| `dispatchArtifactFailure returns strand for reviewer after max retries` | Reviewer retry 2 exhausted -> strand, strandedAt/strandReason set |
| `dispatchArtifactFailure returns relaunch for implementer on first failure` | Implementer retry 1 -> relaunch, counter = 1 |
| `dispatchArtifactFailure returns strand for implementer after max retries` | Implementer retry 2 exhausted -> strand, strandedAt/strandReason set |
| `reviewer and implementer artifact retry counters are independent` | Reviewer at 1, implementer exhausts at 2, reviewer still relaunches at 2 |
| `stranded state records actionable metadata for reviewer` | reviewerArtifactStrandedAt and reviewerArtifactStrandReason set |
| `stranded state records actionable metadata for implementer` | implementerArtifactStrandedAt and implementerArtifactStrandReason set |
| `dispatchArtifactFailure uses separate metadata keys from gate retry counters` | gateFailureRetryCount unchanged when artifact counter increments |
| `dispatchArtifactFailure handles null persisted state` | Creates new state with counter on first call |
| `dispatchArtifactFailure respects custom maxRetries` | maxRetries=5, counter at 4 -> relaunch to 5 |
| `isArtifactInfraDiagnostic identifies post-failure diagnostics as infra` | "post failed" diagnostics -> true (Forgejo/network failures) |
| `isArtifactInfraDiagnostic identifies persist-failure diagnostics as infra` | "persist failed" diagnostics -> true (storage failures) |
| `isArtifactInfraDiagnostic returns false for artifact production failures` | "incomplete: missing" diagnostics -> false (agent's fault) |
| `isArtifactInfraDiagnostic handles null/undefined/empty` | Null/empty inputs -> false |
| `dispatchArtifactFailure syncs retry count into in-memory state on relaunch` | In-memory state.metadata counter matches disk after dispatch |
| `dispatchArtifactFailure syncs strand markers into in-memory state` | strandedAt/strandReason synced to both in-memory and disk state |
| `dispatchArtifactFailure returns metadata in result` | Result.metadata present with correct counter |
| `isArtifactInfraDiagnostic gates infra failures from artifact dispatcher` | All 6 infra diagnostics -> true; all 4 artifact diagnostics -> false |
| `dispatchArtifactFailure skips state sync when state is null` | No crash, dispatch proceeds normally |
| `dispatchArtifactFailure skips state sync when state has no metadata` | No crash, dispatch proceeds normally |

### Verification Gate

`./scripts/verify-local.sh static-analysis` — ESLint, tsc typecheck, test-hygiene, test typecheck: ALL PASSED.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Missing/malformed reviewer artifacts produce diagnostic and select reviewer relaunch | `test/review-artifact-dispatcher.test.ts`: "returns diagnostic when findings/outcome/verdict are missing"; "returns relaunch for reviewer on first failure" | PASS |
| Missing/malformed implementer artifacts produce diagnostic and select implementer relaunch | `test/review-artifact-dispatcher.test.ts`: "returns diagnostic when round-resolution/disposition is missing"; "returns relaunch for implementer on first failure" | PASS |
| Separate persisted counters per role | `test/review-artifact-dispatcher.test.ts`: "reviewer and implementer artifact retry counters are independent" — reviewer at 1, implementer exhausts, reviewer still relaunches | PASS |
| Retry exhaustion strands with actionable state | `test/review-artifact-dispatcher.test.ts`: "returns strand for reviewer/implementer after max retries"; "stranded state records actionable metadata"; "syncs strand markers into in-memory state" — strandedAt + strandReason verified in both disk and in-memory state | PASS |
| HumanOnly (infra/gate) failures remain terminal | `test/review-artifact-dispatcher.test.ts`: "isArtifactInfraDiagnostic identifies post-failure diagnostics as infra" and "identifies persist-failure diagnostics as infra" — verifies Forgejo/network/storage failures classified as infra (HumanOnly); "gates infra failures from artifact dispatcher" — 6 infra diagnostics excluded from relaunch, 4 artifact diagnostics routed to dispatcher | PASS |
| Static analysis passes | `./scripts/verify-local.sh static-analysis` — ESLint, tsc, test-hygiene, test typecheck all PASS | PASS |

## Next Action

All 3 checkpoints complete. Run mission gate `./scripts/verify-local.sh all` and update backlog task.
