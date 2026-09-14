# Checkpoint 6 — Recovery paths

## Summary
Covered the recovery paths the mission enumerates. Verification failure and
GitHub unavailable (pending) both leave the run blocked without advancing and
without treating pending as a failure. A verification ref that already exists is
resolved: same SHA is an idempotent no-op, a different SHA is a collision that is
refused (never clobbered). Out-of-order completion is retried on the next poll
once the gap commit verifies. Transient GitHub failure is modeled as `pending`
with retry (the oracle returns `pending`; the engine waits, does not fail).
`maxPollAttempts` bounds polls when configured; `null` polls indefinitely while
pending.

Delivered:
- `src/application/github-publish/publication-engine.ts` — `publishCommit`
  collision/idempotent handling, `pollVerification` pending retry,
  `PublishEngineOptions.maxPollAttempts`.
- `src/application/github-publish/verification-ref.ts` — `resolveExistingRef`.
- `config/workflow.config.schema.json` — `pollIntervalMs`, `maxPollAttempts`.
- `test/github-publish.test.ts` — recovery tests.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Verification failure blocks run, no advance | `test/github-publish.test.ts`, `"failed earlier verification blocks later commits"` | PASS |
| GitHub unavailable (pending) waits, not failure | `test/github-publish.test.ts`, `"pending verification does not fail and does not advance"` | PASS |
| Ref exists: idempotent vs collision | `test/github-publish.test.ts`, `"re-publishing the same SHA is an idempotent no-op"`, `"pre-existing ref at a different SHA fails closed without clobbering"` | PASS |
| Out-of-order retried once gap verifies | `test/github-publish.test.ts`, `"out-of-order verification advances in order without skipping"` | PASS |
| Configurable poll bounds | `config/workflow.config.schema.json` `adapters.githubPublish.pollIntervalMs`, `maxPollAttempts` | PASS |

## Next action
Implement the operator status command exposing local head, published head,
awaiting/verified-blocked/failed (CP-7).
