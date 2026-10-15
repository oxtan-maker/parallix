---
id: TASK-2676
title: dependabot pipelines
status: done
assignee: [codex]
created_date: '2026-10-07 06:40'
labels: []
dependencies: []
ordinal: 188008
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Ensure dependabot works on newer pipelines, currently it gets: 

✖ failing tests:

test at test/integration/verification/sonarqube-cloud-wiring.test.ts:41:1
✖ local sonar scan submits the worktree branch to the one Cloud project (20.835708ms)
  Error: Cannot resolve the Git branch for the Sonar analysis; check out a branch before scanning.
      at resolveSonarBranch (/home/runner/work/parallix/parallix/scripts/sonar-local.ts:27:45)
      at runSonar (/home/runner/work/parallix/parallix/scripts/sonar-local.ts:92:36)
      at run (/home/runner/work/parallix/parallix/test/integration/verification/sonarqube-cloud-wiring.test.ts:31:18)
      at TestContext.<anonymous> (/home/runner/work/parallix/parallix/test/integration/verification/sonarqube-cloud-wiring.test.ts:43:3)
      at Test.runInAsyncScope (node:async_hooks:226:14)
      at Test.run (node:internal/test_runner/test:1402:25)
      at Test.start (node:internal/test_runner/test:1262:17)
      at startSubtestAfterBootstrap (node:internal/test_runner/harness:387:17)

test at test/integration/verification/sonarqube-cloud-wiring.test.ts:96:1
✖ sonar scan fails closed when the quality gate does not pass (12.354693ms)
  AssertionError [ERR_ASSERTION]: The input did not match the regular expression /analysis or quality gate failed/. Input:
  
  'Error: Cannot resolve the Git branch for the Sonar analysis; check out a branch before scanning.'
  
      at TestContext.<anonymous> (/home/runner/work/parallix/parallix/test/integration/verification/sonarqube-cloud-wiring.test.ts:100:10)
      at Test.runInAsyncScope (node:async_hooks:226:14)
      at Test.run (node:internal/test_runner/test:1402:25)
      at Test.processPendingSubtests (node:internal/test_runner/test:974:18)
      at Test.postRun (node:internal/test_runner/test:1542:19)
      at Test.run (node:internal/test_runner/test:1467:12)
      at async Test.processPendingSubtests (node:internal/test_runner/test:974:7) {
    generatedMessage: true,
    code: 'ERR_ASSERTION',
    actual: Error: Cannot resolve the Git branch for the Sonar analysis; check out a branch before scanning.
        at resolveSonarBranch (/home/runner/work/parallix/parallix/scripts/sonar-local.ts:27:45)
        at runSonar (/home/runner/work/parallix/parallix/scripts/sonar-local.ts:92:36)
        at run (/home/runner/work/parallix/parallix/test/integration/verification/sonarqube-cloud-wiring.test.ts:31:18)
        at getActual (node:assert:580:5)
        at strict.throws (node:assert:728:24)
        at TestContext.<anonymous> (/home/runner/work/parallix/parallix/test/integration/verification/sonarqube-cloud-wiring.test.ts:100:10)
        at Test.runInAsyncScope (node:async_hooks:226:14)
        at Test.run (node:internal/test_runner/test:1402:25)
        at Test.processPendingSubtests (node:internal/test_runner/test:974:18)
        at Test.postRun (node:internal/test_runner/test:1542:19),
    expected: /analysis or quality gate failed/,
    operator: 'throws',
    diff: 'simple'
  }
Error: Process completed with exit code 1.

Example: https://github.com/oxtan-maker/parallix/actions/runs/37579115060/job/112654537327?pr=13
<!-- SECTION:DESCRIPTION:END -->

## Live GitHub investigation (review round 4, 2026-10-14)

Read the actual Actions job logs through the GitHub API, rather than inferring
hosted success from local checks:

- [PR #13 run 37579115060](https://github.com/oxtan-maker/parallix/actions/runs/37579115060/job/112654537327)
  failed the two reported Sonar branch-resolution cases. The credential check
  and actual scan were skipped after the test failure.
- [setup-java run 37417054518](https://github.com/oxtan-maker/parallix/actions/runs/37417054518/job/112117868309),
  tsx run 37417059049, and eslint run 37417050190 failed the same two cases.
- [Ink run 37417063946](https://github.com/oxtan-maker/parallix/actions/runs/37417063946)
  failed TypeScript compilation because the proposed Ink version rejects
  `textWrap="end"`. Dependency-upgrade compatibility is outside this mission.

GitHub main was e38bec80a60532684fe811c3b81c29158ca9f300 and still used the
checkout-dependent test helper. The latest PR run was October 7; PR #13 closed
October 9 without merging. There were no open GitHub PRs. This mission's fix
has not been published to GitHub, so those failed runs do not exercise it.

Manual replay: check out PR #13 head f9bcd8a4c24d9202321863e7918e6ef3b132c054
as a disposable detached worktree, use the installed local dependencies, and
run the owning Sonar suite with GitHub PR context. Original suite: 7 passed,
2 failed. Apply this mission's fixture/test changes while retaining the old
checkout's npm-lockfile assertion: 11 passed, 0 failed. Copying the entire newer
suite initially failed its unrelated pnpm-lockfile assertion because that
historical checkout predates the pnpm migration. This was a local focused
replay, not a complete hosted verification or a live Sonar scan. The current
mission's two focused suites passed 19/19.

The GitHub secrets metadata APIs returned zero Dependabot secrets and one
Actions secret, SONAR_TOKEN. Owner oxtan-maker is a user, not an organization.
Consequently the existing mandatory same-repository token check will fail for
Dependabot even after the test fix lands. An administrator must provision an
approved Sonar analysis credential as a Dependabot secret named SONAR_TOKEN
before a real Dependabot scan can succeed. No secret values were read or
changed, no workflow was rerun, and no quality gate or trust guard was bypassed.
README remains unchanged.

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 Verification gate ran and passed on the final tree with captured proof rather than an unverified claim
- [ ] #2 Lint and static analysis report clean on every changed file
- [ ] #3 No focused or unannotated skipped tests were introduced (no .only and no bare .skip)
- [ ] #4 Final checkpoint Goal Check table cites real evidence using file:line references and test names
- [ ] #5 Docs updated to reflect any workflow or user-facing behavior change
- [ ] #6 Bug-labeled missions include a red-to-green reproduction test that fails before the fix and passes after
<!-- DOD:END -->

## Human-approved follow-up (2026-10-14)

The owner provisioned Dependabot `SONAR_TOKEN`. A metadata-only GitHub API check
returned one secret named `SONAR_TOKEN`; its value and scan validity were not
inspected. This supersedes the missing credential blocker recorded above.

Only Dependabot PR #2 was merged, on September 26. Its verification and Sonar
scan passed; release failed because version 1.5.180 was already published for
another SHA. The owner approved skipping package publication for Dependabot
merges while retaining verification. Commit 4e02729186 adds the release guard
using the merged PR author and exact main SHA, including human-performed merges.
Ordinary publication stays eligible; lookup errors block release.

Manual native CLI checks against the read-only GitHub API classified PR #2's
merge as ineligible and the normal October 9 publication as eligible. Three
focused suites passed 23/23; static analysis and docs checks passed. No release
was executed and no hosted success with this mission fix is claimed. README
remains unchanged. Mission scope, success criteria, gates, and CP-2/CP-3 were
updated through px for the approved follow-up. The operator will restart review.

## Operator decision: reuse the existing workflow (2026-10-14)

Use the existing `ci-required` workflow for Dependabot PR verification. No
separate Dependabot pipeline or `release-policy` job is required or approved.
Move the merged-PR author check for the exact main SHA into the existing
`publication-proof` job and pass release eligibility to the existing `release`
job. Remove the separate `release-policy` job and its release dependency.

Dependabot-authored PRs must still pass normal verification. Their merges must
skip npm publication, tags and GitHub Releases, including when a human performs
the merge. Ordinary verified changes remain eligible for publication. Check
the PR author rather than the triggering actor; provenance lookup failures
must block publication without suppressing verification. Keep README unchanged.

This decision supersedes the earlier proposal to reconcile packaging assertions
by adding `release-policy` to their expected dependency list. Update the owning
contracts to prove the guard through the existing jobs, preserving exact-SHA
verification, publication authorization and release-only OIDC permissions.
Update release guidance to describe the resulting behavior.

Implementation and fresh verification for this decision remain pending. Earlier
passing checks and checkpoint evidence describe the previous implementation;
they do not prove compliance with this decision. Before handoff, run the focused
owning contracts, required static analysis and docs checks, and a manual public
interface check of Dependabot and ordinary merge eligibility without publishing
or changing the live Sonar project. Record fresh final checkpoint evidence for
all success criteria. Do not clear the invalid-contract report using evidence
for the superseded design.

## Existing-job implementation and verification (2026-10-14)

The publication-proof job now performs the exact-main-SHA PR-author check with
read-only pull-request permission. It supplies release eligibility alongside
its existing verification proof. Only the author-lookup step permits failure;
its failed, skipped, cancelled or missing output defaults eligibility to false.
The source verification condition does not inspect eligibility, and release
requires true. The separate release-policy job and dependency are removed.
README remains byte-identical to the mission base.

Focused packaging and three verification suites passed 33/33. Static analysis
and docs passed. A disposable detached checkout passed all 11 Sonar wiring
cases. Manual npm run sonar in that checkout with a substituted scanner produced
exit 0 and exit 1 for the matching scanner statuses; each invocation supplied
only the host, organization and project arguments. Local detached mode exited 1
without invoking the substitute. Fixtures were removed and no Sonar request was
made. The manual native-node release-policy CLI, using the read-only GitHub API,
returned eligible=false for the historical Dependabot merge and eligible=true
for the ordinary publication SHA. Invalid-SHA lookup exited 1 without writing
eligibility. Temporary outputs were removed. Dependabot secret metadata still
lists SONAR_TOKEN; its value and validity were not inspected. Hosted pipeline
success remains unproven. The unchanged integration-ci gate and final checkpoint
evidence follow on the committed implementation.
