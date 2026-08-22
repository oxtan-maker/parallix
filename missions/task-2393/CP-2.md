# CP-2: Reconciled current-work attribution

`ConcreteAgentReadAdapter` now reconciles its injected current-work events and
uses a live or unverified named family before the existing fresh-marker and
command-line-pinned fallbacks. Board composition supplies the current-work reader
from the same operational-history repository and liveness probe it already uses.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC1: current-work family attributes a live session | `test/task-2393-current-work-attribution-repro.test.ts`; test `TASK-2393 SC1/SC2: a live role-null review session uses reconciled current-work attribution` | Passed |
| SC2: role-null review sessions use current-work | `test/task-2393-current-work-attribution-repro.test.ts`; `npx tsx --test test/task-2393-current-work-attribution-repro.test.ts test/running-sessions.test.ts` | Passed |
| SC3: stale marker cannot claim the live process | `test/running-sessions.test.ts`; test `loadRunningSessions ignores a session marker older than the running process` | Passed |
| SC4: fresh marker, pinned family, then null remain fallbacks | `test/running-sessions.test.ts`; tests `loadRunningSessions uses a session marker written after the process started`, `loadRunningSessions falls back to the family pinned on the command line`, and `loadRunningSessions leaves a session unattributed when no source names a family` | Passed |
| SC5: liveness and unattributed-session honesty remain unchanged | `test/running-sessions.test.ts`; tests `loadRunningSessions reports unknown when liveness could not be observed` and `loadRunningSessions leaves a session unattributed when no source names a family` | Passed |
| SC6: red-to-green reproduction | `test/task-2393-current-work-attribution-repro.test.ts`; test `TASK-2393 SC1/SC2: a live role-null review session uses reconciled current-work attribution` | Green |

Next action: Run the mission static-analysis gate and capture its successful result in CP-3.
