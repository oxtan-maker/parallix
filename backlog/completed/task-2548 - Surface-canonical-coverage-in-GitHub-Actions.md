---
id: TASK-2548
title: Surface canonical coverage in GitHub Actions
status: done
assignee: [codex]
created_date: '2026-09-21 13:11'
labels:
  - ai_sdlc
dependencies: []
ordinal: 88008
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Make the coverage result already produced by GitHub verification human-readable directly in the GitHub Actions run.

TASK-2547 establishes the architectural invariant that GitHub's CI-safe tests execute once and those same executions produce the canonical:

`coverage/lcov.info`

consumed by SonarQube Cloud.

This mission must **only present that existing evidence**.

It must not:

* run tests;
* generate coverage;
* alter test membership;
* enforce a second coverage threshold;
* query a second coverage engine;
* change Sonar behaviour; or
* add another coverage authority.

The desired GitHub Actions experience is a small Markdown section in the existing `ci-required` job summary such as:

```text
Coverage

| Metric | Covered | Total | Coverage |
|--------|--------:|------:|---------:|
| Lines  | 8,214   | 8,957 | 91.7%    |

Revision: abcdef123...
Coverage source: coverage/lcov.info
SonarQube Cloud: analysis continues below
```

Functions and branches may also be shown if the canonical LCOV file actually contains reliable information for them. Do not synthesize metrics that are absent from the report.

The displayed whole-report coverage is an observability metric. It must not be mislabeled as Sonar's "new code coverage" or as a separate quality gate.

<!-- SECTION:DESCRIPTION:END -->

## Architectural Boundary

There is one coverage evidence source for GitHub verification:

```text
CI-safe test execution
        |
        v
coverage/lcov.info
        |
        +------> SonarQube Cloud
        |
        +------> GitHub readable summary
```

The summary is a projection of the LCOV artifact.

It is not another producer or authority.

The relationship must remain:

```text
test execution owns coverage generation
LCOV owns recorded coverage data
Sonar owns hosted quality analysis
GitHub summary owns presentation only
```

## Required Changes

### 1. Add a repository-owned LCOV summary renderer

Add a small repository-owned script for rendering the existing LCOV report into concise Markdown.

Prefer a pure script under `scripts/` with an interface conceptually similar to:

```text
render coverage/lcov.info
    ->
Markdown on stdout
```

The script must not know about `$GITHUB_STEP_SUMMARY`.

That keeps:

* LCOV parsing repository-owned and testable;
* GitHub-specific output routing in the workflow; and
* the script reusable locally.

Do not add a third-party coverage reporting dependency merely to calculate simple LCOV totals.

### 2. Parse LCOV correctly

At minimum report line coverage using the canonical LCOV records.

The renderer must correctly handle:

* multiple source-file records;
* duplicate source records if they legitimately exist in the merged LCOV;
* zero total coverable lines;
* malformed numeric records;
* missing LCOV input; and
* paths containing ordinary punctuation/spaces supported by LCOV.

Do not calculate "lines in source files".

The denominator is the set of coverable lines represented by LCOV.

Do not infer coverage from test counts.

### 3. Additional metrics are evidence-dependent

If the LCOV produced by TASK-2547 contains valid function and/or branch records, those may be summarized.

If it does not, omit those rows.

Do not print:

```text
Functions: N/A 100%
Branches:  N/A 100%
```

or otherwise manufacture reassuring numbers.

The minimum useful summary is line coverage.

### 4. Add the summary to `ci-required`

After the canonical LCOV has been produced successfully, append the rendered Markdown to:

```text
$GITHUB_STEP_SUMMARY
```

The workflow should remain orchestration only.

Conceptually:

```text
repository coverage command
        |
        v
coverage/lcov.info
        |
        v
repository summary renderer
        |
        v
$GITHUB_STEP_SUMMARY
```

Do not embed LCOV parsing logic in YAML/bash.

### 5. Identify the exact candidate

The summary must include the exact Git commit SHA being verified.

On GitHub this is the triggered candidate SHA, not an inferred branch tip.

Do not shorten the SHA in stored evidence if doing so introduces ambiguity. Display shortening is acceptable only if the full SHA remains available in the surrounding GitHub run.

### 6. Clearly distinguish whole-report coverage from new-code policy

The summary must call the LCOV metric something unambiguous such as:

```text
Overall covered lines in CI-safe LCOV
```

or:

```text
CI-safe line coverage
```

Do not call it:

```text
Sonar coverage
new-code coverage
quality-gate coverage
```

unless the displayed value actually comes from that provider metric.

TASK-2548 must not duplicate Sonar's new-code calculation.

### 7. Preserve the existing Sonar summary

The current Sonar quality-gate output may continue to appear separately in the GitHub summary.

Do not merge raw Sonar log parsing into the LCOV renderer.

A desirable resulting GitHub summary is conceptually:

```text
CI coverage
...

SonarQube quality gate
...
```

These are related evidence but have different authorities.

## Acceptance Criteria

<!-- AC:BEGIN -->

* [ ] #1 A repository-owned renderer reads the canonical `coverage/lcov.info` generated by TASK-2547 and produces concise Markdown without running tests or generating coverage.
* [ ] #2 The GitHub `ci-required` job appends the rendered coverage summary to `$GITHUB_STEP_SUMMARY`.
* [ ] #3 The summary reports at least covered lines, total coverable lines and percentage.
* [ ] #4 Function/branch metrics are shown only when valid corresponding LCOV records exist.
* [ ] #5 The summary identifies the exact candidate revision being verified.
* [ ] #6 The summary explicitly distinguishes whole-report CI coverage from Sonar new-code coverage/quality-gate policy.
* [ ] #7 No new coverage threshold, second coverage engine or second test execution is introduced.
* [ ] #8 A real `github-publish/<sha>` run visibly shows the coverage summary in GitHub Actions and remains green.

<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
* [ ] #1 Unit tests cover LCOV aggregation including multiple files, duplicate records, uncovered lines, empty/no-coverable-line input and malformed input.
* [ ] #2 Missing or unreadable canonical LCOV fails with an actionable message rather than displaying a fake zero result.
* [ ] #3 The renderer has no GitHub API dependency and does not read GitHub secrets.
* [ ] #4 The GitHub workflow contains no file-level coverage calculation logic.
* [ ] #5 `npm test`, `npm run test:integration:ci`, typecheck and existing static-analysis gates remain green.
* [ ] #6 A real GitHub Actions run is cited in the final Goal Check showing the rendered Markdown.

- [ ] #1 Verification gate ran and passed on the final tree with captured proof rather than an unverified claim
- [ ] #2 Lint and static analysis report clean on every changed file
- [ ] #3 No focused or unannotated skipped tests were introduced (no .only and no bare .skip)
- [ ] #4 Final checkpoint Goal Check table cites real evidence using file:line references and test names
- [ ] #5 Docs updated to reflect any workflow or user-facing behavior change
- [ ] #6 Bug-labeled missions include a red-to-green reproduction test that fails before the fix and passes after
<!-- DOD:END -->
