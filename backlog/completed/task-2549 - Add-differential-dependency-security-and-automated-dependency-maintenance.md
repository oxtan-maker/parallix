---
id: TASK-2549
title: Add differential dependency security and automated dependency maintenance
status: done
assignee: [claude]
created_date: '2026-09-21 13:11'
labels: [ai_sdlc]
dependencies: []
ordinal: 89008
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Add a GitHub-native dependency-security trust boundary to Parallix.

The repository currently has source-code security analysis through CodeQL and npm release-time auditing, but GitHub publication verification does not explicitly prevent a candidate from introducing a newly vulnerable dependency.

The repository also has no `.github/dependabot.yml`, so routine npm and GitHub Actions dependency maintenance is not automated.

Implement two complementary controls:

1. **Differential dependency security gate:** GitHub Dependency Review must block a candidate that introduces a dependency with a known **High or Critical** vulnerability.
2. **Continuous dependency maintenance:** Dependabot must monitor npm packages and GitHub Actions for security and version updates.

The security gate must be differential.

Existing dependency debt must remain visible and actionable, but must not make every unrelated candidate permanently red merely because the repository already contains a vulnerable transitive package.

The policy is:

> A candidate may not make the known dependency vulnerability posture worse by introducing a High or Critical vulnerable dependency.

This applies to dependencies GitHub classifies as:

* runtime;
* development; and
* unknown.

Development dependencies are in scope because Parallix builds/bundles tooling from its development dependency graph; `devDependency` is therefore not by itself a sufficient statement that code can never affect the distributed artifact.

`unknown` is included fail-closed so an unclassified dependency does not silently bypass the policy.

<!-- SECTION:DESCRIPTION:END -->

## Security Model

This mission establishes three distinct responsibilities:

```text
Dependency Review
    -> prevent newly introduced vulnerable dependencies

Dependabot alerts/security updates
    -> expose and remediate vulnerabilities present on the default branch

Dependabot version updates
    -> keep direct npm and GitHub Actions dependencies current
```

Existing CodeQL remains:

```text
CodeQL
    -> source-code/static security analysis
```

These controls complement each other.

Do not collapse them into one command or claim that one replaces another.

## Required Policy

### Vulnerability threshold

GitHub Dependency Review must fail when the candidate introduces a dependency with severity:

```text
high
critical
```

Use the action's `fail-on-severity: high` semantics rather than implementing a separate severity parser.

Moderate/low vulnerabilities remain visible but are not initially blocking under this ADR/task.

Changing that threshold later is a separate policy decision based on evidence.

### Dependency scopes

The blocking policy applies to:

```text
runtime
development
unknown
```

Do not silently use the action's narrower default scope.

### Differential, not baseline-blocking

The required CI gate compares the candidate against the relevant trusted base.

It must not simply run:

```text
npm audit --audit-level=high
```

over the complete current dependency tree and fail every candidate because of pre-existing debt.

The existing release-time npm audit behaviour remains outside this mission unless a concrete incompatibility is discovered.

## GitHub Execution Model

### Pull requests

For normal pull-request verification, use GitHub Dependency Review's normal PR comparison semantics.

The candidate is:

```text
PR base
   ->
PR head/candidate
```

Do not reimplement the dependency diff locally.

### `github-publish/<sha>`

ADR 0058 publication candidates also need dependency review.

A `github-publish/<sha>` push is not a normal PR, so use the action's explicit custom comparison refs.

The comparison must be:

```text
current origin/main full SHA
            ->
github.sha exact publication candidate
```

Resolve `origin/main` after the workflow's full-history checkout.

Use full unambiguous commit SHAs.

Do not use:

* abbreviated SHAs;
* branch-name guessing;
* GitHub merge commits not corresponding to the publication candidate;
* local workstation `main`;
* HEAD~1 as a substitute for published main; or
* whichever previous workflow run happened to complete.

This intentionally reviews the entire dependency delta that would become visible if that candidate advances remote `main`.

If several locally integrated commits are queued behind remote `main`, reviewing the cumulative delta is conservative and correct for publication trust.

## Placement in `ci-required`

Keep the existing stable GitHub trust check.

Do not create a parallel required-check architecture unless necessary.

Dependency Review should execute early in `ci-required`, after repository/ref state is available and before expensive test/Sonar work where practical.

A vulnerable dependency should fail fast instead of consuming several minutes of testing first.

The resulting conceptual pipeline is:

```text
checkout exact candidate
        |
        v
resolve trusted base
        |
        v
dependency review
        |
        +---- FAIL on introduced High/Critical
        |
        v
existing CI-safe verification
        |
        v
coverage
        |
        v
Sonar
        |
        v
ci-required
```

Do not weaken existing test or Sonar gates to compensate for the added check.

## Dependency Review Action Supply-Chain Safety

Use GitHub's official:

```text
actions/dependency-review-action
```

Resolve a current stable supported release at implementation time.

Pin the action invocation to the release's **full immutable commit SHA**, with a human-readable version comment, e.g. conceptually:

```text
uses: actions/dependency-review-action@<40-char-commit> # vX.Y.Z
```

Do not use only:

```text
@main
@master
@v5
@v4
```

for the newly introduced security-critical action.

The immutable SHA is execution authority; the comment is maintenance context.

Do not invent a SHA. Resolve it from the official repository/release.

## GitHub Actions Pinning

Because this mission introduces Dependabot maintenance for the `github-actions` ecosystem, also pin the third-party/marketplace Actions already used in the security-critical `ci-required` workflow to their current resolved immutable full commit SHA where practical.

This includes official GitHub Actions such as checkout/setup actions.

Constraints:

* preserve the currently intended action major/version behaviour;
* this is a pinning operation, not an upgrade campaign;
* record the corresponding release/version in a YAML comment;
* let Dependabot propose future updates to these pins.

Do not change Node versions, checkout semantics, cache policy or workflow functionality merely while pinning action references.

If pinning an existing Action would change behaviour or cannot be mapped confidently to the version currently in use, stop and report that specific action rather than guessing.

## Dependabot Configuration

Add:

```text
.github/dependabot.yml
```

with version updates for exactly these ecosystems initially:

### npm

* ecosystem: `npm`
* directory: `/`
* schedule: weekly

### GitHub Actions

* ecosystem: `github-actions`
* directory: `/`
* schedule: weekly

Keep the first configuration deliberately small.

Do not add automated merging.

Do not add broad ignore rules.

Do not suppress major updates globally merely to reduce noise.

Do not add private registry configuration when none is needed.

Do not add Docker/Maven/Python ecosystems that the repository does not use.

If PR volume becomes noisy, grouping/cooldown can be decided from real experience later.

## Dependabot Repository Settings

The following GitHub repository capabilities must be enabled:

```text
Dependency graph
Dependabot alerts
Dependabot security updates
```

The committed `dependabot.yml` enables version-update scheduling; it does not substitute for verifying the repository security settings.

If the implementation agent has sufficient authenticated GitHub administration capability, it may enable the settings as part of this mission.

If it does not:

* do not pretend they are enabled;
* do not edit unrelated files to compensate;
* stop at the explicit operator boundary;
* report the exact missing setting and the exact GitHub Settings location required.

Completion requires evidence that these settings are enabled.

## License Policy Is Explicitly Out of Scope

Dependency Review also supports license checking.

This mission is about known-vulnerability dependency security.

Set or configure the dependency review so license policy does not unexpectedly become a new blocking criterion.

Do not invent a license allowlist/denylist.

Do not decide that LGPL/GPL/Apache/BSD or another license is acceptable/unacceptable in this mission.

If existing GitHub defaults would make license checking operationally ambiguous, explicitly disable the license-check function for this gate.

A future license-governance decision can be made separately.

## Existing Vulnerability Debt

Current `npm ci` output may report existing vulnerabilities.

This mission must not "solve" that fact by:

* deleting required dependencies without analysis;
* blindly running `npm audit fix --force`;
* accepting breaking upgrades;
* adding broad advisory suppressions; or
* changing the dependency gate into baseline-wide failure.

Dependabot alerts/security PRs become the mechanism for addressing existing known debt.

A separate remediation mission may be created from concrete alerts.

## Existing CodeQL Boundary

`scripts/codeql-sast.sh` remains the source-code/SAST security gate.

Do not:

* remove CodeQL because Dependency Review exists;
* make Dependency Review call CodeQL;
* make CodeQL parse npm advisories;
* merge the two result models; or
* claim dependency vulnerability review replaces static source analysis.

They protect different threat surfaces.

## GitHub Permissions

Use least privilege.

Dependency Review on the public repository should operate with the normal GitHub-provided token and read permissions needed for repository/dependency metadata.

Do not introduce:

* PATs;
* long-lived GitHub credentials;
* organization tokens;
* npm credentials; or
* new repository secrets

for Dependency Review.

Do not give the workflow write permission merely to display results.

PR commenting is not required.

The Action log/check result is sufficient.

## Failure Semantics

Dependency Review is fail-closed for its required comparison.

The following must fail the relevant verification rather than silently skip:

* GitHub dependency API/action cannot retrieve the comparison;
* the requested base SHA is missing;
* the publication candidate SHA is ambiguous/missing;
* the dependency review action errors;
* a High or Critical vulnerable dependency is introduced.

A candidate with no dependency changes should produce a successful no-change result.

Do not translate infrastructure errors into "no vulnerable changes".

## Live Negative Proof

A security gate that has only ever returned green is not sufficient evidence.

Before mission completion, prove the rejection path using GitHub itself.

### Required proof method

Create a **throwaway, non-integrated proof branch** from the trusted default branch.

On that branch only:

1. identify a package/version that is currently present in the GitHub Advisory Database with a High or Critical advisory;
2. record the GHSA identifier, package and vulnerable version in mission evidence;
3. make the minimal manifest/lock change required for GitHub's dependency graph to observe it;
4. push the throwaway branch;
5. open/trigger a disposable PR against `main`;
6. prove Dependency Review fails for the intended advisory;
7. close the proof PR; and
8. delete the proof branch.

The vulnerable dependency must never be:

* committed to the TASK-2549 mission branch;
* integrated into local `main`;
* published through `github-publish`;
* shipped to npm; or
* retained as a test fixture in the repository.

Resolve the proof package at execution time. Do not hard-code an ancient vulnerability merely because it used to exist in the advisory database.

If the agent cannot create a disposable remote branch/PR because it lacks GitHub permission, stop and request that exact operator action.

Do not replace the live negative proof with a mocked API.

## Live Positive Publication Proof

TASK-2549's real resulting integration SHA must enter the normal:

```text
github-publish/<sha>
```

path.

The live run must prove:

* the custom base is the current full `origin/main` SHA;
* the head is exactly `${github.sha}`;
* Dependency Review completes successfully;
* existing test/coverage/Sonar verification still executes;
* `ci-required` is green.

This proves the non-PR publication path, while the disposable vulnerable PR proves the rejection path.

## Acceptance Criteria

<!-- AC:BEGIN -->

* [ ] #1 GitHub Dependency Review executes as part of the stable `ci-required` trust path.
* [ ] #2 The policy blocks newly introduced High and Critical known vulnerabilities.
* [ ] #3 The blocking scopes explicitly include `runtime`, `development`, and `unknown`.
* [ ] #4 Existing dependency vulnerabilities do not make unrelated candidates fail solely because they predate the candidate.
* [ ] #5 Normal PRs use GitHub's PR dependency comparison.
* [ ] #6 `github-publish/<sha>` runs compare the full current `origin/main` SHA to the exact full candidate SHA.
* [ ] #7 Missing/failed dependency comparison fails closed rather than reporting "no changes".
* [ ] #8 The official dependency-review action is pinned to an immutable full commit SHA with a readable release/version comment.
* [ ] #9 Existing Actions used by the security-critical workflow are pinned to current immutable SHAs without unrelated behavioural upgrades, or any unsafe/unresolvable pin is explicitly stopped/reported.
* [ ] #10 `.github/dependabot.yml` configures weekly version updates for npm and GitHub Actions.
* [ ] #11 Dependency graph, Dependabot alerts and Dependabot security updates are verified enabled for the repository.
* [ ] #12 License checking does not accidentally become a new blocking policy.
* [ ] #13 A disposable live PR introducing a currently High/Critical vulnerable dependency is rejected by the real GitHub Dependency Review action.
* [ ] #14 The proof PR/branch and vulnerable dependency are removed after evidence is captured.
* [ ] #15 TASK-2549's real `github-publish/<sha>` run passes Dependency Review plus the pre-existing CI/coverage/Sonar gates.

<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
* [ ] #1 Workflow/config syntax validation passes.
* [ ] #2 Existing `npm test`, `npm run test:integration:ci`, typecheck and static-analysis gates remain green.
* [ ] #3 No existing dependency is removed or force-upgraded merely to make this mission green.
* [ ] #4 No broad GHSA/package suppression is added.
* [ ] #5 No new repository secret or long-lived credential is introduced for dependency review.
* [ ] #6 Dependabot config is minimal, valid and limited to npm + GitHub Actions.
* [ ] #7 The final Goal Check records the disposable vulnerable PR URL/reference, GHSA, expected failure and cleanup evidence.
* [ ] #8 The final Goal Check records the green real `github-publish` run for the integrated TASK-2549 candidate.

- [ ] #1 Verification gate ran and passed on the final tree with captured proof rather than an unverified claim
- [ ] #2 Lint and static analysis report clean on every changed file
- [ ] #3 No focused or unannotated skipped tests were introduced (no .only and no bare .skip)
- [ ] #4 Final checkpoint Goal Check table cites real evidence using file:line references and test names
- [ ] #5 Docs updated to reflect any workflow or user-facing behavior change
- [ ] #6 Bug-labeled missions include a red-to-green reproduction test that fails before the fix and passes after
<!-- DOD:END -->
