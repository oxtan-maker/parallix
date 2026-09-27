---
id: TASK-2586
title: Collapse redundant pre-integration coverage and Sonar passes
status: done
assignee: [codex]
created_date: '2026-09-26 15:28'
labels:
  - ai_sdlc
dependencies: []
ordinal: 117008
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Goal

Reduce Parallix pre-integration critical-path time without weakening the repository's intended verification policy.

The current local pre-integration path redundantly executes most CI-safe tests a second time solely to generate coverage and then executes two SonarQube Cloud analyses of the same mission candidate.

Replace this with:

1. coverage collected as a reporting mode of the test executions that must run anyway;
2. exactly one local mission Sonar analysis: a SHORT comparison branch targeting `main`;
3. the provider quality gate as the Sonar pass/fail authority for new-code HIGH/BLOCKER severity, coverage, duplication, and security-hotspot review; and
4. no permanent per-mission total-code LONG analysis.

Do not reduce test populations, remove required local-only integration coverage, weaken the provider quality gate, or defer failures that can be detected locally until GitHub.

## Why Now

Observed local timings after parallelizing pre-integration:

* dedicated coverage execution: approximately 420 seconds;
* Sonar: approximately 200–300 seconds;
* these remain substantially serial because Sonar depends on coverage.

Current `main` still has two older architectural patterns on the critical path.

First, local pre-integration runs:

```
integration-suite
    npm run test:integration:prebuilt
```

and separately:

```
coverage
    npm run test:coverage -- --threshold 0 --lcov
```

The coverage command executes the complete unit + `integration-ci` population again through `c8`, currently with coverage concurrency 2. GitHub CI already uses the preferred architecture: `PARALLIX_TEST_COVERAGE=1` makes coverage a reporting mode of the normal unit and integration-ci executions and `coverage:merge` combines their LCOV fragments without a second test pass.

Second, local mission Sonar currently executes:

```
candidate/mission/<slug>   SHORT, target main, provider quality gate
mission/<slug>             LONG, second full analysis
total-code API check       HIGH/BLOCKER across complete candidate
```

The LONG path was deliberately introduced after TASK-2525.05 removed the then-existing HIGH/BLOCKER debt. It is not necessary to enforce the current progressive new-code policy.

Current SonarQube Cloud semantics are:

* SHORT branches evaluate quality-gate conditions on new code only;
* their new code is the change relative to the configured target branch;
* `sonar.branch.target=main` explicitly establishes that target for the local comparison scan;
* LONG branches additionally permit overall-code conditions/metrics.

The current Parallix provider policy is intentionally progressive:

```
Blocker -> blocking
High    -> blocking
Medium  -> visible, non-blocking
Low     -> visible, non-blocking
Info    -> visible, non-blocking
```

with provider-owned new-code conditions for severity plus coverage, duplication and security-hotspot review.

Therefore the second LONG analysis adds one semantic only:

```
fail a mission because unchanged total code contains a HIGH/BLOCKER issue
```

That is no longer a required per-mission property. Changes in quality profiles/rules that reveal serious findings in otherwise unchanged old code are repository-baseline governance and must not require every unrelated mission to perform a second full Cloud analysis.

GitHub publication verification already relies on the provider new-code gate rather than the mission total-code assertion. Local verification should detect the same Sonar regressions before integration instead of maintaining a stricter unrelated total-code policy.

## Required End State

The local pre-integration topology should be structurally equivalent to:

```
dependency-audit ------------------------------+
                                               |
static-analysis -------------------------------+
                                               |
build ----------------+------------------------+
                       |                        |
                       +-> integration-ci + coverage --+
                       |                               |
                       +-> integration-local           +-> coverage merge
                       |                               |        |
                       +-> workflow                    |        v
                       |                               |   ONE Sonar scan
                       +-> agent-smoke                 |        |
                                                       |   SHORT candidate
unit + coverage ---------------------------------------+   target = main
                                                                |
                                                       provider quality gate
                                                                |
                                                           integration
```

Exact scheduling may differ, but the following invariants are mandatory:

* every unit test required today still runs;
* every `integration-ci` test required today still runs;
* every `integration-local` test required today still runs;
* workflow and real-agent gates remain required;
* unit and integration-ci tests execute at most once for this pre-integration attempt;
* coverage is generated by those executions rather than by a separate coverage test population;
* one local mission causes exactly one Sonar scanner analysis;
* that Sonar analysis is SHORT and targets `main`;
* a failed provider quality gate still fails integration locally.

## Scope

### 1. Replace the dedicated local coverage execution

Use the coverage-aware runner already used by GitHub.

The unit population must run with:

```
PARALLIX_TEST_COVERAGE=1
```

and produce:

```
coverage/.lcov-unit.info
```

The `integration-ci` population must run once with:

```
PARALLIX_TEST_COVERAGE=1
```

and produce:

```
coverage/.lcov-integration-ci.info
```

After both complete successfully, run the existing LCOV merge path to produce:

```
coverage/lcov.info
```

The merge itself must not execute tests.

The `integration-local` population remains mandatory locally but does not need to contribute to LCOV unless current supported behaviour already requires it. Preserve the current coverage population: unit + integration-ci.

### 2. Preserve the full integration proof

Do not simply remove:

```
npm run test:integration:prebuilt
```

and accidentally lose tests.

The resulting pre-integration execution must prove:

```
integration-ci ∪ integration-local == complete required integration population
```

using the existing positive test-category registry as the authority.

Do not duplicate integration files between the two executions.

Do not create another test-membership list.

### 3. Preserve unit verification explicitly

Today the dedicated coverage path also happens to execute the unit population.

After removing that path, the unit suite must remain an explicit required pre-integration proof.

Do not optimize away unit tests because they previously arrived indirectly through coverage.

### 4. Isolate concurrent coverage scratch state

Unit coverage and integration-ci coverage may execute concurrently.

Their output ownership must be race-safe.

The final LCOV fragments are already distinct, but inspect `NODE_V8_COVERAGE` and any temporary cleanup paths before enabling concurrent execution.

If both currently share:

```
tmp/coverage-v8
```

give each invocation a process/tier-owned scratch directory or otherwise prove concurrent writers and cleanup cannot interfere.

Do not solve this with a global lock that serializes the two test populations and recreates the critical path.

### 5. Retire the old coverage architecture where genuinely unused

After migrating all supported pre-integration and GitHub consumers, audit references to:

```
npm run test:coverage
coverage-gate.ts
c8
```

If the dedicated `c8` coverage runner has no supported runtime caller after this mission, delete the obsolete path, its dedicated tests, and the `c8` dependency if nothing else uses it.

Do not retain an entire second coverage architecture as speculative fallback code.

If an actual supported external/public contract still requires `npm run test:coverage`, document that concrete consumer and keep only what that contract needs.

### 6. Collapse local mission Sonar to one SHORT analysis

For an actual local `mission/*` worktree, `npm run sonar` must perform exactly one scanner analysis.

Use the existing comparison identity:

```
candidate/mission/<slug>
```

with:

```
sonar.branch.target=main
```

Keep:

```
sonar.qualitygate.wait=true
```

The provider quality gate remains fail-closed.

A scanner upload without a completed passing quality gate is not success.

### 7. Keep explicit SHORT-branch validation

Retain a fail-closed assertion that the comparison analysis is actually represented by SonarQube Cloud as a SHORT branch.

Do not silently continue if `candidate/mission/<slug>` has accidentally become LONG, because that changes new-code semantics.

The SHORT assertion is a cheap provider-state check and is not the redundant second analysis being removed.

### 8. Remove the LONG mission analysis

Delete the second scanner invocation against:

```
mission/<slug>
```

Remove the requirement that local mission branches be represented as Sonar LONG branches.

Remove the associated wait/poll path that exists only to wait for that second analysis.

Remove repository code whose sole purpose is querying total-code:

```
reliability_issues
security_issues
maintainability_issues
```

and summing HIGH/BLOCKER impacts across the complete candidate.

Do not convert that check into another local implementation of the provider quality gate.

### 9. Remove total-code policy from the active mission gate

The per-mission invariant is:

```
the mission introduces no provider-blocking new-code regression relative to main
```

It is NOT:

```
every mission must re-prove that all unchanged repository code contains zero HIGH/BLOCKER findings
```

TASK-2525.05's zero-total-code remediation remains valid historical evidence that the baseline was cleaned.

Do not rewrite historical completed tasks or checkpoint evidence to pretend the LONG analysis never existed.

Update active policy and runtime behaviour only.

### 10. Keep the provider as policy authority

The Sonar provider continues to own the active new-code conditions, including:

* Maintainability severity at the configured blocking threshold;
* Reliability severity at the configured blocking threshold;
* Security severity at the configured blocking threshold;
* new-code coverage;
* new-code duplication; and
* security-hotspot review.

Do not implement copies of these rules in TypeScript.

Before removing the LONG scan, inspect the currently associated SonarQube Cloud quality gate using read-only provider APIs and record sanitized evidence that the expected new-code conditions remain active.

Never emit `SONAR_TOKEN`.

Do not make provider configuration changes in this mission.

### 11. Preserve GitHub verification

GitHub `ci-required` must retain its existing Sonar verification and coverage behaviour.

Do not weaken GitHub to make local and hosted execution look identical.

The intended relationship is:

```
local mission SHORT scan against main
    catches Sonar/new-code problems before integration

GitHub exact-SHA scan from clean hosted checkout
    independently reproduces provider verification at the publication trust boundary
```

A mission must not need GitHub to discover an ordinary Sonar quality-gate failure that the local SHORT comparison could have reported.

### 12. Update ADR 0060

Correct ADR 0060 to describe one local mission Sonar analysis rather than SHORT + LONG.

Record the decision explicitly:

* local missions use a SHORT comparison branch targeting `main`;
* provider new-code quality gate is the Sonar integration authority;
* the previous total-code LONG mission analysis is retired;
* TASK-2525.05's zero-HIGH/BLOCKER total-code cleanup was a baseline-remediation activity, not a permanent requirement that every mission re-certify the complete repository;
* unchanged-code findings caused by future rule/profile/provider changes belong to baseline/main governance rather than unrelated mission verification;
* GitHub still performs its independent exact-SHA hosted verification;
* the ADR's hosted-provider latency reconsideration trigger remains intact.

Do not change ADR 0060's Cloud-vs-local-provider decision.

## Required Regression Tests

Add focused executable coverage proving all of the following.

### Coverage/test execution

A repository-gate test must prove that local pre-integration:

* contains an explicit unit execution;
* contains explicit `integration-ci` and `integration-local` executions;
* enables coverage on unit and integration-ci rather than invoking a second broad coverage test population;
* merges LCOV only after both coverage-producing test populations succeed;
* runs Sonar only after canonical `coverage/lcov.info` exists;
* does not run `npm run test:coverage` as a second pre-integration test pass.

Existing integration-tier consistency tests must continue proving that CI + local classifications cover the complete required integration population without gaps or overlap.

Add focused coverage for concurrent coverage output ownership if scratch/output paths are changed.

### Sonar execution

For a local mission branch such as:

```
mission/task-example
```

prove that the scanner is invoked exactly once and receives:

```
sonar.branch.name=candidate/mission/task-example
sonar.branch.target=main
```

Prove that the provider quality gate remains waited on.

Prove the SHORT-branch assertion still runs and fails closed when the provider reports the comparison branch as LONG.

Prove there is:

* no second scanner invocation for `mission/task-example`;
* no mission LONG requirement;
* no `measures/component` total-code HIGH/BLOCKER query after a successful comparison scan.

### GitHub execution

Existing tests proving that GitHub uses the shared scanner entrypoint and that a scanner/quality-gate failure propagates through the Actions step must remain green.

Do not introduce separate local/GitHub scanner implementations.

### Cleanup

After a successfully integrated mission, clean up the comparison analysis that this architecture actually creates:

```
candidate/mission/<slug>
```

Do not maintain runtime cleanup for a LONG `mission/<slug>` analysis that the runtime no longer creates merely as speculative compatibility code.

Historical stale provider branches may be cleaned manually or once during migration; do not preserve permanent dead machinery solely for them.

## Success Criteria

* Local pre-integration executes the unit population once, `integration-ci` once, and `integration-local` once.
* Unit and integration-ci executions produce the LCOV fragments consumed by `coverage:merge`; no second broad test execution exists solely for coverage.
* Canonical `coverage/lcov.info` is generated before Sonar and remains suitable for the existing provider coverage condition.
* Every integration test required before this mission still belongs to and runs through either `integration-ci` or `integration-local`.
* A local `mission/*` invokes the Sonar scanner exactly once.
* The local Sonar candidate is SHORT, explicitly targets `main`, waits for the provider quality gate, and fails integration when that gate fails.
* No second LONG mission scan, long-analysis polling path, or repository total-code HIGH/BLOCKER query remains in the active local mission verification path.
* GitHub `ci-required` retains its current clean-runner test, coverage, Sonar and quality-gate semantics.
* ADR 0060 describes the resulting one-scan policy and no active documentation claims that every mission must re-certify total-code HIGH/BLOCKER = 0.
* No permanent duplicate coverage or Sonar architecture is retained without a concrete supported caller.
* `./scripts/verify-local.sh static-analysis` passes.
* All relevant unit/integration regression tests pass.
* A real local mission SHORT analysis reaches SonarQube Cloud and passes the currently configured provider gate before the implementation is declared complete.

## Performance Evidence

This is an optimization mission, so correctness-only completion is insufficient.

Capture the final pre-integration per-gate timing and compare it with the current observed topology.

At minimum record:

```
before:
  dedicated coverage ≈ 420 s
  Sonar total ≈ 200–300 s
  coverage -> Sonar is serial
```

and the corresponding final measurements.

Do not spend several full cycles manufacturing statistically perfect benchmark data. One representative before measurement may use the already recorded baseline if it is trustworthy; capture at least one representative after run.

The final evidence must demonstrate structurally that:

* the second unit/integration-ci execution is gone;
* the second Sonar analysis is gone.

If overall pre-integration wall time does not materially improve despite removing those two operations, do not hide that result. Identify the new critical path and record it for the next optimization.

## Checkpoints

### CP 1 — Verify semantics and establish exact execution graph

Before changing runtime behaviour:

* inspect the active SonarQube Cloud quality gate read-only;
* confirm the comparison branch currently evaluates against `main`;
* record current pre-integration gate dependencies;
* record which test populations the existing coverage gate executes;
* identify all supported callers of `test:coverage`, `coverage-gate.ts`, `c8`, LONG mission scanning and total-code Sonar APIs.

Do not modify implementation until there is a concrete caller/invariant inventory.

### CP 2 — Fold coverage into required test execution

Implement coverage-aware unit and integration-ci gates, preserve integration-local, isolate concurrent coverage output, merge LCOV, and remove the redundant dedicated pre-integration coverage execution.

Run focused tests proving population preservation before deleting old coverage machinery.

### CP 3 — Collapse Sonar to the SHORT comparison scan

Remove the LONG mission scanner invocation and total-code assertion while retaining the SHORT type assertion, explicit `main` target, quality-gate wait and GitHub behaviour.

Add red-to-green regression coverage that would fail if a second mission scanner invocation or total-code query is reintroduced.

### CP 4 — Remove dead machinery and update architecture

Audit/delete no-longer-used coverage and Sonar helpers, update ADR 0060 and active comments, and ensure historical mission evidence remains historical.

Do not leave exported helpers, tests or comments for the retired architecture unless a real caller remains.

### CP 5 — Final real verification and timing capture

Run repository verification, perform a real local mission Sonar comparison against Cloud, capture final gate timings, and identify the resulting critical path.

## Gates

* [ ] ./scripts/verify-local.sh static-analysis
* [ ] npm test
* [ ] npm run test:integration:ci:prebuilt
* [ ] npm run test:integration:local

Run the real Sonar/pre-integration path required by this mission after the implementation is complete; do not add a second redundant Sonar invocation merely as a checkpoint gate.

## Restricted Areas / Agent-Slop Guardrails

* Do not reduce test membership to improve timings.
* Do not move tests from integration to unit merely because unit is faster unless the test genuinely becomes hermetic as part of an independently justified change.
* Do not skip, quarantine, `.skip`, `.only`, timeout-inflate, or weaken tests to meet the performance goal.
* Do not lower Sonar quality-gate conditions.
* Do not modify Sonar quality profiles, severity mappings, coverage thresholds, duplication thresholds, hotspot policy or source exclusions.
* Do not introduce a local reimplementation of Sonar's new-code quality gate.
* Do not replace the removed LONG analysis with issue-by-issue API polling that reconstructs the same total-code check.
* Do not retain a second coverage runner or second Sonar architecture "for safety" without identifying a real supported caller.
* Do not create separate `sonar:local` / `sonar:github` implementations.
* Do not serialize unit and integration-ci merely to avoid designing safe coverage output ownership.
* Do not increase pre-integration concurrency blindly. Retain the current concurrency initially and alter it only from measured evidence that doing so reduces wall time without creating contention/timeouts.
* Do not rewrite completed task/checkpoint history to conform to the new decision.
* Do not make SonarQube Cloud configuration write calls.
* Do not expose or persist `SONAR_TOKEN`.
* Do not declare the mission complete based only on mocked Sonar tests; perform one real SHORT comparison analysis against the configured Cloud project.

## Stop Rules

Stop and surface the evidence rather than improvising if any of these are found:

* the active provider quality gate no longer contains the expected blocking new-code HIGH/BLOCKER policy;
* the SHORT comparison analysis does not actually evaluate mission changes relative to `main`;
* GitHub publication verification depends on total-code semantics not represented by the current repository documentation;
* removing the dedicated coverage runner would drop a currently supported coverage population or public command contract that cannot be replaced by the coverage-aware normal runner;
* unit and integration-ci coverage cannot safely execute concurrently without a broader architecture change;
* a required integration file falls outside both `integration-ci` and `integration-local`;
* a proposed performance improvement requires weakening a test, quality condition or trust boundary.

In those cases, preserve the existing behaviour and record the concrete blocker rather than inventing another compatibility layer.
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
