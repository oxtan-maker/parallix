# CP-3: Extract task transitions

Moved task status mutation, completion, local and integration-branch transitions, lifecycle operation recording, and mission rebase reconciliation into the transitions adapter. The transition layer imports the lower-level file-I/O and metadata adapters without reverse imports.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Transition adapter provides status, lifecycle, and rebase operations | `src/adapters/backlog/task-transitions.ts` | PASS |
| Transition layer composes sibling file-I/O and metadata adapters | `src/adapters/backlog/task-transitions.ts` | PASS |
| Static analysis passes after extraction | `./scripts/verify-local.sh static-analysis` | PASS |

Next action: Audit and finalize the `backlog.ts` barrel, verify its line count and compatibility exports, then run the final static-analysis gate.
