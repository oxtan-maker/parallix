# Checkpoint 5 — Fetch safety and fail-closed divergence

## Summary
Added fetch safety and fail-closed behavior when `origin/main` moves unexpectedly.
`advanceMain` re-reads `origin/main` and fails closed if it moved between the
expected-ancestor check and the push (`remote-moved`), and refuses to advance if
the verified tip is no longer a descendant of `origin/main` (`divergence`).
`GitRepositoryPort.fetch` surfaces remote movement so the engine can detect a
non-fast-forward situation. Local history is never rewritten on fetch — the
engine only fast-forwards `main`, never resets it.

Delivered:
- `src/application/github-publish/publication-engine.ts` — re-read guard,
  `isDescendant` check, `GithubPublishError` reasons `remote-moved`, `divergence`.
- `src/adapters/git/github-publish-git.ts` — `fetch`, `isDescendant`.
- `test/github-publish.test.ts` — fetch and unexpected-movement tests.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Fetch does not rewrite local history (AC #4) | `test/github-publish.test.ts`, `"fetching updated origin/main does not rewrite local history"` | PASS |
| Unexpected remote movement fails closed (AC #5) | `test/github-publish.test.ts`, `"unexpected origin/main movement fails closed"` | PASS |
| Never force-pushes; exact SHA unchanged (AC #6) | `test/github-publish.test.ts`, `"never force-pushes; exact SHA unchanged through the lifecycle"` | PASS |
| Fail-closed divergence guard | `src/application/github-publish/publication-engine.ts`, `advanceMain` `remote-moved`/`divergence` guards | PASS |

## Next action
Cover the remaining recovery paths: verification failure, GitHub unavailable,
ref-exists collision, out-of-order, and transient retry (CP-6).
