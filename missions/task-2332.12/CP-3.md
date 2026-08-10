# CP-3 — CLI interface, composition wiring, mocked-port tests

## Summary

- Added `src/interfaces/cli/rebase.ts`: `parseRebaseCliRequest` (positional slug
  plus `--push`, no filesystem or adapter access), the renderers
  (`renderRebaseUsage`, `renderUnknownRebaseOptions`), and `createRebaseCommand`,
  which parses, renders, delegates to the runner and maps the workflow's exit
  callback onto the command's exit code. `createRebaseCommandForUseCase` binds a
  pre-composed `RebaseCommandUseCase`, mirroring `createIntegrateCommand`.
  Unrecognized options are collected and passed through rather than rejected,
  and their advisory is rendered at debug level only: the pre-extraction command
  ignored them silently, so both the exit codes and the default output stay
  identical for every invocation (SC7).
- Wired the composition root: `src/composition/create-cli.ts:122` now registers
  `createRebaseCommand(...)` around the existing mission-services factory, so
  `px rebase` reaches the use case through the interface layer.
- Added `test/rebase-use-case.test.ts` — eight tests driving a fully mocked
  `RebaseWorkflowPort` (no real git, Forgejo, agent, backlog or filesystem):
  clean rebase, mission-specific auto-resolve, shared-file agent launch,
  hook-failure auto-bounce, selected-root rejection, plus the interface's flag
  parsing, argv delegation and exit-code mapping. The file classifies into the
  fast default suite, so `test/default-test-suite.test.ts` needed no change.

Gate note: `./scripts/verify-local.sh all` runs the default (hermetic) suite,
which excludes the pre-existing rebase groups; those live in the integration
suite and were run explicitly. The integration suite reports 4 failures, all in
the task-2318/task-2327 SIGKILL temp-directory cleanup groups; they pass when
run on their own (`npm test -- test/task-2327-coverage-gate-tmp-leaks.test.ts
test/task-2318-temp-directory-leaks.test.ts` → 10 pass / 0 fail), touch no
rebase code path, and are load-dependent flakes rather than regressions from
this mission.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC4: `src/interfaces/cli/rebase.ts` owns flag parsing, rendering and exit-code mapping | `src/interfaces/cli/rebase.ts:22` (`parseRebaseCliRequest`), `src/interfaces/cli/rebase.ts:35` + `src/interfaces/cli/rebase.ts:40` (renderers), `src/interfaces/cli/rebase.ts:53` (`createRebaseCommand` exit mapping) | PASS |
| Composition root routes `px rebase` through the interface | `src/composition/create-cli.ts:122` | PASS |
| SC6: new mocked-port tests cover clean rebase, mission-specific auto-resolve, shared-file agent launch, hook auto-bounce, selected-root rejection | `test/rebase-use-case.test.ts`, `"rebase use case completes a clean rebase through mocked ports"`, `"rebase use case auto-resolves mission-specific conflicts with --theirs"`, `"rebase use case launches an agent for shared-file conflicts"`, `"rebase use case auto-bounces a hook failure and retries the rebase"`, `"rebase use case rejects a selected root that is not on the mission branch"` | PASS |
| SC1: adapter keeps one use case instance and one adapter import | `src/adapters/cli/commands/rebase.ts:26`, `src/adapters/cli/commands/rebase.ts:18` | PASS |
| SC2/SC3: use case and port in the application layer | `src/application/rebase-command-use-case.ts:5`, `src/application/ports/rebase-workflow.ts:39` | PASS |
| SC5: existing 48 rebase tests pass unedited | `npm test -- test/rebase.test.ts test/rebase_hardening.test.ts test/rebase_diagnostics.test.ts test/task-2340-hook-rebounce.test.ts test/task-1049-force-push.test.ts` → 97 pass / 0 fail | PASS |
| SC7: CLI behavior unchanged (`--push`, positional slug, output, exit codes) | `test/rebase-use-case.test.ts` (`"rebase CLI interface parses the positional slug and --push without adapter state"`, `"rebase CLI interface maps the workflow exit code onto the command result"`), `test/rebase_hardening.test.ts` (`"rebase uses the selected mission root for rebase state, Git, and publication"`) | PASS |
| SC8: static analysis clean | `./scripts/verify-local.sh static-analysis` → ESLint clean, tsc typecheck clean, test-hygiene clean, test typecheck clean | PASS |
| Mission gate | `./scripts/verify-local.sh all` → 0 fail on the final tree (1892 pass; the runner's reported total varies run to run, 1892–1902 observed) | PASS |

Next action: hand off task-2332.12 for review, flagging that the follow-up re-homes (TASK-2332.13 status/checkpoint, TASK-2332.14 review) can reuse `src/adapters/rebase/rebase-workflow-adapter.ts` as the pattern for binding a command port without touching the restricted adapter packages.
