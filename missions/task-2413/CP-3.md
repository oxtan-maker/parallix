# CP-3 — Publication seam: structured gate failure end-to-end

Revalidated on 2026-08-25 with
`npm test -- test/task-2413-publication-seam.test.ts test/task-2413-repro.test.ts`.
CP-4 records the final bounded-buffer and typed-failure behavior and supersedes
interim wording below.

## Summary

Closed the end-to-end loop for the task-2373.01 failure class. The remaining gap
was that `captureVerifiedTreeProof` (the publication verifier) ran the gate with
`stdio: 'inherit'`, so a failing verifier's stdout/stderr streamed to the console
and were discarded from the returned error — the same information loss as the
exit-code-only wrapper, just one layer earlier.

Fix (`src/adapters/verification/verification.ts`): `captureVerifiedTreeProof` now
runs the gate with `stdio: 'pipe'` and attaches bounded `stdout`/`stderr` to the
structured gate failure. `createPr` already propagates `proofResult.error`
unchanged, and the handoff use case already wraps it, so the captured diagnostic
now reaches the implementer instead of vanishing.

The same checkpoint also migrated the remaining recovery consumers to the
central rebound policy. `test/review.test.ts` covers reviewer and implementer
timeout recovery through `rebound()`, including the retained artifact-infra
diagnostic path; `test/repair-handoff.test.ts` covers `buildRelaunchPrompt` as
a compatibility delegate to `buildReboundFixPrompt`. The legacy
`repair-handoff.ts` seam now supplies stage-specific facts and remedy slots
rather than independently classifying, budgeting, or constructing recovery
prompts.

Evidence: `test/task-2413-publication-seam.test.ts` drives the REAL
`captureVerifiedTreeProof` through the REAL `createPr` seam against a temp Git
repo with a failing, output-emitting verification command, and asserts the
captured stdout/stderr and exit code survive in `createPr.error`.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Publication verifier failure preserves captured stdout/stderr + exit code | `test/task-2413-publication-seam.test.ts`, `"task-2413: publication verifier failure carries captured output through createPr"` | PASS |
| Structured gate failure propagates through the whole handoff→publication seam | `test/task-2413-publication-seam.test.ts`, `"task-2413: an exit-code-only wrapper string still propagates without crashing createPr"` | PASS |
| Handoff already fails closed with captured gate output on final gate | `test/handoff-use-case.test.ts`, `"handoff use case fails closed when the final verification gate fails"` | PASS |
| Proof-reuse/invalidation pinned | `test/task-2413-proof-reuse.test.ts`, `"task-2413: a stale/mismatched proof cannot authorize publication"` | PASS |
| Timeout consumers use the shared recovery authority | `test/review.test.ts`, `"startReviewLoop preserves an implementer artifact infrastructure failure during timeout recovery"` | PASS |
| Legacy repair seam delegates recovery policy | `test/repair-handoff.test.ts`, `"buildRelaunchPrompt is a compatibility delegate to the evidence-preserving rebound prompt"` | PASS |
| Full default suite green | `./scripts/verify-local.sh all` → 2149 pass, 0 fail | PASS |

Run: `node --experimental-test-module-mocks --import tsx --test test/task-2413-publication-seam.test.ts`

## Next action

Re-run the focused recovery suite after review feedback, then hand the committed
review response back to the active reviewer.
