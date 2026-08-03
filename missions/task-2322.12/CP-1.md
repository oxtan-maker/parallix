# CP 1: Inventory audit and compatibility entry removal

Removed the six `TASK-2322.12` Review compatibility entries from
`ADR0053_PERSISTENCE_INVENTORY`. The inventory now identifies
`SqliteMissionStore` as the remaining default Review authority. The audit also
found older `TASK-2322.02` and `TASK-2322.03` cutover markers, which are outside
this mission's Review cleanup scope and remain unchanged.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| No inventory entry remains for this cutover | `src/platform/runtime/lib/core/durable-state-inventory.ts:216`; `rg -n "TASK-2322\\.12" src/platform/runtime/lib/core/durable-state-inventory.ts` returns no matches | PASS |
| Default Review authority remains SQLite-backed | `src/platform/runtime/lib/core/durable-state-inventory.ts:218`; `test/persistence-inventory-guardrail.test.ts` | PASS |
| The removed entries expose legacy durable I/O to remove next | `test/persistence-inventory-guardrail.test.ts` test `SC1 reverse: all durable-IO files under src/ are present in the inventory` currently identifies `review-state.ts` and `review-commands.ts` | PASS — expected until CP 2 |

Next action: Remove the legacy review-state and review-command durable file paths so the inventory reverse guard passes without compatibility entries.
