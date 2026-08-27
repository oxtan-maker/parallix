# CP-1 — Regression test (red) then fix

## Summary of work done
Authoring a genuine red-then-green regression test for a real defect, then fixing
the defect at the current-work reconciliation seam.

The defect: the review loop's own agents run `px review --start` / `--submit` /
`--consume-artifacts`, each a **separate process under its own operationId**
(all three are in `PUBLISHED_PHASES` of `ReviewCommandUseCase`). Their nested
`running({agent: null})` fact superseded the outer `px review --continue` loop's
family-carrying fact — attributing the live continuation as `family unknown` —
and their `ended` then cleared the mission's live current work entirely, even
though the outer process was still alive. Every review round hits this, because
this workflow's own reviewer instructions require `px review --start` /
`--submit` to publish artifacts.

`test/task-2416-review-family-repro.test.ts` publishes, in the order a live
review round actually produces them — the outer `run()` bracket, the loop's
agent-launch fact carrying `claude`, then a nested `running({agent: null})` from
a **different operationId and different live pid**, then that nested operation's
`ended` — and asserts the live review continuation still attributes `claude` and
still reports live work after the nested operation closes.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Regression test fails at the mission parent, then passes after the fix. | `test/task-2416-review-family-repro.test.ts`, test `TASK-2416 repro: a nested px review --start must not shadow the outer review family`. Red at parent: `git stash` of `src/application/projections/current-work.ts`, then `FORCE_COLOR=0 npx tsx --test test/task-2416-review-family-repro.test.ts` → `✖ TASK-2416 repro …` (`ℹ fail 1`). Fixed: same command → `✔ TASK-2416 repro …` (`ℹ pass 3`). | PASS |
| The fix is at the reconciliation seam, not presentation/family-config. | `src/application/projections/current-work.ts` `resolveOperation`: a `running` event from a different, still-alive process no longer supersedes a standing family-carrying `running` fact (new `processAlive` helper). | PASS |

## Red demonstration (parent / pre-fix)
Command: `FORCE_COLOR=0 npx tsx --test test/task-2416-review-family-repro.test.ts`
Pre-fix result:
```
✖ TASK-2416 repro: a nested px review --start must not shadow the outer review family
ℹ pass 2
ℹ fail 1
```
The nested null-family fact supersedes the outer `claude` fact, so
`loadRunningSessions` returns `family: null` instead of `claude`.

## Green result (post-fix)
```
✔ TASK-2416 repro: a nested px review --start must not shadow the outer review family
✔ TASK-2416 guard: a live non-agent operation that publishes a null current-work fact stays family unknown
✔ TASK-2416 guard: a dead recording process shows no family attribution
ℹ tests 3
ℹ pass 3
ℹ fail 0
```

## Next action
Commit the regression test and the reconciliation fix; proceed to CP-2.
