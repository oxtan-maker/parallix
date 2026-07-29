# CP-1: Map the production persistence surface

## Summary

Produced the executable ADR 0053 persistence inventory covering all 15 durable-state
concepts. Every production default and compatibility reader/writer is named with its
file location, operation (read/write), ADR 0053 classification, and a later cutover
task for every temporary exception. Added guardrail tests that verify the inventory
is complete, well-formed, and enforces the direct-SQL boundary between application/UI
code and the SQLite adapter layer.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Executable inventory names every production default and compatibility reader/writer for all 15 concepts | `src/platform/runtime/lib/core/durable-state-inventory.ts:ADR0053_PERSISTENCE_INVENTORY`, `test/persistence-inventory-guardrail.test.ts` "SC1: ADR 0053 inventory covers all 15 durable-state concepts", "SC1 reverse: all durable-IO files under src/ are present in the inventory" | PASS |
| Every inventoried boundary classified as exactly one of six ADR 0053 categories | `src/platform/runtime/lib/core/durable-state-inventory.ts:ADR0053Classification` type, `test/persistence-inventory-guardrail.test.ts` "SC1: every inventory entry has exactly one recognized classification" | PASS |
| Temporary exceptions name a specific later cutover task | `test/persistence-inventory-guardrail.test.ts` "SC4: compatibility pathType entries are exceptions with cutover tasks or permanent SQLite paths" | PASS |
| Inventory distinguishes external task authoring and Git observations from Mission lifecycle authority | `test/persistence-inventory-guardrail.test.ts` "SC3: TaskIntake entries are classified as external-fact-or-intake", "SC3: GitObservations entries are classified as external-fact-or-intake", "SC3: TaskIntake is distinct from Mission lifecycle authority" | PASS |
| No production authority switch, source-format repair, dual-write introduced | `test/persistence-inventory-guardrail.test.ts` "SC4: no inventory entry uses forbidden-persistence classification" | PASS |
| Direct SQL guard: application/UI code must not import node:sqlite | `test/persistence-inventory-guardrail.test.ts` "SC2: no src/application/ file imports node:sqlite directly", "SC2: no src/interfaces/ file imports node:sqlite directly" | PASS |
| Inventory file locations reference existing files | `test/persistence-inventory-guardrail.test.ts` "SC6: inventory fileLocation references resolve to existing files" | PASS |

## Next action

CP 2: Add isolated, fast characterization tests for CLI, TUI, and shared board-projection behavior with mocks for Forgejo, agents, and expensive subprocesses; confirm task intake and Git observations remain external inputs/facts.
