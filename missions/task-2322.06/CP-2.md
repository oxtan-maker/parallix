# CP-2: Review-state routing boundary decision record

No Review writer was added. The selected compatibility Mission store neither
loads nor saves `Mission.review`; the legacy review-state snapshot cannot
losslessly represent review rounds, findings, and resolutions. Implementing a
writer here would select a second authority or invent an undocumented
translation/atomicity rule, both prohibited by the locked mission.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Review lifecycle is routed through checked commands, queries, and ports | `src/adapters/backlog/concrete-mission-read-adapter.ts:302`; `src/adapters/backlog/compatibility-mission-store.ts:195` | BLOCKED — lossless compatibility port contract required |
| No second authority, dual write, or fallback is introduced | `src/platform/runtime/lib/composition/application-services.ts:119`; `src/adapters/backlog/compatibility-mission-store.ts:1` | PASS |

Next action: apply an approved lossless Review compatibility-port and atomicity contract before adding Review mutation use cases.
