# CP-2: Propagate selected roots through local defenses

## Summary

Checkpoint, rebase, and the reusable integration-gate executor now select a
mission root once and pass it explicitly to verification, Git, state checks,
task lookup, and publication. The integration-gate executor fails closed if a
caller omits the root, rather than silently using the primary checkout.

Focused tests use injected/mocked process seams only; they do not launch an
agent, contact Forgejo, or execute a recursive CLI command.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Checkpoint verification and Git use the selected mission root | `src/platform/runtime/lib/commands/checkpoint.ts:30`, `src/platform/runtime/lib/commands/checkpoint.ts:43`, `src/platform/runtime/lib/commands/checkpoint.ts:52`, `"checkpoint preserves the selected mission root for verification and Git"` | PASS |
| Rebase preserves the selected root through state, Git, task lookup, and publication | `src/platform/runtime/lib/commands/rebase.ts:53`, `src/platform/runtime/lib/commands/rebase.ts:85`, `src/platform/runtime/lib/commands/rebase.ts:101`, `"rebase uses the selected mission root for rebase state, Git, and publication"` | PASS |
| Nested integration runner cannot fall back to primary checkout | `src/platform/runtime/lib/commands/integrate.ts:554`, `"executeIntegrationGates rejects an omitted execution root before launching a child"` | PASS |
| Focused root-propagation regression tests pass | `npm test -- test/task-1268-checkpoint-no-gate.test.ts test/rebase_hardening.test.ts` | PASS |
| Type checking passes for the changed runtime code | `npm run typecheck` | PASS |

Next action: harden Forgejo proof/publication mismatch rejection and document the narrowly retained primary-baseline synchronization exception with independent no-push tests.
