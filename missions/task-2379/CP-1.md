# CP 1 — Baseline + red reproduction

## Summary

Recorded the baseline and authored the red reproduction test that locks the
approval-boundary divergence.

- `BASELINE_SHA` = `7b42e7f8634812159b14128fe048fb10b16134b5` (parent commit on
  `mission/task-2379`).
- Working tree at baseline: only `M package-lock.json` (pre-existing, unrelated
  version-bump diff; left untouched). No other modified files.
- Confirmed the baseline approval producer that bypasses the `decidedAt`
  boundary: the `defaultUserApproved` human-override preflight path in
  `src/adapters/cli/commands/integrate.ts`. It is only an integrate-preflight
  boolean; it never persists a `ReviewerDecision` and never fires the
  `review → integration` boundary. The unbound `bindReviewPersistence(...)`
  call site in `src/composition/create-cli.ts` (the `review-event` command) was
  also confirmed as a second baseline candidate — it calls
  `bindReviewPersistence(services.mission.store)` with no lifecycle service.

Authored `test/task-2379-approval-boundary-repro.test.ts`: the 10:00 review /
10:30 human-approval / 14:00 integrate / 14:15 land fixture driven through the
`defaultUserApproved` override producer, asserting `Mission.status =
integration`, `review → integration occurredAt = 10:30`, exactly one
`integration → done @ 14:15`, and dwell 30m / 225m through the Board/FLOW
lifecycle projection (`medianCycleTimeByStateSeries`).

Ran it at the parent commit and captured the exact red failure output:

```text
[FAIL] Mission task-2379-repro is in review without an authoritative approval. Record a ReviewerDecision through px review before integration.
✖ delayed integration: review dwell is 30m and integration dwell is 225m (R2) (51.922487ms)
ℹ tests 1
ℹ pass 0
ℹ fail 1
...
  Error
      at recoverMissionForIntegration (/home/magnus/code/parallix-task-2379/src/adapters/cli/commands/integrate.ts:951:11)
      at async TestContext.<anonymous> (/home/magnus/code/parallix-task-2379/test/task-2379-approval-boundary-repro.test.ts:157:5)
```

The failure is the baseline behavior: the human override is not persisted as a
`ReviewerDecision`, so `recoverMissionForIntegration` rejects with
`IntegrationAbort` before any `review → integration` transition exists. This
test goes green once CP 3/CP 4 make the override persist a real
`ReviewerDecision` and fire the boundary at `decidedAt`.

Baseline sanity: the pre-existing lifecycle/stats regression suites are green
at the parent commit, so the red is specific to the new repro, not a broken
baseline:

```text
✔ R2: delayed integration dwell — review 30m, integration 225m
✔ R8: direct review → done forbidden — integrate requires integration status
✔ R10: first-pass approval yields known reviewFixRounds=0
✔ R13: missing MissionStore cannot activate heuristic inference
✔ R5: human px review approval persists ReviewerDecision and lands integration at decidedAt without a second approval
ℹ tests 14
ℹ pass 14
ℹ fail 0
```

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Baseline SHA and working-tree state recorded | `BASELINE_SHA = 7b42e7f8634812159b14128fe048fb10b16134b5`; `git status --short` shows only `M package-lock.json` | PASS |
| Red reproduction locks the approval-boundary divergence | `test/task-2379-approval-boundary-repro.test.ts`; `npm test -- test/task-2379-approval-boundary-repro.test.ts` fails at parent `7b42e7f86` with `IntegrationAbort` in `recoverMissionForIntegration` | PASS |
| Repro asserts `review → integration occurredAt = decidedAt` and dwell 30m/225m | `test/task-2379-approval-boundary-repro.test.ts`, test `"delayed integration: review dwell is 30m and integration dwell is 225m (R2)"`; projection `medianCycleTimeByStateSeries` in `src/application/projections/metrics.ts` | PASS |
| Baseline regression suites green at parent (red is specific) | `npm test -- test/task-2376-lifecycle-timing.test.ts test/task-2378-authoritative-stats.test.ts` → 14 pass / 0 fail | PASS |

Next action: CP 2 — inventory + invariant proof. Trace every approval producer, every `bindReviewPersistence` call site, the `defaultUserApproved` flow, `recoverMissionForIntegration`, the `deriveImplementerAndFixRounds` caller graph, and every external-inference reader; prove from `src/domain/mission-workflow.ts` that a Mission cannot reach `integration` without a Review aggregate.
