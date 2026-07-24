# CP-5: Guardrail Tests and Verification

## Summary

Added two required guardrail tests that were absent from the mission diff:

1. **Single-path guardrail test** (`test/adapters/single-path-guardrail.test.ts`): Verifies that no module outside the allowed set (concrete read adapters, BoardProjectionBuilder, status.ts) assembles a mission/board/status projection. Confirms that `status.ts` routes through `BoardProjectionBuilder` and that `status-projection.ts` is dead code (not dispatched from `index.ts`).

2. **Repository-wins test** (`test/adapters/repository-wins.test.ts`): Proves that concrete adapters prefer committed integration-base/Git state over any SQLite or board cache. Tests cover `ConcreteMissionReadAdapter` reading from backlog files, store priority (tasks over completed), `ConcreteGitReadAdapter` using explicit repositoryId, `ConcreteGateReadAdapter` returning unknown for missing artifacts, `ConcreteReviewReadAdapter` returning null for missing review state, and `getSourceFacts` reporting `task-markdown` as the source.

Both verification gates (`./scripts/verify-local.sh all` and `./scripts/verify-local.sh static-analysis`) pass.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC10: Single-path guardrail test exists and passes | `test/adapters/single-path-guardrail.test.ts`, `"SC10: status.ts routes mission output through BoardProjectionBuilder (single-path guardrail)"`, `"SC10: no module outside the allowed set assembles a board projection"`, `"SC10: status-projection.ts is dead code (not dispatched from index.ts)"` | PASS |
| SC11: Repository-wins test exists and passes | `test/adapters/repository-wins.test.ts`, `"SC11: ConcreteMissionReadAdapter reads from backlog files (repository authority), not cache"`, `"SC11: ConcreteMissionReadAdapter prefers tasks store over completed store (repository priority)"`, `"SC11: getSourceFacts reports task-markdown as source (repository provenance)"`, `"SC11: ConcreteMissionReadAdapter does not consult SQLite (no cache to lose to)"` | PASS |
| SC11 note: MissionReadAdapter has no SQLite dependency (no cache to lose to) | `src/adapters/backlog/concrete-mission-read-adapter.ts` constructor accepts only `rootDir`/`repositoryId` and parse-primitive fns — no SQLite repos. Agent/OperationLog adapters use SQLite for their respective concerns. | DOCUMENTED |
| SC14: `./scripts/verify-local.sh all` passes | `` `./scripts/verify-local.sh all` `` | PASS |
| SC14: `./scripts/verify-local.sh static-analysis` is clean | `` `./scripts/verify-local.sh static-analysis` `` | PASS |
| All unit tests pass | `npm test` (1137 tests, 0 failures) | PASS |

**Tests:** `npm test -- test/adapters/single-path-guardrail.test.ts` (3 tests, 0 failures), `npm test -- test/adapters/repository-wins.test.ts` (7 tests, 0 failures)

Next action: Ready for integration.
