---
id: TASK-2854
title: >-
  Make workflow observations fast and bounded across storage, projections, IPC
  and web delivery
status: backlog
assignee: []
created_date: '2026-11-13 15:27'
labels:
  - bug
  - performance
  - web
dependencies: []
references:
  - src/composition/board-projection.ts
  - src/composition/workflow-observation.ts
  - src/application/projections/historical-board-metrics.ts
  - src/application/projections/metrics-read-adapter.ts
  - src/adapters/sqlite/operational-history-repository.ts
  - src/adapters/verification/verification-read-snapshot.ts
  - src/application/rebound-kernel.ts
  - src/application/rebound-telemetry.ts
  - src/interfaces/web/transport-projection.ts
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The web UI remains responsive through retained snapshots while workflow refreshes repeatedly report "Workflow observation timed out". Make fresh observations fast and bounded across storage, projection construction, observer IPC and browser delivery. A fast cached response does not establish fresh workflow data.

Profiling on 2026-11-13 at commit 0290e8a1d used the live observer and an isolated online SQLite backup with 934 Parallix missions, 100 visible/history cards and approximately 709 MB of database state:

- Production source graph: 9.57 s cold projection, 3.72–4.06 s unchanged warm projections; background historical analytics took 13.15 s. Warm process RSS reached approximately 3.2 GB.
- Actual bundled --workflow-observe child: three board requests sent at 0, 5 and 10 seconds returned after 26.1, 21.1 and 16.2 seconds respectively. All exceeded the parent's 10-second deadline.
- The current web host returned a cached snapshot in 29 ms, explicitly stale with the timeout reason. Another running host returned HTTP 503 after 10.006 s with the exact timeout message. Two web hosts were running; the current host was checked separately.
- Each unchanged warm build launched 72 synchronous child processes, taking 2.87–3.23 s. A 20.29-second live V8 sample attributed approximately 34% of sampled time to synchronous Git and 23% to SQL query stacks; inclusive categories overlap.
- 1,119 rebound.repair records contained 499,888,811 bytes of event JSON. Their fingerprintBefore/fingerprintAfter fields embed full diagnostic text; the largest event was approximately 1.74 MB. The shared analytics history read materialized 65,468 rows in 3.72 s despite an existing compact rebound reader.
- Rich Mission review/checkpoint JSON cache keys cost 172–253 ms per build; broad evidence revision queries cost approximately 200 ms even warm.
- The sampled cached HTTP payload was 2.54 MB, including 2.18 MB of metrics. Chromium warm navigations took 330–364 ms with cached snapshots without FLOW; those browser measurements do not prove fresh observation performance.

These are small diagnostic samples on an active workstation, not p95 benchmarks. Instrumentation adds overhead and nested asynchronous timings are not additive. Temporary profiling files were removed after transferring the findings into this task.

Implementation scope:
- Use compact repository/mission-scoped analytical reads and existing rebound reader; keep raw audit evidence out of hot history snapshots. Persist bounded identity digests and retain full diagnostics through their existing evidence owner; preserve old history compatibility.
- Replace whole-history polling and rich Mission JSON cache keys with revision-based incremental reads and immutable snapshots. Index activity/lifecycle once and reuse immutable SHA proofs. Preserve all statistical attribution, unknowns, malformed-record handling and decision windows.
- Reduce 72 synchronous child calls per warm build: reuse the existing Git and proof-currency owners, consolidate equivalent reads, and use bounded async work at adapters without weakening cleanliness, lineage or proof checks.
- Run analytical reconstruction without blocking current workflow observation or terminal IPC; bound and coalesce queued observations, propagate deadlines, and discard expired work. Preserve finite shutdown and no hung child amplification.
- Keep lightweight current workflow transport independent from bulky historical metrics/detail payloads, with explicit truthful freshness per data family.

Reuse existing owners and typed ports. The current composition includes raw rebound.repair in its general analytical history even though createReboundRepairReader already uses findReboundRepairs. HistoricalBoardMetrics starts reconstruction on the same event loop as current observations; returning a Promise does not isolate synchronous SQL or replay work. VerificationReadSnapshot memoizes within a single board read, leaving repeated currency checks expensive across unchanged builds. Parent request timeouts currently remove pending callers without cancelling expired serial work in the child.

Preserve ports-and-adapters boundaries, composition authority, proof validity, statistical attribution and finite shutdown. Any proposed change to architectural principles requires the separate explicit operator decision required by repository instructions.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A focused regression in the existing owning suite is red on parent behavior and green with the fix for repeated observation timeouts after first load, including background analytics and queued/expired requests; use deterministic boundary and scheduler control rather than real 10-second waits.
- [ ] #2 Hot analytical reads use compact repository/mission-scoped facts and reuse the existing rebound reader; raw diagnostic/fingerprint blobs are not materialized or repeatedly parsed for board analytics. New repair telemetry stores bounded identity digests with diagnostics retained through their existing evidence owner, and existing persisted history remains readable without deleting audit evidence.
- [ ] #3 Unchanged board reads reuse revision-based identities and immutable indexed snapshots instead of rereading/hashing full history or serializing complete Mission reviews/checkpoints. Changed and late evidence invalidates the affected results correctly; statistical attribution, unknown/unavailable states, malformed-record diagnostics and reporting windows remain correct.
- [ ] #4 Repeated Git observations are consolidated through existing Git/proof-currency owners with bounded adapter work. Cleanliness, rebase lineage, current revision and verification proof currency remain authoritative; caching must not pass stale proof or miss dirty worktrees.
- [ ] #5 Historical reconstruction cannot block current workflow observation or terminal IPC. Duplicate reads are coalesced, queued and running work have finite bounds, caller deadlines propagate, expired queued work is discarded, and shutdown cleans up work without accumulating orphan requests or children.
- [ ] #6 Current workflow transport and historical analytics/details have independent delivery and explicit truthful freshness. Retained stale snapshots or cached browser responses cannot satisfy fresh observation performance claims, and unavailable analytics must not be fabricated as empty or fresh.
- [ ] #7 On representative populated isolated state matching or exceeding the measured workload, cold current workflow display completes within 1,000 ms, fresh warm observation p95 is at most 300 ms, and warm browser reload-to-render p95 is at most 400 ms. Measure at least 20 warm samples after 3 warmups, report cold timing separately, and exercise unchanged state, activity changes and multiple clients without recurring observation timeouts.
- [ ] #8 On the same workload, historical analytics completes or refreshes within 3,000 ms and steady observer RSS stays at or below 512 MiB. Report analytics freshness, CPU, peak/steady RSS, subprocess/query counts and fresh IPC/HTTP/browser latency separately so moving work or hiding it behind a cache cannot count as an improvement.
- [ ] #9 Extend existing owning unit and boundary suites under ADR 0057; preserve their distinct behavioral assertions and keep every added/modified integration case and suite within 3.5 seconds. Unit cases meet the 500 ms headroom requirement. Manually validate the rebuilt production CLI and browser against isolated populated state, including first analytics completion, changing/late evidence and multi-client pressure. Keep operator-owned verification gates and CPU budgets unchanged.
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 Verification gate ran and passed on the final tree with captured proof rather than an unverified claim
- [ ] #2 Lint and static analysis report clean on every changed file
- [ ] #3 No focused or unannotated skipped tests were introduced (no .only and no bare .skip)
- [ ] #4 Final checkpoint Goal Check table cites real evidence using file:line references and test names
- [ ] #5 Docs updated to reflect any workflow or user-facing behavior change
- [ ] #6 Bug-labeled missions include a red-to-green reproduction test that fails before the fix and passes after
<!-- DOD:END -->
