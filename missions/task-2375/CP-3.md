# CP-3: Metrics-cache identity and unverifiable process liveness

## Summary

**Metrics cache fix**: `BoardProjectionBuilder.buildMetrics()` cache key now depends only on mission states (`[missionId, status]` pairs), excluding `agentAvailability` which carries volatile `blockedForMs` that changes every refresh. Cache hit returns `{...cachedMetrics, agentAvailability}` to deliver fresh countdown values without rerunning slow historical metrics.

**Process liveness fix**: `probeProcessLiveness(pid, null)` now returns `null` (unverifiable) instead of `true` (authoritatively alive) when the publisher recorded no start identity. This allows the existing TTL/freshness policy to age out unverifiable facts instead of keeping them permanently `live`.

**TASK-2373.01 alignment**: Existing wording "falls back to PID-only liveness and TTL expiry" already matches the implemented semantics. No update needed.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC4: Fresh agent availability on cache hit (deterministic red→green evidence) | `test/task-2375-metrics-cache-and-liveness.test.ts`, `"TASK-2375 SC4: fresh agent availability delivered on cache hit"` — distinct `untilMs` values make the old key red regardless of timing | PASS |
| SC4: Slow metrics not recomputed on blockedForMs change (supplementary) | `test/task-2375-metrics-cache-and-liveness.test.ts`, `"TASK-2375 SC4: repeated refreshes during AgentBlock reuse slow metrics cache"` — red only when the three builds land in distinct milliseconds; corroborating, not the red→green proof | PASS |
| SC5: Non-Linux liveness returns null (unverifiable) | `test/task-2375-metrics-cache-and-liveness.test.ts`, `"TASK-2375 SC5: probeProcessLiveness returns null when identity is null (non-Linux fallback)"` | PASS |
| SC5: Linux identity remains authoritative | `test/task-2375-metrics-cache-and-liveness.test.ts`, `"TASK-2375 SC5: probeProcessLiveness returns true when identity matches (Linux authoritative)"` | PASS |
| SC5: Dead process returns false | `test/task-2375-metrics-cache-and-liveness.test.ts`, `"TASK-2375 SC5: probeProcessLiveness returns false for dead process"` | PASS |
| TASK-2373.01 wording aligned | `backlog/tasks/task-2373.01 - Add-macOS-and-Windows-process-start-identities.md` AC #4: "falls back to PID-only liveness and TTL expiry" | PASS |
| Static analysis gate | `./scripts/verify-local.sh static-analysis` — ALL STAGES PASSED | PASS |

Next action: CP-4 — write shutdown semantics checkpoint and run final integration gates.
