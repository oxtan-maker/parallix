# Checkpoint 2 — Focused integration regression tests

## Summary of work done
Added two hermetic regression tests and confirmed each is red before the
behavior change and green after.

- `test/task-2506-integrate-rebase.test.ts` — full-flow regression. A stateful
  git double makes the probe merge conflict *only until* the integration rebase
  runs, so the test is red when the rebase is absent (probe merge dead-ends at
  `integrate.ts:749`) and green once the rebase applies the primary's ahead
  commit (`src/app.ts` non-backlog conflict, conflict-free after rebase).
  Asserts the rebase ran before the probe merge and the mission lands to
  `done` with no `Rebase the mission branch before integrating` instruction.
- `test/task-2506-dry-run-rebase.test.ts` — dry-run non-mutation. Drives
  `predictIntegrationRebase` against real git trees (a virtual 3-way
  `git merge-tree`): no-rebase (primary is ancestor), clean rebase (primary
  advanced on an unrelated file), conflict (both sides edit the same line), and
  a HEAD-unchanged check.

Red-to-green evidence (reproducible):
- With the `runIntegrationRebase` call disabled,
  `test/task-2506-integrate-rebase.test.ts` fails (probe merge dead-ends);
  re-enabling it makes it pass.
- `predictIntegrationRebase` is a new export (absent pre-change), so
  `test/task-2506-dry-run-rebase.test.ts` cannot resolve it pre-change (red);
  it passes once exported (green).

Both files use injected git/backlog/forgejo/stats/verification/mission-services
doubles — no real Forgejo, worktree, or agent.

## Goal Check
| Criterion | Evidence | Status |
|---|---|---|
| Clean rebase ordering regression | `test/task-2506-integrate-rebase.test.ts` (probe merge conflict clears only after rebase; mission reaches `done`) | Proven (red→green) |
| Behind-primary, conflict-free integrates without manual rebase | `test/task-2506-integrate-rebase.test.ts` (non-backlog `src/app.ts` conflict) | Proven (red→green) |
| Dry-run non-mutation + needed/conflict reporting | `test/task-2506-dry-run-rebase.test.ts` (HEAD-unchanged + 3 prediction cases) | Proven (red→green) |
| Conflict delegation path covered by existing guard | `test/rebase-use-case.test.ts` (`launches an agent for shared-file conflicts`) unchanged | Proven |
| No real external boundaries | injected doubles in both new files; `test/integrate.test.ts` still 84 tests green | Proven |

## Next action
Write CP-3: run the mission gate (`./scripts/verify-local.sh all`) on the
completed tree and record final Goal Check evidence.
