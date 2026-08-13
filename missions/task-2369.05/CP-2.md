# CP-2: Gate environment, final-tree capture, worktree helpers, and gate execution moved

## Work Summary

Moved the remaining five helpers verbatim from `src/adapters/cli/commands/integrate.ts` into `src/adapters/cli/commands/integrate-gates.ts`:

- `buildIntegrationGateEnv()`
- `captureFinalIntegrationTree()`
- `resolveIntegrationVerificationWorktree()`
- `buildIntegrationVerificationInvocation()`
- `executeIntegrationGates()`

`parseIntegrateArgs()` and the `--real-agent` option constants stayed in `integrate.ts`: they are argument parsing, not gate orchestration, and are out of the mission's move list.

`integrate-gates.ts` gained the dependencies those bodies need — `node:child_process` and `import * as verification` with the same `const { formatVerificationCommand } = verification;` destructure `integrate.ts` used, so the module-mock harness keeps intercepting verification the same way.

`integrate.ts` now imports all thirteen helpers it uses or re-exports from `integrate-gates.js`. The gate block inside `integrate()` (verification invocation, final-tree capture, gate environment, `bash -c` spawn) is unchanged and now calls the imported functions. `IntegrateFn`'s `typeof` members and the `(integrate as any).X = X` attachments resolve to the imported bindings, so the command object's runtime surface is byte-identical. Dependency direction remains one-way with no cycle.

Extended `test/task-2369.05-integrate-gates.test.ts` to cover all fourteen extracted names plus verification-worktree resolution and invocation construction, both driven through injected `resolveWorktreeFn` / `conventionalWorktreePathFn` / `formatVerificationCommandFn` — no real worktree, Forgejo, or agent contact.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| All fourteen listed functions owned by the new module | `src/adapters/cli/commands/integrate-gates.ts` (14 `export function` / `export async function` declarations covering the mission's list) | PASS |
| `integrate.ts` no longer defines any of them | test `"integrate.ts keeps no second implementation of the extracted gate helpers"` in `test/task-2369.05-integrate-gates.test.ts` | PASS |
| Existing consumers keep every helper they import | test `"integrate re-exports the extracted gate helpers as the same functions integrate-gates owns"` in `test/task-2369.05-integrate-gates.test.ts` | PASS |
| Verification-worktree resolution and invocation preserved | tests `"integrate-gates resolves the verification worktree from the mission worktree before the conventional path"` and `"integrate-gates falls back to the conventional worktree path when the mission worktree is unresolved"` in `test/task-2369.05-integrate-gates.test.ts` | PASS |
| Gate environment, final-tree capture, and gate execution behaviour preserved | `node --import tsx --experimental-test-module-mocks --test test/task-2369.05-integrate-gates.test.ts test/integration-pipelines.test.ts test/integrate.test.ts` — 121 pass, 0 fail, 10 skipped (pre-existing task-1302 host-coupled skips) | PASS |
| Lint clean on the touched files | `npx eslint src/adapters/cli/commands/integrate.ts src/adapters/cli/commands/integrate-gates.ts test/task-2369.05-integrate-gates.test.ts` — no output | PASS |
| No new type errors | `npx tsc --noEmit -p tsconfig.json` — same 5 pre-existing `src/adapters/cli/commands/stats.ts` errors, none in the touched files | PASS |

Next action: confirm no duplicate helper implementations remain across the boundary, run the mission gate `./scripts/verify-local.sh static-analysis`, and record the final goal check in CP-3.
