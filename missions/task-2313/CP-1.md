# CP-1 — Red reproduction

Added a real Ink render regression test using a fake TTY stream. It captures
board writes at initial mount and after resize, checks each lane header in the
final frame, and proves the parent tree has two board resize subscriptions.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Stable terminal does not emit an immediate second board frame | `test/task-2313-repro.test.ts:103`, `"writes exactly one board frame for the first render"` | PASS |
| Parent tree exposes only one board resize subscription | `test/task-2313-repro.test.ts:121`, `"subscribes to terminal resize exactly once across the component tree"`; `npm test -- test/task-2313-repro.test.ts` | FAIL (red: observed 3 listeners, expected 2) |
| Final resized frame contains every lane header once | `test/task-2313-repro.test.ts:145`, `"shows every lane header exactly once in the final frame after a resize"` | PASS |
| Headless output remains a single board frame | `test/task-2313-repro.test.ts:165`, `"renders a single headless frame with no duplicated lane headers"` | PASS |

Next action: Pass the detected dimensions from `BoardShell` into `BoardLayout` without letting the layout establish a second resize subscription.
