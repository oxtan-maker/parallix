# Mission: Define and enforce a GitHub-safe CI verification tier (task-2500.04)

## Goal
Establish a first-class, positively selected verification tier that a clean GitHub-hosted runner can execute without local AI, operator model configuration, Forgejo credentials or state, workstation state, pre-existing worktrees, or private local services. Keep deterministic local integration and real-agent/e2e verification as explicit, runnable lanes with their current trust obligations.

## Why Now
The current `npm run test:integration` lane combines test families with different environmental requirements, so it cannot safely become a required GitHub check. Mission 5 depends on this mission's stable CI-safe command and trust-boundary definition to create the GitHub Actions pipeline.

## Refinement Signals
- Predicted NEL bucket: Medium (81–235)
- Confidence: High
- Selection note: activate as-is
- Main drivers: test-suite inventory and classification, positive CI membership, portable runner commands, preservation of local trust gates, runtime recording, and CI-versus-local trust-model documentation.

## Scope
- Audit every existing test family and assign it to an explicit semantic category: hermetic unit, GitHub-safe deterministic integration, local-only integration, or real-agent/e2e; record the classification and its environmental boundary.
- Add positively selected, stable npm commands for the GitHub-safe aggregate and its deterministic integration subset, plus explicit commands for local-only integration and real-agent/e2e coverage.
- Make adding an integration test require an explicit category selection in the repository's test-runner conventions and enforce that selection with focused automated coverage.
- Include portable build, type checking, hermetic unit tests, deterministic clean-checkout integration tests, and package/bundle validation in the GitHub-safe tier when each is supported without prohibited infrastructure.
- Preserve and document the separate guarantees of GitHub CI, local Parallix verification, and real-agent/local-AI verification; record the measured runtime of the CI-safe suite.

## Out of Scope
- Adding the GitHub Actions workflow or changing required GitHub branch-protection checks; that belongs to TASK-2500.05.
- Replacing Forgejo, local AI/model infrastructure, or the repository's review and integration workflow.
- Removing, skipping, or weakening real-agent/e2e and local trust gates merely to make GitHub CI pass.
- Broad test rewrites unrelated to categorization, runner portability, or an identified pathological runtime issue.

## Success Criteria
> **Falsifiability rule (ADR 0039 Part 2):** Each criterion must be falsifiable. Forbidden: subjective adjectives ("easy, fast, simple, intuitive, user-friendly, responsive, quick, efficient" without an attached metric) and vague quantifiers ("multiple, several, some, many, few, various"). For refactor / condense / migration missions, the criterion must enumerate the specific elements (rules, files, behaviours) that must survive — generic phrases like "preserve critical content" are not sufficient.

- A maintained classification records every current test family as `unit`, `integration-ci`, `integration-local`, or `agent-e2e` (or documented semantic equivalents), including the environmental boundary that places it there.
- The GitHub-safe aggregate command and its CI-integration command use positive membership; a newly authored integration test cannot enter the CI-safe command without an explicit classification decision enforced by automated test coverage.
- On a clean checkout with no local AI/model service, model configuration, Forgejo credentials/state, pre-existing worktree, workstation state, or private service, the GitHub-safe command completes build, type checking, hermetic unit tests, selected deterministic integration tests, and portable package/bundle validation.
- Stable npm commands exist and are documented for the GitHub-safe aggregate, CI-safe integration subset, local-only integration, and real-agent/e2e lanes; the latter two remain runnable outside GitHub CI.
- Existing local Parallix verification and real-agent/e2e obligations retain their coverage and are not reclassified into the GitHub-safe tier solely to avoid environmental dependencies.
- The trust-model documentation distinguishes exactly what GitHub CI proves, what local Parallix verification proves, and what real-agent/local-AI verification proves.
- The implementation records the CI-safe suite runtime using the established CI-safe command and documents any runtime tuning without removing meaningful test coverage.

## Risks and Assumptions
- The suite may contain tests whose environmental dependencies are implicit; the audit must use test setup and runner behavior, not filenames alone.
- Portable packaging or bundle validation may differ across operating systems; include only checks that can run on the clean GitHub runner and record a justified exclusion if no portable command exists.
- Positive membership can initially omit coverage; mitigate this with an exhaustive family inventory and a test proving unclassified integration tests are rejected or excluded by construction.
- Runtime tuning must not convert meaningful boundary coverage into unit-only checks or silently move it out of local verification.

## Checkpoints
- CP 1: Inventory the current test runners and all test families; define the four semantic categories, each lane's permitted dependencies, and the CI/local/real-agent trust boundaries. Record the mapping and the proposed stable command contract before changing runners.
- CP 2: Implement positively selected test membership and stable npm commands for the CI-safe aggregate, CI integration, local integration, and agent e2e lanes. Add focused tests demonstrating that an integration test needs an explicit category decision and that prohibited dependencies cannot enter the CI lane by default.
- CP 3: Make the clean-checkout CI tier cover its portable build, typecheck, unit, deterministic integration, and package/bundle checks; preserve the local and real-agent lanes. Measure the CI-safe command runtime and document the three verification guarantees.
- CP 4: Run the mission gate, inspect changes for accidental weakening of local trust gates, and write the final goal-check evidence.

### Checkpoint Documentation Requirements
Every checkpoint document (CP-N.md) MUST include a summary and lead its evidence with durable references Parallix verifies today: exact test names, ADR references, test file paths, and recognized repository commands or paths such as `npm ...`, `node ...`, `git ...`, `px ...`, or `./...`. File:line references are accepted when needed but discouraged because line numbers rot.

Every checkpoint document MUST contain the exact heading `## Goal Check`, followed by this 3-column table:

| Criterion | Evidence | Status |
|---|---|---|
| GitHub-safe lane classification is explicit | `package.json` and the exact classification test name | PASS/FAIL |

Include at least one durable evidence row for every success criterion, then end with a non-generic `Next action:` line. Raw `stat`/`ls` output or generic prose alone is not enough; when used as supplemental context, pair it with an accepted reference above.


## Gates
- [ ] ./scripts/verify-local.sh all

## Restricted Areas
- Do not add or alter the GitHub Actions workflow; TASK-2500.05 owns that pipeline.
- Do not require live Forgejo, local AI, credentials, private services, existing worktrees, or operator model configuration in the GitHub-safe lane.
- Do not delete or weaken local-only integration or real-agent/e2e commands, their coverage, or their required local verification policy.
- Keep test classification and runner changes scoped to the tier definition; defer unrelated test failures and broad infrastructure redesigns.

## Stop Rules
- Stop and request a decision if a test family cannot be classified from its actual dependencies, because choosing its CI eligibility without evidence would weaken the trust boundary.
- Stop and request a decision if a required portable build, package, or bundle check needs credentials, local AI, Forgejo state, or a private service; do not simulate a passing CI tier by suppressing the dependency.
- Stop and request a decision if preserving a local trust gate conflicts with making the GitHub-safe command deterministic; retain the local gate unless an approved policy change explicitly replaces it.
- Stop if runtime work would require removing meaningful test coverage rather than fixing a demonstrated pathological case; record the measurement and escalate instead.
