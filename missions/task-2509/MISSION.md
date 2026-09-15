# Mission: Implement GitHub-native CD while retaining local version allocation (task-2509)

## Goal
Deliver a fail-closed release lifecycle in which Parallix allocates a patch version locally and folds that version into the completed mission's single logical integration commit; GitHub Actions then validates, packages, and publishes that exact merged `main` SHA through npm Trusted Publishing before creating the matching tag and GitHub Release.

## Why Now
The current post-integration hook creates a second `chore: bump version` commit and publication remains an operator-run process with token-oriented guidance in ADR 0046. That leaves the committed release candidate, the source GitHub verifies, the artifact npm receives, and the release tag insufficiently bound together. The existing `ci-required` workflow already establishes a read-only trust check on pushes, so this mission can extend that boundary without introducing GitHub-side version allocation.

## Refinement Signals
- Predicted NEL bucket: Large (235+)
- Confidence: Medium
- Selection note: activate as-is; release automation, integration commit semantics, collision recovery, and GitHub workflow coverage require coordinated changes across local and hosted boundaries.
- Main drivers: replacement of the post-integrate version-only commit, exact-SHA CI/release handoff, OIDC npm publication, version/tag collision handling, and supply-chain verification.

## Scope
- Replace the current post-integration local version-bump sequence so a normal completed mission leaves its implementation, `package.json` version, and `package-lock.json` version in one logical mission commit; calculate the patch version before committing when possible, otherwise deterministically amend only that just-created mission commit.
- Add focused automated coverage for the normal completion path proving no standalone `chore: bump version` commit is created and that both package metadata files in the mission commit carry the same allocated version.
- Extend `.github/workflows/ci-required.yml` with a release job that is eligible only for a `push` to `refs/heads/main` after the literal `ci-required` job succeeds, checks out the triggering `github.sha`, and keeps the verification job read-only while granting `contents: write` and `id-token: write` only to the release job.
- Implement release validation against the trusted checkout: valid SemVer in `package.json`; identical `package-lock.json` version; proposed version absent from `@magnusekdahl/parallix` on npm; version newer than the current normal release according to the existing policy; and existing `v<version>` either absent or already pointing to the trusted SHA.
- Run deterministic dependency installation plus the repository package lifecycle for the trusted SHA, preserving `prepack` and `prepublishOnly`, then publish `@magnusekdahl/parallix@<package.json version>` to npmjs.org through GitHub Actions OIDC/Trusted Publishing with provenance enabled and no stored npm credential.
- After a successful publish, create or verify `v<version>` at the trusted SHA and create the corresponding GitHub Release without creating a release-only commit.
- Cover normal release, invalid/mismatched/stale/already-published versions, tag collisions, reruns after partial publication, and ineligible events with automated tests or workflow-focused assertions appropriate to each boundary.
- Update ADR 0046 and any directly affected live release documentation to replace the superseded manual/token-based publication guidance with the supported GitHub-native process; consult `docs/doc-standards.md` before editing root-level or `docs/` Markdown.

## Out of Scope
- release-please, Changesets, GitHub-calculated versions, GitHub-created version commits, or any other change that makes GitHub authoritative for version allocation.
- `NPM_TOKEN`, automation tokens, PATs, username/password authentication, private signing keys, or disabling npm provenance.
- Force-pushing, rebasing, squashing, or otherwise rewriting unrelated history; a deterministic amend is permitted only for the newly created mission commit when pre-commit version allocation is architecturally impossible.
- Changing package naming, adding another version-authority file, changing npm dist-tag policy, or altering the public package contents except as required by the existing package lifecycle.
- Release automation for branches other than protected `main`, PR-run publication, multi-registry publication, or automated rollback/unpublish.
- Configuring npm Trusted Publishing in the npm account or GitHub repository settings; the repository owner performs that external setup.

## Success Criteria
> **Falsifiability rule (ADR 0039 Part 2):** Each criterion must be falsifiable. Forbidden: subjective adjectives ("easy, fast, simple, intuitive, user-friendly, responsive, quick, efficient" without an attached metric) and vague quantifiers ("multiple, several, some, many, few, various"). For refactor / condense / migration missions, the criterion must enumerate the specific elements (rules, files, behaviours) that must survive — generic phrases like "preserve critical content" are not sufficient.

- [SC1] A normal non-dry-run mission completion produces one logical mission commit containing the implementation change plus matching `package.json` and `package-lock.json` patch versions; the resulting history contains no standalone `chore: bump version` commit for that completion.
- [SC2] The local allocator remains the only component that calculates the next version: the GitHub workflow never invokes `npm version`, changes package version metadata, or creates a version commit.
- [SC3] The release job runs only for a `push` of `refs/heads/main` whose `ci-required` job succeeded, checks out the triggering `github.sha`, and preserves `verified SHA == packaged SHA == release-tag SHA`.
- [SC4] The workflow grants `contents: read` to verification and grants exactly the release-required elevated permissions `contents: write` and `id-token: write` only in the release job, using a GitHub-hosted runner with Node 24 and npm at least 11.5.1.
- [SC5] Before publish, the trusted checkout rejects invalid SemVer, unequal manifest/lockfile versions, a version already on npm, a version not newer than the current normal release, and a `v<version>` tag pointing to another SHA; it does not calculate a replacement version.
- [SC6] For a valid trusted SHA, deterministic installation and the existing `prepack` and `prepublishOnly` lifecycle complete before `npm publish`; publication targets npmjs.org as `@magnusekdahl/parallix@<source version>` through OIDC without `NPM_TOKEN`, `NODE_AUTH_TOKEN`, or another publish credential and without disabling provenance.
- [SC7] After successful publication, `v<package version>` points to the exact trusted SHA and the GitHub Release has the same version; no release-only commit is created.
- [SC8] A duplicate local allocation or partial failure fails closed: a rerun may accept an already-published version and tag only when both identify the same trusted SHA, but must reject a different SHA or stale version and require local reintegration/version allocation rather than silently issuing a new version.
- [SC9] ADR 0046 and affected live release guidance describe the GitHub-native Trusted Publishing flow and no longer prescribe an npm token or manual post-publish tagging for the supported release path.
- [SC10] `./scripts/verify-local.sh all`, `./scripts/verify-local.sh static-analysis`, and `./scripts/verify-local.sh docs` succeed on the final tree.

## Risks and Assumptions
- Risk: independently prepared missions can allocate the same patch version. Mitigation: validation treats an npm or tag collision as fail-closed unless it demonstrably belongs to the exact trusted SHA; the losing mission is reintegrated and versioned locally.
- Risk: npm publication can succeed before tagging or release creation fails. Mitigation: make reruns idempotent only when the existing npm version and tag identify the trusted SHA; otherwise abort without mutation.
- Risk: GitHub Actions expression or checkout defaults could release a moving branch head. Mitigation: assert explicit event/ref/job conditions and explicit `github.sha` checkout in workflow coverage.
- Risk: trusted publishing depends on externally configured npm trust and runner tool versions. Assumption: the owner configures npm Trusted Publishing for this repository/workflow; the workflow pins a Node/npm combination satisfying the stated minimums.
- Risk: replacing the post-integrate hook can affect local self-update/rebuild behavior. Mitigation: preserve the required build/package lifecycle and cover version/commit ordering directly.
- Assumption: the existing release policy defines what constitutes a newer normal release and can be made executable without calling external mutable state beyond npm/tag lookups.

## Checkpoints
- CP 1: Map the current integration closeout and `scripts/refresh-global-px.sh` responsibilities; write focused tests for a completed mission's one-commit version semantics and matching manifest/lockfile versions before changing the allocator or hook.
- CP 2: Implement the local allocation/commit change, preserving rebuild and self-update behavior where still required; prove normal completion contains implementation and version metadata in one commit and no standalone bump commit.
- CP 3: Design and implement trusted-SHA release validation and workflow wiring around the existing literal `ci-required` job: eligible `main` push only, explicit SHA checkout, least permissions, Node/npm floor, OIDC registry configuration, and no source mutation.
- CP 4: Implement and test deterministic package validation/publication flow, including SemVer, metadata equality, npm freshness, release-policy ordering, package lifecycle, and credential/provenance constraints.
- CP 5: Implement and test tag/release creation plus collision and rerun behavior for published-version/tag states; ensure every path maintains the exact-SHA invariant or fails closed.
- CP 6: Update ADR 0046 and directly affected live release guidance after consulting `docs/doc-standards.md`; run and record all final gates against the completed tree.

### Checkpoint Documentation Requirements
Every checkpoint document (CP-N.md) MUST include:
- At least one evidence row for every applicable success criterion, led by durable evidence Parallix verifies today: exact test names, ADR references, test file paths, and recognized repository commands or paths such as `npm ...`, `node ...`, `git ...`, `px ...`, or `./...`. Cite `test/task-2203-publish-proof-refresh-order.test.ts`, the exact added version/release test names, `.github/workflows/ci-required.yml`, `ADR 0046`, and the final `./scripts/verify-local.sh all`, `./scripts/verify-local.sh static-analysis`, and `./scripts/verify-local.sh docs` commands where applicable. File:line references are accepted parenthetically when necessary but discouraged because line numbers rot.
- A summary of work done
- The exact heading `## Goal Check`
- The 3-column table `| Criterion | Evidence | Status |`
- **Weak-agent failure mode:** raw `stat`/`ls` output or generic prose alone is not enough; pair shell output with an accepted reference above, such as an exact test name and file, ADR reference, or recognized `npm`, `node`, `git`, `px`, or `./...` command.
- A non-generic `Next action:` line at the bottom

Example Goal Check table:

| Criterion | Evidence | Status |
|---|---|---|
| One-commit local allocation is proven | `test/task-2203-publish-proof-refresh-order.test.ts`, exact added test name | PASS |
| Trusted release uses the verified SHA | `.github/workflows/ci-required.yml`, exact added workflow test name | PASS |
| Final verification gates ran | `./scripts/verify-local.sh all`, `./scripts/verify-local.sh static-analysis`, `./scripts/verify-local.sh docs` | PASS |

## Gates
- [ ] ./scripts/verify-local.sh all
- [ ] ./scripts/verify-local.sh static-analysis
- [ ] ./scripts/verify-local.sh docs

## Restricted Areas
- Do not add GitHub-side version calculation, `npm version`, release-please, Changesets, GitHub-created version commits, or another authoritative version file.
- Do not publish from pull requests or any non-`main` ref, and do not check out moving `main` after `ci-required`; release only the triggering `github.sha`.
- Do not add `NPM_TOKEN`, `NODE_AUTH_TOKEN`, npm automation tokens, PATs, username/password credentials, private signing keys, or a provenance-disable flag.
- Do not grant write permissions to the `ci-required` verification job; constrain `contents: write` and `id-token: write` to the release job.
- Do not rewrite unrelated commits or history, force-push protected branches, or create a standalone version-only commit; amend only the just-created mission commit if unavoidable.
- Do not configure external npm/GitHub settings, publish a real package, create a real release, or push the mission branch to `origin`; only `main` may be pushed to `origin` and `review` is the mission-branch review remote.
- Before editing root-level or `docs/` Markdown, consult `docs/doc-standards.md`; do not alter archived tasks, completed mission records, or unrelated release history.

## Stop Rules
- Stop and return for refinement if local allocation cannot be incorporated into the completed mission commit without rewriting a pre-existing or unrelated commit.
- Stop before publishing if the trusted source has invalid or unequal version metadata, the version is not newer under the defined release policy, npm already contains that version for another SHA, or the corresponding tag points elsewhere.
- Stop and report if GitHub Actions cannot prove it is operating on the `ci-required`-verified triggering SHA, if least-privilege OIDC cannot be configured, or if external npm Trusted Publishing has not been configured by the owner.
- Stop and report rather than issuing another version when concurrent allocation causes a collision; require local reintegration and allocation.
- Stop if a required gate fails; resolve failures only within this mission's scope or return the mission for refinement.
- Stop after the final gates pass; do not start review, execute, or integrate phases and do not transition the task to `ready`.
