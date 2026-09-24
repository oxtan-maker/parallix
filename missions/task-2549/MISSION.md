# Mission: Add differential dependency security and automated dependency maintenance (task-2549)

## Goal
Add GitHub Dependency Review to the existing `ci-required` trust path so it rejects newly introduced High or Critical dependency vulnerabilities across runtime, development, and unknown scopes, and add weekly Dependabot maintenance for npm and GitHub Actions. Preserve the distinction between differential dependency review, Dependabot remediation, and CodeQL source analysis.

## Why Now
Parallix has CodeQL and release-time npm auditing but no publication-time differential dependency-vulnerability boundary and no committed Dependabot configuration. Existing dependency debt must stay visible without permanently failing unrelated candidates; the missing controls leave both newly introduced vulnerable dependencies and routine direct-dependency maintenance unmanaged.

## Refinement Signals
- Predicted NEL bucket: Medium (81–235)
- Confidence: High
- Selection note: bounded configuration and workflow change, with authenticated GitHub proof obligations.
- Main drivers: `ci-required` conditional comparison for PR and `github-publish/<sha>` events; immutable action pinning; minimal Dependabot configuration; repository settings verification; disposable live negative proof and real publication positive proof.

## Scope
- Add GitHub's SHA-pinned `actions/dependency-review-action` to `ci-required`, early enough to fail before expensive verification where repository/ref state permits.
- Use `fail-on-severity: high`, explicitly include `runtime`, `development`, and `unknown`, and ensure license checking is disabled or otherwise cannot become a blocking policy.
- Retain normal PR comparison behavior; for `github-publish/<sha>`, compare the full current `origin/main` SHA after full-history checkout with the exact full `${github.sha}` candidate SHA, failing closed if either comparison ref or the review cannot be obtained.
- Pin Actions already used by security-critical `ci-required` to immutable full SHAs with release comments, without intentional behavior changes; stop on any ambiguous or unsafe pin.
- Add `.github/dependabot.yml` with weekly root updates for exactly `npm` and `github-actions`.
- Verify dependency graph, Dependabot alerts, and Dependabot security updates are enabled; complete the disposable remote rejection proof and the real `github-publish/<sha>` success proof.

## Out of Scope
- Baseline-wide `npm audit` gating, remediation of pre-existing vulnerability debt, force upgrades, dependency removal, or advisory suppression.
- License governance, license allow/deny lists, automated merging, broad Dependabot ignore/group/cooldown policy, private registries, and non-npm/non-GitHub-Actions ecosystems.
- Replacing, merging, or weakening CodeQL, existing test, coverage, Sonar, release-time audit, Node-version, checkout, cache, or workflow behavior.
- PATs, new secrets, write permissions, long-lived credentials, PR comments, or retaining a vulnerable package/branch/PR as a repository fixture.

## Success Criteria
> **Falsifiability rule (ADR 0039 Part 2):** Each criterion must be falsifiable. Forbidden: subjective adjectives ("easy, fast, simple, intuitive, user-friendly, responsive, quick, efficient" without an attached metric) and vague quantifiers ("multiple, several, some, many, few, various"). For refactor / condense / migration missions, the criterion must enumerate the specific elements (rules, files, behaviours) that must survive — generic phrases like "preserve critical content" are not sufficient.

- `ci-required` invokes the official `actions/dependency-review-action` via a 40-character immutable SHA with a readable release comment, and a High or Critical newly introduced vulnerability makes the dependency-review step fail.
- Dependency Review's blocking scopes explicitly cover `runtime`, `development`, and `unknown`; license checking is configured so it cannot create a new blocking policy.
- Normal pull requests use GitHub's native PR comparison, while `github-publish/<sha>` compares the full current `origin/main` SHA with the exact full `${github.sha}` candidate SHA; unavailable/ambiguous refs or review errors fail the relevant verification.
- An unrelated candidate with no newly introduced High/Critical vulnerability is not failed solely by dependency vulnerabilities that predate its candidate/base comparison.
- Every Action used by security-critical `ci-required` is either pinned to its confidently resolved immutable SHA with a release comment and unchanged intended major behavior, or the unresolved/unsafe action is explicitly reported and execution stops before guessing.
- `.github/dependabot.yml` defines weekly root updates for exactly `npm` and `github-actions`, with no automerge, global major-update suppression, broad ignores, private-registry setup, or extra ecosystems.
- Repository settings evidence confirms Dependency graph, Dependabot alerts, and Dependabot security updates are enabled.
- A disposable remote PR containing a dependency version with a currently High/Critical GHSA is rejected by the real Dependency Review action; the final evidence names the GHSA, package/version, failed run/PR, and cleanup of both PR and branch.
- The integrated TASK-2549 SHA completes its normal `github-publish/<sha>` run with Dependency Review, existing test/coverage/Sonar work, and `ci-required` green.

## Risks and Assumptions
- GitHub repository administration and remote branch/PR permissions may be unavailable to the implementer; enabling settings and the live negative proof then require an operator at the documented GitHub Settings/PR boundary.
- A current advisory and a current immutable action-release SHA must be resolved from their official GitHub sources during execution; neither may be guessed or copied from stale evidence.
- Publication candidates may be ahead of remote `main`; comparing against freshly resolved full `origin/main` is deliberately cumulative and conservative.
- Pinning can expose an existing ambiguous action version; preserving behavior takes priority over completing an unverified pin.
- GitHub Dependency Review availability and dependency-graph ingestion are external services; their failure must remain visible and fail closed, not be reclassified as no changes.

## Checkpoints
- CP 1: Inspect the existing `ci-required` workflow and ADR 0058 publication flow; record the exact PR and `github-publish/<sha>` ref-handling plan, the existing action versions to pin, and the intended minimal `.github/dependabot.yml` content before editing.
- CP 2: Implement the workflow/configuration changes and focused validation. Confirm native PR behavior remains native, custom publication refs are full unambiguous SHAs, review errors are not ignored, scope/severity/license policy is explicit, and no unrelated workflow behavior changed.
- CP 3: With authenticated GitHub administration where available, verify Dependency graph, Dependabot alerts, and Dependabot security updates. Create a disposable branch and PR from trusted `main` using a currently High/Critical GHSA package/version; capture the real Dependency Review failure, then close the PR and delete the branch. Never merge or retain the vulnerable dependency.
- CP 4: Integrate only after local gates and required live proof are complete; capture the actual TASK-2549 `github-publish/<sha>` run showing the fresh full `origin/main` base, exact candidate head, successful Dependency Review, and continuing CI/coverage/Sonar execution.

### Checkpoint Documentation Requirements
Every checkpoint document (`CP-N.md`) MUST lead its evidence with durable references Parallix verifies today: exact test names, ADR references, test file paths, and recognized repository commands or paths such as `npm ...`, `node ...`, `git ...`, `px ...`, or `./...`. File:line references are accepted parenthetically when needed but discouraged because line numbers rot.

Every checkpoint document MUST include:
- A summary of work done.
- The exact heading `## Goal Check`.
- The exact 3-column pipe-delimited table `| Criterion | Evidence | Status |` with at least one evidence row for every success criterion reached by that checkpoint.
- Concrete evidence such as `ADR 0058`, the relevant workflow or `.github/dependabot.yml` path, exact test names, and recognized commands including `./scripts/verify-local.sh all`; CP 3 must cite the GHSA, disposable PR/run reference, and branch/PR cleanup, while CP 4 must cite the real `github-publish/<sha>` run reference.
- A non-generic `Next action:` line at the bottom.

Raw `stat`/`ls` output or generic prose alone is not evidence: it may be supplemental only when paired with one of the accepted references above.

Example Goal Check table:

| Criterion | Evidence | Status |
|---|---|---|
| Publication comparison policy is documented | `ADR 0058`, `ci-required` workflow path | PASS |
| Local verification ran | `./scripts/verify-local.sh all` | PASS |
| Verification gate ran | `./scripts/verify-local.sh docs` | PASS |

## Gates
- [ ] ./scripts/verify-local.sh all
- [ ] ./scripts/verify-local.sh static-analysis

## Restricted Areas
- Do not modify CodeQL, release-time npm audit behavior, test/coverage/Sonar semantics, Node versions, checkout semantics, cache policy, or workflow permissions except for the least-privilege read access required by Dependency Review.
- Do not add credentials, repository secrets, PATs, license policy, suppression lists, automerge, or extra Dependabot ecosystems.
- Do not commit, merge, publish, or retain the disposable vulnerable dependency; remote proof branches and PRs exist only long enough to capture the real failure and must be cleaned up.
- Do not guess action SHAs, advisory status, publication refs, or repository security settings; use official/current evidence.

## Stop Rules
- Stop and report the exact action if its current intended version cannot be mapped confidently to an immutable release SHA without a behavior change.
- Stop at the operator boundary if GitHub administration is unavailable to enable Dependency graph, Dependabot alerts, or Dependabot security updates; report the missing setting and its GitHub Settings location.
- Stop and request the exact operator action if remote permission is insufficient to create, run, close, and delete the disposable proof PR/branch, or to observe the required real publication run.
- Stop if a full `origin/main` base SHA or exact publication candidate SHA cannot be resolved, or if Dependency Review cannot retrieve its comparison; do not substitute branch guesses, abbreviated SHAs, `HEAD~1`, mocked evidence, or a baseline-wide audit.
