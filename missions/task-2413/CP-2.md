# CP-2 — Structured recovery + proof reuse

Revalidated on 2026-08-25 with
`npm test -- test/task-2413-proof-reuse.test.ts test/task-2413-repro.test.ts`.
The final proof format and publication-consumption behavior are recorded in
CP-4; those final facts supersede interim wording below.

## Summary

Implemented and covered the two highest-signal fixes from the mission without a
broad refactor:

1. **Structured root-failure preservation** — `captureVerifiedTreeProof`
   (`src/adapters/verification/verification.ts`) now returns the exact `exitCode`,
   `command`, `cwd`, and bounded `stdout`/`stderr` on a verification failure, not
   an exit-code-only string. This is the root of the task-2373.01 information
   loss; the outer Forgejo wrapper is now presentation only.

2. **Verification-proof reuse / invalidation** — the identity mechanism
   (`createVerificationProofIdentity` / `readReusableVerificationProof` /
   `writeReusableVerificationProof` / `assertVerifiedTreeProof`) already fails
   closed on any of: dirty worktree, changed command, changed tracked-input
   fingerprint, changed toolchain, or mismatched HEAD/tree. CP-2 pins these with
   dedicated tests so a stale or mismatched proof can never authorize
   publication.

3. **Fresh-failure reclassification** — `classifyReboundReason` reclassifies a
   gate failure from its own diagnostic: a deterministic gate failure stays
   `GateFailure` (auto send-back); when the same gate now fails under a named
   infrastructure condition it is reclassified `InfraBlocker` (human-only)
   rather than continuing under the prior class.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Structured root failure preserved (command/cwd/exit/output) | `test/task-2413-repro.test.ts`, `"task-2413: publication verifier failure preserves the structured root failure"` | PASS |
| Deterministic failure not masked as pass | `test/task-2413-repro.test.ts`, `"task-2413: a deterministic gate failure is not masked as a transient/no-output pass"` | PASS |
| Changed failure freshly reclassified | `test/task-2413-repro.test.ts`, `"task-2413: a materially changed failure is reclassified from its own evidence, not the prior class"` | PASS |
| Unchanged tree/command/toolchain reuses proof | `test/task-2413-proof-reuse.test.ts`, `"task-2413: unchanged tree/command/toolchain reuses authoritative proof without re-verification"` | PASS |
| Changed HEAD/tree invalidates reuse | `test/task-2413-proof-reuse.test.ts`, `"task-2413: changing HEAD/tree invalidates proof reuse"` | PASS |
| Changed command invalidates reuse | `test/task-2413-proof-reuse.test.ts`, `"task-2413: changing the verification command invalidates proof reuse"` | PASS |
| Stale/mismatched proof cannot authorize publication | `test/task-2413-proof-reuse.test.ts`, `"task-2413: a stale/mismatched proof cannot authorize publication"` | PASS |
| Dirty worktree cannot issue a proof (fails closed) | `test/task-2413-proof-reuse.test.ts`, `"task-2413: a dirty worktree cannot issue a reusable proof (fails closed)"` | PASS |

Run: `node --experimental-test-module-mocks --import tsx --test test/task-2413-repro.test.ts test/task-2413-proof-reuse.test.ts`

## Next action

CP-3: migrate review-loop timeout relaunch and repair-handoff duplicate-prompt
seam to the central rebound authority; thin handoff gatekeeper nested-budget;
add consumer-migration tests.
