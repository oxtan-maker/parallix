---
id: TASK-2589
title: >-
  Prove coverage semantics after c8 removal and eliminate redundant V8 writes
  only if safe
status: backlog
assignee: []
created_date: '2026-09-27 08:37'
labels: []
dependencies: []
ordinal: 120008
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Determine whether the current post-TASK-2586 coverage implementation preserves the coverage semantics that motivated the historical c8 implementation, and only then remove redundant `NODE_V8_COVERAGE` subprocess/raw-JSON work if doing so is demonstrably semantics-preserving.

This is an experiment with a fail-closed outcome.

Do NOT assume that removing `NODE_V8_COVERAGE` is correct.

If the experiment proves that the current Node-native coverage path has already weakened the coverage denominator, TypeScript source mapping, or meaningful subprocess coverage relative to the historical c8 implementation, restore the required semantics instead of shipping a faster but weaker gate.

## Why Now

Current local pre-integration timing on the incoming `4b4196c9c73dced296b14c32f33efe8891ac9bc8` tree is:

```text
Repository gates (integration): 297.8s

build                2.3s
dependency-audit     0.6s
verification        41.6s
unit               172.7s
integration-ci     205.5s
integration-local   47.3s
coverage-merge       0.7s
workflow              6.6s
agent-smoke         167.8s
quality-gate         89.3s
```

The critical path is approximately:

```text
build
  -> integration-ci
  -> coverage-merge
  -> quality-gate

≈ 298s
```

TASK-2586 correctly removed the second broad test pass previously used solely for coverage, but the resulting runner now enables Node's built-in test coverage while also setting:

```text
NODE_V8_COVERAGE=tmp/coverage-v8-<tier>-...
```

for the entire test process tree.

Those raw V8 directories are deleted after the run and are not directly consumed by `coverage:merge`.

At first sight this looks redundant and potentially expensive for `integration-ci`, whose tests spawn many Node processes.

However, history shows that coverage semantics need to be proven before removing anything.

## Historical Coverage Contract — MUST be investigated first

Use Git history, not assumptions.

The relevant transition is:

```text
parent:
2354ad8c9c2f0b0459d2a354d0df54a3715307c9

c8 introduction:
4be2630651c7c26e02c1c0f07192926f855b54a0
```

At `4be263...`, coverage changed from Node's built-in:

```text
--experimental-test-coverage
--test-coverage-lines=<threshold>
--test-coverage-include ...
--test-coverage-exclude ...
```

to c8:

```text
c8
  --all
  --extension .ts
  --exclude-after-remap
  --include src/**/*.ts
  ...
```

while retaining `NODE_V8_COVERAGE`.

That change is significant.

c8 documents that:

```text
--all
```

includes source files that were never loaded and therefore counts them as uncovered rather than allowing them to disappear from the denominator.

c8 also explicitly supports source-map remapping back to original TypeScript/JSX source, and:

```text
--exclude-after-remap
```

applies filtering against the remapped/original source paths.

The currently used Node 24 test-coverage implementation has `--test-coverage-include`, but Node's `--test-coverage-include-all` facility was added only later in Node 26.7.

Therefore this mission must treat the following as an open risk:

> TASK-2586 may have preserved "LCOV exists" while losing c8's all-production-source denominator or original-TypeScript line semantics.

Do not infer equivalence from a similar percentage.

## Scope

### 1. Reconstruct exactly what c8 was protecting

Inspect:

* commit `4be2630651c7c26e02c1c0f07192926f855b54a0`;
* its parent;
* `src/adapters/verification/coverage-gate.ts` before and after;
* associated tests;
* subsequent coverage changes through TASK-2547 and TASK-2586.

Record in CP-1 the concrete semantic differences between:

```text
historical Node-native coverage
historical c8 coverage
current post-TASK-2586 Node-native coverage
```

At minimum investigate:

* inclusion of never-loaded production files;
* TypeScript source-map remapping;
* original TS line numbers versus transformed/generated JS line numbers;
* include/exclude behaviour before versus after remapping;
* coverage originating in subprocesses spawned by integration tests;
* how the historical `NODE_V8_COVERAGE` directory was consumed by c8;
* whether current `NODE_V8_COVERAGE` JSON is consumed by anything before deletion.

Do not rely solely on comments; execute controlled fixtures.

### 2. Create a coverage semantics fixture

Add a small deterministic fixture/test harness that can prove coverage behaviour without relying on today's repository-wide percentage.

The fixture must include at least:

```text
src/executed.ts
src/partially-executed.ts
src/never-imported.ts
test/coverage-fixture.test.ts
```

Use TypeScript constructs whose transformed representation differs materially enough from the source to detect bad line mapping.

Examples may include:

* type-only declarations;
* interfaces/types removed at runtime;
* TS syntax transformed by `tsx`;
* multiple executable source lines separated by type-only lines.

The fixture MUST prove all of these independently:

#### A. Original source identity

LCOV `SF:` entries refer to the intended original `.ts` source paths.

Generated JS, tsx cache paths, temporary transformed modules, test files, and `node_modules` must not replace the intended production source identity.

#### B. Original line mapping

Known executed and unexecuted executable lines map to their original TypeScript line numbers.

Do not settle for:

```text
SF:src/foo.ts exists
```

The test must inspect actual `DA:`/line evidence for deliberately chosen source lines.

#### C. Full denominator

`never-imported.ts` MUST appear as uncovered in the production coverage denominator if that is the historical c8 behaviour.

A never-loaded production module silently disappearing from LCOV is a regression even if the resulting percentage is higher.

#### D. Partial coverage

The deliberately partially executed source must show the expected covered and uncovered executable lines.

#### E. Exclusion semantics

Test/helper/config/generated paths excluded by the repository coverage policy must not enter the production denominator after source-map remapping.

### 3. Reproduce the historical c8 result as an oracle

Use the historical implementation as a comparison oracle.

Prefer a detached temporary Git worktree at:

```text
4be2630651c7c26e02c1c0f07192926f855b54a0
```

with deterministic dependencies.

If installing the historical tree is impractical, temporarily restore the exact historical c8 dependency/configuration in the mission branch solely for the experiment.

Do not approximate what c8 "probably" did.

Capture normalized evidence for the fixture:

```text
SF set
LF
LH
DA line/hit pairs
overall line denominator
```

The final mission does not need byte-identical LCOV — counters/order may legitimately differ — but semantically relevant coverage must agree.

### 4. Test current Node-native coverage WITH NODE_V8_COVERAGE

Run the fixture through today's post-TASK-2586 path.

Compare it to the historical c8 oracle.

If current coverage does not preserve the required denominator and mapping semantics, record that as a correctness regression.

Do NOT continue to remove coverage machinery before deciding how to restore the missing defence.

### 5. Test current Node-native coverage WITHOUT NODE_V8_COVERAGE

Run exactly the same Node-native coverage path with:

```text
NODE_V8_COVERAGE
```

unset.

Compare:

```text
with NODE_V8_COVERAGE
vs
without NODE_V8_COVERAGE
```

for:

* normalized LCOV `SF:` set;
* `LF`;
* `LH`;
* selected `DA:` entries;
* overall coverage;
* process exit;
* Sonar-consumable paths.

Also include a fixture where a test spawns a child Node process which executes production code.

Determine explicitly whether raw child coverage contributes to today's LCOV.

Do not assume that because JSON files are written they contribute to the test reporter.

### 6. Measure the raw V8 cost

On the real integration-ci population, measure the current coverage run with and without the explicit raw coverage environment.

Record at minimum:

```text
wall time
user CPU
system CPU
raw V8 file count
raw V8 total bytes
```

Prefer one warm baseline plus one warm experiment rather than many expensive cycles.

If practical, record the number of child Node processes or otherwise correlate raw JSON growth with subprocess-heavy integration tests.

### 7. Outcome A — hypothesis confirmed

Only if all coverage semantics remain intact without explicit `NODE_V8_COVERAGE`:

* remove the unnecessary coverage scratch-directory creation from `test/run-default-tests.ts`;
* stop injecting `NODE_V8_COVERAGE` into the test process tree;
* remove cleanup/registry code used solely by that now-unused raw coverage path;
* retain Node's built-in test coverage and LCOV reporter;
* retain per-tier LCOV fragments and `coverage:merge`.

Add a regression test proving a future change cannot reintroduce an unused raw V8 path.

### 8. Outcome B — current Node-native coverage is weaker than historical c8

If any required historical semantic is lost — particularly:

* never-loaded source denominator;
* TS original-line remapping;
* source identity;
* useful subprocess coverage;

then DO NOT ship the "remove NODE_V8_COVERAGE" optimization by itself.

Instead restore equivalent coverage semantics.

The preferred options, in order, are:

1. use a supported Node-native mechanism only if it works on the repository's supported Node versions and proves the full contract;
2. restore c8 as a reporting wrapper around the **existing required test executions**, not as a second test pass;
3. another implementation only if it provides equivalent executable proof and does not invent a duplicate test population.

Do not solve the problem by requiring Node 26 solely to obtain `--test-coverage-include-all` unless separately justified against the package's supported runtime contract.

If c8 is restored, preserve the important historical semantics:

```text
--all
--extension .ts
--exclude-after-remap
```

and ensure each required unit/integration-ci test still runs only once.

### 9. Prove Sonar compatibility

On the final implementation:

* produce canonical `coverage/lcov.info`;
* run the existing Sonar path or a semantically equivalent read-only validation;
* ensure production `src/` paths in LCOV resolve correctly;
* investigate and eliminate coverage-path warnings caused by files outside the Sonar source set where practical.

The incoming hosted run currently reports unresolved LCOV paths such as:

```text
scripts/benchmark-runtime.ts
```

The mission should establish whether those are harmless extra coverage sources or evidence that the reporting boundary is broader than intended.

Do not suppress warnings without understanding them.

## Out of Scope

* Dropping coverage thresholds.
* Reducing the production coverage denominator.
* Excluding poorly covered files to improve the number.
* Moving tests between unit and integration tiers.
* Test-impact selection.
* Sonar quality-gate policy changes.
* Removing integration tests.
* Optimizing agent-smoke.
* Changing the generic Parallix gate scheduler.
* Raising the minimum Node version merely to simplify this experiment.
* Accepting "roughly the same percentage" as proof.

## Success Criteria

1. The mission records why c8 was introduced at `4be263...` in terms of actual executable coverage behaviour, not just dependency history.

2. A deterministic fixture proves original TypeScript source identity in LCOV.

3. The fixture proves original executable TypeScript line mapping using selected source lines.

4. A never-imported production TypeScript file is explicitly tested as part of the coverage denominator.

5. Historical c8 behaviour is captured as an executable comparison baseline.

6. Current post-TASK-2586 coverage is compared against that baseline.

7. Current Node-native coverage with and without explicit `NODE_V8_COVERAGE` is compared semantically, not only by percentage.

8. A child-process fixture determines whether current LCOV actually consumes subprocess raw coverage.

9. If explicit `NODE_V8_COVERAGE` contributes nothing to required LCOV semantics, it and its write/delete path are removed.

10. If removing it changes required coverage semantics, it is retained and the hypothesis is recorded as rejected.

11. If the current post-TASK-2586 implementation has already weakened c8 semantics, equivalent semantics are restored before the mission completes.

12. Unit and integration-ci populations still execute at most once per pre-integration attempt.

13. The final `coverage/lcov.info` remains consumable by the Sonar gate.

14. No never-loaded production source disappears from the denominator merely because it was not imported by this test population.

15. No generated/transformed JS path substitutes for the intended TS source in final coverage evidence.

16. Performance evidence records the cost of the explicit raw V8 path on integration-ci.

17. The final checkpoint states one of these explicitly:

```text
A: raw NODE_V8_COVERAGE was redundant and safely removed
B: raw coverage is required by the chosen correct implementation
C: current native coverage was semantically weaker and coverage correctness was restored another way
```

## Checkpoints

### CP 1 — Reconstruct coverage history

Inspect `2354ad8c...`, `4be263...`, TASK-2547, and TASK-2586.

Document the historical coverage contract and identify what `--all`, `.ts`, source-map remapping, and `NODE_V8_COVERAGE` actually did.

### CP 2 — Build the semantic fixture and historical oracle

Create the executed/partial/never-loaded TS fixture.

Produce normalized historical c8 evidence for it.

No production coverage changes yet.

### CP 3 — Compare current native coverage with/without raw V8

Run both variants.

Include the child-process case.

Determine whether explicit raw V8 JSON changes the final LCOV semantics.

### CP 4 — Implement the evidence-supported result

Either:

* remove the redundant raw path;
* retain it;
* or restore stronger c8/equivalent semantics if TASK-2586 regressed the coverage contract.

Do not optimize first and justify later.

### CP 5 — Real integration-ci timing and Sonar proof

Run representative real integration-ci coverage before/after.

Capture runtime and raw-file evidence.

Produce canonical LCOV and prove Sonar compatibility.

## Gates

* [ ] ./scripts/verify-local.sh static-analysis
* [ ] npm test
* [ ] npm run test:integration:ci:prebuilt

Run the coverage semantic fixture explicitly.

Run one representative coverage-enabled integration-ci execution after the implementation.

Do not add a second complete test execution merely to create coverage evidence.

## Restricted Areas / Agent-Slop Guardrails

* Never remove c8 semantics because "Node has coverage now".
* Never compare only the final percentage.
* Never treat an existing LCOV file as proof that it is correct.
* Never remove never-loaded `.ts` files from the denominator.
* Never accept generated JS line locations in place of original TS coverage.
* Never upgrade Node as a shortcut without a separate runtime-support decision.
* Never reintroduce a second complete test pass for coverage.
* Never reduce test populations in this mission.
* Never hide a failed hypothesis. If `NODE_V8_COVERAGE` is actually necessary, say so and retain it.
* Never preserve raw V8 scratch machinery if no consumer reads it and its removal is proven semantically neutral.

## Stop Rules

Stop and surface the finding before optimizing further if:

* current post-TASK-2586 LCOV omits never-loaded `src/**/*.ts` files that historical c8 included;
* original TS line mapping differs materially from the c8 oracle;
* subprocess coverage is required to maintain the historical coverage contract;
* the only way to remove raw V8 output is to weaken the coverage denominator;
* Node-native equivalence would require an unsupported runtime version;
* c8/equivalent coverage cannot be folded into the already-required test executions without causing a second test pass.
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
