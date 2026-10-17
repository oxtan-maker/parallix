---
id: TASK-2770
title: >-
  Fix web board cold observer timeout loop after TASK-2750 and cover real board
  loading
status: done
assignee: [codex]
created_date: '2026-10-16 08:20'
updated_date: '2026-10-16 08:23'
labels:
  - bug
dependencies: []
priority: high
ordinal: 257008
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Regression introduced by TASK-2750 (aa1bd73db547afd62a19b82619ca71e96b93a87a): after rebuilding, node build/px.mjs web can serve its shell while the board never loads or repeatedly reports observation failures.

Root cause confirmed
- src/composition/cli-read-commands.ts switched web board reads from the existing builder to workflowObservationCapabilities().board.
- src/composition/workflow-observation.ts applies a fixed 10,000 ms deadline to each request, including observer startup, graph composition and the first full production board projection. On timeout it rejects the request and sends SIGTERM to the observer.
- Cold projection on this populated repository exceeds that deadline. Killing the observer discards BoardProjectionBuilder.metricsCache and launcher caches. The subscription retries with a fresh observer, repeating the expensive cold projection instead of reaching inexpensive warm reads. This is a timeout/cold-cache restart feedback loop, not evidence that the HTTP listener failed to bind.

Read-only investigation evidence (2026-10-16, HEAD 9af4591a8)
- Existing rebuilt bundle observer invoked directly over real IPC, without the parent 10-second deadline, returned a valid board after 12,940 ms.
- Production source graph instrumentation: graph construction 182 ms; board build 12,107 ms in one run. A separate instrumented run measured cold build 10,768 ms, metrics build 9,038 ms (including deriveLifecycleEntries 4,670 ms), followed by a warm build of 395 ms in the same graph. Timings are wall measurements, not CPU budget recommendations; nested async timings are not additive.
- GET http://127.0.0.1:33047/api/board on the already-running node build/px.mjs web returned HTTP 503 and {"kind":"board-snapshot-error","transportVersion":2,"error":{"kind":"unavailable","message":"Workflow observer exited (null)"}}. The host shares concurrent builds; an HTTP request can join a subscription attempt already approaching its deadline and see the resulting exit error.
- The direct observation and instrumentation did not dispatch any workflow or run verification gates. Do not launch recovery against copied live operations during reproduction.

Why verification missed it
- test/integration/presentation/presentation-web.integration.test.ts imports web-package-smoke.integration.cases.ts. The wrapper is in the integration-ci registry; its largest declared CPU limit is 2,000 ms, below the 3,500 ms early-integration cutoff. Thus this smoke IS selected for early integration; this investigation did not audit the historical gate run logs.
- That packaged smoke starts the real packaged web CLI in an empty source-free directory with isolated PARALLIX_HOME and asserts HTML, JS assets and shutdown. It never requests /api/board or proves a mission card renders, so a live shell with a broken production observer passes.
- workflow-observation-isolation.test.ts and the manual workflow-browser-manual.ts exercise injected workflowBoard fixtures, not this populated production board projection. web-board-pointer.test.ts is local-only and uses injected snapshots; it is not a production startup/data smoke.

Fix scope
Preserve independent observation and HTTP responsiveness. Resolve the mismatch between cold projection cost and observer lifetime/deadline without creating infinite waits or simply inflating CPU limits. Investigate bounding/avoiding expensive historical metrics work in initial board delivery, and preserve useful warm observer state while retaining finite failure/shutdown behavior. Review timeout-versus-exit handling so one expired request does not unnecessarily fail unrelated observation requests. The confirmed cause is above; other reported startup/no-output symptoms are not independently established and should be checked with the real CLI smoke.

Separate from TASK-2769, which concerns execution counts and card activity semantics. This task owns production web board availability and the missing real data smoke assertion.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Retain a focused regression that is red on parent behavior and green with the fix: a finite slow cold projection must not cause an endless observer restart loop, and subsequent warm reads succeed.
- [ ] #2 Extend the existing packaged web smoke owner to request /api/board through the real built CLI with an isolated representative repository and operator state; assert a valid snapshot and expected mission data, plus a subsequent successful refresh. Shell-only success must not satisfy the smoke.
- [ ] #3 Manually verify the rebuilt CLI with representative populated isolated state: URL is announced, browser board cards load, refresh succeeds, and shutdown cleans up owned observers. Record actual evidence and avoid mutating live mission state.
- [ ] #4 Preserve observer isolation, finite deadlines and cleanup, and operator-owned gate configuration. Keep any added or modified integration test within 3.5 seconds; use deterministic boundary control rather than a real 10-second sleep.
- [ ] #5 After the first successful load, board reloads must complete within 400 ms end to end, from browser reload initiation to mission cards rendered with a successful board snapshot, on representative populated isolated state. Measure repeated warm reloads through the real rebuilt CLI and browser, including HTTP, serialization and rendering; report first-load timing separately. The observed 395 ms projection alone does not establish compliance with this limit.
- [ ] #6 Restore first-load and subsequent board performance to at least the level of the last main commit on or before 2026-10-13 (three days before this report), while also meeting the explicit 400 ms end-to-end warm reload maximum. Compare that baseline, the parent of TASK-2750, and the fixed tree using identical representative isolated database snapshots, repository inputs, agent probe conditions and hardware; record cold startup-to-render and repeated warm reload-to-render measurements. Identify and fix intervening performance regressions regardless of which mission introduced them. A timeout increase alone is insufficient.
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Operator clarification: first-load latency of 10 seconds is unacceptable. Performance restoration must cover regressions introduced since 2026-10-13, not only TASK-2750. Baseline measurement was requested, then deferred to this task by the operator; no historical baseline timing has yet been measured.

Historical baseline candidate resolved from git: 26e2adac23702dafd3e1389fb3aba070b06780cb (2026-10-13 18:30 +0200, Render Claude output inside hosted mission terminals), the last commit before 2026-10-13 23:59:59 +0200. Verify main ancestry before using it for the comparison.
<!-- SECTION:NOTES:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 Verification gate ran and passed on the final tree with captured proof rather than an unverified claim
- [ ] #2 Lint and static analysis report clean on every changed file
- [ ] #3 No focused or unannotated skipped tests were introduced (no .only and no bare .skip)
- [ ] #4 Final checkpoint Goal Check table cites real evidence using file:line references and test names
- [ ] #5 Docs updated to reflect any workflow or user-facing behavior change
- [ ] #6 Bug-labeled missions include a red-to-green reproduction test that fails before the fix and passes after
<!-- DOD:END -->
