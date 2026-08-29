# CP 1 — Lock the bug

Added the focused race regression: a confirmation observed in `backlog` is
submitted after the authoritative fake has changed to `ready`. The current
caller-supplied guard lets the command effect run, so the required conflict and
zero-effect assertions fail on the parent behavior.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Race regression captures an authoritative status change | `test/task-2425-repro.test.ts`, "authoritative status change rejects confirmation before the effect is called" | PASS |
| Parent behavior is demonstrably red | `npm test -- test/task-2425-repro.test.ts` | PASS (expected red) |
| Regression requires conflict and no effect | `test/task-2425-repro.test.ts` | PASS |

Next action: inject the existing mission-store read authority into the dispatcher and remove the caller-supplied status argument.
