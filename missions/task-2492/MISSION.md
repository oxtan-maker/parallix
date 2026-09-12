# Mission: Auto-bounce integration-gate failures to the implementer (task-2492)

## Goal
Make a mission whose integration gate fails because of its change return to the
implementer with actionable gate evidence, while failures that also reproduce
on `main` become a separately tracked mainline problem and repeated mission
failures stop for human intervention.

## Why Now
TASK-2483 demonstrated a real dead end: a review-approved mission can have its
normal verification green but fail an integration-only test, leaving it in
`ready-for-integration` until a human discovers and routes the regression.
The existing squash-commit failure rebound already supplies the intended
implementer handoff pattern; integration gates need the same safe recovery
path and an explicit escape from retry loops.

## Refinement Signals
- Predicted NEL bucket: Medium (81–235)
- Confidence: High
- Selection note: activate as-is
- Main drivers: integration-gate result classification, reuse of the existing
  implementer rebound kernel, mainline reproduction handling, bounded retry
  state, and CLI/domain regression coverage.

## Scope
- Classify a failed `runPhaseGates('integration', ...)` result during `px
  integrate` as either a mission regression, a failure reproducible on `main`,
  or an exhausted retry condition.
- For a mission regression below the retry limit, reuse the existing rebound
  path to return the mission from `ready-for-integration` to `active`, retain
  the gate output in the implementer prompt, and relaunch the implementer.
- Detect or establish the repository-supported way to determine whether an
  integration failure reproduces on `main`; create a distinct backlog task for
  that condition and do not bounce the implementer.
- Persist and enforce a finite integration-gate rebound limit, then surface a
  human-actionable escalation without another implementer launch.
- Add focused tests for the successful bounce, mainline failure routing, and
  retry-limit escalation, plus any affected workflow/CLI behavior.
- Make the bounced prompt explicitly identify integration-only test evidence
  when the failed test was not covered by the mission's ordinary verification.

## Out of Scope
- Changing which commands the repository defines as integration gates or
  altering the gate-pipeline configuration merely to avoid a failure.
- Automatically repairing a failure that reproduces on `main`.
- Changing review approval rules, squash-merge semantics, or unrelated
  implementer-launch behavior.
- Retrofitting historical missions that are already stalled in
  `ready-for-integration`.

## Success Criteria
> **Falsifiability rule (ADR 0039 Part 2):** Each criterion must be falsifiable. Forbidden: subjective adjectives ("easy, fast, simple, intuitive, user-friendly, responsive, quick, efficient" without an attached metric) and vague quantifiers ("multiple, several, some, many, few, various"). For refactor / condense / migration missions, the criterion must enumerate the specific elements (rules, files, behaviours) that must survive — generic phrases like "preserve critical content" are not sufficient.

- A mission-regression integration failure while the retry budget remains
  transitions the task from `ready-for-integration` to `active`, preserves the
  failed gate output in the new implementer handoff, and schedules exactly one
  implementer relaunch.
- The integration-failure handoff identifies the failed gate command and, when
  applicable, states that the cited failing test is integration-only rather
  than covered by ordinary mission verification.
- An integration gate failure that reproduces on `main` leaves the mission out
  of the implementer rebound path, creates one separately identifiable backlog
  task for the mainline problem, and reports the escalation to the operator.
- After the configured finite number of integration-gate rebounds, a further
  failure does not transition the mission to `active` or launch an implementer
  and instead reports that human action is required.
- Existing squash-commit hook rebound behavior remains covered and unchanged
  for a recoverable mission-local failure.
- The focused regression tests for all four paths above and the repository's
  static-analysis and integration verification gates pass on the final tree.

## Risks and Assumptions
- Assumption: the existing rebound kernel can accept integration-gate evidence
  without weakening its current squash-commit-hook semantics.
- Risk: testing reproduction on `main` may require worktree, revision, or
  command-isolation support; use the repository's existing Git abstractions and
  stop if a safe, deterministic mechanism is unavailable.
- Risk: gate output may contain large or sensitive text; pass the actionable
  failure excerpt through the established prompt-sanitization boundary rather
  than inventing a second formatter.
- Risk: retry accounting can accidentally survive an unrelated new change or
  reset during a genuine retry; define its reset boundary in tests before
  relying on it.

## Checkpoints
- CP 1: Trace the integration-gate failure and existing squash-hook rebound
  paths; define the failure classification, retry-count reset boundary, and
  operator-facing outcomes in focused tests before changing behavior.
- CP 2: Implement the recoverable mission-regression path using the shared
  rebound kernel, including gate-output handoff and integration-only coverage
  wording; keep squash-hook regression coverage green.
- CP 3: Implement and test the `main`-reproduction route and finite-retry
  escalation so neither condition relaunches the implementer.
- CP 4: Run the configured verification gates, reconcile all success criteria
  against durable evidence, and prepare the final handoff.

### Checkpoint Documentation Requirements
Every checkpoint document (CP-N.md) MUST include:
- A summary of work done.
- Durable evidence for every criterion, leading with exact test names, ADR
  references, test file paths, and recognized repository commands or paths
  such as backticked `npm ...`, `node ...`, `git ...`, `px ...`, or `./...`.
  File:line references are accepted when needed but discouraged because line
  numbers rot.
- The exact heading `## Goal Check` followed by the exact 3-column table
  `| Criterion | Evidence | Status |`, with at least one durable-evidence row
  per success criterion.
- Raw `stat`/`ls` output or generic prose alone is not evidence: if included,
  pair it with an accepted command, path, exact test name, or ADR reference.
- A non-generic `Next action:` line at the bottom.

Example Goal Check table:

| Criterion | Evidence | Status |
|---|---|---|
| Integration failure has rebound coverage | `test/integration-rebound.test.ts`, exact test name | PASS |
| Mainline reproduction avoids a bounce | `test/integration-rebound.test.ts`, exact test name | PASS |
| Verification gate ran | `./scripts/verify-local.sh docs` | PASS |

## Gates
- [ ] ./scripts/verify-local.sh static-analysis
- [ ] ./scripts/verify-local.sh integrate

## Restricted Areas
- Do not modify gate definitions, integration-pipeline configuration, or
  unrelated phase-gate behavior unless a focused test proves that the rebound
  contract cannot be implemented through the existing interfaces.
- Do not create a mainline-problem backlog task from an unclassified failure;
  it must be demonstrated to reproduce on `main` through the supported
  repository mechanism.
- Do not include secrets, full unredacted environment output, or arbitrary
  command output in implementer prompts or task records.

## Stop Rules
- Stop and request direction if safely determining reproduction on `main`
  requires mutating shared branches, force-pushing, or executing an
  untrusted/unsafe gate command outside the repository's approved verifier.
- Stop and request direction if the existing rebound kernel cannot carry gate
  evidence without changing squash-hook semantics, review approval invariants,
  or mission-state ownership beyond this scope.
- Stop and request direction if the intended retry limit or the required
  operator escalation channel is not defined by repository policy and tests
  cannot establish a compatible bounded behavior.
