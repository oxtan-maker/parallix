---
id: TASK-2510
title: Authorize Parallix GitHub CD to publish to npm
status: done
assignee: [custom]
created_date: '2026-09-14 11:54'
labels: [user_value]
dependencies: [TASK-2509]
ordinal: 76007
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Establish the external npm trust relationship required by Parallix's GitHub CD workflow.

This mission must be performed by an npm maintainer/owner with write access to:

`@magnusekdahl/parallix`

Do not give npm account credentials, authentication cookies, recovery codes, or 2FA codes to a coding agent.

---

# Prerequisite

The GitHub workflow filename selected by Mission A must be known.

The workflow must live under:

`.github/workflows/`

npm's configuration requires the workflow **filename**, not the full path.

For example, if publication is added to:

`.github/workflows/ci-required.yml`

configure:

`ci-required.yml`

Do not guess this value; use the filename actually implemented by Mission A.

---

# 1. Configure npm Trusted Publisher

Open the npm package settings for:

`@magnusekdahl/parallix`

Find:

`Trusted Publisher`

Add a GitHub Actions trusted publisher with:

### Organization or user

`oxtan-maker`

### Repository

`parallix`

### Workflow filename

Use the exact workflow filename implemented in Mission A.

For example:

`ci-required.yml`

if that remains the actual workflow filename.

### Allowed action

Enable direct:

`npm publish`

because Parallix is intentionally implementing true continuous delivery rather than staged/manual approval.

Do not select stage-only publishing unless intentionally changing the CD design.

No GitHub environment restriction is required by this mission unless Mission A deliberately introduces one.

---

# 2. Preserve account security

Keep npm account-level 2FA enabled.

Do not create an npm automation token for this workflow.

Do not add an `NPM_TOKEN` GitHub secret.

Do not give GitHub a reusable npm credential.

GitHub should authenticate using the OIDC trust relationship established above.

---

# 3. First live release

After the Trusted Publisher is configured, allow the next normal Parallix change to proceed through the regular integration path.

Do not create a special release by bypassing the trust layer.

The expected path is:

`normal mission → protected main → ci-required → CD → npm`

Confirm that npm successfully publishes the source-declared version.

Confirm that the package page shows provenance for the new version.

Confirm that the corresponding GitHub release/tag exists and refers to the same source SHA.

---

# 4. Harden npm after successful migration

Once Trusted Publishing has been demonstrated successfully, review the package's npm Publishing Access settings.

Prefer:

`Require two-factor authentication and disallow tokens`

so traditional token-based publication cannot become a parallel bypass around the GitHub trust layer.

Before enabling this restriction, verify that no legitimate automation still depends on an npm publishing token.

Revoke obsolete npm publishing/automation tokens once they are demonstrably unnecessary.

The intended end state is:

```text
developer laptop
    X cannot publish

stolen/reused npm token
    X no publishing path exists

PR workflow
    X cannot publish

untrusted main commit
    X cannot publish

trusted GitHub CD workflow
    ✓ OIDC short-lived publishing authority
```

---

# Definition of done

The npm package trusts only the intended Parallix GitHub Actions workflow for automated direct publishing.

No persistent npm publication credential is required by GitHub.

A normal trusted-main integration successfully produces:

* the intended npm version,
* npm provenance,
* the matching GitHub release/tag.

After validation, legacy token-based publication is disabled/revoked where possible.
<!-- SECTION:DESCRIPTION:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 Verification gate ran and passed on the final tree with captured proof rather than an unverified claim
- [ ] #2 Lint and static analysis report clean on every changed file
- [ ] #3 No focused or unannotated skipped tests were introduced (no .only and no bare .skip)
- [ ] #4 Final checkpoint Goal Check table cites real evidence using file:line references and test names
- [ ] #5 Docs updated to reflect any workflow or user-facing behavior change
- [ ] #6 Bug-labeled missions include a red-to-green reproduction test that fails before the fix and passes after
<!-- DOD:END -->
