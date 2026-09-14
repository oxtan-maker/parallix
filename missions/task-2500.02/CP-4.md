# Checkpoint 4 — Publication engine: contiguous advancement + out-of-order

## Summary
Implemented `GithubPublishEngine.advanceMain`: it walks the ahead-commits from
`origin/main` and advances only through the highest contiguous run of
`externally verified` commits that are the direct next unpublished descendants,
via fast-forward (`git update-ref` on local `main` then the tracked remote ref).
A non-verified commit stops the run; a failed verification sets `failClosed`.
Out-of-order completion is handled: verified commits behind an unverified one do
not advance; once the gap commit verifies, the whole contiguous run advances in
order. This enforces the invariant `P -> A -> B -> C -> D` with
`A ✅ B ✅ C ❌ D ✅` may advance through B but must not skip C.

Delivered:
- `src/application/github-publish/publication-engine.ts` — `advanceMain`,
  `_nextUnpublishedInRun`, `AdvanceResult`.
- `src/adapters/git/github-publish-git.ts` — `aheadCommits`, `isDescendant`,
  `fastForward`, `updateRemoteTrackingRef`.
- `test/github-publish.test.ts` — out-of-order and failed-blocks-later tests.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Contiguous advancement only (AC #1) | `test/github-publish.test.ts`, `"exact integration SHA preserved through verification ref and publication"` advances `origin/main` to `A` only | PASS |
| Out-of-order completion never skips (AC #2) | `test/github-publish.test.ts`, `"out-of-order verification advances in order without skipping"` | PASS |
| Failed earlier blocks later (AC #3) | `test/github-publish.test.ts`, `"failed earlier verification blocks later commits"` | PASS |
| Fail-closed on gap/failure | `src/application/github-publish/publication-engine.ts`, `advanceMain` `failClosed`, `blockedBy` | PASS |

## Next action
Add fetch safety and fail-closed divergence on unexpected remote movement (CP-5).
