# CP-3 — Deterministic documentation verification

## Summary

Added a focused documentation verifier and connected it to the existing docs
gate. The verifier checks the four live authored surfaces for volatile source
and test-inventory evidence, then validates their relative Markdown links. The
docs gate no longer requires a retired changelog artifact.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Drift checker rejects source and test inventory patterns | `scripts/verify-docs.mjs:24`, `"documentation verifier rejects volatile implementation evidence and broken relative links"` | PASS |
| Drift checker validates relative Markdown links for all four authored surfaces | `scripts/verify-docs.mjs:8`, `scripts/verify-docs.mjs:34` | PASS |
| Documentation gate runs the deterministic verifier | `scripts/verify-local.sh:327` | PASS |
| Retired changelog is not required by the docs gate | `scripts/verify-local.sh:330` | PASS |
| Focused regression tests pass | `npm test -- test/documentation-verification.test.ts` | PASS |

Next action: Update documentation standards and repository guidance so future authored-doc edits preserve the single-source model.
