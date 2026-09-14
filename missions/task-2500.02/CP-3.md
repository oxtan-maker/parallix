# Checkpoint 3 — Verification polling and state transitions

## Summary
Implemented verification polling and the durable commit-state transitions.
`GithubPublishEngine.pollVerification` maps an injected
`VerificationOracle.query(sha)` outcome (`verified`/`failed`/`pending`) to a
state transition via the pure state machine `transitionFrom`; `pending` stays
`external verification pending` (slow/unavailable GitHub is not a failure). Legal
transitions are enforced by the state machine — illegal transitions throw
(fail closed). The injected oracle keeps the engine decoupled from operator CI
and lets tests drive outcomes deterministically.

Delivered:
- `src/application/github-publish/state-machine.ts` — states
  `locally integrated`, `external verification pending`, `externally verified`,
  `published`, `external verification failed`; `transitionFrom` enforces legal
  edges; `isExternallyVerified`, `isVerificationFailed`.
- `src/application/github-publish/publication-engine.ts` — `pollVerification`,
  `tracking`, `MapVerificationOracle`.
- `docs/adr/0058-github-publish-mode.md` — `ADR 0058` state model.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Polling drives pending → verified/failed (AC #1) | `test/github-publish.test.ts`, `"failed earlier verification blocks later commits"` | PASS |
| Pending is not a failure, no advance | `test/github-publish.test.ts`, `"pending verification does not fail and does not advance"` | PASS |
| Durable states + legal transitions | `src/application/github-publish/state-machine.ts`, `transitionFrom`, `GithubPublishState`; `ADR 0058` | PASS |
| Oracle injection (decoupled from CI) | `src/application/github-publish/publication-engine.ts`, `VerificationOracle`, `MapVerificationOracle` | PASS |

## Next action
Implement the publication engine's contiguous advancement of `origin/main` and
out-of-order completion ordering (CP-4).
