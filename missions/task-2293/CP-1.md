# CP-1

## Summary

Reconciled the TASK-2277 marker population with TASK-2276's captured mission-base inventory. The TASK-2276 baseline contains 158 JavaScript suites converted to TypeScript; the current tree has 160 marker-bearing suites because `test/test-hygiene.test.ts` and `test/typescript-test-authoring.test.ts` were already/new TypeScript suites and are outside this mission's converted-suite scope. The first isolated batch is the command-focused `active`, `agents`, and `backlog` suites, which use local `require`-based doubles.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC1: scoped population is identified without expanding scope | `missions/task-2276/mission-base-inventory.txt:1`; `test/active.test.ts:1` | PASS |
| SC2: typecheck command is selected for each implementation batch | `npx tsc --noEmit --project tsconfig.test.json`; `tsconfig.test.json:1` | PENDING CP-2 |
| SC3: focused test commands are selected for changed suites | `node --import tsx --test test/active.test.ts`; `test/active.test.ts` | PENDING CP-2 |
| SC4: any narrow suppression must remain adjacent to its legacy mock or assertion | `test/active.test.ts:1361` | PENDING CP-2 |
| SC5: final required gates are recorded | `./scripts/verify-local.sh static-analysis`; `./scripts/verify-local.sh all` | PENDING CP-4 |

Next action: remove the TASK-2277 marker from the active, agents, and backlog command-suite batch, address the exposed diagnostics locally, and run its focused test commands.
