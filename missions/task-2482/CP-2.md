# CP-2: Retire the checkpoint CLI command

## Summary

Removed `px checkpoint` from the runtime registry, usage text, and suggestion path. Deleted its CLI boundary, use case, adapters, legacy command, and command-only tests. Updated live operator and board guidance to describe checkpoint evidence without the retired command. The separate checkpoint document, resume context, and handoff validation paths remain in place.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC1: command is no longer exposed | `test/index.test.ts`, `"checkpoint is neither a known command nor a suggested invocation"` | PASS |
| SC2: command-only implementation and tests are removed | `src/composition/create-cli.ts`, `src/interfaces/cli/runtime.ts`, and `test/status-command-use-case.test.ts` no longer import or register the retired command | PASS |
| SC3: execution evidence, local progress commits, and resume survive | `test/active.test.ts`, `"buildExecutePrompt injects slug, current year, and checkpoint context into the template"`; `src/adapters/cli/commands/active.ts` | PENDING CP-3 verification |
| SC4: handoff validates checkpoint evidence independently | `test/handoff.test.ts`, `"performHandoff fails when no checkpoint documents exist"`; `test/active.test.ts`, `"validateCheckpointsBeforeHandoff accepts complete declared checkpoint coverage"` | PENDING CP-3 verification |
| SC5: live guidance does not instruct use of the retired command | `AGENTS.md`, `docs/tui-board.md`, and `src/domain/README.md` | PASS |
| SC6: focused and repository gates pass | `test/index.test.ts` and `test/status-command-use-case.test.ts`; `npm test -- --unit-test-headroom` | PENDING CP-3 verification |

Next action: run the required gates and confirm the execution, resume, and handoff checkpoint-evidence paths remain intact without `px checkpoint`.
