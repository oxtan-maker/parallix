# CP-3: Verify checkpoint lifecycle after command retirement

## Summary

Verified that the retired CLI command is absent while checkpoint evidence remains part of execution, resume, and handoff validation. Review correction removed unrelated notification, handoff-recovery, and backlog work so this branch contains only the command-retirement mission. Repository gates pass.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC1: `px checkpoint` is not registered, advertised, or suggested | `test/index.test.ts`, `"checkpoint is neither a known command nor a suggested invocation"`; `./scripts/verify-local.sh all` | PASS |
| SC2: command-owned code, adapters, and tests are gone | `src/composition/create-cli.ts`, `src/interfaces/cli/runtime.ts`, and `test/status-command-use-case.test.ts`; `./scripts/verify-local.sh static-analysis` | PASS |
| SC3: execution records committed checkpoint evidence and resume reads it | `test/active.test.ts`, `"buildExecutePrompt injects slug, current year, and checkpoint context into the template"`; `src/adapters/cli/commands/active.ts` | PASS |
| SC4: handoff validates checkpoint evidence and owns its transition checks | `test/handoff.test.ts`, `"performHandoff fails when no checkpoint documents exist"`; `test/active.test.ts`, `"validateCheckpointsBeforeHandoff accepts complete declared checkpoint coverage"` | PASS |
| SC5: live guidance no longer instructs the retired command or assigns verification to every execution checkpoint | `AGENTS.md`, `docs/tui-board.md`, `src/domain/README.md`; `./scripts/verify-local.sh docs` | PASS |
| SC6: focused tests and repository gates pass | `npm test -- --unit-test-headroom`; `./scripts/verify-local.sh static-analysis`; `./scripts/verify-local.sh all` | PASS |

Next action: submit the committed review correction for the next reviewer decision.
