---
id: TASK-2547
title: Make GitHub coverage reuse the CI-safe test execution
status: backlog
assignee: []
created_date: '2026-09-21 06:14'
labels: []
dependencies: []
ordinal: 87008
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Repair the GitHub verification pipeline after live run `35564233203`, job `106222771593`, proved that the Sonar coverage step bypasses Parallix's verification-tier authority and reruns tests that have already passed.

The existing GitHub-safe verification completed successfully:

```text
npm run test:ci
```

which intentionally executes:

```text
typecheck
build
unit
integration-ci
bundle/package checks
```

using the authoritative tier selection in:

```text
test/lib/test-run-plan.ts
test/lib/test-categories.ts
```

The subsequent Sonar preparation then started a second test pass:

```text
npm run test:coverage -- --threshold 0 --lcov
```

`coverage-gate.ts` independently globs nearly every `*.test.ts`, ignoring the CI/local verification registry. It therefore reruns the unit and CI-safe integration tests and additionally executes `integration-local` tests that must not run on GitHub.

The live failure is:

```text
test/task-2286-native-sea-smoke.test.ts

No ESM-SEA-capable Node runtime found
need major >= 25
GitHub runner: Node 24.21.0
```

That test is intentionally local-only. Installing Node 25/26 on GitHub would hide the defect rather than fix it.

The coverage failure occurs before `npm run sonar`, so run `35564233203` did **not** prove GitHub → SonarQube Cloud integration.

The architectural defect is that coverage currently defines its own test population.

**Coverage is a reporting mode of an already selected verification tier. It must not be a second authority for which tests execute.**

Fix the pipeline so the CI-safe tests execute once, generate the LCOV report from that execution, and SonarQube Cloud consumes that report. Also ensure that in the local integration mode test only execute once

<!-- SECTION:DESCRIPTION:END -->

## Root Cause Contract

There is exactly one authority for test membership:

```text
test/lib/test-run-plan.ts
        +
test/lib/test-categories.ts
```

It defines:

```text
unit
integration-ci
integration-local
agent-e2e
```

The coverage implementation must consume this authority.

It must not independently derive equivalent membership from:

* filesystem globs;
* filename exclusions;
* dependency heuristics duplicated outside the existing planner;
* `CI=true`;
* `GITHUB_ACTIONS`;
* Node version;
* available executables;
* environment capability detection; or
* a second coverage-specific registry.

The existing verification-tier model from ADR 0057 is not being reconsidered in this mission.

## Required Outcome

The GitHub-hosted verification flow must become conceptually:

```text
npm ci
   |
   v
typecheck
build
   |
   +---- unit tests ------------+
   |                            |
   +---- integration-ci tests --+-- executed ONCE with coverage
                                |
                                v
                         coverage/lcov.info
                                |
                 +--------------+--------------+
                 |                             |
          bundle/package                  SonarQube Cloud
          verification                         |
                                                v
                                         quality gate
```

The implementation may keep unit and `integration-ci` as separate Node test invocations if their execution semantics require that.

The invariant is:

> Every GitHub-required test executes at most once per `ci-required` job, while the resulting coverage from the CI-safe test population is available to Sonar.

Do not optimize by changing which tests belong to the tiers.

## Required Changes

### 1. Make coverage consume the existing test plan

Refactor coverage execution so its selected files originate from the existing test-plan authority.

The coverage path must be able to request at least:

* unit;
* `integration-ci`; and
* the existing local/full verification population where required outside GitHub.

Do not copy the contents of `INTEGRATION_CI_TESTS` or `INTEGRATION_LOCAL_TESTS`.

Do not maintain a parallel coverage registry.

If common pure selection functionality needs to move to a reusable helper, extract it from the existing planner rather than reproducing it.

### 2. Do not rerun GitHub tests merely to collect coverage

The current structure:

```text
npm run test:ci
npm run test:coverage
npm run sonar
```

is rejected.

A replacement such as:

```text
npm run test:ci
npm run test:coverage:ci
npm run sonar
```

is also rejected if `test:coverage:ci` executes unit or `integration-ci` tests a second time.

Coverage must be enabled during the test execution that constitutes GitHub verification.

Possible implementation shapes include:

* coverage-aware modes of the existing unit and integration runner followed by deterministic LCOV aggregation; or
* another implementation that demonstrably executes each selected test only once.

The mission is not prescribing one mechanism, but duplicate test execution is not an acceptable solution.

### 3. Produce one Sonar-consumable LCOV report

After the CI-safe test executions complete successfully:

```text
coverage/lcov.info
```

must represent their combined production-code coverage.

If separate unit and `integration-ci` coverage fragments are produced, combine them correctly.

Do not naïvely concatenate duplicate LCOV records where the same source line appears in more than one run.

For the same source line, execution counts must be combined or normalized using correct LCOV semantics so Sonar receives one coherent report.

Do not implement a new semantic coverage engine. Reuse the existing Node/LCOV machinery where possible.

### 4. Preserve verification-tier semantics

GitHub must continue to run:

```text
unit
integration-ci
```

and must not run:

```text
integration-local
agent-e2e
lifecycle-e2e
```

unless an existing ADR explicitly classifies something otherwise.

In particular, the fix must keep:

```text
task-2286-native-sea-smoke.test.ts
```

out of GitHub because it is not CI-safe.

Do not make it CI-safe merely by installing additional workstation tooling.

### 5. Preserve local verification

This mission must not weaken local verification.

Existing local commands for:

```text
integration-local
full integration
agent-e2e
lifecycle-e2e
```

must remain available and retain their intended membership.

If the coverage runner currently serves local integration, adapt it to the same authoritative tier model rather than preserving an unclassified "run every test file" path.

A local full-coverage mode may select the appropriate union explicitly through the existing planner.

### 6. Keep SonarQube Cloud unchanged

TASK-2546's provider decision is not being reopened.

The canonical service remains:

```text
https://sonarcloud.io
organization: oxtan-maker
project: parallix
```

The GitHub job must still:

1. receive `SONAR_TOKEN` only on trusted execution;
2. generate the LCOV report;
3. invoke the repository-owned `npm run sonar` command;
4. wait for the actual Cloud quality gate;
5. fail if the gate fails; and
6. preserve the repository's existing coverage enforcement.

Do not restore local Docker SonarQube.

Do not create another Sonar project.

Do not change Sonar branch identity to solve this test-runner problem.

### 7. Remove the duplicate LCOV flag

The current live workflow expands to:

```text
coverage-gate.ts --lcov --threshold 0 --lcov
```

because `test:coverage` already contains `--lcov` and the caller supplies it again.

Remove this duplication as part of making the command boundary explicit.

Do not treat this cosmetic fix as satisfying the mission.

## Required Red Reproduction

The implementation must retain an automated reproduction of the underlying architectural defect.

The reproduction must demonstrate that, before the fix, a GitHub/CI coverage plan can select a test that the authoritative verification registry classifies as `integration-local`.

It must prove the general property.

It must **not** simply assert:

```text
task-2286-native-sea-smoke.test.ts is excluded
```

A test specific to that one filename is insufficient.

The required invariant is equivalent to:

```text
coverage files selected for hosted CI
    ⊆
unit ∪ integration-ci

coverage files selected for hosted CI
    ∩
integration-local
    =
∅
```

The test should fail against the pre-fix coverage selection and pass after the fix.

## GitHub Live-Proof Requirement

This mission is not complete until its resulting integration SHA reaches a real:

```text
github-publish/<sha>
```

run and the GitHub-hosted `ci-required` job proves the correction.

The final live run must establish all of the following:

1. `npm run test:ci` or its replacement CI aggregate succeeds.
2. Unit tests execute once.
3. `integration-ci` tests execute once.
4. No `integration-local` tests execute.
5. `task-2286-native-sea-smoke.test.ts` does not execute.
6. `coverage/lcov.info` is produced from the same CI-safe test executions.
7. There is no second broad test-suite invocation merely for Sonar coverage.
8. `npm run sonar` is actually reached.
9. SonarQube Cloud reports the exact GitHub candidate SCM revision.
10. SonarQube Cloud quality-gate processing completes.
11. The repository coverage policy completes.
12. `ci-required` is green.

The GitHub log is the authoritative evidence for points 1–12.

Unit tests or YAML-string assertions are supporting evidence only.

## Acceptance Criteria

<!-- AC:BEGIN -->

* [ ] #1 Coverage test membership is selected through the existing `test-run-plan` / `test-categories` authority; no second CI/local classification list exists.
* [ ] #2 GitHub executes only the existing `unit` and `integration-ci` populations and does not execute `integration-local`, `agent-e2e`, or lifecycle-only tests.
* [ ] #3 Each test required by hosted verification executes at most once per `ci-required` job.
* [ ] #4 The same hosted test executions produce a valid combined `coverage/lcov.info` consumed by SonarQube Cloud.
* [ ] #5 Combining coverage from multiple suite executions handles duplicate source/line records correctly rather than concatenating incompatible LCOV records.
* [ ] #6 The local/full verification commands retain their existing test-tier semantics and remain runnable.
* [ ] #7 The duplicate `--lcov` invocation is removed.
* [ ] #8 A general red-to-green regression test proves hosted coverage cannot include an `integration-local` test.
* [ ] #9 A real `github-publish/<sha>` run reaches SonarQube Cloud, reports the exact candidate revision, passes the Cloud quality gate and ends with green `ci-required`.
* [ ] #10 Live GitHub evidence proves there is no second execution of the CI-safe test population solely to produce coverage.

<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
* [ ] #1 `npm test` passes on the final tree.
* [ ] #2 `npm run test:integration:ci` passes on the final tree.
* [ ] #3 `npm run test:integration:local` still selects the local-only population rather than silently losing it.
* [ ] #4 `npm run typecheck` passes.
* [ ] #5 Repository static-analysis gates pass.
* [ ] #6 No focused or unannotated skipped tests were introduced (`.only`, bare `.skip`).
* [ ] #7 The regression test fails against the old coverage-selection behaviour and passes against the new implementation.
* [ ] #8 The final Goal Check cites the real GitHub run and relevant log evidence, not an agent claim that CI "should" work.
* [ ] #9 SonarQube Cloud is actually invoked in that live run; run `35564233203` is explicitly recorded as the pre-fix failed evidence where Sonar was never reached.

- [ ] #1 Verification gate ran and passed on the final tree with captured proof rather than an unverified claim
- [ ] #2 Lint and static analysis report clean on every changed file
- [ ] #3 No focused or unannotated skipped tests were introduced (no .only and no bare .skip)
- [ ] #4 Final checkpoint Goal Check table cites real evidence using file:line references and test names
- [ ] #5 Docs updated to reflect any workflow or user-facing behavior change
- [ ] #6 Bug-labeled missions include a red-to-green reproduction test that fails before the fix and passes after
<!-- DOD:END -->
