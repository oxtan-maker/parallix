# Checkpoint 2 — Verification-ref publication (exact SHA preserved)

## Summary
Implemented publication of the exact locally-generated integration commit to a
per-commit verification ref with the SHA preserved verbatim. `verificationRefName`
builds `refs/<prefix>/<sha>` (full 40-char SHA encoded in the ref path) so every
ref is unique per commit. `GithubPublishEngine.publishCommit` pushes
`<sha>:<ref>` with no force flag and resolves a pre-existing ref via
`resolveExistingRef` into `idempotent-retry` (same SHA) or `collision` (different
SHA, refused).

Delivered:
- `src/application/github-publish/verification-ref.ts` — `verificationRefName`,
  `resolveExistingRef`, `DEFAULT_VERIFICATION_REF_PREFIX`.
- `src/application/github-publish/publication-engine.ts` — `publishCommit`.
- `src/adapters/git/github-publish-git.ts` — `GitRepositoryPort.push` uses
  `git push <remote> <sha>:<ref>` (no `--force`).
- `config/workflow.config.schema.json` + `product-config.ts` —
  `adapters.githubPublish.verificationRefPrefix`, `verificationRemote`.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Exact integration commit published unchanged (AC #6) | `test/github-publish.test.ts`, `"exact integration SHA preserved through verification ref and publication"` | PASS |
| Verification ref encodes full SHA | `src/application/github-publish/verification-ref.ts`, `verificationRefName` → `refs/github-publish/<40-hex>` | PASS |
| No force-push on publish | `test/github-publish.test.ts`, `"never force-pushes; exact SHA unchanged through the lifecycle"`; `!/--force/` in `publication-engine.ts` | PASS |
| Collision refused, same-SHA idempotent | `test/github-publish.test.ts`, `"pre-existing ref at a different SHA fails closed without clobbering"`, `"re-publishing the same SHA is an idempotent no-op"` | PASS |
| Opt-in config for ref prefix/remote | `config/workflow.config.schema.json` `adapters.githubPublish`, `resolveGithubPublishConfig` | PASS |

## Next action
Implement verification polling and `locally integrated` → `pending` →
`externally verified`/`failed` transitions (CP-3).
