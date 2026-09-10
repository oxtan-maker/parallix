# CP-1: Multi-process reproduction

Added a real two-process contention reproduction with a finite custom capacity.
It is red on the parent implementation: each process acquires its own module-local slot.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Independent processes share a finite custom-agent limit | `test/custom-capacity-multiprocess-repro.test.ts`, "two processes contend for one custom slot: exactly one acquires"; `node --import tsx --test test/custom-capacity-multiprocess-repro.test.ts` reports two acquisitions on the parent implementation | Red reproduction captured |
| Final-slot admission is atomic | `test/custom-capacity-multiprocess-repro.test.ts`, "two processes contend for one custom slot: exactly one acquires" | Red reproduction captured |

Next action: replace the process-local counter with an atomic operator-SQLite lease and turn this reproduction green.
