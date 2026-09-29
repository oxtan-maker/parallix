# ADR 0062: Self-hosted verification performance

**Status:** pending data for decision

**Date:** 2026-09-29

**Scope:** Development of the Parallix repository, not repositories using Parallix.

## Context

The objective is ten concurrent missions instead of five without multiplying verification CPU demand. Recent local optimizations require a new baseline; previous integration timings measured wall time, not CPU consumption.

Queueing reduces contention, not necessarily computation. Compilation caches are not test-result caches. Shards depending on the entire application still invalidate together.

Verification tools belong to the developed repository. Parallix must not impose a competing build system or scheduling policy on iOS or other client projects.

## Options considered

| Option | Advantages | Costs / risks | Position |
|---|---|---|---|
| Existing scripts and targeted optimization | No tool migration; preserves execution behavior | Repeated computation and broad invalidation remain possible | Control baseline |
| Nx Core around existing commands | Incremental adoption; input-based task caching and output restoration; shared worktree cache [1], [2] | Requires complete inputs; coarse targets may miss on every source change; shared caching does not establish global scheduling | Evaluate first, not selected |
| moon / Turborepo | Alternative task-cache approach without rewriting the application | Same granularity problem; worktree behavior and migration cost need comparison | Retain as lightweight alternatives |
| Bazel with JavaScript rules and an existing execution backend | Explicit action model and shared result infrastructure | More target modeling and adaptation of host-sensitive tests | Revisit if lightweight adoption is insufficient |
| Dagger / BuildXL / Pants / Buck2 | Alternative environment, dependency-tracking, or execution models | Additional integration work; no Parallix-specific comparative measurement | Retain for subsequent evaluation |
| Rust / Go or another application-stack migration | Could reduce demonstrated application execution overhead | Rewrite and compatibility cost; language choice alone does not establish correct test-result reuse | Separate decision requiring hotspot evidence |

## Decision

No tool is adopted. Evaluate repository-local Nx Core and independently convert compute-cost guards to CPU accounting. Acceptance remains a human decision.

Preserve test frameworks, source layout, product runtimes, and verification obligations. No product cache/scheduler, shipped Nx dependency, Cloud service, or remote worker in this experiment.

Nx task reuse requires matching complete inputs and restored artifacts. It cannot restore another mission's approval or exact-commit proof: the existing workflow still certifies the current clean candidate. Dirty snapshots cannot reuse/publish evidence. Live checks and mandatory side effects remain fresh.

### Performance and liveness are separate contracts

Compute-cost guards use attributed user-plus-system CPU seconds: worker-side per-test measurements and descendant-inclusive suite totals. Keep independent wall deadlines for hangs, stalled I/O, cancellation, and elapsed-time behavior. CPU limits cannot replace these. [3], [4]

Calibrate thresholds; do not relabel wall-time values. Separate plain/coverage profiles and report CPU plus elapsed time. Both Nx and its baseline use identical revised guards; fewer timing-related retries are not credited to Nx.

## Evidence required for a decision

Recommend Nx only with:

1. At least **50% less total local verification CPU per completed candidate** on a predeclared ten-mission replay, including cache population, hashing/restoration, orchestration, and uncached gates. Identical warm reruns alone do not qualify.
2. Executable evidence preserving invalidation, artifacts, coverage semantics, compute-regression detection, liveness, and exact-candidate trust.
3. Ten clients completing without new resource failures or more than 5% degradation in cohort time or observed maximum candidate latency versus the equivalent baseline. Report five-client results separately; CPU savings alone do not prove doubled throughput.
4. Repository configuration, development dependencies, and thin test/script changes only. No production restructuring, custom Nx executor, dependency-analysis engine, or duplicate test-membership authority.

Below-threshold results mean insufficient benefit; invalid measurements mean inconclusive. Retain the pending status even after positive results.

## Consequences

Few hits under conservative inputs are valid negative evidence, not permission to weaken dependencies. Proven CPU-guard improvements can remain independently of Nx.

## Relationship to existing decisions

ADRs 0041, 0048, and 0057 retain gate, trust, and test-tier authority; ADR 0044 retains distribution authority; ADRs 0060 and 0061 retain Sonar and dependency-security policy.

## References

[1]: https://nx.dev/docs/concepts/how-caching-works
[2]: https://nx.dev/docs/kb/change-cache-location
[3]: https://nodejs.org/api/process.html#processcpuusagepreviousvalue
[4]: https://nodejs.org/api/test.html#test-runner-execution-model
