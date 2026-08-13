# CP-3: Verification and handoff

Verified the retained `integrate.ts` import route and preflight behavior after the command extraction. The required static-analysis gate remains blocked by four pre-existing TypeScript errors in unchanged `src/adapters/cli/commands/stats.ts`, a restricted area outside this mission's approved scope.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| `integrate-command.ts` contains the named command-facing API | `src/adapters/cli/commands/integrate-command.ts:1`; `src/adapters/cli/commands/integrate.ts:1` re-export surface | Complete |
| Existing callers retain the `integrate.ts` import route | `src/adapters/rebase/rebase-workflow-adapter.ts:1`, `src/adapters/cli/commands/resolve-conflict.ts:1`, `src/composition/create-cli.ts:1`, `test/task-1431-integration-preflight-repro.test.ts` | Complete |
| The extraction preserves the enumerated integration flow | `node --test --import tsx test/task-1431-integration-preflight-repro.test.ts`; all 5 preflight/context tests pass | Complete for verified flow |
| Command/lifecycle line movement is approximately 350 lines | `git diff bb5bc813d --stat -- src/adapters/cli/commands/integrate.ts src/adapters/cli/commands/integrate-command.ts`; 1,122 lines removed from the facade and 1,138 added to the extracted module | Not met: movement exceeds the mission estimate |
| Static analysis passes on the final tree | `./scripts/verify-local.sh static-analysis`; TypeScript errors at `src/adapters/cli/commands/stats.ts:154`, `:1935`, and `:1956` | Blocked: restricted-area expansion requires mission-owner approval |

Next action: obtain mission-owner direction on the `stats.ts` scope expansion and the extraction-size variance before final handoff.
