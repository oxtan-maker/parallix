# CP 2 — Fix applied; reproduction test turns green

## Summary
Applied the root-cause fix in `src/application/status-command-use-case.ts`. The
use case now resolves the requested mission's branch through the new
`StatusGitPort.missionBranchName(slug, rootDir)` and passes it to
`StatusPrPort.getPrInfo`, instead of passing the current git branch. This routes
through the existing Forgejo `getPrStatus` path via `createStatusPrAdapter`
with no new PR-fetching machinery and no change to the `StatusPrPort`
contract (`getPrInfo(branch: string)`).

Layering: the application layer is forbidden from importing `src/adapters/`
(`test/dependency-graph.test.ts` — `production scan has no violation outside the
owned allowlist`). So instead of importing `missionBranchName` directly, the
branch resolution goes through the `StatusGitPort`, which the production status
command wires via `createStatusGitAdapter` (`src/adapters/cli/commands/status-adapter.ts`),
where the real, per-repo `missionBranchName` (adapter-config-aware) lives. The
legacy single-port `StatusWorkflowAdapter` stub falls back to the default
`mission/` prefix.

The reproduction test `test/task-2419-status-pr-branch-repro.test.ts` now passes
(green). The existing `test/status-command-use-case.test.ts` suite (38 tests)
still passes unchanged. ESLint and `tsc --noEmit` are clean.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC1: branch passed to `getPrInfo` equals `missionBranchName(slug, rootDir)`, not `getCurrentBranch()` | `test/task-2419-status-pr-branch-repro.test.ts` test `"StatusCommandUseCase: PR lookup uses the requested mission branch, not the current branch"` asserts `capturedBranch === 'mission/task-2419'` and `!== 'mission/task-2402'` | PASS |
| SC2: `px status <slug>` reports requested branch's PR | `src/application/status-command-use-case.ts:50` uses `missionBranchName(resolvedSlug, rootDir)`; repro test green | PASS |
| SC3: mission with no PR reports no PR (not current branch's PR) | `getPrInfo` returns adapter's real value; existing `createStatusCommand: renders status and exits 0` test uses `getPrInfo() { return { exists: false }; }` in `test/status-command-use-case.test.ts` | PASS |
| SC4: test asserts PR lookup uses requested mission branch | `test/task-2419-status-pr-branch-repro.test.ts` | PASS |
| SC5: pre-existing status tests pass unchanged | `test/status-command-use-case.test.ts` — 38 tests, 0 failures (`node --test --import tsx test/status-command-use-case.test.ts`) | PASS |
| No `StatusPrPort` interface change / no new port | `src/application/ports/cli-workflows.ts:157` still `getPrInfo(_branch: string)` | PASS |
| Static analysis clean | ESLint clean + `tsc --noEmit` clean on changed files | PASS |

## Next action
Run the full mission gate `./scripts/verify-local.sh all` (CP 3); update docs
only if user-visible behavior changed.
