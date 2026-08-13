# CP-2: Extract task metadata

Moved assignee parsing and updates, supported-agent lookup, label management, classification, and mission-to-base label synchronization into the metadata adapter. The original `backlog.ts` compatibility exports remain available to callers.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Metadata adapter exports assignee, labels, classification, and agent support operations | `src/adapters/backlog/task-metadata.ts` | PASS |
| Existing backlog entry point retains metadata exports | `src/adapters/backlog/backlog.ts` | PASS |
| Static analysis passes after extraction | `./scripts/verify-local.sh static-analysis` | PASS |

Next action: Move task status changes, transition orchestration, rebase reconciliation, and lifecycle recording into `task-transitions.ts`.
