# CP-1: Current-work attribution reproduction (red)

Added the focused TASK-2393 reproduction for a detected live `px review --continue`
session (`role: null`) whose only attribution evidence is a current-work `running`
event naming the `claude` family. The unmodified adapter returns `family: null`,
confirming the missing first attribution source.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC1: reconciled current-work names the running family | `test/task-2393-current-work-attribution-repro.test.ts`; test `TASK-2393 SC1/SC2: a live role-null review session uses reconciled current-work attribution` | Red — returns `family: null` |
| SC2: role-null review sessions can use current-work attribution | `npx tsx --test test/task-2393-current-work-attribution-repro.test.ts`; test `TASK-2393 SC1/SC2: a live role-null review session uses reconciled current-work attribution` | Red — role-null session remains unattributed |
| SC6: reproduction fails at the parent implementation | `test/task-2393-current-work-attribution-repro.test.ts`; `npx tsx --test test/task-2393-current-work-attribution-repro.test.ts` | Passed — command exits 1 with expected assertion diff |

Next action: Stop before implementing the fix, as required by the mission CP-1 stop rule.
