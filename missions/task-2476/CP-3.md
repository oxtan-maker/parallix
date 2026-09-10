# CP-3 — Verification and handoff story

Replaced numbered happy-path handoff narration with the verification command, a pass outcome, and an explicit independent-review transition. Rebase, NEL, provider-disabled, gatekeeper-success, declaration, proof-hash, and lifecycle bookkeeping remain internal; their warnings and failures still reach the operator.

The demo now seeds a verifier that asserts `hello.sh` prints exactly `Hello, World!`. It runs once against the broken seed (with an expected failure marker) and once after `px active`; the configured command has no `docs` area placeholder, so the greeting change is not presented as documentation verification.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Handoff reports repository verification, result, and independent-review start | `test/handoff-use-case.test.ts`, `"handoff reports repository verification and its result instead of numbered steps"`; `"handoff states that independent review is next"` | PASS |
| Happy-path handoff excludes numbered steps, nested prefixes, proofs, NEL, and lifecycle narration | `test/handoff-use-case.test.ts`, `"handoff never nests one status prefix inside another"`; `"handoff keeps proof hashes and lifecycle bookkeeping out of the operator story"` | PASS |
| Failure, rebase conflict, missing-artifact, and fallback paths stay visible | `src/application/handoff-command-use-case.ts`; `test/handoff-use-case.test.ts`, `"handoff use case blocks the transition when a pre-handoff gate fails"` | PASS |
| Demo verifier tests the displayed greeting rather than unconditionally succeeding | `scripts/record-first-value-demo.sh`; `docs/assets/first-value-demo.cast` | PASS |
| Demo no longer presents `docs` as greeting-verification evidence | `scripts/record-first-value-demo.sh` | PASS |
| Focused handoff suite passes | `npm test -- test/handoff-use-case.test.ts`; `test/handoff-use-case.test.ts` | PASS |
| Real configured-agent replay, raw cast/GIF inspection, red-to-green replay evidence, static analysis, and full gate | `scripts/record-first-value-demo.sh`; `docs/assets/first-value-demo.cast`; `docs/assets/first-value-demo.gif`; `./scripts/verify-local.sh static-analysis`; `./scripts/verify-local.sh all` | PENDING CP-4 |

Next action: Run the real isolated demo, inspect the resulting cast and GIF, repair every in-scope finding, then complete the declared gates.
