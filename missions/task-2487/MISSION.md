# Mission: Amend ADR 0046 for version drift and post-publish gaps (task-2487)

## Goal
Amend ADR 0046 in place so its npm publication decision records post-integrate version drift, safe multi-step publication, live-registry validation, the repositioning download baseline, and the package's current published status.

## Why Now
The trust-layer repositioning sequence depends on a publish process that the existing ADR understates: successful integrations can change the local version before publication, two publishes cannot reuse a version, and the registry page exposes README rendering and loading behavior unavailable from local packaging checks. A download baseline must also be captured before the first repositioning publish so the experiment's installation-based kill criterion can be evaluated.

## Refinement Signals
- Predicted NEL bucket: Small (0–80)
- Confidence: High
- Selection note: activate as-is
- Main drivers: ADR-only amendment; release-process safeguards; live npm registry checks; pre-publish measurement baseline

## Scope
- Amend `docs/adr/0046-npm-publish-process-and-security.md` in its existing operational and verification sections.
- Document that `scripts/refresh-global-px.sh` runs after successful `px integrate`, bumps the patch version, rebuilds, packs, and installs globally without publishing to npm.
- Specify publication sequencing: drain or park concurrent integrations, read the version immediately before each publish, and assign a distinct version to every publish in a multi-step sequence.
- Add live-registry checks for README demo-image rendering and first-screen image loading, including the fact that `README.md` ships while `docs/assets/` does not.
- Require recording the package's npm download count before the first repositioning publish and state its use as the experiment baseline.
- Correct the obsolete unclaimed/404 statement for `@magnusekdahl/parallix` in place.

## Out of Scope
- Changing `scripts/refresh-global-px.sh`, publication automation, package contents, versioning policy, or npm credentials.
- Publishing a package, querying or recording a live npm download count as part of this mission, or changing the repositioning design.
- Creating a release runbook, a dated ADR addendum, a supersedes clause, or any ADR other than 0046.

## Success Criteria
> **Falsifiability rule (ADR 0039 Part 2):** Each criterion must be falsifiable. Forbidden: subjective adjectives ("easy, fast, simple, intuitive, user-friendly, responsive, quick, efficient" without an attached metric) and vague quantifiers ("multiple, several, some, many, few, various"). For refactor / condense / migration missions, the criterion must enumerate the specific elements (rules, files, behaviours) that must survive — generic phrases like "preserve critical content" are not sufficient.

- ADR 0046 states that the post-integrate hook `scripts/refresh-global-px.sh` bumps the patch version after every successful `px integrate`, rebuilds, packs, installs globally, and does not publish to npm.
- ADR 0046 requires concurrent mission integrations to be drained or parked before starting a publish sequence.
- ADR 0046 requires reading the on-disk version immediately before each publish and states that a multi-step publication uses distinct versions because npm rejects an already-published version.
- ADR 0046 defines live npm registry-page checks for README demo-image rendering and first-screen image loading, and explains that the tarball includes `README.md` but excludes `docs/assets/`.
- ADR 0046 requires recording the npm download count before the first repositioning publish and connects that baseline to evaluating the repositioning experiment's installation-based kill criterion.
- ADR 0046 no longer claims that `@magnusekdahl/parallix` returns 404 or that the scoped package name is unclaimed.
- The amendments are integrated into ADR 0046's existing sections; no dated addendum, supersedes clause, parallel release runbook, or new ADR is created.
- `./scripts/verify-local.sh all` completes successfully on the drafted change.

## Risks and Assumptions
- The live-registry observations depend on npm's current rendering and network behavior; the ADR must distinguish these post-publish checks from locally verifiable packaging checks.
- The actual download-count value is time-sensitive and belongs to the later publication operation, while this mission defines the requirement to record it.
- Assumption: `scripts/refresh-global-px.sh` remains the post-integrate hook described by the backlog task; implementation must reconcile the ADR wording with the repository's current behavior before finalizing it.

## Checkpoints
- CP 1: Inspect ADR 0046 and its cited release/package-audit artifacts; map each of the eight ADR amendment acceptance criteria to the existing ADR section where it belongs, without creating a new runbook or addendum.
- CP 2: Amend ADR 0046 in place with the version-drift, sequencing, live-registry, download-baseline, and package-status corrections; confirm the document has no obsolete 404/unclaimed claim and no parallel release documentation.
- CP 3: Run the required repository verification and record a final Goal Check with criterion-by-criterion evidence.

### Checkpoint Documentation Requirements
Every checkpoint document (CP-N.md) MUST include a concise work summary and lead its evidence with durable references Parallix verifies today: `ADR 0046`, exact test names where applicable, existing test file paths where applicable, and recognized repository commands or paths such as `./scripts/verify-local.sh all`, `npm ...`, `node ...`, `git ...`, `px ...`, or `./...`.

Every checkpoint document MUST contain the exact heading `## Goal Check`, followed by this 3-column table:

| Criterion | Evidence | Status |
|---|---|---|

Include one evidence row for every Success Criterion. File:line references are accepted parenthetically when necessary, but are discouraged because line numbers rot. Raw `stat`/`ls` output or generic prose alone is not sufficient evidence; when used, pair it with an accepted ADR reference, exact test name, test path, or recognized repository command/path above. End with a concrete `Next action:` line that names the next ADR section, verification command, or handoff activity.

Example Goal Check table:

| Criterion | Evidence | Status |
|---|---|---|
| Version-drift safeguard is documented | `ADR 0046` | PASS |
| Live-registry checks are documented | `ADR 0046` | PASS |
| Verification gate ran | `./scripts/verify-local.sh all` | PASS |

## Gates
- [ ] ./scripts/verify-local.sh all

## Restricted Areas
- Do not modify source code, publication scripts, package metadata, npm configuration, or package contents.
- Do not publish, tag, install globally, access credentials, or perform a real registry-side release operation.
- Do not create or modify release runbooks, new ADRs, dated addenda, or supersedes clauses; ADR 0046 is the only authored-document target.
- Do not alter the backlog task assignee or its workflow status.

## Stop Rules
- Stop and request direction if the required ADR amendment conflicts with the current behavior of `scripts/refresh-global-px.sh` or `px integrate` and cannot be reconciled from repository evidence.
- Stop and request direction if validating the intended live-registry checks requires publishing, changing npm state, using credentials, or making a decision about an actual version number.
- Stop and request direction if the amendments require a separate release runbook, new ADR, or a change outside ADR 0046.
