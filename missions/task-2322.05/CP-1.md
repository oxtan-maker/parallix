# CP-1: Covered call paths mapped and characterized

## Summary

Mapped every call path this mission covers and added characterization coverage
for the observable behavior each one has today, so the later rerouting can be
checked against a recorded contract rather than an assumption.

**Call-path map (pre-mission behavior).**

| Covered operation | Entry point | Durable effect today |
|---|---|---|
| Intake | `px draft` writes the Backlog task document; the board's `draft:create` was an unavailable capability (`src/application/controller/board-command.ts`) | Task Markdown under `backlog/tasks/` |
| Activation | `ActiveService.execute` → `LegacyActiveAdapter.recordLaunch` → `transitionTask` (`src/platform/runtime/lib/adapters/legacy-active-adapter.ts`) | Task frontmatter `status`/`assignee`, committed on the integration branch |
| Checkpoint | `px checkpoint` runs the gate, then `git add -A`, then `git commit` (`src/platform/runtime/lib/commands/checkpoint.ts`); the board's `checkpoint:record` was unavailable | `CP-N.md` documents in the mission directory (Git) |
| Handoff / NEL | `performHandoff` → `captureNelAtHandoff` computed NEL from `primary..HEAD`, read the predicted bucket from `MISSION.md`, read rounds from `review-state.json`, and wrote `nel-record.json` | `nel-record.json`, staged and committed before the Backlog transition |
| Checkpoint read | `ConcreteMissionReadAdapter` materialized checkpoints with `goalCheck: []` and `nextActionText: ''` | none (read-only projection) |

**Pre-existing behavior recorded rather than changed.** `performHandoff` logs
`nelResult.bucket.label` while `captureNelAtHandoff` returns `bucket` as a
string, so the PASS line reads `(undefined bucket)`. That is out of this
mission's scope and is intentionally left as-is; the characterization pins the
returned shape (`bucket: 'Small'`) so a later fix is a deliberate change.

**Characterization added.** `test/task-2322-05-cli-characterization.test.ts`
pins the `checkpoint` command's gate→stage→commit ordering and its
gate-failure stop, plus the NEL capture's effect ordering, its fail-closed
result, and the skipped-capture result when no primary branch is detectable.
The `.test-runtime` builder now also emits `src/domain`, because the covered
paths reach domain *values* (rule violations, factories, policy) and not only
erasable types.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC5 — checkpoint CLI success path and external-effect ordering characterized | `"SC5 characterization: checkpoint runs the gate, then stages, then commits, in that order"`, `test/task-2322-05-cli-characterization.test.ts` | PASS |
| SC5 — checkpoint CLI failure path characterized (no Git effect after a failed gate) | `"SC5 characterization: a failed gate stops checkpoint before any Git effect"` | PASS |
| SC5 — handoff NEL capture ordering and result characterized | `"SC5 characterization: NEL capture observes the primary branch first, then records the mission"`, `src/platform/runtime/lib/commands/handoff.ts:1098` | PASS |
| SC5 — handoff NEL failure results characterized (fail closed vs skipped) | `"SC5 characterization: a refused Mission write makes NEL capture fail closed"`, `"SC5 characterization: an undetectable primary branch is a skipped capture, not a failure"` | PASS |
| SC2 — activation call path identified for rerouting | `src/platform/runtime/lib/adapters/legacy-active-adapter.ts:80`, `"legacy active adapter preserves the launch-synchronize-stats-handoff lifecycle order"` | PASS |
| SC3 — checkpoint compatibility representation identified | `src/platform/runtime/lib/commands/checkpoint.ts:52`, `src/adapters/backlog/concrete-mission-read-adapter.ts:273` | PASS |
| Characterization suite runs in the gate | `` `./scripts/verify-local.sh all` `` — 1549 tests, 0 fail | PASS |
| Domain values reachable from the CommonJS test runtime | `scripts/build-test-runtime.ts:27`, `npm test -- test/task-2322-05-cli-characterization.test.ts` | PASS |

Next action: Define the checked Mission use cases (intake, lifecycle, checkpoint, handoff) plus the Mission repository port additions, and prove them against isolated SQLite fixtures.
