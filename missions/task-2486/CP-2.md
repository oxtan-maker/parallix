# Checkpoint 2 — Trust-ladder framing

## Work Summary

Repositioned the README and npm description around the trust ladder. The opening now states the availability limits for different-family review and Bubblewrap, and the configured scope of verification before it introduces parallel Git isolation.

Placed the lifecycle review qualification immediately after the ASCII diagram. Moved Forgejo bootstrap to the `Optional integrations` section, removed it from the required `px setup` narrative, and changed setup help to say bootstrap is optional. The internal measurement now explicitly says it is not external evidence.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Claim inventory maps review, verification, confinement, Forgejo, merge, and measurement claims to qualifications and authorities | `missions/task-2486/CP-1.md`, `src/domain/review.ts`, `src/adapters/process/bubblewrap.ts`, `src/adapters/review/setup-review.ts` | PASS |
| README and npm description lead with the trust ladder | `README.md`, `package.json` | PASS |
| Review, Bubblewrap, Forgejo, and configured-gate conditions remain attached to their claims | `README.md`, test `isBubblewrapAvailable warns once that the agent runs unsandboxed` | PASS |
| Inaccurate or uncaveated claims are qualified or removed | `README.md`, `missions/task-2486/CP-1.md` | PASS |
| README statements remain mutually consistent | `README.md` | PENDING CP-3 |
| Forgejo bootstrap is optional in README and setup help | `README.md`, `src/interfaces/cli/runtime.ts`, test `evaluateReviewSetup reports not-required without configured review settings and passes when setup is complete` | PASS |
| Lifecycle diagram retains its reviewer-availability qualification | `README.md`, test `startReview allows self-review only when the implementer is the sole eligible family` | PASS |
| Measurement remains labelled internal rather than external evidence | `README.md`, `docs/readme-rewrite-benchmark.md` | PASS |
| README standard remains satisfied | `docs/doc-standards.md`, `README.md` | PENDING CP-3 |
| Documentation and general verification pass on the final tree | `./scripts/verify-docs.mjs`, `./scripts/verify-local.sh all` | PENDING CP-3 |

Next action: Review the complete README for contradictions and standard compliance, then run the documentation and general verification gates.
