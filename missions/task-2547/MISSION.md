# Mission: Make GitHub coverage reuse the CI-safe test execution (task-2547)

## Goal
Make coverage a reporting mode of the authoritative CI-safe test plan, so the
GitHub `ci-required` job executes the `unit` and `integration-ci` populations
once, emits their combined `coverage/lcov.info`, and sends that report to the
existing SonarQube Cloud scan without selecting `integration-local` tests.

## Why Now
GitHub run `35564233203`, job `106222771593`, passed `npm run test:ci` and then
failed in the separate broad coverage pass when it selected the intentionally
local-only `test/task-2286-native-sea-smoke.test.ts`. That pass bypasses the
authority in `test/lib/test-run-plan.ts` and `test/lib/test-categories.ts`,
reruns CI-safe tests, and prevents `npm run sonar` from running.

## Refinement Signals
- Predicted NEL bucket: Medium (81–235)
- Confidence: High
- Selection note: activate as-is
- Main drivers: one test-tier authority, one hosted execution per selected test,
  correct LCOV aggregation, and live GitHub-to-SonarQube proof

## Scope
- Trace and reuse the selection authority in `test/lib/test-run-plan.ts` and
  `test/lib/test-categories.ts` for coverage execution; do not duplicate either
  integration registry.
- Add a general regression test at `test/task-2547-repro.test.ts` proving the
  hosted coverage selection is a subset of `unit ∪ integration-ci` and has an
  empty intersection with `integration-local`.
- Make the existing CI-safe test execution coverage-aware, or use an equivalent
  path that executes each selected `unit` and `integration-ci` test at most once
  in the GitHub `ci-required` job.
- Produce one valid `coverage/lcov.info` from the CI-safe execution population;
  merge duplicate source/line records using LCOV semantics rather than raw
  concatenation.
- Update the relevant package, coverage, workflow, and focused test wiring so
  trusted GitHub runs invoke the repository-owned `npm run sonar` after coverage
  is available, without a second broad test invocation or a duplicated `--lcov`
  flag.
- Preserve the existing local commands and tier memberships for `integration-ci`,
  `integration-local`, full integration, `agent-e2e`, and lifecycle E2E.
- Capture a real `github-publish/<sha>` `ci-required` run as final evidence.

## Out of Scope
- Changing the membership rules or dependency policy of the four verification
  tiers defined by `ADR 0057`.
- Installing Node 25+ or changing GitHub runner images to make
  `task-2286-native-sea-smoke.test.ts` runnable in hosted CI.
- Creating another coverage registry, using environment/capability detection to
  classify tests, or maintaining filename-exclusion heuristics outside the
  existing planner.
- Changing SonarQube Cloud provider, organization (`oxtan-maker`), project
  (`parallix`), branch identity, quality-gate policy, or restoring local Docker
  SonarQube.
- Changing release workflow behavior, package engine requirements, or unrelated
  test-tier memberships.

## Success Criteria
> **Falsifiability rule (ADR 0039 Part 2):** Each criterion is falsifiable and
> names the behavior or artifact that demonstrates it.

- SC1: `test/task-2547-repro.test.ts` fails at the mission parent commit because
  hosted coverage selection includes at least one registry-classified
  `integration-local` file, then passes after the change by proving hosted
  coverage is a subset of `unit ∪ integration-ci` and intersects
  `integration-local` in zero files.
- SC2: The coverage selection used for hosted CI originates from
  `test/lib/test-run-plan.ts` and `test/lib/test-categories.ts`; no coverage-only
  CI/local membership list, filesystem glob, filename exclusion, or environment
  capability classifier remains.
- SC3: In one trusted GitHub `ci-required` job, every `unit` and
  `integration-ci` test executes at most once; no `integration-local`,
  `agent-e2e`, or lifecycle E2E test executes, including
  `test/task-2286-native-sea-smoke.test.ts`.
- SC4: That same CI-safe execution produces one Sonar-consumable
  `coverage/lcov.info` covering the combined production-code results. If a
  source/line occurs in separate suite fragments, its LCOV record is merged or
  normalized correctly rather than duplicated by concatenation.
- SC5: The trusted GitHub path reaches repository-owned `npm run sonar`, reports
  the exact `github-publish/<sha>` candidate revision to SonarQube Cloud, waits
  for the Cloud quality gate, preserves repository coverage enforcement, and
  ends with green `ci-required`.
- SC6: Existing commands `npm run test:integration:ci`,
  `npm run test:integration:local`, `npm run test:agent-e2e`, and
  `npm run test:lifecycle-e2e` retain their intended tier populations; local
  coverage, if retained, obtains its population through the same planner.
- SC7: The former duplicate workflow expansion
  `coverage-gate.ts --lcov --threshold 0 --lcov` no longer occurs.
- SC8: `npm test`, `npm run test:integration:ci`, and
  `./scripts/verify-local.sh static-analysis` exit zero on the final tree with
  no `.only` or bare `.skip` introduced.

## Risks and Assumptions
- Risk: unit and integration CI suites may need separate Node invocations;
  mitigate by collecting coverage in those existing invocations and merging
  records with valid LCOV semantics.
- Risk: workflow assertions may accidentally prove command text rather than
  execution count; mitigate with the general selection regression plus the
  authoritative GitHub log for the candidate SHA.
- Assumption: the existing planner can expose reusable pure selection behavior
  without changing its tier policy.
- Assumption: trusted `github-publish/<sha>` execution has `SONAR_TOKEN`; an
  untrusted fork intentionally cannot provide live Sonar proof.
- Risk: Sonar Cloud may be unavailable after the GitHub test phase; preserve its
  existing fail-closed quality-gate behavior and record the run result rather
  than treating a local test as equivalent proof.

## Checkpoints
- CP 1: Before any fix, author `test/task-2547-repro.test.ts`. Construct hosted
  coverage selection through the current coverage path and assert it contains no
  test classified by the authoritative registry as `integration-local`; at the
  mission parent commit this assertion must be red, and after the fix it must be
  green. The test must prove the set relationship, not name only
  `task-2286-native-sea-smoke.test.ts`.
- CP 2: Trace every caller of the test planner, coverage gate, package command,
  and `ci-required` workflow. Extract only reusable pure selection behavior from
  the planner when necessary, then route coverage through it.
- CP 3: Enable coverage during the selected unit and `integration-ci` execution,
  aggregate LCOV records correctly, and update command/workflow wiring so the
  hosted job has no second broad test pass and no duplicate `--lcov` argument.
- CP 4: Extend focused coverage for the selector invariant, single-execution
  command boundary, and correct merged LCOV behavior; preserve local tier paths.
- CP 5: Run repository gates and capture final Goal Check evidence, including
  the real `github-publish/<sha>` `ci-required` log showing the CI-safe tests,
  LCOV artifact, Sonar scan, quality-gate result, and green job.

### Checkpoint Documentation Requirements
Every checkpoint document (CP-N.md) MUST lead with durable evidence forms
Parallix verifies today: exact test names, ADR references, test file paths, and
recognized repository commands or paths such as `npm ...`, `node ...`, `git ...`,
`px ...`, or `./...`. File:line references are accepted when needed but
discouraged because line numbers rot.

Every checkpoint document MUST include:
- A summary of work done.
- The exact heading `## Goal Check`.
- The exact 3-column table header `| Criterion | Evidence | Status |`, with one
  evidence row for every success criterion.
- Evidence for the red-to-green selector test at `test/task-2547-repro.test.ts`,
  the tier authority in `test/lib/test-run-plan.ts` and
  `test/lib/test-categories.ts`, the relevant recognized commands, and the
  final `github-publish/<sha>` `ci-required` log when live proof is required.
- A non-generic `Next action:` line at the bottom.

Raw `stat`/`ls` output or generic prose alone is not enough; pair shell output
with one of the accepted references above. A checkpoint that only pastes shell
output or generic prose fails.

Example Goal Check table:

| Criterion | Evidence | Status |
|---|---|---|
| Hosted coverage selection excludes local integration | `test/task-2547-repro.test.ts` | PASS |
| CI-safe execution produced coverage | `npm run test:ci` | PASS |
| Final repository verification ran | `./scripts/verify-local.sh all` | PASS |

## Gates
- [ ] npm test
- [ ] npm run test:integration:ci
- [ ] npm run test:integration:local
- [ ] npm run test:agent-e2e
- [ ] npm run test:lifecycle-e2e
- [ ] ./scripts/verify-local.sh static-analysis
- [ ] ./scripts/verify-local.sh all

## Restricted Areas
- Keep `test/lib/test-run-plan.ts` plus `test/lib/test-categories.ts` as the
  only authority for tier membership; do not copy their CI/local arrays.
- Do not change ADR 0057 tier policy or run local-only/agent/lifecycle tests in
  GitHub to obtain coverage.
- Do not alter GitHub runner images, Node version, workflow permissions,
  `ci-required` job name, SonarQube provider/project identity, or quality-gate
  policy to work around selection.
- Do not reintroduce local Docker SonarQube, a second Sonar project, a second
  coverage engine, or raw LCOV concatenation for overlapping records.
- Do not introduce `.only` or bare `.skip`.
- During this draft phase, do not modify source files outside this MISSION.md and
  its backlog task.

## Stop Rules
- Stop and request direction if satisfying one-execution hosted coverage requires
  changing verification-tier membership or making an `integration-local` test
  CI-safe.
- Stop and request direction if correct LCOV merging requires a new coverage
  engine rather than existing Node/LCOV machinery.
- Stop and request direction if the live candidate run cannot receive the
  trusted `SONAR_TOKEN`, cannot reach SonarQube Cloud, or cannot produce a
  `github-publish/<sha>` reference; record the external blocker rather than
  claiming live proof.
- Stop drafting after this contract and the allowed verification gate; do not
  implement, review, execute, or integrate the mission.
