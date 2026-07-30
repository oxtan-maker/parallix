# CP-3: Checked integration and closure decisions

Added `MissionIntegrationService`. It accepts Git, verification, and completed
integration observations as fresh caller-supplied facts only, applies the
existing Mission transition/closure policy, and writes only the Mission through
the selected store. The focused unit tests use an in-memory mocked store.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Integration and closure reject absent or stale external observations | `src/application/mission-integration-service.ts:28`; "rejects an absent observed verification fact before loading the Mission" | PASS |
| Integration and closure apply Mission policy and do not persist Git/provider facts | `src/application/mission-integration-service.ts:48`; `src/application/mission-integration-service.ts:63` | PASS |
| Success, stale-version conflict, and closure behavior have mocked-port coverage | `test/mission-integration-service.test.ts`; "returns a conflict when persistence rejects the observed Mission version" | PASS |

Next action: route the TUI Mission-detail materialization through an application projection query.
