# CP-3: Mission gate and completed goal check

## Summary

Ran the mission-declared gate `./scripts/verify-local.sh all` on the committed
mission tree: exit status 0, 2559 unit tests passing, 0 failures, within the
unit-test budget. Refreshed the code knowledge graph with `graphify update .`
after the production change.

Final state of the mission:

- `test/task-2503-repro.test.ts` holds the reproduction (red at the mission
  parent commit, green after CP-2) plus the local-classification guard.
- `src/application/rebase-workflow.ts` captures the recorded implementer at the
  rebase boundary from the mission record (review state), falling back to the
  Backlog task file, and routes shared-file conflict recovery and the hook
  bounce through that single captured value.
- Unavailable or stale local mission metadata stays a local workflow condition;
  ADR 0048's dispatch table maps the "no recorded implementer … cannot launch
  conflict resolution" diagnostic to `StateMachineViolation`, never
  `InfraBlocker`.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| A regression test starts a rebase with recorded implementer A, replayed metadata exposes implementer B, and it failed at the mission parent commit | `test/task-2503-repro.test.ts`, test name "shared-file rebase recovery dispatches the implementer recorded before commit replay"; at commit `683865f72` the run reported `'qwen' !== 'claude'` (pre-fix baseline, before `99e135ca2`) | Met |
| Shared-file conflict recovery dispatches recorded implementer A; the regression test passes after the fix | `npm test -- test/task-2503-repro.test.ts` passes; asserts `step === 'conflict-resolution'`, `options.agent === 'claude'`, `role === 'implementer'`, `pinnedAgent === true` | Met |
| The recovery path reports unavailable/stale local mission metadata as a local workflow condition, with no Forgejo or network attribution | Test name "unavailable local mission metadata is reported as a local workflow condition, not an infrastructure blocker" in `test/task-2503-repro.test.ts`; ADR 0048 classification of that diagnostic in `src/application/failure-classification.ts` (`StateMachineViolation`, not `InfraBlocker`) | Met |
| `./scripts/verify-local.sh all` exits successfully on the completed mission tree | `./scripts/verify-local.sh all` → exit 0, `tests 2559 / pass 2559 / fail 0` | Met |
| No regression in the existing rebase and conflict-pinning behaviour | `npm test -- test/rebase.test.ts test/rebase-use-case.test.ts test/rebase_hardening.test.ts test/rebase_diagnostics.test.ts test/task-2377-02-pre-review-rebase-inprocess.test.ts test/task-2294.01-repro.test.ts` all pass | Met |

Next action: hand the mission to review; no further code change is pending for
task-2503.
