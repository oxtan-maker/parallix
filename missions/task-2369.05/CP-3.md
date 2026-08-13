# CP-3: Boundary confirmed; static-analysis gate blocked by a pre-existing `main` failure

## Work Summary

Confirmed the extraction boundary holds and no helper is implemented twice:

- `src/adapters/cli/commands/integrate-gates.ts` declares all fourteen extracted functions; `src/adapters/cli/commands/integrate.ts` declares none of them and imports the thirteen it uses or re-exports (`getIntegrationConfigPath` is internal to the new module and had no consumer in `integrate.ts`).
- Test `"integrate.ts keeps no second implementation of the extracted gate helpers"` asserts the absence of duplicate definitions for all fourteen helpers; test `"integrate re-exports the extracted gate helpers as the same functions integrate-gates owns"` asserts strict function identity for the thirteen helpers that were already exposed through `integrate.ts` (`getIntegrationConfigPath` remains internal, as before).
- Line movement against the pre-mission baseline `8ca957000`: `integrate.ts` 2366 → 2041 lines (−325), `integrate-gates.ts` 341 lines. Per the mission's Risks section the ~500-line figure is directional; the extracted region is what the fourteen listed functions actually occupy.

**Gate result — blocked, not caused by this mission.** `./scripts/verify-local.sh static-analysis` fails at step 2/4 with 5 TypeScript errors, all in `src/adapters/cli/commands/stats.ts`, a file this mission never touches. Verified as baseline-red: a detached worktree at `origin/main` (`git worktree add --detach /tmp/pmx-base origin/main`, then `npx tsc --noEmit`) emits the identical 5 errors, and `git show origin/main:src/adapters/cli/commands/stats.ts` is byte-identical to the working tree copy. First error line:

```
src/adapters/cli/commands/stats.ts(154,28): error TS7006: Parameter 'value' implicitly has an 'any' type.
```

Repairing `stats.ts` is outside this mission's Scope and its Restricted Areas ("Refactoring unrelated command modules"), so it was left untouched and is escalated here instead. Step 1/4 (ESLint) passes clean, which is the part of the gate this extraction can affect.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| `integrate-gates.ts` owns all fourteen functions and `integrate.ts` defines none of them | `src/adapters/cli/commands/integrate-gates.ts`; test `"integrate.ts keeps no second implementation of the extracted gate helpers"` in `test/task-2369.05-integrate-gates.test.ts` | PASS |
| Existing consumers retain access to every extracted helper they import | test `"integrate re-exports the extracted gate helpers as the same functions integrate-gates owns"` in `test/task-2369.05-integrate-gates.test.ts` (strict identity for all 13 pre-existing `integrate.ts` exports; `getIntegrationConfigPath` was internal) | PASS |
| Changed-area detection and file-to-area parsing preserved | tests `"parseFilesToAreas extracts top-level directories"`, `"parseFilesToAreas ignores unknown directories"`, `"detectChangedAreas returns server and web-client for multi-area mission"` in `test/integration-pipelines.test.ts` | PASS |
| Config loading and config-path resolution preserved | tests `"loadIntegrationConfig parses valid JSON config"`, `"loadIntegrationConfig treats an empty config file as no config present"`, `"loadIntegrationConfig returns ok=false with an invalid JSON error for malformed config"` in `test/integration-pipelines.test.ts` | PASS |
| Gate filtering, ordering, plan rendering, and environment construction preserved | tests `"getIntegrationGatePlan respects run_last ordering - web-e2e with lower order but run_last=true runs last"`, `"printIntegrationGatePlan outputs gate plan lines"`, `"buildIntegrationGateEnv strips config override and forwards mission changed areas"` in `test/integration-pipelines.test.ts`; `"integrate-gates owns gate ordering with run_last gates sorted after the rest"` in `test/task-2369.05-integrate-gates.test.ts` | PASS |
| Verification-worktree resolution and invocation construction preserved | tests `"integrate-gates resolves the verification worktree from the mission worktree before the conventional path"` and `"integrate-gates falls back to the conventional worktree path when the mission worktree is unresolved"` in `test/task-2369.05-integrate-gates.test.ts` | PASS |
| Final-tree capture and gate execution preserved | tests `"executeIntegrationGates uses injected commandRunner and aborts on failure"`, `"executeIntegrationGates rejects an omitted execution root before launching a child"`, `"executeIntegrationGates with injected commandRunner succeeds on all pass"` in `test/integration-pipelines.test.ts` | PASS |
| No regression across every suite that imports `integrate.js` | `node --import tsx --experimental-test-module-mocks --test $(grep -rln "commands/integrate" test/*.ts test/adapters/*.ts)` — branch 282 pass / 13 fail; `origin/main` worktree 276 pass / 13 fail; failing test-name sets are identical (`diff /tmp/base-fails.txt /tmp/mine-fails.txt` empty) | PASS (no new failures) |
| Hermetic tests only | `test/task-2369.05-integrate-gates.test.ts` injects `gitRunner`, `resolveWorktreeFn`, `conventionalWorktreePathFn`, `formatVerificationCommandFn` and reads `test/fixtures/task-2369.05-integration-pipelines.json`; no Forgejo, worktree, or agent contact | PASS |
| `./scripts/verify-local.sh static-analysis` | ESLint step passes (`npx eslint src/adapters/cli/commands/integrate.ts src/adapters/cli/commands/integrate-gates.ts test/task-2369.05-integrate-gates.test.ts` clean); typecheck step fails on 5 pre-existing `src/adapters/cli/commands/stats.ts` errors reproduced unchanged on `origin/main` | BLOCKED (pre-existing on `main`, outside mission scope) |

Next action: escalate the baseline-red `src/adapters/cli/commands/stats.ts` typecheck failure as its own backlog item so `./scripts/verify-local.sh static-analysis` can go green on `main`; re-run the gate on this branch once that lands, with no further change expected to `integrate.ts` or `integrate-gates.ts`.
