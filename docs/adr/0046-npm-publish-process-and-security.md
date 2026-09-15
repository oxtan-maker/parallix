# ADR 0046: parallix npm Registry Publication Process and Security Posture

Status: Proposed | Accepted
Date: 2026-06-23

Related: ADR 0044 (Workflow Distribution Model), task-1340 (make parallix publishable)

## Context

ADR 0044 established the distribution stance as "local npm tarball, globally installed `px` CLI" and deferred concrete npm registry publication. parallix was pushed to public GitHub on 2026-06-22 (task-1322). The repo is now public and the operator wants a credible, secure, single-command install path before inviting external use.

The package is distributed under AGPL-3.0-or-later and uses `access: public` in
`publishConfig`. A trusted GitHub Actions release publishes the version already
committed on protected `main`; GitHub never allocates or edits that version.

The original built-ins-only claim is superseded. The canonical bundle includes
audited third-party code such as Ink and React, and ADR 0054 permits additional
web dependencies. Having no installed production dependency tree is a packaging
choice, not an architecture constraint; bundled components remain dependencies
for SBOM, license, vulnerability, and release review.

The `@magnusekdahl` scope was verified on the npm registry (task-1340 CP-0) and `@magnusekdahl/parallix` is now published under it; the registry serves the package and the scope is claimed.

## Decision

**Adopt public npm registry publication for parallix as `@magnusekdahl/parallix`, alongside the existing local tarball install path.**

Parallix allocates the next patch version locally as part of the landed mission
commit. After `ci-required` verifies a push to protected `main`, GitHub Actions
checks out that exact SHA, validates its declared version, runs the package
lifecycle, publishes through npm Trusted Publishing with provenance, then creates
the matching tag and GitHub Release. No dist-tag management beyond `latest` is in
scope.

### Authentication requirement

Publishing uses npm Trusted Publishing through the GitHub Actions OIDC identity.
The repository owner configures that trust relationship in npm; the repository
contains no npm token, automation token, PAT, password, private signing key, or
provenance-disable switch.

### Security posture enabling this decision

- **Audited bundled dependencies:** The build emits an SBOM and third-party
  notices and runs license and package-content checks. Adding a dependency
  requires that evidence; it is not prohibited by this ADR.
- **Explicit `files` allowlist:** `package.json` uses an explicit `files` array as an allowlist, not a blacklist. Test suites, coverage reports, knowledge graph output, session data, workflow caches, and Forgejo local state are all excluded.
- **Defense-in-depth:** `.npmignore` provides a secondary exclusion layer. The combination ensures operator secrets (`*.local.json`), test fixtures, and development artifacts cannot reach the published tarball.
- **`access: public` in `publishConfig`:** The package is declared public in the manifest. The `--access public` flag is also passed at publish time for explicitness.
- **AGPL-3.0-or-later license:** The license ensures users can freely use, modify, and distribute parallix while triggering copyleft obligations on modifications to parallix itself.
- **ECDSA registry signatures:** Every package published to the public npm registry is automatically signed with ECDSA signatures by the registry. This protects against tampering at registry mirrors or proxies. Consumers can verify with `npm audit signatures` (requires npm CLI ≥8.15.0). Signed packages are the npm industry standard — all major packages have them.

### Operational procedures (derived from this decision)

The following procedures are consequences of this decision, not decisions themselves:

1. **Pre-publish verification:** `npm pack --dry-run` inspects the file listing before each publish. The operator verifies all exclusion patterns are absent.
2. **Local version allocation:** the version is not operator-controlled. Parallix's integrate pre-commit hook (`adapters.integrate.preCommitCommand`) allocates one local patch version on the mission branch after it is rebased onto the base branch and before the integration gates, so the gates verify matching package metadata and the mission lands as one commit. The base branch version is authoritative: allocation never moves the version backwards, and a retried integration keeps an already-allocated newer version. Allocation is repository configuration, not built-in `px integrate` behavior. The subsequent post-integrate self-update rebuilds and reinstalls the CLI without committing or publishing.
3. **Collision handling:** independently prepared missions can propose the same patch version. The release path never repairs this in GitHub: a stale or foreign version/tag state fails closed and the losing mission is reintegrated and allocated locally.
4. **Trusted publication sequence:** the release job accepts only a successful `ci-required` main push, checks out its triggering SHA, and rejects invalid, unequal, stale, already-foreign-published, or tag-colliding versions. It does not calculate a replacement version.
5. **Package and provenance:** after deterministic installation, the trusted checkout completes `prepack` and `prepublishOnly` before npm publishes the declared version to npmjs.org with provenance. The workflow has release-only OIDC and repository-write authority.
6. **Tag and release:** after publication, the matching `v<version>` tag and GitHub Release identify the same trusted SHA. A rerun may complete a partial release only when both existing npm and tag state identify that SHA; otherwise it fails closed for local reintegration and allocation.
7. **Post-publish verification against the live registry:** some properties are observable only on the published registry page and cannot be checked from a local checkout or from `npm pack --dry-run`. After each publish the operator opens the package page on npmjs.com and checks:
   - **README demo-image rendering:** the tarball ships `README.md` but not `docs/assets/` (the `files` allowlist in `package.json` covers `NOTICES`, `build/`, `LICENSE`, and `README.md`), so a relative image path has no target inside the package. The README therefore references the demo image by absolute `https://raw.githubusercontent.com/.../main/docs/assets/first-value-demo.gif` URL. The operator confirms the image actually renders on the registry page: the URL is fetched from the public repository at publish time, so a repository rename, a branch rename, or a moved asset breaks it silently in the published README while the local checkout still looks correct.
   - **First-screen image loading:** the demo image is several megabytes and sits on the first screen of the README, so the operator checks how the top of the page behaves while it loads, on a throttled connection.
8. **Download-count baseline before a repositioning publish:** the operator records the package's current npm download count before the first publish that carries the trust-layer repositioning pitch. The repositioning experiment's kill criterion in `docs/designs/reposition-as-trust-layer.md` is that people read the new pitch and none install; without a count captured before the publish, there is no baseline to compare installations against and the criterion cannot be evaluated.
9. **Content audit:** An automated package-content check remains part of the package lifecycle.

These procedures are operational guidance. They are subject to change as the operator gains experience with the publish process. They are not architectural decisions.

## Decision matrix

| Option | Summary | Benefits | Risks / Costs | Fit to constraints | Decision |
|--------|---------|----------|---------------|--------------------|----------|
| A: Public npm registry | One command: `npm install -g @magnusekdahl/parallix` | Shortest install; matches public repo expectations | Operator token risk managed by 2FA; npm permanence | Matches ADR 0044's canonical audited bundle; public repo warrants public install path | **Accept** |
| B: Private npm scope first, then public | Same install after switch | Initial publish is invisible; allows verification | Two publish cycles; potential version confusion | No concrete security concern justifies extra step | Defer — only if a concrete security concern emerges |
| C: Continue tarball-only | Two commands: `npm pack && npm install -g ./magnus-parallix-*.tgz` | Maximum operator control; no registry involvement | Higher friction; does not meet credibility bar for public repo | Consistent with ADR 0044 but inferior UX for public tool | Reject as primary — tarball remains a valid secondary path |
| D: GitHub Trusted Publishing | Publish the committed main version after verification | Exact-SHA provenance; no stored npm credential | npm trust relationship must be configured by the owner | Keeps local version authority and binds verification, package, tag, and release | **Accept** |

## Consequences

### Positive consequences

- **Credible public install path:** Users can install with `npm install -g @magnusekdahl/parallix` — the shortest possible install, matching expectations for a public Node tool.
- **Tarball path preserved:** Local tarball install (`npm pack && npm install -g ./magnus-parallix-*.tgz`) remains valid and documented. Operators who prefer it can continue using it.
- **Supply-chain transparency:** The release SBOM, notices, license audit, and
  build manifest expose bundled third-party code for review. Registry audit
  alone is not sufficient because bundled code may not appear as an installed
  production dependency.
- **Exact-SHA release discipline:** The verified source, package version, npm provenance, tag, and GitHub Release share one trusted SHA.
- **Rollback awareness:** The ADR documents npm's unpublish constraints (72-hour window for unpublishing; deprecation for older versions) and provides mitigation strategies (conservative semver, version bumping).

### Negative consequences

- **npm permanence:** Once published, a version cannot be unpublished if >72 hours old or if it has more than 3 dependents. Beyond that window, deprecation is the only option. Prevention (careful `npm pack --dry-run`) is the only reliable rollback.
- **Trusted-publishing setup:** The repository owner must maintain npm's external trust configuration for this repository and workflow.
- **Namespace reservation:** The `@magnusekdahl` scope is now associated with a published package. If the operator abandons parallix, the scope becomes orphaned on npm.
- **Dist-tag scope:** This decision does not add dist-tag policy, multi-registry publication, or rollback automation.
- **No version pinning guarantee:** Users installing with `npm install -g @magnusekdahl/parallix` get `latest`. Without a lockfile or version specifier, they may receive unexpected updates.

## Alternatives considered

### Private registry publication first (Option B in matrix)

Positive: Initial publish is invisible to the public; allows verification of the package without exposing it to accidental installs.

Negative: Requires two publish cycles (restricted → public). Adds confusion about which version is "the" published version. No concrete security concern justifies the extra step.

Assessment: Defer until a specific threat scenario emerges that makes a private-first publish worthwhile.

### Continue tarball-only distribution (Option C in matrix)

Positive: Maximum operator control. No registry involvement. Consistent with ADR 0044's current stance.

Negative: Does not meet the credibility bar for a public repo. Two-command install is friction compared to one-command expectation. External contributors cannot easily test the published package.

Assessment: Tarball remains a valid secondary install path for operators who prefer it, but should not be the primary documented path for a public tool.

### Token-based CI publishing

Positive: A token can work with broad CI providers.

Negative: It introduces a durable publication credential and weakens the
repository-to-registry identity binding.

Assessment: Reject. GitHub OIDC Trusted Publishing supplies the required identity
without a stored npm credential.

### Staged publishing

Positive: Allows CI workflows to submit packages to staging without 2FA; requires 2FA only for manual approval. Provides an intermediate review step.

Negative: Adds complexity for a solo-maintainer project with no CI. The operator's manual publish sequence already includes a verification step (`npm pack --dry-run`).

Assessment: Not needed for current workflow. Can be adopted later if CI is introduced or if the operator wants an extra review gate.

### Scoped package name alternatives

Positive: Alternative scopes (`@parallix/parallix`, `@px-cli/parallix`) would decouple the package from the operator's personal npm identity.

Negative: `@magnusekdahl` is the operator's own scope and already carries the published package. The operator is the sole maintainer. An organizational scope would require creating a new npm org, which is unnecessary overhead.

Assessment: `@magnusekdahl/parallix` is the correct scope for a solo-maintainer package. Revisit if a team or organization assumes maintenance.

## Links

- ADR 0044: Workflow Distribution Model — established the local npm tarball / global `px` install stance; deferred registry publication
- ADR 0037: AI Workflow Coordination Architecture — established the `workflow/` directory as the coordination CLI
- task-1340: make parallix publishable — this ADR's originating task
- task-1340 CP-0: npm scope availability verified
- `package.json` — package metadata, `files` allowlist, `publishConfig.access`
- `parallix/.npmignore` — secondary exclusion layer
- GitHub Actions npm Trusted Publishing documentation — external setup and OIDC trust relationship
- `docs/designs/reposition-as-trust-layer.md` — trust-layer repositioning experiment; source of the installation-based kill criterion the download baseline serves
- npm docs: Creating and publishing scoped public packages — https://docs.npmjs.com/creating-and-publishing-scoped-public-packages
- npm docs: Unpublishing packages from the registry — https://docs.npmjs.com/unpublishing-packages-from-the-registry
- npm docs: Requiring 2FA for package publishing — https://docs.npmjs.com/requiring-2fa-for-package-publishing-and-settings-modification
- npm docs: Staged publishing — https://docs.npmjs.com/staged-publishing
- npm docs: About ECDSA registry signatures — https://docs.npmjs.com/about-registry-signatures
- npm docs: Verifying ECDSA registry signatures — https://docs.npmjs.com/verifying-registry-signatures
- npm docs: Threats and Mitigations — https://docs.npmjs.com/threats-and-mitigations

## Reconciliation addendum (2026-07-27, task-2288)

The original decision to adopt public npm registry publication as `@magnusekdahl/parallix` remains in effect. The published package now ships the canonical ESM bundle (`build/px.mjs`) as the sole executable artifact — no `dist/` tree, no source tree, no runtime `node_modules`. The `bin.px` entry is `build/px.mjs`; the package has no `main` or `exports` (ADR 0044: Parallix is a CLI application, not a supported JavaScript SDK). The `files` allowlist in `package.json` and the `.npmignore` exclusion layer preserve the defense-in-depth security posture described in this ADR. The package still installs without a production `node_modules` tree, but the bundle contains third-party runtime code. Release metadata and audits must treat that bundled code as dependencies rather than calling the product dependency-free.

(End of file - total 130 lines)
