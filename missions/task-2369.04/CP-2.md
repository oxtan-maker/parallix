# CP-2: Extract command orchestration

Moved the command entry, argument parser, integration context, task-status helpers, preflight, recovery guidance, and command option constants into `integrate-command.ts`. The existing `integrate.ts` module imports and re-exports that API, while command orchestration imports its remaining lifecycle helpers from the facade without the facade importing itself.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| The named command-facing symbols live in the extracted module | `src/adapters/cli/commands/integrate-command.ts` | Complete |
| Existing callers keep their `integrate.js` import route | `src/adapters/cli/commands/integrate.ts`, `test/task-1431-integration-preflight-repro.test.ts` | Complete |
| Argument parsing, context, status promotion, and preflight behavior are preserved | `node --test --import tsx test/task-1431-integration-preflight-repro.test.ts`; "printIntegrationPreflight resolves classification from the mission base worktree, not process.cwd()" | Complete |
| Command/lifecycle line movement is measurable from the mission parent | `git diff bb5bc813d --stat -- src/adapters/cli/commands/integrate.ts src/adapters/cli/commands/integrate-command.ts` | Complete |
| Static analysis passes on the final tree | `./scripts/verify-local.sh static-analysis` | Pending CP-3 |

Next action: verify the facade import routes, final line-count movement, and required static-analysis gate.
