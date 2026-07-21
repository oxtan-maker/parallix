# CP-2

## Summary

Completed the first command-suite batch: `active`, `agents-limit-hit`, `agents`, `backlog`, `backlog_gate`, and `backlog_reorder_completed_duplicate`. Removed their TASK-2277 file suppressions and obsolete `@ts-expect-error` comments. Added local shapes for the CommonJS repair-handoff namespace and the `selectAgentFn` exclusion option; focused tests retained their existing isolated launchers and temporary-worktree doubles.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC1: TASK-2277 suppression is removed from the completed batch | `test/active.test.ts:1`; `test/agents.test.ts:1`; `test/backlog.test.ts:1` | PASS |
| SC2: completed batch typechecks without unused expectations | `npx tsc --noEmit --project tsconfig.test.json`; `test/active.test.ts:593`; `test/agents-limit-hit.test.ts:142` | PASS |
| SC3: focused suites execute with their test doubles | `node --import tsx --test test/active.test.ts`; `node --import tsx --test test/agents-limit-hit.test.ts`; `node --import tsx --test test/agents.test.ts`; `node --import tsx --test test/backlog.test.ts`; `node --import tsx --test test/backlog_gate.test.ts`; `node --import tsx --test test/backlog_reorder_completed_duplicate.test.ts` | PASS |
| SC4: added typing is local to legacy mock/assertion boundaries | `test/active.test.ts:593`; `test/agents-limit-hit.test.ts:142` | PASS |
| SC5: final required gates remain outstanding | `./scripts/verify-local.sh static-analysis`; `./scripts/verify-local.sh all` | PENDING CP-4 |

Next action: harden the bootstrap-through-config command-suite batch, beginning with `bootstrap-isolation`, `claude`, `codex`, `config-command`, and `config-contract-deferral`.
