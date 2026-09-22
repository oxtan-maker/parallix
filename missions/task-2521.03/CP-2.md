# CP-2: Write-surface verification

## Summary

The production CLI is exercised against isolated SQLite state. The test proves
context updates preserve a versioned write boundary, checkpoint evidence is
persisted through the application service, assignments and dependencies mutate
through named operations, and review decisions/resolutions preserve review
domain rules. This is an implementation checkpoint, not proof that all legacy
file consumers have been retired.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Structured context update and re-read work through the production command graph | `test/task-2521-03-context-cli.integration.test.ts` | PASS |
| Stale writes fail closed | `"expected version 1, found 2"` (`test/task-2521-03-context-cli.integration.test.ts`) | PASS |
| Malformed Goal Check evidence fails before persistence | `test/task-2521-03-context-cli.integration.test.ts` | PASS |
| Review decision actor is explicit and review resolution remains versioned | `test/task-2521-03-review-write.test.ts`, `test/task-2521-03-context-cli.integration.test.ts` | PASS |
| One-Mission synthetic flow reaches review start, decision, resolution, then context reread | `test/task-2521-03-context-cli.integration.test.ts` | PASS |
| Mission-4 task-provider command contract is explicit and remains outside Mission CRUD | `test/task-2521-03-mutation-parity.test.ts` | PASS |

Next action: add lifecycle-invalid-write coverage, then migrate the runtime
consumers and prompts that still rely on repository workflow artifacts.
