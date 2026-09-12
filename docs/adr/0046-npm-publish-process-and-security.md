# ADR 0046: parallix npm Registry Publication Process and Security Posture

Status: Proposed | Accepted
Date: 2026-06-23

Related: ADR 0044 (Workflow Distribution Model), task-1340 (make parallix publishable)

## Context

ADR 0044 established the distribution stance as "local npm tarball, globally installed `px` CLI" and deferred concrete npm registry publication. parallix was pushed to public GitHub on 2026-06-22 (task-1322). The repo is now public and the operator wants a credible, secure, single-command install path before inviting external use.

The package is distributed under AGPL-3.0-or-later and uses `access: public` in
`publishConfig`. The operator publishes manually — no CI/release automation is
in scope. This ADR documents the decision to adopt public npm registry
publication, the authentication requirements, and the pre-publish verification
process.

The original built-ins-only claim is superseded. The canonical bundle includes
audited third-party code such as Ink and React, and ADR 0054 permits additional
web dependencies. Having no installed production dependency tree is a packaging
choice, not an architecture constraint; bundled components remain dependencies
for SBOM, license, vulnerability, and release review.

The `@magnusekdahl` scope was verified on the npm registry (task-1340 CP-0) and `@magnusekdahl/parallix` is now published under it; the registry serves the package and the scope is claimed.

## Decision

**Adopt public npm registry publication for parallix as `@magnusekdahl/parallix`, alongside the existing local tarball install path.**

The operator performs `npm publish` manually from a verified local checkout. The decision is bounded: no CI/release automation, no dist-tag management beyond the `latest` tag. The publish process is manual, repeatable, and documented here. Packages published to the public npm registry are automatically signed with ECDSA registry signatures — no publisher action required.

### Authentication requirement

Publishing scoped public packages to npm requires one of the following:

- **Two-factor authentication (2FA)** enabled on the npm account, or
- **A granular access token (GAT) with bypass 2FA enabled**

Both options are documented in the npm docs for scoped public packages. The operator uses 2FA on their npm account for interactive publishing (`npm publish --access public`), which triggers an OTP prompt. This is the default and recommended approach for manual publishing.

An alternative is staged publishing (`npm stage publish` followed by `npm stage approve`), which allows a CI workflow to submit a package to staging without 2FA, then requires 2FA only for the manual approval step. Since parallix has no CI automation, direct publishing is simpler and sufficient.

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
2. **Version drift between integrations:** the version on disk is not operator-controlled. `scripts/refresh-global-px.sh` is wired as the post-integrate hook (`adapters.integrate.postIntegrateCommand` in `workflow.config.json`) and runs from the base checkout after every successful non-dry-run `px integrate`. It bumps the patch version (`npm version patch --no-git-tag-version`), commits the bump, rebuilds the canonical bundle, packs a tarball, and installs it globally. It does **not** publish to the npm registry. Any mission that lands therefore moves the version, including between the moment the operator decides to publish and the moment they publish.
3. **Quiescing before a publish sequence:** concurrent mission integrations are drained or parked before a publish sequence begins, so the hook cannot bump the version mid-sequence. "Parked" means no mission is permitted to reach `px integrate` until the sequence completes.
4. **Manual publish sequence:** Clean working tree → drain or park concurrent integrations → read the on-disk version immediately before this publish → `npm pack --dry-run` → `npm publish --access public` → post-publish verification → git tag. The version is read fresh at each publish rather than carried over from an earlier step, because the post-integrate hook may have changed it.
5. **Distinct version per publish in a multi-step sequence:** npm rejects a publish at a version that already exists on the registry. A sequence that publishes more than once therefore needs a distinct version for every publish by construction; step 4's version read is repeated for each one.
6. **Post-publish verification against the live registry:** some properties are observable only on the published registry page and cannot be checked from a local checkout or from `npm pack --dry-run`. After each publish the operator opens the package page on npmjs.com and checks:
   - **README demo-image rendering:** the tarball ships `README.md` but not `docs/assets/` (the `files` allowlist in `package.json` covers `NOTICES`, `build/`, `LICENSE`, and `README.md`), so a relative image path has no target inside the package. The README therefore references the demo image by absolute `https://raw.githubusercontent.com/.../main/docs/assets/first-value-demo.gif` URL. The operator confirms the image actually renders on the registry page: the URL is fetched from the public repository at publish time, so a repository rename, a branch rename, or a moved asset breaks it silently in the published README while the local checkout still looks correct.
   - **First-screen image loading:** the demo image is several megabytes and sits on the first screen of the README, so the operator checks how the top of the page behaves while it loads, on a throttled connection.
7. **Download-count baseline before a repositioning publish:** the operator records the package's current npm download count before the first publish that carries the trust-layer repositioning pitch. The repositioning experiment's kill criterion in `docs/designs/reposition-as-trust-layer.md` is that people read the new pitch and none install; without a count captured before the publish, there is no baseline to compare installations against and the criterion cannot be evaluated.
8. **Token security:** npm tokens are stored in `~/.npmrc` only, never committed. Fine-grained tokens with minimal permissions are used.
9. **Content audit:** An automated grep script checks `npm pack --dry-run` output against known exclusion patterns.

These procedures are operational guidance. They are subject to change as the operator gains experience with the publish process. They are not architectural decisions.

## Decision matrix

| Option | Summary | Benefits | Risks / Costs | Fit to constraints | Decision |
|--------|---------|----------|---------------|--------------------|----------|
| A: Public npm registry | One command: `npm install -g @magnusekdahl/parallix` | Shortest install; matches public repo expectations | Operator token risk managed by 2FA; npm permanence | Matches ADR 0044's canonical audited bundle; public repo warrants public install path | **Accept** |
| B: Private npm scope first, then public | Same install after switch | Initial publish is invisible; allows verification | Two publish cycles; potential version confusion | No concrete security concern justifies extra step | Defer — only if a concrete security concern emerges |
| C: Continue tarball-only | Two commands: `npm pack && npm install -g ./magnus-parallix-*.tgz` | Maximum operator control; no registry involvement | Higher friction; does not meet credibility bar for public repo | Consistent with ADR 0044 but inferior UX for public tool | Reject as primary — tarball remains a valid secondary path |
| D: CI/CD automated publish | Fully automated pipeline | Repeatable; can include automated checks | CI credential risk; infrastructure to maintain; out of scope | Operator explicitly requested manual publish | Reject for now — revisit when cadence justifies automation |

## Consequences

### Positive consequences

- **Credible public install path:** Users can install with `npm install -g @magnusekdahl/parallix` — the shortest possible install, matching expectations for a public Node tool.
- **Tarball path preserved:** Local tarball install (`npm pack && npm install -g ./magnus-parallix-*.tgz`) remains valid and documented. Operators who prefer it can continue using it.
- **Supply-chain transparency:** The release SBOM, notices, license audit, and
  build manifest expose bundled third-party code for review. Registry audit
  alone is not sufficient because bundled code may not appear as an installed
  production dependency.
- **Manual publish discipline:** The operator's hands-on publish process is a feature, not a bug — it forces a deliberate verification step before every release.
- **Rollback awareness:** The ADR documents npm's unpublish constraints (72-hour window for unpublishing; deprecation for older versions) and provides mitigation strategies (conservative semver, version bumping).

### Negative consequences

- **npm permanence:** Once published, a version cannot be unpublished if >72 hours old or if it has more than 3 dependents. Beyond that window, deprecation is the only option. Prevention (careful `npm pack --dry-run`) is the only reliable rollback.
- **Operator token responsibility:** The operator manages npm tokens, 2FA, rotation, and scope. This is a single point of operational risk.
- **Namespace reservation:** The `@magnusekdahl` scope is now associated with a published package. If the operator abandons parallix, the scope becomes orphaned on npm.
- **Scope creep risk:** Documenting the publish process here invites future requests to add CI automation, npm provenance (Sigstore), or dist-tag management. These are separate decisions that require their own ADRs.
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

### CI/CD automated publish (Option D in matrix)

Positive: Eliminates manual steps. Consistent publish process. Can include automated checks (audit, pack verification) in the pipeline.

Negative: Introduces CI credential management. Adds infrastructure to maintain. Out of scope for the operator's stated preference for manual publish.

Assessment: Revisit when publication cadence justifies automation (e.g., frequent patch releases, multiple maintainers).

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
- `scripts/refresh-global-px.sh` — post-integrate hook that bumps the patch version, rebuilds, packs, and installs globally without publishing
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
