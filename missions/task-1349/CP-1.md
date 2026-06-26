# CP-1: Identified exact code location where existing-PR path diverges

## Work Done

Analyzed `lib/tools/forgejo.js` `createPr` function (lines 378-516) to map the control flow:

1. **Lines 429-432**: Verification proof captured via `captureVerifiedTreeProofFn`
2. **Lines 435-442**: `syncPrimaryBaseline` called with proof, assertion, and gitRunner — applies to ALL code paths
3. **Lines 444-481**: Branch push to Forgejo via authenticated URL
4. **Lines 484-499**: Existing-PR detection path — `resolvePrAccess` at line 484, early return at lines 492-499 if open PR found

**Finding**: `syncPrimaryBaseline` is invoked at lines 435-442, BEFORE the branch push at line 456 and BEFORE the existing-PR check at line 484. The existing-PR path (lines 492-499) returns early at line 497, but the baseline sync has already completed. Both the PR-creation path and the existing-PR update path share this single `syncPrimaryBaseline` invocation — no separate inline force-push exists on the existing-PR path.

## Goal Check

| Criterion | Evidence | Status |
|-----------|----------|--------|
| CP-1: Identified exact code location of divergence | forgejo.js:492-499 (existing-PR early return after resolvePrAccess at line 484) | PASS |
| CP-1: Confirmed syncPrimaryBaseline coverage on existing-PR path | forgejo.js:435-442 (sync called before branch push at line 456 and before PR check at line 484) | PASS |

## Next action: CP-2 — Verify both paths share single sync invocation (no separate inline force-push)
