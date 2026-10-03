# ADR 0063: Self-hosted verification performance

**Status:** accepted operational decision — retain direct verification; evaluated Nx configurations not adopted

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

Keep the CPU-usage guards and direct verification. The local pre-integration unit gate runs a reviewed hybrid: allowlisted stateless files share a process, while other files retain per-file isolation and bounded concurrency. New files default to isolation. The ordinary `npm test` path remains fully isolated. Do not adopt the tested Nx configuration: its useful warm hits require unchanged inputs, while source changes invalidate the whole covered unit target. The trial wiring was removed. TASK-2622.18 rejects the evaluated per-file and grouped Nx layouts: after release-input normalization and small dependency cuts, ten ordinary-development candidates used 4,783 CPU seconds grouped versus 4,423 direct (+8.1%); parent preparation cost another 4,444 seconds separately.
Coverage attribution remains unresolved; retain direct verification. Detailed results, limitations and raw-artifact references are recorded in `px status task-2622.18 --json` checkpoints.

Preserve test frameworks, source layout, product runtimes, and verification obligations. No product cache/scheduler, shipped Nx dependency, Cloud service, or remote worker in this experiment.

Nx task reuse requires matching complete inputs and restored artifacts. It cannot restore another mission's approval or exact-commit proof: the existing workflow still certifies the current clean candidate. Dirty snapshots cannot reuse/publish evidence. Live checks and mandatory side effects remain fresh.

### Performance and liveness are separate contracts

The parent-side test reporter sees elapsed durations, not the CPU used by isolated file workers. Measure each unit test inside its file worker, where unit tests normally run serially, and prove the hook and non-overlap assumptions. For the suite, use validated process accounting on both Linux and macOS: POSIX `wait4`/`getrusage` can report a waited-for child and the descendants it waited for. Prove child/grandchild inclusion and reject escaped or unaccounted work. A Linux cgroup's `cpu.stat` can be an optional cross-check, not a required dependency. [3], [4], [5], [6]

Keep finite independent wall deadlines for hangs, stalled I/O, cancellation, and elapsed-time behavior. Do not relabel wall-time values as CPU; calibrate separate plain and coverage CPU budgets. The direct and Nx trial paths use the same revised guards and coverage profile. Missing CPU measurements are failures, not zero usage.

Integration cases also enforce worker CPU plus the CPU of reaped commands and their waited descendants. Measurement includes case teardown and rejects overlapping siblings that would share a counter. Integration suites enforce a separate whole-process-tree budget. Focused integration runs retain the same accounting as their tier; new cases receive a finite default rather than unbudgeted execution. Plain and covered profiles have separately calibrated limits, with reviewed margins, owned by the executable runner policy. Retuning requires current CPU evidence rather than elapsed-time contention buffers.

Local integration accounting requires a C compiler and installed Node N-API headers. Hosted timing suspension remains unchanged; local verification supplies performance enforcement. Independent wall watchdogs still terminate hangs and reclaim fixtures. The older trial measurements below remain historical evidence, not current budget values.

## Bounded evidence from TASK-2615

The local unit suite passed 3,085 tests with 567 CPU seconds against a 650-second plain limit. The covered suite initially passed with 640 CPU seconds against a 740-second limit; a subsequent pre-review run of the 3,086-test population used 793 CPU seconds, and the following run used 635. The covered limit was raised to 900 CPU seconds after the 793-second result, but this spread remains unexplained. Treat that limit as provisional, not as evidence of a stable performance bound or a speedup. These are CPU measurements, not elapsed-time contention buffers. Individual tests have a 1-second CPU limit, tightened to 500 ms for the plain headroom gate. A separate finite wall deadline still terminates hangs. Worker probes exercise low-CPU waits, compute overruns, nested and overlapping tests, and descendant accounting; the runner rejects a missing CPU report.

Nx Core needs no testing plugin to cache a command target. In the first bounded Linux trial, direct build cost 3.17 CPU seconds, Nx with cache bypass cost 4.49, and a warm cached build cost 1.08. The covered unit target cost 638 CPU seconds cold and 1.06 on an unchanged warm hit; its execution marker stayed fixed, and the cached LCOV artifact was restored byte-for-byte. A source change forced the full unit target to run again. Source and semantic lockfile changes likewise invalidated the build target; a repeated broken build failed twice and was not cached. The uncached CI integration target cost 624 CPU seconds. Thus the large warm unit saving applies only to identical inputs, while the conservative monolithic test target reruns for changed mission candidates. The measured build saving is too small relative to the full verification cost to justify this configuration. The [first trial measurements](../../tools/nx-evaluation/results.json) retain commands, CPU and wall values, cache behavior, and local raw-log hashes.

The first trial result was **do not adopt the tested Nx configuration**. That trial used a custom cache directory, which did not establish cross-worktree reuse; a later trial with Nx's default cache did establish it for identical clean inputs. Neither trial modeled source-specific affected test groups, replayed the ten candidate revisions, or measured the full pre-integration gate graph. macOS has source-supported POSIX accounting but was not executed in this Linux-hosted trial, so its calibration remains to be measured on a Mac before relying on the local guard there.

The later covered-unit profile found that cost is spread across file workers: 396 files consumed about 638 CPU seconds, while 20 empty files under the same isolation and coverage setup consumed 27.74 CPU seconds. A paired probe then ran the same 278 files and 2,082 assertions with per-file processes (425.63 CPU seconds) and one shared process (17.07 CPU seconds); both passed, including a reversed-order shared run. The other 118 files passed 1,003 assertions in per-file processes at 209.95 CPU seconds. Sequentially combining those measurements suggests a 64% unit-CPU opportunity, but it is not a validated hybrid gate. Running all 396 files in one shared process produced at least 105 assertion failures and incomplete results. The exact commands, selection rule, and measured values are in the [trial results](../../tools/nx-evaluation/results.json).

Node's default per-file process model confines module mocks and mutable runtime state. TASK-2328's ESM migration relies on that boundary for its module-mocking seam; TASK-2554 added disposable test homes and an operator-database guard in the process bootstrap; TASK-2372 kept a process-group watchdog after `--test-force-exit` silently dropped results. The local hybrid retains the operator-database guard, process-group watchdog, CPU limits, and temporary-root cleanup. Its shared group has one disposable home and module cache across files. The operator accepted that narrower boundary for the screened local gate after the passing trial; files with known stateful markers and newly added files remain isolated.

A subsequent covered trial ran 278 screened files in one process and kept the other 118 isolated. All 3,086 assertions passed. Direct build plus tuned tests used 235 CPU seconds and 68 seconds wall time, versus 645 CPU seconds and 140 seconds wall time for the fully isolated covered unit suite. Nx Core with the same tuned targets used 238 CPU seconds cold, 1.3 CPU seconds on an unchanged warm hit, and 1.3 CPU seconds in a second worktree at the same clean revision using Nx's default per-user cache. One source-comment change in that second worktree invalidated the build and both test targets, costing 237 CPU seconds. Cached build and LCOV artifacts were restored byte-for-byte. The [second trial measurements](../../tools/nx-evaluation/tuned-results.json) preserve the commands, measurements, and raw-log hashes.

The original tuned run was a measured opportunity, not proof of equivalent file isolation. Normalized LCOV covered 33,376 source lines in the tuned run and 33,546 in the isolated run, with 262 lines covered only by isolation and 92 only by the tuned run. Both reports have the same source files and executable line set, and recomputing the tuned merge reproduced its saved LCOV byte for byte. A [focused attribution probe](../../tools/nx-evaluation/coverage-attribution-probe.json) also found zero-hit lines in the current covered runner despite passing tests: two isolated files at four workers missed lines that one worker or a shared process recorded. The LCOV difference alone therefore cannot establish different execution. The source-text screen still cannot establish transitive state isolation; this is an accepted local-gate tradeoff, not an assertion that the groups are semantically identical.

We checked existing Nx integrations before considering custom dependency logic. The community `node:test` package [7] runs a configured test-file glob as an Nx executor but does not infer per-file affected inputs or preserve this repository's CPU and liveness supervisor. Official Jest and Vitest integrations [8], [9] support file splitting, but require a runner migration; splitting work does not itself prove which tests a source change may safely skip. Nx 23.2.1 also introduced two high npm audit findings through its `smol-toml` dependency during the trial. The Nx trial dependency and configuration were removed, preserving the mandatory audit gate.

The same isolation probe found a smaller opportunity in the CI integration tier, excluding agent E2E and workstation-only tests. Thirty screened files passed all 223 tests both with file processes and in one shared process, including a reversed shared order. Under coverage, CPU fell from 54.84 to 10.51 seconds and wall time from 12.99 to 8.99 seconds. The normalized coverage sets still differed by 38 lines covered only with file processes and 29 only with sharing. Shared execution also loses each file's separate home and module cache. Node's current `node:test` runner offers `process` and `none` isolation modes [4], so this measured subset is not an adopted integration gate. The [integration probe measurements](../../tools/nx-evaluation/integration-isolation-results.json) retain the population, profiles, and raw-log hashes.

The follow-up concurrency probe kept four isolated workers. For the same 118-file covered partition, four workers used 214.51 CPU seconds and 48.71 seconds wall time; six used 244.58/39.51 and eight used 267.66/34.36. Running the shared partition alongside four isolated workers reduced its sequential wall time from about 65 to 50 seconds for about 3% more CPU. The [parallelism measurements](../../tools/nx-evaluation/unit-parallelism-results.json) support four workers for the isolated group under concurrent mission load.

The adopted local gate passed all 3,086 tests in the 278/118 partition on two covered runs. After removing an unused extra V8 payload dump, it used 337 and 367 CPU seconds, with 91 and 99 seconds elapsed under concurrent host activity. The 425-second CPU bound is 16% above the higher observation; the separate wall watchdog remains a liveness guard. The later LCOV report has the same 328 source files and 47,626 executable lines as the earlier tuned trial, with one previously covered line now at zero hits. The known coverage-attribution instability prevents interpreting that one hit difference as a changed assertion path. [Local gate evidence](../../tools/nx-evaluation/local-hybrid-gate-results.json) records the commands, counts, CPU values, and report comparison. The measured 50-second experimental wall time is not a promised local gate latency under concurrent missions.

An isolated follow-up tried Nx's documented feature-project model [10] with the existing guarded `node:test` runner. Project metadata alone did not infer TypeScript imports in this repository; adding `@nx/js/typescript` did. Eight application test files then formed a narrow project and passed 60 assertions. A cache hit across an unrelated backlog change initially looked selective, but it omitted the common runner's transitive source dependencies. Once those dependencies were conservatively included, the same unrelated edit became a miss. The covered command also emitted zero-hit LCOV entries for unrelated source files, so caching that whole-repository artifact under the narrow test key would be unsound. The 23.2.1 trial with a scoped `smol-toml` 1.9.0 override passed `npm audit` with zero findings, but the override has not been adopted. The [feature-project probe](../../tools/nx-evaluation/feature-scope-trial.json) preserves the measured hits, misses, CPU, and graph correction. It is a small correctness probe, not the representative replay or evidence for the 50% target.

We also evaluated compile-once ESM test execution and **did not adopt it**. In this approach, the sources and tests are compiled once into unbundled, source-mapped ESM, and the existing isolated workers then run without the tsx loader. The trial ran on the same unit population, and compiled workers used about half the unit-tier CPU and wall time, with compilation included. The saving was smaller in the CI integration tier and absent in the local integration tier. Parity still failed. Generated files in the scanned tree tripped the architecture, ESM-only, file-size and test-selection guards. Packaging smoke tests failed when run from the compiled tree. Some imports only resolved under tsx. Native coverage also reported a lower comparable line rate, because source-mapped compiled output does not count uncalled function bodies that the tsx path counts as covered. Adopting the approach would require a separate decision on guard scope and coverage semantics, so the trial wiring was removed. The [evaluation](../../backlog/docs/task-2622.03-compile-once-esm-evaluation.md) records the measurements and the conditions for revisiting it.

Execution groups do not require large source files. The unit tier currently has no test file over 1,000 lines; 15 existing test files in other tiers exceed that size. The repository now prevents new test files from exceeding 1,000 lines without a cohesive refactor and keeps exact exceptions for existing debt. The separate 500-line production-source guard remains in force.

### Conditions for revisiting test-result reuse

Process isolation is not what prevents Nx from reusing results: the tested unit targets hash the whole application and unit population, so a changed mission candidate gets different task inputs. Nx's default local cache does reuse exact inputs across worktrees. Smaller targets need complete transitive source, resource, environment, toolchain, and test inputs. Measure aggregate CPU and wall time for every pre-integration gate, then freeze candidate revisions and equivalent direct obligations. Replay clean worktrees with a shared cache, recording actual executions and restored artifacts for direct, cache-bypassed, and cache-enabled runs. Include cache population and misses caused by real mission changes. Keep fresh exact-candidate certification and performance guards. A representative ten-client run is needed to assess throughput and latency after CPU savings are shown.

## Evidence required to reopen adoption

Recommend Nx adoption only with:

1. At least **50% less total local verification CPU per completed candidate** on a separately predeclared representative ten-mission replay, including cache population, hashing/restoration, orchestration, and uncached gates. The bounded TASK-2615 trial does not supply this claim.
2. Executable evidence preserving invalidation, artifacts, coverage semantics, compute-regression detection, liveness, and exact-candidate trust.
3. Ten clients completing without new resource failures or more than 5% degradation in cohort time or observed maximum candidate latency versus the equivalent baseline. Report five-client results separately; CPU savings alone do not prove doubled throughput.
4. Repository configuration, development dependencies, thin test/script changes, and a small POSIX CPU-accounting helper built only for this repository's verification. No product runtime dependency, production restructuring, custom Nx executor, dependency-analysis engine, or duplicate test-membership authority.

Below-threshold results mean insufficient benefit; invalid measurements mean inconclusive. A new adoption decision needs evidence beyond the current trial.

## Consequences

Few hits under conservative inputs are valid negative evidence, not permission to weaken dependencies. Proven CPU-guard improvements can remain independently of Nx.

## Relationship to existing decisions

ADRs 0041, 0048, and 0057 retain gate, trust, and test-tier authority; ADR 0044 retains distribution authority; ADRs 0060 and 0061 retain Sonar and dependency-security policy.

## References

[1]: https://nx.dev/docs/concepts/how-caching-works
[2]: https://nx.dev/docs/kb/change-cache-location
[3]: https://nodejs.org/api/process.html#processcpuusagepreviousvalue
[4]: https://nodejs.org/api/test.html#test-runner-execution-model
[5]: https://www.kernel.org/doc/html/latest/admin-guide/cgroup-v2.html#cpu
[6]: https://developer.apple.com/library/archive/documentation/System/Conceptual/ManPages_iPhoneOS/man2/wait.2.html
[7]: https://github.com/SimoneGianni/nx-nodejs-test-runner
[8]: https://nx.dev/docs/technologies/test-tools/jest/introduction
[9]: https://nx.dev/docs/technologies/test-tools/vitest/introduction

[10]: https://nx.dev/docs/kb/feature-based-testing
