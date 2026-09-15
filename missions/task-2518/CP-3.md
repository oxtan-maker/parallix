# CP-3 — Drift guard and final verification

## Summary

Added the all-lanes drift guard and the dispatch check to
`test/task-2518-board-action-vocabulary-repro.test.ts`:

- `"every board lane produces only wire-accepted action kinds"` builds cards
  for all six lanes and all three active shapes (stranded, failed gate, live
  work), asserts every lane is populated, JSON-round-trips the snapshot through
  `validateWebBoardSnapshot`, and asserts that the set of emitted card action
  kinds plus attention action kinds equals `Object.values(BOARD_COMMAND_KINDS)`
  — derived from the producer mapping, not a copied literal, so a new board
  command that the transport does not know about fails here. It also pins the
  three attention-borne kinds (`active:execute` for both stranded and
  gate-failed, `review:submit`, `integrate:merge`) and that a live-work mission
  is no attention item at all.
- `"stranded active mission dispatches active:execute through ExecuteMissionService"`
  dispatches `active:execute` for a mission whose stored status is `active`
  through `BoardCommandController` with the in-memory
  `test/fixtures/execute-mission-ports.ts` double. The result is `completed`
  and the launch call is recorded, so `checkStaleCommand` and the domain
  `activate` transition both accept the replacement action and no
  `recover`-specific branch is needed in `board-controller.ts`.

Gate note: the first `./scripts/verify-local.sh all` run failed on a set of
SQLite-backed integration tests. Each failing file passed when run alone
(`npx tsx test/run-default-tests.ts test/task-2337-repro.test.ts`), the parent
commit `6e3f30cdefeedcdafb885661e6fa1445a0bc20f0` flaked on a different,
disjoint set (sandbox/bubblewrap tests) in a clean worktree, and a clean re-run
at this commit exits 0 with no failures. The failures were environmental, not
caused by this change.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC1 no `recover:mission`, no board `'recover'` | `git grep -n "recover:mission" -- src web test` matches only the negative assertion and header comment in `test/task-2518-board-action-vocabulary-repro.test.ts`; `git grep -nE "'recover'" -- src/application/projections src/interfaces/web src/application/controller` returns no matches | PASS |
| SC2 stranded mission: `active:execute` attention action, enabled `active` command targeting lane `active` | `"stranded active mission snapshot validates and advertises active:execute"` in `test/task-2518-board-action-vocabulary-repro.test.ts`; `"attention orphaned-active mission surfaces active resume item"` in `test/attention-orphaned-active-observable.test.ts` | PASS |
| SC3 JSON-round-tripped stranded snapshot validates, wire action `state: 'enabled'`; red at parent | `npm test -- test/task-2518-board-action-vocabulary-repro.test.ts`; red run at `6e3f30cdefeedcdafb885661e6fa1445a0bc20f0` recorded in `missions/task-2518/CP-1.md` | PASS |
| SC4 all-lanes drift guard: emitted kind set equals `BOARD_COMMAND_KINDS`, every snapshot validates | `"every board lane produces only wire-accepted action kinds"` in `test/task-2518-board-action-vocabulary-repro.test.ts` | PASS |
| SC5 `active:execute` for a stranded mission reaches `ExecuteMissionService.execute`, no recover branch in the controller | `"stranded active mission dispatches active:execute through ExecuteMissionService"` in `test/task-2518-board-action-vocabulary-repro.test.ts`; `git grep -n "recover" -- src/application/controller/board-controller.ts` returns no matches | PASS |
| SC6 `resume ▸` / `findings ↩` intact, live-work mission stays ineligible and quiet | `test/board-readers.test.ts` (`"BoardProjectionBuilder queues a gate-failed mission behind its runnable resume"`), `"attention active mission with live work stays quiet"` in `test/attention-orphaned-active-observable.test.ts`, `"board command projection offers active only as a resume, never as a self-transition with live work"` in `test/domain-projections.test.ts` | PASS |
| SC7 both gates green, no focused or skipped markers | `./scripts/verify-local.sh static-analysis` exits 0; `./scripts/verify-local.sh all` exits 0 (2624 tests, 0 failures); `git grep -n "test.only\|\.skip(\|todo(" -- test/task-2518-board-action-vocabulary-repro.test.ts` returns no matches | PASS |
| NEL stop rule (≤235 net engineering lines) | `git diff --stat 6e3f30cde HEAD -- src test web`: 11 files changed, 135 insertions(+), 45 deletions(-) | PASS |

Next action: hand off for review — all three checkpoints are committed and both mission gates pass at this commit.
