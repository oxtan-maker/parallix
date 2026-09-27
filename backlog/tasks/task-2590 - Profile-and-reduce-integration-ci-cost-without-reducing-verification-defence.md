---
id: TASK-2590
title: Profile and reduce integration-ci cost without reducing verification defence
status: backlog
assignee: []
created_date: '2026-09-27 08:38'
labels: []
dependencies: []
ordinal: 121008
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Reduce the local `integration-ci` wall time by finding and repairing the concrete expensive test behaviours that dominate the suite, without reducing test population, boundary coverage, failure sensitivity, or lifecycle defence.

Start with measurement.

Do not begin by moving tests, increasing timeouts, lowering coverage, or changing the gate DAG.

Current representative local pre-integration evidence:

```text
integration-ci: 205.5s
unit:           172.7s
integration-local: 47.3s
agent-smoke:    167.8s
quality-gate:    89.3s
total wall:     297.8s
```

Current critical path:

```text
build
 -> integration-ci
 -> coverage-merge
 -> quality-gate
```

Therefore reducing integration-ci directly reduces integration wall time until another lane becomes dominant.

## Why Now

The large redundant coverage and Sonar passes have already been removed.

The remaining integration-ci population contains approximately 185 positively classified files covering real boundaries such as:

* subprocesses;
* Git/worktrees;
* SQLite;
* package creation/installation;
* loopback services;
* CLI execution;
* lifecycle/recovery behaviour.

A blanket optimization would risk weakening the trust ladder.

The next step is to identify where the 205 seconds actually go and distinguish:

```text
intrinsically expensive boundary proof
```

from:

```text
accidental repeated setup
real sleeps/polling
duplicated process launches
over-broad integration scenarios
CPU contention
fixture construction overhead
work that can safely move behind injected ports while retaining one real boundary certification
```

## Scope

### 1. Add trustworthy per-file timing visibility

Add a test-only profiling mode for the existing Node test runner.

It must report at minimum:

```text
test file
wall duration
tier
```

Prefer machine-readable output such as JSON or JSONL plus a concise sorted summary.

Do not run every file serially merely to obtain timing.

Use the normal integration-ci execution and observe file completion from the test-runner reporter/event stream if possible.

The profiling mode must not alter:

* test selection;
* test isolation;
* test concurrency;
* timeouts;
* bootstrap behaviour;
* assertions.

Normal non-profile runs must remain lightweight.

Example desired output:

```text
integration-ci total: 205.5s

slowest files:
  18.2s  test/foo.test.ts
  15.9s  test/bar.test.ts
  11.4s  test/baz.test.ts
  ...

top 10 cumulative: 103.7s
top 20 cumulative: 147.9s
```

### 2. Separate intrinsic slowness from contention

Measure integration-ci under at least these contexts:

#### A. Isolated

```text
integration-ci only
```

#### B. Coverage-enabled isolated

The exact coverage mode used by pre-integration.

#### C. Actual pre-integration contention

The suite running inside the real concurrent gate topology.

Do not compare numbers from different modes as though they were identical.

The purpose is to identify whether the 205.5s is primarily:

```text
suite work
```

or:

```text
suite work + starvation from unit/integration-local/agent-smoke/etc.
```

### 3. Profile the top offenders individually

Take the smallest set of files accounting for a material fraction of wall time.

Target roughly the top 10–20 files, but stop earlier if a clear Pareto set emerges.

For each candidate, record:

* isolated wall time;
* approximate CPU time where available;
* whether it spawns child processes;
* whether it creates Git repos/worktrees;
* whether it runs npm pack/install/build;
* whether it opens SQLite databases;
* whether it uses real timers/sleeps/polling;
* whether multiple tests repeat identical expensive setup.

Use `/usr/bin/time -v` or equivalent local tooling when useful, but do not make optional profiling tools production dependencies.

### 4. Classify every expensive file

Each slow file must be placed in one of these categories:

#### A. Necessary expensive boundary certification

Example:

```text
one real package-install smoke
one real Git rebase workflow
one real subprocess lifecycle
```

Preserve it.

Optimize setup only if semantics remain identical.

#### B. Repeated expensive setup

Examples:

* creating essentially the same temporary Git repository for every test case;
* running package/build setup repeatedly within one test file;
* rerunning migrations unnecessarily;
* rebuilding an identical fixture per assertion.

Prefer safe fixture reuse within a file when isolation does not require recreation.

Never share mutable state across files merely for speed.

#### C. Real-time waiting that can be event-driven

Examples:

```text
setTimeout(500)
poll every 100ms
sleep before checking process output
```

Replace waiting with deterministic synchronization when possible.

Do not merely shorten sleeps until the test becomes flaky faster.

#### D. Boundary mixed with pure policy

If a large integration file tests many pure application decisions through an expensive process/Git/SQLite boundary:

split the proof into:

```text
fast hermetic policy tests
+
minimal real boundary certification
```

The boundary certification must remain and must prove the adapter/wiring actually works.

Do NOT "optimize" by mocking the only test proving the real boundary.

#### E. Duplicate scenario coverage

If multiple integration files prove materially identical boundary behaviour, consolidate only after demonstrating assertion/scenario equivalence.

Do not delete a regression merely because another test has a similar name.

### 5. Optimize a bounded high-value set

Do not attempt to rewrite all 185 integration files.

Select the smallest group whose profile suggests the largest safe gain.

Prefer approximately 3–5 concrete optimization clusters in this mission.

For each optimization record:

```text
before isolated duration
after isolated duration
what expensive operation was removed/reduced
which defence remains
```

### 6. Preserve the integration population exactly

Before implementation, capture the complete positively classified:

```text
INTEGRATION_CI_TESTS
```

set.

After implementation, prove set equality unless a test has genuinely been split.

If a test is split:

* every original behavioural assertion must have a new owner;
* at least one integration-level test must retain the actual boundary proof;
* no scenario may disappear merely because it became expensive.

Do not change classification from integration to unit simply to improve the integration number.

A classification change is permitted only if implementation work genuinely removes the real external/process/Git/SQLite boundary from that test and another integration test still certifies the concrete adapter.

### 7. Investigate test-worker concurrency using evidence

Current integration-ci runner concurrency is hardcoded to:

```text
4
```

Do not assume 4 is optimal.

After code-level profiling, run a small bounded matrix for integration-ci, for example:

```text
2
4
6
```

or another evidence-based set appropriate to the machine.

Make concurrency temporarily configurable for the benchmark if necessary.

Record:

```text
workers
wall time
user CPU
system CPU
failure/flakiness
```

Do not benchmark dozens of settings.

Do not optimize isolated integration-ci at the expense of the actual pre-integration critical path.

If a different concurrency is materially better, apply it at the Parallix repository/test configuration layer rather than introducing Node-test concepts into generic gate scheduling.

### 8. Measure interaction with outer gate parallelism

After the suite itself is improved, run one representative full pre-integration pass.

Compare:

```text
integration-ci isolated
integration-ci under gate contention
full pre-integration wall time
```

If integration-ci remains dramatically slower under full parallelism, record that as evidence for a later CPU-budget/scheduling mission.

Do not redesign the generic scheduler in this mission.

### 9. Preserve failure sensitivity

For every optimized slow-test cluster, include a mutation/reverse assertion demonstrating that the test still bites.

Examples:

* broken subprocess exit propagation causes failure;
* skipped Git operation causes failure;
* wrong SQLite persistence causes failure;
* removed packaging artifact causes failure;
* incorrect lifecycle transition causes failure.

"Tests still pass after refactor" is not enough proof of preserved defence.

## Out of Scope

* Removing tests.
* `.skip`, `.only`, quarantine lists.
* Increasing timeouts to hide contention.
* Lowering coverage.
* Changing Sonar policy.
* Removing agent-smoke.
* Changing integration-local membership just to improve timing.
* Test-impact selection based on changed files.
* Generic Parallix scheduling redesign.
* Global `flock`.
* Running the suite serially as the permanent solution.
* Replacing all real boundaries with mocks.
* Optimizing 185 files at once.

## Success Criteria

1. Integration-ci produces machine-readable per-file timing data in profiling mode.

2. Normal test runs do not pay material profiling overhead when profiling is disabled.

3. The mission identifies the files/clusters responsible for the largest share of integration-ci time.

4. Each selected heavy test has documented cause rather than only duration.

5. Intrinsic cost is distinguished from outer-gate CPU contention.

6. The exact pre-mission integration-ci population is captured.

7. No integration test disappears without equivalent behavioural coverage.

8. No test is reclassified solely for performance.

9. Every boundary moved into a faster hermetic test retains a smaller real integration certification.

10. Real sleeps/polling removed by the mission are replaced by deterministic synchronization rather than arbitrary shorter waits.

11. Repeated expensive setup is removed only where fixture isolation remains valid.

12. At least one reverse/mutation proof exists for every optimized test cluster.

13. A bounded concurrency experiment determines whether the current worker count of 4 is appropriate.

14. Final integration-ci timings are captured both isolated and in one real pre-integration run.

15. The final checkpoint reports:

```text
before integration-ci: ~205.5s representative local baseline
after integration-ci: <measured>
before pre-integration: ~297.8s
after pre-integration: <measured>
```

16. A performance change that does not produce a meaningful improvement is reverted rather than retained as complexity.

17. Static analysis, unit tests, integration-ci, integration-local, workflow and agent-smoke defence remain intact.

## Performance Target

Treat this as a target, not permission to cheat:

```text
integration-ci:
  target < 160s

stretch:
  < 140s
```

A result above the target is acceptable only if the mission has produced strong evidence that the remaining time is necessary boundary work or external contention and has identified the next concrete bottleneck.

Do not manufacture the target by reducing coverage.

## Checkpoints

### CP 1 — Build profiling visibility

Add per-file timing.

Capture isolated, coverage-enabled and full-pre-integration timing.

Identify the Pareto set.

No test semantics changes yet.

### CP 2 — Profile the top expensive files

Run the heaviest files individually.

Classify cost into boundary work, repeated setup, waits, process launches, Git, SQLite, packaging, or contention.

Choose a bounded optimization set.

### CP 3 — Optimize high-value clusters

Implement the selected safe reductions.

For each, preserve boundary proof and add reverse evidence.

Capture before/after individual timings.

### CP 4 — Concurrency experiment

Benchmark a small worker-count matrix.

Apply a change only if it materially improves the real critical path and remains stable.

### CP 5 — Full certification

Run the complete required verification and one representative pre-integration pass.

Record the new gate dashboard and identify the next critical path.

## Gates

* [ ] ./scripts/verify-local.sh static-analysis
* [ ] npm test
* [ ] npm run test:integration:ci:prebuilt
* [ ] npm run test:integration:local

After focused verification, run one real pre-integration cycle to capture final wall-clock evidence.

Do not repeatedly run the complete expensive gate while developing individual optimizations; use the targeted affected test files first.

## Restricted Areas / Agent-Slop Guardrails

* Do not delete or skip slow tests.
* Do not weaken assertions to make them faster.
* Do not raise timeout budgets as an optimization.
* Do not move integration tests into unit merely by changing a registry entry.
* Do not replace the sole real Git/process/SQLite/package boundary proof with a mock.
* Do not introduce cross-file mutable shared fixtures.
* Do not optimize using only one noisy contended timing.
* Do not run dozens of expensive benchmark combinations.
* Do not rewrite unrelated tests.
* Do not change Sonar or coverage semantics.
* Do not claim success based only on individual-file timing if total integration-ci did not improve.
* Do not tune generic Parallix gate scheduling to this developer machine in this mission.

## Stop Rules

Stop and record the finding if:

* profiling instrumentation materially changes suite timing or behaviour;
* a proposed speedup requires removing the only real boundary certification;
* the slowest cost is predominantly external/tool latency that test-code changes cannot safely reduce;
* a test cannot share setup without compromising isolation;
* the only way to reach the performance target is reducing test population;
* integration-ci becomes faster alone but the complete pre-integration path becomes slower or less reliable.
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
