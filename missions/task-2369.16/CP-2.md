# CP 2: Extract authentication and repository operations

Moved Forgejo request/token handling into the auth module and repository, collaborator, user, and remote operations into the repository module. The bootstrap flow imports those implementations directly.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Auth module owns request and token behavior | `src/adapters/review/setup-review-auth.ts`, `test/setup-review.test.ts` | PASS |
| Repository module owns Forgejo and Git remote operations | `src/adapters/review/setup-review-repository.ts`, `test/setup-review.test.ts` | PASS |
| Token and repository behavior remains hermetic | `node --import tsx test/setup-review.test.ts` | PASS |

Next action: Complete configuration/readiness extraction and confirm the import direction.
