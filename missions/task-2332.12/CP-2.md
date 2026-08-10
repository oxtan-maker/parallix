# CP-2 — CLI adapter delegates to the use case

## Summary

`px rebase` now runs entirely through `RebaseCommandUseCase`:

- Added `src/adapters/rebase/rebase-workflow-adapter.ts` — the single place
  where the workflow is bound to concrete adapters. `createRebaseWorkflowPort()`
  maps the historical `*Fn` option seam onto `RebaseWorkflowPort`, so every
  existing caller and test injects exactly the doubles it did before. It also
  hosts the two adapter-resolved helpers the port declares
  (`missionConflictPathPrefix`, `resolvePromptBaseBranch`) and the legacy
  `handleHookFailureAutoBounce` / `buildRebasePrompt` wrappers.
- Rewrote `src/adapters/cli/commands/rebase.ts` from 950 lines to 42: it
  constructs one `RebaseCommandUseCase` over the port and re-exports the policy
  helpers (`classifyHookFailure`, `parseConflictFilesFromGitStatus`,
  `parseConflictFilesFromRebaseOutput`, `buildRebasePrompt`,
  `handleHookFailureAutoBounce`) that other modules and tests import. It imports
  one adapter package (`../../rebase/rebase-workflow-adapter.js`), down from
  eight (git, agents, forgejo, backlog, review, config, verification,
  filesystem) plus the integrate command.

Behavior parity notes:

- The rebounce seam is reproduced exactly: the port's
  `handleHookFailureAutoBounce` forwards only `{ startAgentFn, exitFn,
  missionStore }`, which is what the pre-extraction command passed; every other
  rebounce dependency still resolves to its real adapter (R1).
- `resolveConflictsForMission` is still read off the integrate command module at
  port-construction time and is only renamed at the port boundary (R2).
- No CLI flags changed: `--push` and the positional slug are parsed exactly as
  before inside the workflow (A2, SC7).

No test file was edited: the existing 48 rebase tests drive the new path through
the unchanged `*Fn` seam (R3 — port injection and `test/lib/module-mock.ts`
coexist untouched).

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC1: adapter delegates to exactly one `RebaseCommandUseCase` and imports ≤2 adapter packages | `src/adapters/cli/commands/rebase.ts:26` (single `new RebaseCommandUseCase(...)`), `src/adapters/cli/commands/rebase.ts:18` (only adapter import: `../../rebase/rebase-workflow-adapter.js`) | PASS |
| Rebase policy no longer lives in the CLI adapter | `src/adapters/cli/commands/rebase.ts` is 42 lines (was 950); policy at `src/application/rebase-workflow.ts:344` | PASS |
| Port bound to concrete adapters in one place | `src/adapters/rebase/rebase-workflow-adapter.ts:154` (`createRebaseWorkflowPort`) | PASS |
| R1: hook rebounce seam unchanged (`{ startAgentFn, exitFn, missionStore }` only) | `src/adapters/rebase/rebase-workflow-adapter.ts:226`, tests `"rebounces a second initial-rebase hook failure before stranding at the budget"`, `"rebounces every failed rebase --continue until the persisted budget strands"` | PASS |
| SC5: existing rebase tests pass unedited against the mocked ports | `npm test -- test/rebase.test.ts test/rebase_hardening.test.ts test/rebase_diagnostics.test.ts test/task-2340-hook-rebounce.test.ts test/task-1049-force-push.test.ts` → 97 pass / 0 fail | PASS |
| SC7: CLI behavior unchanged (args, output, exit codes) | `test/rebase_diagnostics.test.ts` (`"rebase reports git output and hook hints on non-conflict failure"`), `test/rebase.test.ts` (`"rebase exits 0 on clean rebase"`, `"rebase exits 1 when base is not an ancestor of HEAD"`) | PASS |
| Architecture guards still green | `test/application-boundaries.test.ts`, `test/dependency-graph.test.ts`, `test/adapters/single-path-guardrail.test.ts`, `test/fmt-enforcement.test.ts` → 31 pass / 0 fail | PASS |
| SC8 partial: static analysis clean on changed files | `./scripts/verify-local.sh static-analysis` (`npx eslint src/adapters/rebase/rebase-workflow-adapter.ts src/adapters/cli/commands/rebase.ts` — no findings; `npm run typecheck` clean) | PASS |

Next action: CP-3 — add `src/interfaces/cli/rebase.ts` with `parseRebaseCliRequest` plus `createRebaseCommand`, wire it in `src/composition/create-cli.ts` in place of the direct `rebase` import, add the five mocked-port tests (clean rebase, mission-specific auto-resolve, shared-file agent launch, hook-failure auto-bounce, selected-root rejection), then run `./scripts/verify-local.sh all`.
