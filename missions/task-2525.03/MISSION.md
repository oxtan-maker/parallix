# Mission: Enforce SonarQube in GitHub and pre-integration (task-2525.03)

## Goal
Make SonarQube a mandatory, shared verification step for both the trusted GitHub required workflow and Parallix pre-integration, using the coverage gate's existing LCOV report and reporting the completed quality-gate result.

## Why Now
SonarQube can currently be bypassed by the required GitHub workflow or the pre-integration plan, so new-code quality regressions can merge without a consistent enforcement point. TASK-2522 and TASK-2525.01 provide the scanner and coverage foundation this mission will consume.

## Refinement Signals
- Predicted NEL bucket: Small (0–80)
- Confidence: High
- Selection note: activate as-is; the task specifies one shared command and two declarative call sites.
- Main drivers: GitHub required-workflow wiring, mandatory `adapters.gates.preIntegration` entry, trusted secret handling, quality-gate reporting, focused declaration test.

## Scope
- Reuse the repository's existing coverage runner and its LCOV output in one shared SonarQube command; generate the report without applying the legacy whole-tree line threshold, and let the SonarQube quality gate enforce at least 90% coverage on new code. Do not create an alternate test, coverage, or scanner flow.
- Add that shared command to the GitHub required verification workflow, with `SONAR_TOKEN` and any non-local SonarQube server URL provided only through GitHub environment secrets.
- Wait for the configured SonarQube quality gate and publish its result in the GitHub job summary; make scan, credential, server-connectivity, and failed-quality-gate failures fail the job clearly.
- Add the same command to the repository-owned mandatory `adapters.gates.preIntegration` plan used by `px integrate`.
- Add focused configuration coverage proving both pipeline declarations invoke the same shared command and retain the new-code quality policy while using the recorded legacy baseline.

## Out of Scope
- Writing a second coverage, LCOV, SonarQube scanner, or quality-gate implementation.
- Exposing secrets to forked or otherwise untrusted pull-request code, committing tokens, or printing token values.
- Remediating unrelated legacy SonarQube findings beyond maintaining the recorded baseline needed to enforce new-code regressions.
- Changing unrelated GitHub workflows, integration gates, or SonarQube quality-profile policy.

## Success Criteria
> **Falsifiability rule (ADR 0039 Part 2):** Each criterion must be falsifiable. Forbidden: subjective adjectives ("easy, fast, simple, intuitive, user-friendly, responsive, quick, efficient" without an attached metric) and vague quantifiers ("multiple, several, some, many, few, various"). For refactor / condense / migration missions, the criterion must enumerate the specific elements (rules, files, behaviours) that must survive — generic phrases like "preserve critical content" are not sufficient.

- The GitHub required verification workflow invokes exactly the shared coverage-plus-SonarQube command, which produces LCOV without enforcing the legacy aggregate threshold; it waits for the SonarQube quality-gate result, writes that result to the job summary, and fails when the scan or quality gate fails.
- The GitHub workflow obtains `SONAR_TOKEN` and any non-local SonarQube server URL only from environment secrets; no token value is committed, emitted to logs, or made available to untrusted pull-request code.
- `workflow.config.json` lists the identical shared command in `adapters.gates.preIntegration`, so `px integrate` treats it as a mandatory pre-integration gate.
- The scanner configuration preserves the recorded legacy baseline and the configured quality gate rejects new-code regressions, including coverage below 90% on new code.
- A focused configuration test asserts both the GitHub workflow declaration and the pre-integration declaration reference the same shared command; `./scripts/verify-local.sh static-analysis` succeeds.

## Risks and Assumptions
- Assumes TASK-2522 and TASK-2525.01 provide a runnable coverage runner and LCOV report before implementation begins; stop if either contract is absent or incompatible.
- The current whole-tree line baseline is below 90%; the shared command must therefore produce LCOV without applying that legacy threshold. The existing `npm run test:coverage` 90% gate remains unchanged for TASK-2535 to restore through focused tests.
- GitHub secrets are unavailable to untrusted fork pull requests; the workflow must preserve that trust boundary while still providing a clear result for trusted runs.
- A configured remote SonarQube server can be unavailable or credentials can be missing; those conditions must produce an actionable failure without revealing sensitive values.
- SonarQube server behavior and quality-gate APIs may require a bounded polling timeout; retain the existing command's timeout behavior where available rather than adding a competing mechanism.

## Checkpoints
- CP 1: Locate the existing coverage runner, LCOV producer, GitHub required workflow, `workflow.config.json` pre-integration gate plan, and existing SonarQube configuration/tests. Confirm TASK-2522 and TASK-2525.01 supply the required command contract before editing.
- CP 2: Wire the shared command into the trusted GitHub required workflow with environment-secret inputs, quality-gate waiting, job-summary output, and failure propagation. Add the same command as a mandatory `adapters.gates.preIntegration` gate.
- CP 3: Add focused configuration coverage that proves both declarations use the shared command and validates the trusted-secret/quality-gate contract. Run the required gates and record final Goal Check evidence.

### Checkpoint Documentation Requirements
Every checkpoint document (CP-N.md) MUST begin its evidence with durable references Parallix verifies today: exact test names, ADR references, test file paths, and recognized repository commands or paths such as `npm ...`, `node ...`, `git ...`, `px ...`, or `./...`. File:line references are accepted when necessary but discouraged because line numbers rot.

Every checkpoint document MUST include:
- A summary of work done.
- An exact `## Goal Check` heading.
- The exact 3-column pipe-delimited table header `| Criterion | Evidence | Status |`, with at least one row for every Success Criterion.
- Evidence that names the focused configuration test and its exact assertion name, the relevant GitHub workflow/configuration path, the applicable ADR if one governs the behavior, and each recognized repository command run.
- A non-generic `Next action:` line at the bottom.

Raw `stat`/`ls` output or generic prose alone is not enough: when used as supplemental context, pair it with at least one accepted command, test name, test-file path, ADR reference, or recognized repository path above.

## Gates
- [ ] ./scripts/verify-local.sh static-analysis
- [ ] ./scripts/verify-local.sh all

## Restricted Areas
- Do not modify source behavior unrelated to the shared coverage-plus-SonarQube command, the required GitHub verification workflow, `workflow.config.json` pre-integration gates, SonarQube configuration, or the focused tests that prove those declarations.
- Do not create, store, log, or copy `SONAR_TOKEN` or remote server credentials into repository files, test fixtures, job summaries, or mission documents.
- Do not alter the `px integrate` gate-selection model outside adding the required existing command to its repository-owned configuration.

## Stop Rules
- Stop and escalate if TASK-2522 or TASK-2525.01 has not supplied a reusable coverage runner and LCOV contract; do not create a parallel command to proceed.
- Stop and escalate if satisfying the GitHub workflow requirement would expose secrets to untrusted pull-request code.
- Stop and escalate if the repository's recorded legacy baseline cannot coexist with a quality gate that rejects new-code regressions without changing unrelated quality policy.
- Stop and escalate if the pre-integration configuration cannot invoke the shared command through `adapters.gates.preIntegration` without changing the integration-gate selection contract.
