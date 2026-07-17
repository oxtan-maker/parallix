# CP-1: Map review-round verification owners

Mapped the currently tracked review submission path. `px review --submit` delegates
to `submitForReview`, which delegates to `performHandoff`. Handoff runs the configured
verification adapter and then runs every command declared in `MISSION.md`; this mission
declares `./scripts/verify-local.sh all`, so those are two commit-equivalent general-suite
owners. The described review-remote pre-push hook is local-only metadata and is not a
tracked repository gate owner, so it cannot be safely changed or covered here.

Added a counter/owner regression fixture that records the two tracked owners before the
proof implementation changes the second boundary to reuse a verified proof.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| The duplicate tracked owners are named and regression-covered | `lib/commands/handoff.ts:354`, `lib/commands/handoff.ts:570`, "task-2273 baseline: handoff owns two commit-equivalent general-gate invocations" | PASS |
| Review submission delegates into handoff | `lib/review/review-commands.ts:701`, `test/task-2273-review-gate-ownership.test.js` | PASS |
| Local-only hook scope is explicitly preserved | `AGENTS.md:18`, "task-2273 baseline: no repository-managed review-remote pre-push verifier exists" | PASS |
| Direct general-suite command remains independently available | `scripts/verify-local.sh:24`, `npm test` | PASS |

Next action: Define a durable, fail-closed proof identity for the configured verification command and its complete gate-relevant input manifest.
