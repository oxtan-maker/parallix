# CP-1 — prerequisite and routing baseline

Confirmed that completed backlog records exist for Ink TUI waves 2–6 (`TASK-2304` through `TASK-2308`) and that TASK-2308's final checkpoint records both required gates as passed. The current bare invocation returns usage before repository validation, while explicit `px ui` is a lazy dispatcher entry. The selected narrow opt-out is `PARALLIX_NO_TUI=1`; when set, a TTY bare invocation will keep the previous usage-and-zero-exit behavior. The non-TTY baseline is likewise usage output with exit code 0, before any UI dispatch.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC1: Existing explicit board entry point is identified for reuse | `src/platform/runtime/index.ts:70`; `src/interfaces/tui/ui-command.ts:126` | PASS — baseline mapped |
| SC2: Existing bare non-TTY behavior is identified before routing changes | `src/platform/runtime/px.ts:217`; `src/platform/runtime/index.ts:142` | PASS — usage then exit 0 |
| SC3: One scoped opt-out mechanism is selected | `missions/task-2309/CP-1.md:3`; `docs/tui-board.md:1` | PASS — `PARALLIX_NO_TUI=1` selected |
| SC4: UI loading remains behind a lazy dispatcher boundary | `src/platform/runtime/index.ts:70`; `test/tui-headless-isolation.test.ts` | PASS — baseline mapped |
| SC5: Documentation locations and existing wording are identified | `docs/tui-board.md:1`; `docs/npm-package-major-migration.md:80` | PASS — pending update |
| SC6: Reversible implementation boundary is planned | `missions/task-2309/MISSION.md`; `src/platform/runtime/px.ts:217` | PASS — pending implementation commit |
| SC7: Required prerequisite gate evidence is present | `missions/task-2308/CP-4.md:17`; `./scripts/verify-local.sh all`; `./scripts/verify-local.sh static-analysis` | PASS — prerequisite evidence |

Next action: add dispatcher-level routing tests that freeze bare non-TTY usage bytes and exit codes before enabling the TTY default.
