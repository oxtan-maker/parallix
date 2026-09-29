---
id: TASK-2615
title: Evaluate Nx caching and replace brittle compute-time guardrails
status: backlog
assignee: []
created_date: '2026-09-29 11:24'
labels: []
dependencies: []
ordinal: 143008
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Goal
Evaluate whether Nx Core reduces total local verification CPU per completed candidate by at least 50% across ten concurrent Parallix self-development missions, without weakening verification or changing the generic product.
Also replace approximate elapsed-time compute guards with correctly attributed CPU budgets, retaining separate wall-clock liveness and behavior deadlines. Measure this change separately from Nx.
Produce GO, NO-GO, or INCONCLUSIVE evidence for ADR 0062, "Self-hosted verification performance". Keep its status exactly pending data for decision, including after a positive result. This mission authorizes an opt-in Nx experiment, not default adoption.
Why Now
Assume the preceding coverage-correctness and heavy-test optimization missions have landed locally. Measure that local state, not obsolete published code. The remaining question is whether low-migration task caching avoids enough computation, while current clock-time proxies can misclassify compute cost under parallel load.
Refinement Signals
- Predicted NEL bucket: Large (235+).
- Confidence: Medium; cache benefit and CPU attribution require executable evidence.
- Selection note: Experimental evaluation; a demonstrated NO-GO is a valid completed experiment.
- Main drivers: guardrail migration, target configuration, cache-safety tests, and bounded workload replay.
Scope
1. Establish the baseline and ADR ownership
Read current repository instructions and documentation standards. Inspect local unpushed changes and verify that the preceding coverage/profiling work is present. Report a missing prerequisite rather than claiming to measure the optimized baseline.
Use the accompanying ADR. Update an existing unpushed general verification-performance ADR instead if one exists. If 0062 belongs to an unrelated decision, allocate the next unused number and reconcile references. Add/update the ADR index without changing unrelated decisions.
Record baseline commit/tree, tool versions, machine resources, actual gate graph, and current proof/cache behavior. Freeze test membership and coverage semantics as the control.
2. Inventory and classify existing time guards
Audit the local versions of these starting points and their tests/callers:
- test/lib/unit-test-budget-reporter.ts: per-test cost and authoring headroom.
- test/lib/test-run-plan.ts: suite budgets and Node test timeouts.
- test/run-default-tests.ts: elapsed suite-budget checks, coverage profile, watchdog, and termination grace.
- Other test/script assertions using elapsed time, duration_ms, hrtime, or equivalent clocks as approximate cost guards.
Record each guard's purpose, measurement scope, old threshold, and proposed treatment in checkpoint evidence. Do not maintain a second permanent implementation inventory in the ADR.
Classify before editing:
Purpose	Treatment
Approximate test/operation compute cost	Attributed CPU budget
Approximate whole-suite compute cost	Aggregate CPU budget including relevant workers/descendants
Hang, deadlock, stalled I/O, cancellation, termination grace	Independent wall-clock deadline retained
Behavior defined in elapsed time: retry delay, TTL, lease expiry, response deadline	Keep its semantic clock; use deterministic synchronization/fake clocks where appropriate

Do not mechanically replace every timer or elapsed-time assertion.
3. Implement CPU guardrails before the Nx comparison
CPU consumption is user CPU + system CPU; when using Node's microsecond counters, divide by 1,000,000 to report CPU-seconds. Measure in the process doing the work, not the parent reporter while it receives delayed events.
For hermetic per-test accounting, use supported worker-side hooks/instrumentation and explicit test identity. Demonstrate attribution across hooks, nested tests, asynchronous overlap, and worker threads. A process-wide counter cannot be charged independently to overlapping tests. Use trustworthy isolation where necessary; do not silently drop the per-test guard, replace it with a permissive file average, or serialize every mission to make accounting easy.
For file/suite budgets, include actual worker startup, relevant setup/teardown, and child/grandchild CPU using existing OS accounting or a proven complete process-tree approach. Never count only the waiting runner or double-count parent/inclusive totals. Do not estimate CPU as elapsed time multiplied by configured worker count. Missing accounting is unavailable evidence, not zero CPU or a pass.
Calibrate healthy uncached executions on the reference host, including a bounded contended run. Preserve authoring headroom and compute-regression sensitivity. Existing 500/1,000 ms per-test and 180/300 s suite values are historical wall-time starting points, not automatically equivalent CPU limits. Use separate plain and coverage-instrumented profiles; do not disable instrumentation or relax correctness to hit a budget. Do not silently change existing hosted-runner enforcement policy during the Nx comparison.
Decouple any Node --test-timeout currently tied to the short compute threshold. Give it a separately named, finite liveness deadline justified for parallel execution. Retain the external suite watchdog and process-tree termination/cleanup so a synchronous busy loop or low-CPU hang cannot evade enforcement. Leave genuine functional timing contracts unchanged.
Diagnostics/configuration must distinguish CPU budget, wall timeout, and observed elapsed time. Version the measurement/budget profile and invalidate cached budget evidence when it changes. Do not silently reinterpret an old wall-budget environment variable as a CPU budget.
Add deterministic counter/attribution tests and small isolated executable probes proving:
- A completed low-CPU wait can exceed the former short wall proxy without a false compute-budget failure.
- A deliberate CPU overrun still fails although functional assertions pass.
- A low-CPU hang and an event-loop-blocking loop still terminate and fail through wall-clock liveness protection.
- A child/grandchild CPU burner cannot hide behind an idle parent; parallel workers are counted once.
- Nested/overlapping tests are not billed for each other's work or mistaken for independent process totals.
- Missing/invalid measurements, failed tests, cancellation, and reporter faults cannot become success.
- Bounded contention changes elapsed time without incorrectly billing unrelated work to the test; report residual CPU variability rather than promising hardware-independent timings.
Classify process-based probes in the existing integration registry. Keep the normal regression probes small; full load experiments belong only to this evaluation. Record CPU-guard work as a separable checkpoint/commit. It may remain if independently sound even when Nx fails its evaluation.
4. Freeze a representative mission replay
Select ten distinct code-changing mission histories from local worktrees/checkpoints or reproducible recent diffs applied to the optimized baseline. Freeze candidate revisions, selection rationale, invocation schedule, and any reconstruction before cache tuning.
Include representative component, shared-helper, configuration, and dependency changes. Replay observed handoff/review-repair/integration checks and successive revisions; do not invent repeated checks, empty commits, or documentation-only missions to manufacture hits. Preserve legitimate same-candidate repetitions actually present in the workflow.
Ensure both comparison profiles can run the same obligations. Do not remove difficult workload cases after seeing results. Use isolated evaluation state and run gates without landing changes, publishing packages, or launching new implementation agents just to collect timing data.
5. Add the smallest Nx trial
Pin compatible stable Nx Core as a development dependency. Use documented package-script/nx:run-commands integration, explicit inputs/outputs, and local caching. No Cloud enrollment, remote workers, custom executor/plugin/hasher, task-spooler, or generic scheduler changes.
Start with existing build, static-check, unit, and integration-ci boundaries, with at most six logical cacheable targets. Existing subgroups may be reused without another test-membership list. Do not restructure the application into packages, migrate the test framework/runtime, or invent hundreds of targets to rescue the trial.
Audit mixed commands: a static-analysis command may include live temporary-filesystem/inode checks. Keep those checks fresh outside cached portions. Dependency-audit, Sonar, live-agent, host-sensitive, and required-side-effect checks remain uncached. A build is eligible only when its complete required artifacts are restored correctly.
Keep original direct commands and one opt-in repository-local path. Hold gate ordering, worker counts, and scheduling equivalent during the primary comparison. Avoid recursive npm/Nx calls and nested fan-out. No Nx requirement in generic src/, shipped runtime assets, or product prompts. Thin repository test/script adapters, including the CPU meter, are allowed.
6. Prove complete inputs and valid outputs
Start with conservative inputs: relevant production dependencies, tests/registry, fixtures, bootstrap/mocks, runtime assets, package/lock files, configuration, command arguments, environment, and toolchain/platform. Include consumed Git/checkout identity where required. Ensure Nx does not invisibly change the command environment through additional environment-file loading.
Narrow only across demonstrated boundaries. A full CLI-bundle test depends on that bundle; balanced shards sharing all source inputs still invalidate together. Do not assume single-project nx affected selects individual tests. Request every required logical check; no empty affected-task plan may erase verification obligations.
Use an owner-only trial cache namespace shared across the cohort. Verify actual worktree sharing and confinement compatibility without loosening permissions. Dirty snapshots bypass cache reuse/publication and execute directly. Prevent mutable-during-run inputs from authorizing reusable evidence. Cache problems must cause execution or an explicit failure, never synthetic success.
Never cache mission/operator state, credentials, review decisions, or Parallix proof files. A cross-commit task hit must still pass the existing current-clean-candidate certification boundary.
Declare disjoint output ownership. Keep unit/integration coverage separate and preserve TS line/source mapping, never-imported-source accounting, and subprocess coverage from the preceding mission. Plain and coverage profiles cannot collide. Restore portable paths or decline cross-worktree reuse for path-sensitive outputs.
Cache hits must say that functional/budget evidence was reused. Report only current cache lookup/restoration CPU as current consumption; do not replay old duration/CPU logs as new measurements. Performance calibration always executes with result-cache bypass. Actual misses must enforce the CPU guards normally; changed budget/meter profiles invalidate the relevant cached evidence.
Add executable invalidation/restoration tests: relevant source/transitive helper changes; test/fixture/bootstrap/registry/asset changes; lockfile/runtime/environment/argument changes; deleted output restoration; dirty/mutating snapshots; corrupt/missing entries; simultaneous worktrees; and cancellation. Include a mutation that still fails the underlying behavioral test. Count actual executions outside cached terminal output. Measure duplicate concurrent cold misses rather than assuming single-flight.
7. Measure Nx independently of guard conversion
Keep these comparisons separate:
- G0: post-optimization commands with old wall-cost guards, for bounded guard-change diagnosis where they complete reliably.
- A: direct commands with validated CPU guards; this is the Nx baseline.
- B: the same commands/guards through Nx caching.
- C: Nx with result reuse bypassed, on a small subset to measure orchestration overhead.
Any reduction in false failures/retries from G0 to A belongs to guard conversion, not Nx. B must meet the 50% criterion against A. If G0 cannot finish under contention, report that failure; do not disable only A's safeguards or let a failed baseline inflate savings.
Use the same workload, installed tools, coverage mode, and relevant background conditions. Initialize pre-existing Parallix proofs and tool caches equivalently in A and B. Include the trial dependency installation in both environments.
For each scored wave:
CPU/profile = attributable local user + system CPU seconds / completed scheduled candidates
Nx CPU reduction = 1 - CPU/B / CPU/A
The denominator is the frozen scheduled candidate set, counted once per completion; priming and retries do not create extra completed candidates. Charge all replay work: lifecycle checks, cache population, hashing/restoration, orchestration/daemon work, subprocesses, and uncached gates. Include material attributable local service CPU or state that the total claim is inconclusive. Avoid double-counting nested accounting. Prefer existing cgroup/systemd accounting; a process-tree alternative must demonstrate completeness. Disable daemon mode consistently if needed for attribution.
Report total/per-gate CPU, cohort wall time, observed maximum candidate latency including queueing (with sample count), peak aggregate memory, swap/OOM events, failures/retries, cache bytes, and CPU-weighted hits. CPU utilization, load average, and unweighted hit counts cannot satisfy 50%.
Start with a small pilot. If the measured safe-cacheable fraction cannot plausibly provide 50% savings, record the limitation and stop without expanding the migration budget.
Otherwise replay the frozen cohort at five and ten independent clients using the same total workload. For the primary ten-client decision, perform two paired A/B sweeps, reversing order in the second. Start each scored sweep with an empty trial result cache and charge any common-base priming. Underlying dependency/download caches may be equally warm. Identical warm-hit demonstrations are separate diagnostics, not the adoption score. At most one additional confirmation pair is allowed for an ambiguous threshold.
GO requires at least 50% total CPU reduction in both primary pairs, no new resource/verification failures, and no more than 5% regression in cohort time or observed maximum candidate latency at the same concurrency. Separately report B at ten clients versus A at five. Do not infer doubled mission throughput from CPU reduction alone.
8. Record results and preserve the decision boundary
Update the ADR with a compact result table: workload/tool identity, CPU per completed candidate, Nx-only reduction, wall time/tail latency, peak memory, guard-calibration outcome, migration footprint, and evidence references.
Record GO, NO-GO, or INCONCLUSIVE. Keep status pending data for decision in all cases. Do not silently enable Nx by default or change hosted verification. For NO-GO, remove unnecessary Nx dependencies/wiring while retaining reproducible evidence. Keep independently validated CPU-guard improvements separable; an inconclusive meter must not replace functioning protection.
Out of Scope
Application rewrites; test deletion/reclassification; new dependency-analysis or impact-selection engines; weakened coverage; scheduling/batching infrastructure; remote execution; product-level Nx configuration; changes to functional timing semantics; automatic integration or publication.
Success Criteria
1. The ADR uses the repository's format, compares alternatives, and retains the requested pending status.
2. Every discovered approximate compute guard is classified and migrated with calibrated CPU accounting, or explicitly reported unresolved without claiming complete conversion.
3. Compute overruns, low-CPU hangs, busy loops, descendants, overlap, and cancellation have executable protection tests; genuine wall-clock contracts remain intact.
4. A representative ten-mission workload and post-guard baseline are frozen before Nx tuning.
5. Nx remains within the repository-only migration budget, with executable input/output, coverage, concurrency, and trust evidence.
6. Complete CPU accounting and paired measurements establish GO/NO-GO/INCONCLUSIVE without crediting guard conversion or selected warm hits to Nx.
7. The ADR receives evidence and a recommendation, not automatic acceptance; defaults and human merge authority remain unchanged.
Risks and Assumptions
CPU-seconds are less exposed to scheduler wait than elapsed-time proxies, but still vary with hardware, runtime, instrumentation, and contention effects. Calibration is not a universal performance guarantee. Coarse dependencies, full-bundle consumers, path-sensitive outputs, cache fallback, and simultaneous misses may leave Nx below 50%. These are useful findings, not reasons to weaken inputs or widen migration scope.
Checkpoints
- CP 1: Resolve ADR ownership and baseline; inventory and classify time guards.
- CP 2: Implement/test CPU accounting and separate liveness; freeze thresholds and the Nx-control state.
- CP 3: Configure opt-in Nx and prove invalidation, outputs, coverage, and trust behavior.
- CP 4: Run the pilot and justified paired five-/ten-client measurements.
- CP 5: Record results, clean up trial-only wiring, and verify preserved defaults/product behavior.
Checkpoint Documentation Requirements
Use the current supported Mission interface discovered through px --help and px status; do not recreate retired workflow-ledger files. Record a summary, Goal Check criterion/evidence/status rows, and a concrete next action. Cite stable test names, commands, candidate IDs, and checksummed run artifacts. Raw profiles belong in ignored experiment storage; the ADR receives only decision-relevant results and durable evidence references.
Gates
- [ ] ./scripts/verify-local.sh docs
- [ ] ./scripts/verify-local.sh static-analysis
Use focused regression tests during development. The evaluation must exercise the actual required verification graph without landing changes; normal lifecycle final gates remain required. Do not add duplicate full passes solely to restate measurement evidence.
Restricted Areas
No generic product changes, weaker confinement/proofs/assertions/coverage, cached live deadlines, incomplete input keys, custom scheduler/cache, silent accounting fallback, global cache deletion, operator-state mutation, or automatic adoption/merge/publication.
Stop Rules
Stop and record the issue if correct accounting needs unbounded test-framework rewrites, overlapping tests cannot be attributed without losing protection, or safe caching needs production restructuring, broader permissions, or incomplete inputs. Record INCONCLUSIVE if measurement/workload validity cannot be established. A sound NO-GO completes the Nx experiment; do not keep changing the workload until Nx passes.
Research References
- Node CPU accounting: https://nodejs.org/api/process.html#processcpuusagepreviousvalue
- Node test process isolation: https://nodejs.org/api/test.html#test-runner-execution-model
- Nx cache model: https://nx.dev/docs/concepts/how-caching-works
- Nx worktree/cache placement: https://nx.dev/docs/kb/change-cache-location
<!-- SECTION:DESCRIPTION:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 Verification gate ran and passed on the final tree with captured proof rather than an unverified claim
- [ ] #2 Lint and static analysis report clean on every changed file
- [ ] #3 No focused or unannotated skipped tests were introduced (no .only and no bare .skip)
- [ ] #4 Final checkpoint Goal Check table cites real evidence using file:line references and test names
- [ ] #5 Docs updated to reflect any workflow or user-facing behavior change
- [ ] #6 Bug-labeled missions include a red-to-green reproduction test that fails before the fix and passes after
<!-- DOD:END -->
