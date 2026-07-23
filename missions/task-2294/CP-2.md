# CP-2: Authority, measurements, and board projections

## Summary

Assigned authority to aggregate fields and retained a separate compatibility
map for the nine legacy path-inventory entries. Replaced the generated
`catalog.ts` and `read-model.ts` registries with concrete projection contracts
and functions. Usage is represented as mission outcomes and agent-run
measurements joined to an explicitly closed mission. Model involvement retains
provider, model, stage, role, and agent; unavailable telemetry remains unknown
instead of being coerced to zero or an agent-family label.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Field-level authority is exhaustive and covers all legacy inventory rows | `src/application/mission-authority.ts:15`, `"authority is exhaustive over mission fields and covers the legacy path inventory"` | PASS |
| Repository facts win and cache fallback is marked stale | `src/application/mission-authority.ts:45`, `"mission reads prefer repository truth and label cache fallback stale"` | PASS |
| The Backlog/Git adapter reconciles integration-base lifecycle, worktree content, and post-cleanup closure without constructing inconsistent missions | `src/adapters/backlog/mission-materialization.ts`, `test/backlog-mission-materialization.test.ts` | PASS |
| Mission-board projection separates lifecycle state from live work and enables integration only for approval of the exact reviewed revision | `src/application/projections/mission-board.ts`, `"mission card contains the board decision inputs without changing lifecycle state"`, `"approved review exposes integrate without inventing another lifecycle state"` | PASS |
| Integrate/shipped are lanes rather than lifecycle states | `src/application/projections/mission-board.ts:52`, `"board lanes are projections, not invented mission statuses"` | PASS |
| Board, detail, analytics, agent-status, activity, and repository-selector reads are separate application projections | `src/application/projections/`, `test/domain-projections.test.ts` | PASS |
| Completed statistics require authoritative closure and mission-owned NEL | `src/domain/usage.ts:152`, `"completed statistics reject mismatched identity and missing mission NEL"` | PASS |
| Model involvement survives aggregation with provider, stage, role, and agent | `src/domain/usage.ts:105`, `"completed mission statistics retain model involvement across stage and role"` | PASS |
| Missing telemetry stays unknown | `src/domain/usage.ts:5`, `"missing provider telemetry stays unknown instead of becoming a dishonest zero"` | PASS |
| Known token-consuming activities map to explicit work stages and never `default` | `src/domain/usage.ts`, `"known token-using activities map to explicit work stages instead of default"` | PASS |

Next action: Prove the async materialization/synchronous policy seam, update the owning ADRs, and run final gates.
