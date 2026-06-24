# ADR 0046: parallix npm Registry Publication Process and Security Posture

Status: Proposed | Accepted
Date: 2026-06-23

Related: ADR 0044 (Workflow Distribution Model), task-1340 (make parallix publishable)

## Context

ADR 0044 established the distribution stance as "local npm tarball, globally installed `px` CLI" and deferred concrete npm registry publication. parallix was pushed to public GitHub on 2026-06-22 (task-1322). The repo is now public and the operator wants a credible, secure, single-command install path before inviting external use.

The package has zero runtime npm dependencies (Node.js builtins only), is distributed under AGPL-3.0-or-later, and uses `access: public` in `publishConfig`. The operator publishes manually — no CI/release automation is in scope. This ADR documents the decision to adopt public npm registry publication, the security posture that enables it, the authentication requirements, and the pre-publish verification process.

The `@magnusekdahl` scope was verified available on the npm registry (task-1340 CP-0). `@magnusekdahl/parallix` returns 404, confirming the scoped name is unclaimed.

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

- **Zero runtime dependencies:** All functionality uses Node.js built-in modules (`fs`, `path`, `child_process`, `os`, `crypto`, `util`, `events`, `stream`, `buffer`, `assert`). This eliminates supply-chain attack surface from third-party packages.
- **Explicit `files` allowlist:** `package.json` uses an explicit `files` array as an allowlist, not a blacklist. Test suites, coverage reports, knowledge graph output, session data, workflow caches, and Forgejo local state are all excluded.
- **Defense-in-depth:** `.npmignore` provides a secondary exclusion layer. The combination ensures operator secrets (`*.local.json`), test fixtures, and development artifacts cannot reach the published tarball.
- **`access: public` in `publishConfig`:** The package is declared public in the manifest. The `--access public` flag is also passed at publish time for explicitness.
- **AGPL-3.0-or-later license:** The license ensures users can freely use, modify, and distribute parallix while triggering copyleft obligations on modifications to parallix itself.
- **ECDSA registry signatures:** Every package published to the public npm registry is automatically signed with ECDSA signatures by the registry. This protects against tampering at registry mirrors or proxies. Consumers can verify with `npm audit signatures` (requires npm CLI ≥8.15.0). Signed packages are the npm industry standard — all major packages have them.

### Operational procedures (derived from this decision)

The following procedures are consequences of this decision, not decisions themselves:

1. **Pre-publish verification:** `npm pack --dry-run` inspects the file listing before each publish. The operator verifies all exclusion patterns are absent.
2. **Manual publish sequence:** Clean working tree → version check → `npm pack --dry-run` → `npm publish --access public` → verify → git tag.
3. **Token security:** npm tokens are stored in `~/.npmrc` only, never committed. Fine-grained tokens with minimal permissions are used.
4. **Content audit:** An automated grep script checks `npm pack --dry-run` output against known exclusion patterns.

These procedures are operational guidance. They are subject to change as the operator gains experience with the publish process. They are not architectural decisions.

## Decision matrix

| Option | Summary | Benefits | Risks / Costs | Fit to constraints | Decision |
|--------|---------|----------|---------------|--------------------|----------|
| A: Public npm registry | One command: `npm install -g @magnusekdahl/parallix` | Shortest install; matches public repo expectations | Operator token risk managed by 2FA; npm permanence | Matches ADR 0044's zero-dependency stance; public repo warrants public install path | **Accept** |
| B: Private npm scope first, then public | Same install after switch | Initial publish is invisible; allows verification | Two publish cycles; potential version confusion | No concrete security concern justifies extra step | Defer — only if a concrete security concern emerges |
| C: Continue tarball-only | Two commands: `npm pack && npm install -g ./magnus-parallix-*.tgz` | Maximum operator control; no registry involvement | Higher friction; does not meet credibility bar for public repo | Consistent with ADR 0044 but inferior UX for public tool | Reject as primary — tarball remains a valid secondary path |
| D: CI/CD automated publish | Fully automated pipeline | Repeatable; can include automated checks | CI credential risk; infrastructure to maintain; out of scope | Operator explicitly requested manual publish | Reject for now — revisit when cadence justifies automation |

## Consequences

### Positive consequences

- **Credible public install path:** Users can install with `npm install -g @magnusekdahl/parallix` — the shortest possible install, matching expectations for a public Node tool.
- **Tarball path preserved:** Local tarball install (`npm pack && npm install -g ./magnus-parallix-*.tgz`) remains valid and documented. Operators who prefer it can continue using it.
- **Supply-chain transparency:** Zero dependencies means `npm audit --production` reports zero vulnerabilities. No hidden third-party code to vet.
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

Negative: `@magnusekdahl` scope is confirmed available and unclaimed. The operator is the sole maintainer. An organizational scope would require creating a new npm org, which is unnecessary overhead.

Assessment: `@magnusekdahl/parallix` is the correct scope for a solo-maintainer package. Revisit if a team or organization assumes maintenance.

## Links

- ADR 0044: Workflow Distribution Model — established the local npm tarball / global `px` install stance; deferred registry publication
- ADR 0037: AI Workflow Coordination Architecture — established the `workflow/` directory as the coordination CLI
- task-1340: make parallix publishable — this ADR's originating task
- task-1340 CP-0: npm scope availability verified
- `package.json` — package metadata, `files` allowlist, `publishConfig.access`
- `parallix/.npmignore` — secondary exclusion layer
- npm docs: Creating and publishing scoped public packages — https://docs.npmjs.com/creating-and-publishing-scoped-public-packages
- npm docs: Unpublishing packages from the registry — https://docs.npmjs.com/unpublishing-packages-from-the-registry
- npm docs: Requiring 2FA for package publishing — https://docs.npmjs.com/requiring-2fa-for-package-publishing-and-settings-modification
- npm docs: Staged publishing — https://docs.npmjs.com/staged-publishing
- npm docs: About ECDSA registry signatures — https://docs.npmjs.com/about-registry-signatures
- npm docs: Verifying ECDSA registry signatures — https://docs.npmjs.com/verifying-registry-signatures
- npm docs: Threats and Mitigations — https://docs.npmjs.com/threats-and-mitigations

(End of file - total 130 lines)
