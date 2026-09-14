# Checkpoint 1 — Design and state model

## Summary
Designed the github-publish mode and its durable state machine. Authored ADR 0058 documenting the "publish exact commit → verify on a verification ref → advance origin/main through contiguous verified commits" model, the fail-closed invariant, and the gating of history-mutating post-integration steps behind the mode flag.

Delivered:
- `docs/adr/0058-github-publish-mode.md` — decision, state model, fail-closed invariant, consequences.
- `src/application/github-publish/state-machine.ts` — pure, side-effect-free state machine with the five durable states (`locally integrated`, `external verification pending`, `externally verified`, `published`, `external verification failed`) and legal-transition enforcement (fails closed on illegal transitions).
- `src/application/github-publish/verification-ref.ts` — SHA-encoding verification-ref naming and collision/idempotent-retry resolution.
- `config/workflow.config.schema.json` + `src/adapters/config/product-config.ts` — opt-in `adapters.githubPublish` config with `enabled`, `verificationRemote`, `verificationRefPrefix`, `pollIntervalMs`, `maxPollAttempts`, `mainBranch`, validated and resolved (defaults keep the squash-merge path byte-for-byte unchanged).

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Publication state model documented | `docs/adr/0058-github-publish-mode.md`, `ADR 0058` | PASS |
| Durable states + legal transitions | `src/application/github-publish/state-machine.ts`, `ALL_PUBLISH_STATES`, `transitionFrom` | PASS |
| Verification-ref naming encodes SHA | `src/application/github-publish/verification-ref.ts`, `verificationRefName`, `resolveExistingRef` | PASS |
| Opt-in config schema + resolver | `config/workflow.config.schema.json` `adapters.githubPublish`, `resolveGithubPublishConfig` | PASS |
| Default squash-merge path unchanged when unconfigured | `product-config.test.ts` (existing), `resolveGithubPublishConfig().enabled === false` by default | PASS |

## Next action
Build the publication engine (CP-2/CP-3): exact-SHA verification-ref push + verification polling/state transitions, with tests.
