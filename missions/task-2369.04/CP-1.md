# CP-1: Command orchestration boundary

Mapped the command-facing extraction set and its callers. `integrate-command.ts` will own argument parsing, command entry, context construction, status evaluation/promotion, and preflight/recovery output. It will import the remaining lifecycle helpers from `integrate.ts`; `integrate.ts` will re-export the command-facing API. This one-way dependency avoids a circular import and preserves the existing `integrate.js` import route.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Extracted command module owns the named entry, context, parsing, status, and preflight symbols | `src/adapters/cli/commands/integrate-command.ts` | Planned |
| Existing callers retain the integrate import route | `src/adapters/rebase/rebase-workflow-adapter.ts`, `src/adapters/cli/commands/resolve-conflict.ts`, `src/composition/create-cli.ts`, `test/task-1431-integration-preflight-repro.test.ts` | Mapped |
| Existing command behavior remains covered during the extraction | `test/task-1431-integration-preflight-repro.test.ts`, `test/task-2340-hook-rebounce.test.ts`, `test/e2e-mission-lifecycle.test.ts` | Planned |
| Approximate line-count movement is verified against the mission parent | `git diff bb5bc813d --stat -- src/adapters/cli/commands/integrate.ts src/adapters/cli/commands/integrate-command.ts` | Planned |
| Static analysis passes on the final tree | `./scripts/verify-local.sh static-analysis` | Planned |

Next action: move the mapped command boundary into `src/adapters/cli/commands/integrate-command.ts` and add facade re-exports.
