# CP-1: Lock the malformed declared-gate regression

Added the hermetic review-submit handoff reproduction before changing production code. The test fixture declares the reported parenthesized outcome suffix and requires structured validation failure without invoking the Bash process port. It is red at this checkpoint: the current validator lets the declaration execute and returns `gate-failed`.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC1 regression is reproducible before the fix | `test/task-2439-rebounce-review-submit-repro.test.ts`, test name `task-2439 repro: review-submit declared-gate prose is a reboundable validation failure, never a Bash command`; `node --test --import tsx test/task-2439-rebounce-review-submit-repro.test.ts` | RED |
| SC2 requires validation before shell execution | `test/task-2439-rebounce-review-submit-repro.test.ts`, `src/application/handoff-command-use-case.ts` | RED |

Next action: reject parenthesized outcome prose in `validateDeclaredGates`, then turn this regression green.
