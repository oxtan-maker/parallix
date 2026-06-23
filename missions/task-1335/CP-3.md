# CP-3: Exact-tree guard implemented

## Summary

This branch adds a repo-owned verification proof that captures the exact checkout, commit, and
tree being published, then re-validates that proof immediately before the publish-side mutation.

### Proof mechanism

- `readPublishedTreeState()` resolves the real checkout path plus `HEAD` commit and tree hash.
  Evidence: `lib/core/verification.js:52-67`.
- `captureVerifiedTreeProof()` runs the configured verification gate, rejects any tree mutation
  that occurs during the run, and emits a proof object containing `rootDir`, `area`, `command`,
  `commit`, `tree`, and `verifiedAt`.
  Evidence: `lib/core/verification.js:69-113`.
- `assertVerifiedTreeProof()` rejects missing proof, different checkout roots, and different
  commit/tree identity.
  Evidence: `lib/core/verification.js:116-131`.

### Publish-path enforcement

- Variant B `integrate` now captures proof after the squash commit and aborts before outward sync
  if the proof cannot be captured or no longer matches the tree being published.
  Evidence: `lib/commands/integrate.js:685-699`.
- Variant A closeout now captures proof after the closeout commit and aborts before
  `git push review <baseBranch|main>` on verification failure or proof mismatch.
  Evidence: `lib/commands/integrate.js:1275-1299`.
- Forgejo PR creation now captures proof before syncing the mirrored primary baseline, and
  `syncPrimaryBaseline()` refuses the force-push unless the proof still matches the current tree.
  Evidence: `lib/tools/forgejo.js:422-439`, `:739-753`.

## Goal Check

| Success criterion | Status | Evidence |
|---|---|---|
| Repo-owned proof captures exact checkout identity | Pass | `lib/core/verification.js:103-112` |
| Guard rejects verification failure before publish mutation | Pass | `lib/commands/integrate.js:689-691`, `:1280-1285`, `lib/tools/forgejo.js:430-431` |
| Guard rejects stale or borrowed proof before publish mutation | Pass | `lib/core/verification.js:124-129`, `lib/commands/integrate.js:695-698`, `:1288-1294`, `lib/tools/forgejo.js:739-742` |
| All three in-scope publish paths share the same exact-tree guard contract | Pass | `integrate.js`, `forgejo.js`, and `verification.js` lines cited above |

## Next action

Tie the guard to regression tests that prove broken or borrowed proof cannot proceed to publish.
