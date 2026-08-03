# CP-1 — Characterize the current execute workflow

## Summary

Enumerated every step, ordering rule, failure branch, and operator message on the
`px active` path and pinned them with a new characterization suite that passes
against the **unchanged** tree.

### Enumerated current behavior (source of truth for the extraction)

Request guards — `src/application/active-service.ts:21-23`:

1. missing `operationId`/`slug` → `rejected('validation', 'operationId and slug are required')`
2. missing `active:execute` capability → `rejected('capability', …)`
3. `cancellation.requested` → `failure('cancelled', 'cancelled before launch')` — no port call

Preparation — `src/platform/runtime/lib/adapters/legacy-active-adapter.ts:59-74`:

4. slug not `task-` prefixed → `'slug must begin with task-'`
5. `preflight` fails → `'execute preflight failed'`
6. `resolveWorktree` null → `'dedicated execute worktree is required'`
7. then, in this exact order: `resolveTaskFile` → `buildCheckpointContext` →
   `readAgentConfig` (+ operator blocklist overlay, `legacy-active-adapter.ts:165-171`) →
   `buildExecutePrompt`; the result is stashed per slug in a `Map`
   (`legacy-active-adapter.ts:36`, the state this mission must make explicit).

Launch — `legacy-active-adapter.ts:76-95`:

8. `selectLaunchAndRecord` with the preselected agent
9. `result.error` → `Could not start execute agent (<agent>): <message>`
10. numeric non-zero `result.status` → `Execute agent (<agent>) exited with status N.`
11. the agent that actually ran (`launch.agent`, possibly a limit-hit fallback family)
    becomes the canonical implementer for record, telemetry, and handoff.

Durable record — `legacy-active-adapter.ts:97-129`:

12. `enforceExecuteCommitSafety` always runs first
13. only when `taskResolution.ok && taskFile`: read status, and synchronize the
    lifecycle when `rebaseDeferred || (status && status !== 'active')`
    (`legacy-active-adapter.ts:109`) — the load-bearing deferred-rebase condition
14. synchronization goes through `MissionLifecycleService` over the injected
    `MissionTransitionStore` (`legacy-active-adapter.ts:145-156`); a refusal is
    fail-closed with `'legacy task lifecycle synchronization failed'`
15. telemetry (`resolveAgentModel` → `resolveStageTelemetry` → `recordActiveStats`)
    is best-effort: its errors are swallowed (`legacy-active-adapter.ts:113-127`)

Cancellation / handoff — `active-service.ts:32-35`, `legacy-active-adapter.ts:131-137`:

16. cancellation observed after the record step → `'cancelled after durable launch; re-query task state'`
    with **both** evidence records retained and no handoff
17. `runHandoffAndReview` false → `'legacy handoff failed'`
18. progress events are emitted as sequence 1 `launch`, 2 `record`, 3 `handoff`
    (the third carries the agent name).

### Test added

`test/execute-mission-characterization.test.ts` — 17 tests covering all eight
Success-Criteria scenarios plus the telemetry-non-fatal, fail-closed-lifecycle,
deferred-rebase, and explicit-state properties. The file's only
construction-aware code is the `buildExecuteWorkflow` factory
(`test/execute-mission-characterization.test.ts:16-25`); CP-4 rewires that
factory to the new use case and ports while every expectation stays identical.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Characterization test asserts `active` success ordering and progress sequence | `test/execute-mission-characterization.test.ts:91`, `"execute workflow: success runs preflight, prepare, launch, record, telemetry, handoff in order"` | PASS |
| Characterization test asserts agent fallback / relaunch retry behavior | `test/execute-mission-characterization.test.ts:153`, `"execute workflow: an agent fallback is reported, recorded, and handed off as the agent that actually ran"`, `"execute workflow: a handoff relaunch retry that recovers still completes the launch"` | PASS |
| Characterization test asserts handoff-and-review failure | `test/execute-mission-characterization.test.ts:187`, `"execute workflow: handoff-and-review failure surfaces as an execution failure after durable evidence"` | PASS |
| Characterization test asserts non-zero agent exit status | `test/execute-mission-characterization.test.ts:203`, `"execute workflow: a non-zero agent exit status stops before safety, telemetry, and handoff"` | PASS |
| Characterization test asserts cancellation before launch | `test/execute-mission-characterization.test.ts:236`, `"execute workflow: cancellation before launch touches no mechanism port"` | PASS |
| Characterization test asserts cancellation after durable launch, including `cancelled after durable launch; re-query task state` | `test/execute-mission-characterization.test.ts:249`, `"execute workflow: cancellation after durable launch keeps both evidence records and skips handoff"` | PASS |
| Characterization test asserts preflight failure message `execute preflight failed` | `test/execute-mission-characterization.test.ts:269`, `"execute workflow: preflight failure rejects with \"execute preflight failed\" before worktree resolution"` | PASS |
| Characterization test asserts `dedicated execute worktree is required` | `test/execute-mission-characterization.test.ts:284`, `"execute workflow: a missing dedicated worktree rejects with \"dedicated execute worktree is required\""` | PASS |
| Telemetry failure is non-fatal (risk mitigation for `legacy-active-adapter.ts:113-127`) | `test/execute-mission-characterization.test.ts:111`, `"execute workflow: telemetry failure cannot fail a launch"` | PASS |
| Deferred-rebase condition characterized before the move (`legacy-active-adapter.ts:109`) | `test/execute-mission-characterization.test.ts:121`, `"execute workflow: a task already active without a deferred rebase skips lifecycle synchronization"` | PASS |
| Checked `MissionTransitionStore` path is fail-closed | `src/platform/runtime/lib/adapters/legacy-active-adapter.ts:145`, `"execute workflow: lifecycle synchronization fails closed when the Mission authority refuses activation"` | PASS |
| Suite passes against the unchanged tree | `npm test test/execute-mission-characterization.test.ts` — 17 pass / 0 fail | PASS |
| `test/active.test.ts` untouched | `test/active.test.ts`, `npm test test/active.test.ts` — unmodified, passing | PASS |

Next action: CP-2 — declare the five mechanism ports in
`src/application/ports/execute-mission.ts` (`MissionWorkspacePort`,
`AgentExecutionPort`, `MissionTransitionStore` reuse, `ExecuteTelemetryPort`,
`HandoffReviewPort`) and re-export them from `src/application/ports.ts`, with no
consumer changes yet.
