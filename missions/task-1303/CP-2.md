# CP-2: Corrected `--push` fallback message and `gatekeeperPushedBack` short-circuit

## Summary
Implemented the corrected fallback guidance and the gatekeeper-pushback short-circuit
(co-located with the CP-1 self-heal sequence in the same branch).

- **Fallback guidance** (`fallbackGuidance(reason)`,
  `lib/review/review-loop.js:560-564`): keeps the `No open review PR found for <branch>.`
  headline and `exit(1)` semantics, surfaces the handoff failure reason as
  `Handoff failure: <reason>` when one is present, and recommends
  `px review <slug> --push` — **never** the old `--submit`. Used in three places: a
  failed handoff (`!handoff.ok`, passes `handoff.error`), a handoff that succeeded but
  produced no open PR (no reason), and dry-run (no reason).
- **Gatekeeper pushback short-circuit** (`lib/review/review-loop.js:576-582`): when
  `handoff.gatekeeperPushedBack` is truthy, logs that mandatory mission artifacts are
  missing and that the task stays in its current state, then `exit(1)` — the loop is not
  spun and the reviewer is never launched. This is checked *before* the `!handoff.ok`
  fallback so a pushback gets its specific message.
- **Dry-run** (`lib/review/review-loop.js:566-571`): emits fallback guidance and exits
  without calling `performHandoffFn`. (The outer `if (!dryRun && forgejoEnabled)` guard at
  line 519 already excludes dry-run from this block, so this is a defensive, intent-
  documenting short-circuit; criterion 7 holds either way.)

## Goal Check

| Mission item | Evidence | Status |
|---|---|---|
| Fallback keeps `No open review PR found` headline + `exit(1)` | `lib/review/review-loop.js:561`, `584-587`, `592-595` | ✅ |
| Fallback recommends `--push`, never `--submit` | `lib/review/review-loop.js:563`; `grep -n -- '--submit'` → only a comment at line 559, zero emitted strings | ✅ |
| Fallback surfaces handoff failure reason when present | `lib/review/review-loop.js:562,585` | ✅ |
| `gatekeeperPushedBack` → artifacts-missing log + `exit(1)`, no reviewer launch | `lib/review/review-loop.js:576-582` | ✅ |
| Pushback checked before generic `!ok` fallback | `lib/review/review-loop.js:576` precedes `584` | ✅ |
| Dry-run never calls `performHandoffFn` | `lib/review/review-loop.js:566-571` | ✅ |
| Full review suite green | `node --test test/review.test.js` → `pass 111 / fail 0` | ✅ |

## Next action
Proceed to CP-3: update the two existing review/approved no-PR tests
(`test/review.test.js:3581-3628`) to inject `performHandoffFn`, and add tests for recovery
(crit. 1), failed-handoff fallback (crit. 2/3), gatekeeper pushback (crit. 4), and dry-run
(crit. 7); then run `npm test` to green.
