# Mission: invalidate a BLOCKED/PARKED stop on `px review --continue`

**Slug:** task-2478-blocker-override
**Status:** done (code + tests)
**Related:** task-2478 (original request-changes trust loop)

## Problem

The review loop relaunches the implementer on every `px review --continue`
whenever the current round carries a `BLOCKED` or `PARKED` implementer
disposition. The loop treats any existing disposition as "resolve the
blocker", so a blocker the operator has already resolved by hand spins
forever:

```
[INFO] Round 2: implementer disposition found (BLOCKED).
       Re-launching implementer to assess whether blocker is resolved...
...
[INFO] Round 2: implementer disposition = BLOCKED
[INFO] Autonomous review stopped: implementer reported BLOCKED. Hand off to human review.
```

The next `--continue` re-reads the persisted `BLOCKED` and relaunches again.
This also traps an already-approved mission whose only remaining step is
external provider approval (`external-formal-approval-owed`): the durable
`ReviewState` phase stays `fixing`, so the loop never reaches the approve
handoff.

## Fix

`px review --continue` is the operator's declaration that a stuck implementer
stop is resolved by hand. It now invalidates a `BLOCKED`/`PARKED` disposition:

- `invalidateBlocker` (domain, `src/domain/review.ts`) clears the current
  round's disposition, drops `blockedReason`, and resets the round phase to
  `reviewing` — only valid when the round is actually `BLOCKED`/`PARKED`.
- `continueReviewInvalidatesBlocker` (`src/adapters/review/review-commands.ts`)
  loads the mission, invalidates the stop, persists the Review aggregate
  (sole write authority, ADR 0053), and records a `human_note` attributed to
  the operator (named `--actor`, else the current git user).
- The workflow adapter's `continue` path calls it before relaunching the loop,
  which now re-polls the reviewer on the current tree instead of relaunching
  the stuck implementer.

An approved mission re-polls the provider, finds the approval, and hands off.

## Operator use

```
px review <slug> --continue
```

Clears a `BLOCKED`/`PARKED` stop and re-reviews the current tree. A review
that is not blocked is left untouched.

## Tests

`test/task-2478-invalidate-blocker.test.ts` — clears `BLOCKED` and `PARKED`,
resets phase to `reviewing`, leaves non-blocked reviews untouched, and
attributes the invalidation to the operator on a review event.
