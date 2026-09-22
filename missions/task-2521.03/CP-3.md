# CP-3: Prompt and file-consumer migration — pending

## Summary

Superseded by the fresh-session handoff in `MISSION.md`. This CP is historical
and must not be used to claim the migration is pending exactly as described
below; later commits partially migrated review prompts/loop behavior but have
not received the required adversarial review.

The old prompt-authority completion claim is obsolete. Existing workflow paths
still consume checkpoint and review artifacts, so removing instructions to
produce them before those consumers use the typed command surface would make
the workflow non-functional. This checkpoint remains intentionally incomplete
until the read/write replacement is verified end to end.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Implementer instructions use supported context and checkpoint writes | Pending consumer migration | PENDING |
| Reviewer instructions use supported review reads/writes | Pending consumer migration | PENDING |
| Planning instructions use supported context/dependency/task-provider writes | Pending parity audit and Mission-4 contract | PENDING |
| No runtime workflow still requires durable repository workflow files | Existing `active`/handoff/review consumers require investigation and migration | PENDING |

Next action: remain active; migrate prompts only with their consumers after CP-2
proves command parity. Do not hand this Mission to review yet.
