# CP-4 — AC #2 / #3 / #4 focused tests and mission gate

Added the focused tests the mission requires and closed the documentation gap:

- **AC #2** — a dedicated conflict-resolver prompt test asserting the shared
  completion contract while proving the pre-existing "unexpected file → stop"
  rule survived it, plus contract assertions on the rebound fix prompt and on
  the handoff shared-file bounce message.
- **AC #3** — a spawn-tee test that spies the child's `kill`/`disconnect` and
  asserts they are never called across repeated liveness reports, and that the
  result comes from the child's own clean close.
- **AC #4** — the CP-1 regression test (output → still running → later reports)
  is green, joined by a payload test for `sawOutput` / `msSinceLastOutput`.
- `docs/agents.md` "Launch output watchdog" now states the observational,
  never-kill contract and documents the post-output message shape.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC1 — every in-scope prompt states the completion contract | `"buildAgentResolutionPrompt states the execute-verify-report completion contract"` (`test/resolve-conflict.test.ts`), `"task-2386: the rebound fix prompt states the execute-verify-report completion contract"` (`test/task-2377.03-rebound-kernel.test.ts`), `"performHandoff fails when rebase returns sharedFileConflicts=true"` (`test/handoff.test.ts`), `"buildRebasePrompt contains mission-specific and shared file sections"` (`test/rebase.test.ts`); single source in `src/application/agent-completion-contract.ts` | PASS |
| SC2 — shared-file rebase prompt commands `git add` + `git rebase --continue` | `test/rebase.test.ts`, `"buildRebasePrompt contains mission-specific and shared file sections"` asserts `git add "<file>"` and `git rebase --continue` | PASS |
| SC3 — watchdog is observational and never kills/cancels | `"spawnAndTee liveness watchdog never kills, signals, or cancels the child"` (`test/spawn-tee.test.ts`) asserts no `kill`/`disconnect` and `result.signal === null`; `grep -nE 'kill|terminate|cancel|\.exit\(' src/adapters/process/spawn-tee.ts` matches only the doc comment | PASS |
| SC4 — periodic liveness continues after first output until settle | `"spawnAndTee continues liveness reports after visible output until the child settles"` and `"spawnAndTee liveness reports carry sawOutput and the age of the last output"` (`test/spawn-tee.test.ts`) | PASS |
| SC5 — mission gate passes on the final tree | `./scripts/verify-local.sh static-analysis` → "Static Analysis Gate: ALL STAGES PASSED" (ESLint, tsc typecheck, test-hygiene, test typecheck) | PASS |
| SC6 — no focused or unannotated skipped tests introduced | `grep -nE '\.only\(\|it\.skip\(\|test\.skip\(' test/spawn-tee.test.ts test/resolve-conflict.test.ts test/task-2377.03-rebound-kernel.test.ts test/handoff.test.ts test/rebase.test.ts` returns nothing; test-hygiene stage of `./scripts/verify-local.sh static-analysis` is clean | PASS |
| Focused suites green together | `npm test -- test/spawn-tee.test.ts test/resolve-conflict.test.ts test/task-2377.03-rebound-kernel.test.ts test/handoff.test.ts test/rebase.test.ts` → 184 pass / 0 fail / 0 skipped | PASS |
| Watchdog behaviour documented | `docs/agents.md`; `test/spawn-tee.test.ts`, "spawnAndTee continues liveness reports after visible output until the child settles" | PASS |

Next action: hand the branch to review; the reviewer should confirm the observational watchdog does not make normally-chatty agents noisy in the custom-agent smoke run, since the mission flags log volume as the one accepted risk.
