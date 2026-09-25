---
id: TASK-2566
title: >-
  Correct SonarQube verification boundaries for local missions and GitHub
  publication
status: done
assignee: [custom]
created_date: '2026-09-24 16:56'
labels: [ai_sdlc, bug]
dependencies: []
ordinal: 101008
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Correct the SonarQube Cloud verification boundary after live GitHub publication verification exposed that repository-owned Sonar policy still conflates two different verification contexts:

1. a local Parallix `mission/*` candidate before integration; and
2. an ephemeral `github-publish/<sha>` candidate used by ADR 0058 for independent hosted verification.

The current implementation correctly uses one SonarQube Cloud project and one scanner entrypoint, but incorrectly applies a mission-specific full-code assertion to every non-PR Sonar branch.

The relevant runtime path currently performs:

    runSonar();

    await assertNoOpenHighOrBlockerIssues({
      token,
      scope: resolveIssueScope(...)
    });

For a GitHub publication push:

    GITHUB_REF_NAME=github-publish/<sha>

`resolveIssueScope()` returns that publication branch as a normal branch.

`assertNoOpenHighOrBlockerIssues()` then requires that branch to be Sonar type `LONG`:

    if (branch.type !== 'LONG') {
        throw new Error(
            `SonarQube Cloud mission branch ${branch} must be analysed as LONG ...`
        );
    }

A `github-publish/<sha>` ref is not a Parallix mission and must not acquire mission-specific lifecycle requirements merely because both flows use SonarQube Cloud.

This task must also remove stale repository policy from TASK-2546 that still describes the quality gate as:

    new_violations > 0
    fail on every new issue

The repository owner has deliberately changed the SonarQube Cloud quality gate to a progressive MQR policy:

    Maintainability severity >= High  -> fail
    Reliability severity     >= High  -> fail
    Security severity        >= High  -> fail

while lower-severity Medium/Low findings remain visible but non-blocking.

The existing quality conditions for new-code coverage, duplication and security-hotspot review remain provider-owned policy.

Finally, the GitHub workflow currently redirects the entire Sonar command into a file:

    npm run sonar > "$GITHUB_WORKSPACE/sonar-quality-gate.log" 2>&1

This hides the actual failing scanner/post-analysis message from the normal Actions log and made the live failure unnecessarily difficult to diagnose.

Make Sonar execution observable in GitHub while preserving the stored summary log and the correct exit status.

### Current live red evidence

GitHub Actions run:

    35771573999

Job:

    106894307296

Candidate:

    4be2630651c7c26e02c1c0f07192926f855b54a0

Branch:

    github-publish/4be2630651c7c26e02c1c0f07192926f855b54a0

Observed:

    checkout                                PASS
    npm ci                                 PASS
    npm run test:ci                        PASS
    CI-safe coverage generation            PASS
    npm run coverage:merge                 PASS
    Run mandatory SonarQube quality gate   FAIL

The existing workflow hides the inner Sonar failure in `sonar-quality-gate.log`, so the task must first establish the exact failure before attributing the live run to the LONG-branch assertion.

However, independently of the exact hidden error, applying the mission-only LONG/full-code assertion to `github-publish/*` is architecturally incorrect and must be repaired.
<!-- SECTION:DESCRIPTION:END -->

## Intended Verification Model

The resulting model must be:

    LOCAL MISSION

    mission/task-XXXX
            |
            v
    SonarQube Cloud scan
            |
            v
    provider new-code quality gate
            |
            v
    repository total-code HIGH/BLOCKER check
            |
            v
    candidate must be a LONG mission branch
            |
            v
    px integrate may continue

    GITHUB PUBLICATION VERIFICATION

    github-publish/<exact SHA>
            |
            v
    clean GitHub-hosted checkout
            |
            v
    tests + canonical LCOV
            |
            v
    SonarQube Cloud scan
            |
            v
    provider new-code quality gate
            |
            v
    ci-required passes

The GitHub publication ref is deliberately ephemeral.

It must NOT be required to:

- be a Sonar LONG branch;
- behave like a Parallix mission;
- receive the local mission total-code API check; or
- persist as durable Sonar mission state.

The second Sonar scan remains valuable because it independently verifies the exact ADR 0058 publication candidate from a GitHub-hosted environment.

## Current Provider Policy

The SonarQube Cloud project remains:

    organization: oxtan-maker
    project: parallix

The repository owner has manually configured the custom quality gate `Parallix new code`.

The intended current progressive issue policy is:

    Blocker -> blocking
    High    -> blocking
    Medium  -> visible, non-blocking
    Low     -> visible, non-blocking
    Info    -> visible, non-blocking

In SonarQube Cloud's current MQR/software-quality model this is represented by new-code conditions equivalent to:

    Maintainability severity >= High
    Reliability severity     >= High
    Security severity        >= High

The provider also owns the existing conditions for:

    Coverage
    Duplicated Lines (%)
    Security Hotspots Reviewed

The previously added condition:

    new_violations > 0

has been deliberately removed by the repository owner.

The previous `rating worse than A` conditions have also been replaced by the explicit software-quality severity conditions.

This mission must align repository policy/documentation/tests with that provider state.

## Required Investigation Before Implementation

### 1. Recover the exact failure from run 35771573999

Before modifying runtime behaviour, establish what actually caused:

    Run mandatory SonarQube quality gate -> exit 1

Use the best available evidence:

- rendered GitHub job summary if accessible;
- SonarQube Cloud branch analysis;
- Sonar Cloud APIs;
- reproduction against the exact candidate;
- or another direct source.

Record whether:

A. the SonarQube Cloud quality gate itself failed;

B. the scanner reported `QUALITY GATE STATUS: PASSED` and the repository's subsequent LONG/total-code assertion failed; or

C. another concrete failure occurred.

Do not write the mission history as though B was proven before this investigation.

If another failure is found, record it and determine whether it is within this mission's Sonar-boundary scope.

Do not hide or discard the original problem merely because the expected LONG-branch bug is also present.

## Required Changes

### 2. Make total-code HIGH/BLOCKER enforcement explicitly mission-only

The repository-owned full-candidate check exists for local Parallix mission verification before integration.

It must run only for an actual local mission candidate.

The authoritative namespace is the repository's configured mission branch prefix:

    mission/

At minimum the runtime must distinguish:

    local mission/*                -> run total-code HIGH/BLOCKER check
    GitHub pull request            -> do not run mission total-code check
    GitHub github-publish/*        -> do not run mission total-code check
    GitHub other branch context    -> do not implicitly treat as a mission
    local main                     -> do not implicitly treat as a mission
    arbitrary local branch         -> do not implicitly treat as a mission

Do not use:

    not GitHub == mission

as the classification rule.

A mission must be positively identified as a mission.

### 3. Preserve local mission fail-closed behaviour

For a local `mission/*` branch, the repository must continue to prove that the complete candidate contains no unresolved HIGH/BLOCKER software-quality impacts.

The local mission check must continue to:

1. analyze the real mission branch;
2. wait for the Sonar provider quality gate;
3. resolve that same branch from Sonar;
4. require the branch form necessary for total-code metrics;
5. query the actual candidate's metrics;
6. count HIGH and BLOCKER impacts across the relevant software qualities; and
7. fail integration if any remain.

Do not weaken the local pre-integration trust boundary merely to fix GitHub.

If a real local mission is unexpectedly SHORT and therefore cannot provide the required total-code proof, fail clearly.

Do not silently skip the check.

### 4. Do not require `github-publish/*` to be LONG

GitHub publication verification must rely on:

- exact candidate checkout;
- the canonical Sonar Cloud project;
- native GitHub/Sonar branch metadata;
- LCOV from the CI-safe test population;
- the actual configured provider quality gate; and
- `sonar.qualitygate.wait=true`.

Do not query Sonar branch type merely to turn `github-publish/*` into a mission-like object.

Do not modify the Sonar organization's long-lived branch regex to include:

    github-publish/.*

Do not recreate publication refs as Sonar LONG branches.

Do not create one Sonar project per publication candidate.

### 5. Remove `assertNewIssuesFail()`

The current helper:

    assertNewIssuesFail()

encodes obsolete policy:

    new_violations > 0

It is also not part of the real runtime verification path.

Delete the helper and tests whose only purpose is protecting that obsolete condition.

Do not rename it and keep the old semantics.

Do not replace it with:

    assertNoNewIssueOfAnySeverity()

The intended current policy is explicitly progressive HIGH/BLOCKER enforcement.

### 6. Keep the provider as the new-code policy authority

Do not build another repository implementation of Sonar's new-code quality-gate evaluation.

The Cloud gate owns:

- new-code severity policy;
- new-code coverage;
- new-code duplication; and
- security-hotspot review.

The repository owns:

- scanner invocation;
- exact candidate identity;
- fail-closed execution;
- local mission total-code HIGH/BLOCKER validation; and
- trust-boundary orchestration.

Do not duplicate provider logic with a local custom quality-gate engine.

### 7. Verify provider policy read-only

As mission evidence, inspect the actual currently associated quality gate for `parallix` using a read-only Sonar API call.

Capture enough sanitized evidence to establish that the active project gate no longer contains:

    new_violations > 0

and that its issue-severity policy is the intended MQR/software-quality policy:

    Maintainability severity >= High
    Reliability severity     >= High
    Security severity        >= High

Also record the active coverage, duplication and hotspot conditions.

Do not print or persist `SONAR_TOKEN`.

This read-only evidence does not require implementing a permanent runtime API assertion unless an existing accepted ADR explicitly requires one.

### 8. Do not mutate SonarQube Cloud configuration

This is a hard boundary.

This mission must make no write calls to Sonar quality-gate administration APIs.

Do not call endpoints or SDK equivalents for:

    qualitygates/create
    qualitygates/create_condition
    qualitygates/update_condition
    qualitygates/delete_condition
    qualitygates/select
    project gate reassignment

The repository owner has intentionally configured the provider gate.

This mission reconciles code with that decision.

It does not recreate provider configuration on every run.

### 9. Stream Sonar output in GitHub while preserving the summary artifact

Replace the current hidden execution:

    npm run sonar > "$GITHUB_WORKSPACE/sonar-quality-gate.log" 2>&1

with behaviour equivalent to:

    set -o pipefail
    npm run sonar 2>&1 | tee "$GITHUB_WORKSPACE/sonar-quality-gate.log"

Requirements:

- Sonar output must be visible in the normal GitHub Actions log while it runs.
- The same output must still be saved for the existing `$GITHUB_STEP_SUMMARY`.
- A non-zero `npm run sonar` exit must still fail the step.
- `tee` must not mask the scanner/wrapper exit status.
- `SONAR_TOKEN` must remain redacted/not printed.

Do not solve observability by making the Sonar step non-blocking.

### 10. Preserve the existing job summary

The existing:

    Publish SonarQube quality gate result

step should continue to provide a concise final result in `$GITHUB_STEP_SUMMARY`.

It may be adjusted to avoid excessive duplication if needed, but this mission must not remove the summary simply because output is now streamed live.

The live log and job summary serve different purposes:

    live log    -> diagnosis
    job summary -> concise result/evidence

### 11. Remove stale `new_violations` policy comments

Search the active repository tree for claims equivalent to:

    new_violations > 0
    fail on every new issue
    any new issue must fail

Update active code comments, workflow comments, tests and ADR text to the current intended policy.

Historical completed task/mission evidence must not be rewritten merely to make history look cleaner.

In particular, completed TASK-2546 CP evidence describing the gate it created is historical evidence and should remain historical.

Active runtime/configuration documentation must not continue claiming that policy is still current.

### 12. Correct `sonar-project.properties` comments

The active configuration may continue using:

    sonar.newCode.referenceBranch=main

if this remains correct for the actual provider behaviour.

But comments must describe the semantic intention rather than stale implementation metrics.

For example:

    mission/publication new-code analysis is evaluated relative to main

rather than claiming specifically that:

    new_violations only reflects ...

when `new_violations` is no longer a required gate condition.

Do not remove `sonar.qualitygate.wait=true`.

### 13. Update ADR 0060

ADR 0060 currently contains stale language equivalent to:

    the Cloud quality gate permits a new issue -> fail

Correct it.

The ADR should state that Parallix currently uses a progressive quality policy:

    HIGH/BLOCKER impacts are blocking;
    MEDIUM/LOW remain visible but non-blocking.

Also make the distinction explicit:

#### Local mission verification

The provider new-code gate is followed by repository-owned total-code HIGH/BLOCKER verification against the LONG `mission/*` candidate.

#### GitHub publication verification

The exact `github-publish/<sha>` candidate is independently analyzed from a clean hosted checkout and must pass the provider's new-code quality gate.

The publication ref does not become a Parallix mission and is not required to be LONG merely to reuse the scanner.

Do not alter ADR 0060's Cloud-vs-local-provider decision.

Do not remove its latency reconsideration trigger.

### 14. Keep one shared scanner entrypoint

Local and GitHub must continue to invoke:

    npm run sonar

through the same repository scanner implementation.

Do not create:

    sonar:local
    sonar:github
    sonar:publish

as divergent scanner implementations.

The distinction belongs around the additional repository-owned post-analysis assertion, not in duplicated scanners.

## Red-to-Green Reproduction Tests

This bug requires executable regression coverage.

### Required red case A: GitHub publication is incorrectly treated as a mission

Create a test that demonstrates the old behaviour would attempt a mission total-code branch check for:

    GITHUB_ACTIONS=true
    GITHUB_REF=refs/heads/github-publish/<sha>
    GITHUB_REF_NAME=github-publish/<sha>

The fixed behaviour must prove:

- the scanner still runs;
- the provider quality-gate result still controls success/failure;
- no mission branch-type API lookup occurs;
- no LONG requirement is applied; and
- no total-code mission metrics API call occurs.

Do not merely assert a returned string.

Prove the forbidden API/check path is not invoked.

### Required red case B: real local mission still performs the full check

For a local branch:

    mission/task-2550

prove:

- scanner runs with native mission branch identity;
- total-code check is invoked;
- SHORT mission branch fails;
- LONG mission branch with HIGH/BLOCKER = 0 passes;
- LONG mission branch with HIGH or BLOCKER > 0 fails.

This prevents the GitHub fix from weakening local verification.

### Required red case C: non-mission local branch is not silently treated as a mission

For an arbitrary local branch such as:

    experiment/foo

prove that the mission-only total-code assertion is not inferred merely from "not running on GitHub".

Do not create a second generic Sonar branch lifecycle policy in this task.

### Required test for GitHub log plumbing

Verify the workflow uses a pipe preserving the Sonar exit status and writes the streamed output to the existing log file.

A source/config test is acceptable for this plumbing detail, but live GitHub evidence remains mandatory for the complete behaviour.

## Acceptance Criteria

<!-- AC:BEGIN -->
- [ ] #1 The exact hidden failure from GitHub run `35771573999`, job `106894307296`, is recovered/reproduced and recorded before causality claims are made.
- [ ] #2 A local `mission/*` Sonar scan still performs the repository-owned total-code HIGH/BLOCKER assertion after the Cloud quality gate passes.
- [ ] #3 A GitHub `github-publish/<sha>` scan does not execute the local mission LONG-branch/total-code assertion.
- [ ] #4 Pull-request Sonar analysis does not execute the local mission total-code assertion.
- [ ] #5 Arbitrary local non-mission branches are not classified as missions merely because `GITHUB_ACTIONS` is absent.
- [ ] #6 The provider quality gate remains mandatory in all trusted Sonar execution contexts via `sonar.qualitygate.wait=true`.
- [ ] #7 `assertNewIssuesFail()` and tests/comments whose only purpose is enforcing `new_violations > 0` are removed.
- [ ] #8 Active repository documentation/comments describe HIGH/BLOCKER as the current blocking issue threshold and Medium/Low as visible but non-blocking.
- [ ] #9 ADR 0060 explicitly distinguishes local mission total-code verification from GitHub exact-SHA publication verification and no longer says every new issue must fail.
- [ ] #10 The actual SonarQube Cloud quality gate is inspected read-only and mission evidence confirms the intended current MQR severity conditions without mutating provider configuration.
- [ ] #11 The GitHub Sonar command streams output to the normal Actions log and simultaneously preserves `sonar-quality-gate.log`.
- [ ] #12 Sonar's non-zero exit status remains fail-closed through the `tee` pipeline.
- [ ] #13 The GitHub job summary continues to expose the Sonar result.
- [ ] #14 No Sonar quality-gate write API is introduced or executed by this mission.
- [ ] #15 A real post-fix `github-publish/<sha>` run for the resulting integration SHA passes `ci-required` and visibly reaches/completes SonarQube Cloud.
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
