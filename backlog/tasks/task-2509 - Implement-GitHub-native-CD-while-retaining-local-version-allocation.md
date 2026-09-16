---
id: TASK-2509
title: Implement GitHub-native CD while retaining local version allocation
status: backlog
assignee: []
created_date: '2026-09-14 11:54'
labels: []
dependencies: []
ordinal: 75007
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Implement the repository-side changes required for fully automatic publication of trusted Parallix releases.

Parallix continues to allocate package versions locally.

GitHub does not determine or modify versions. Instead, GitHub:

1. verifies the exact merged source,
2. validates the version already declared by that source,
3. publishes that version to npm,
4. creates the corresponding GitHub tag/release.

Also change Parallix's existing local version-bump behavior so that a completed mission produces one logical commit containing both implementation and version metadata, rather than an implementation commit followed by a separate `chore: bump version` commit.

The target lifecycle is:

`mission implementation + version bump → one mission commit → integration → protected main → ci-required → validate version → npm Trusted Publishing → tag/release`

---

# 1. Preserve local version allocation

Keep the existing Parallix mechanism that determines the next patch version locally.

Do not introduce:

* release-please,
* Changesets,
* GitHub-side version calculation,
* GitHub-generated version commits.

The source tree remains authoritative for the release version being proposed.

---

# 2. Fold the version bump into the mission commit

Find the existing code responsible for the local package-version bump.

Change its commit semantics.

Current undesirable behavior:

```text
mission implementation commit
chore: bump version to X.Y.Z
```

Required behavior:

```text
mission commit
  ├── implementation
  ├── package.json version
  └── package-lock.json version
```

There must normally be one logical commit per completed mission, not two.

Prefer calculating/applying the version before creating the mission commit.

If the architecture only determines mission completion after the commit already exists, amend that mission commit deterministically rather than creating another version-only commit.

Do not:

* rewrite unrelated history,
* squash unrelated commits,
* use interactive Git operations,
* create a standalone `chore:` version commit.

Add/update automated tests demonstrating that normal mission completion leaves the implementation and version update in the same commit.

---

# 3. Preserve version consistency

Ensure at least:

* `package.json`
* `package-lock.json`

contain the same version.

Do not add another authoritative version file.

The version contained in the resulting source commit is the release candidate version.

---

# 4. Extend the existing GitHub trust pipeline

Extend the existing GitHub Actions architecture around `ci-required`.

The release job must be eligible only when:

```text
github.event_name == 'push'
github.ref == 'refs/heads/main'
ci-required == success
```

Do not publish from the PR execution of the workflow.

The release job must explicitly operate on the exact `github.sha` whose `ci-required` job succeeded.

Do not subsequently check out a moving `main`.

Architectural invariant:

`verified SHA == packaged SHA == release-tag SHA`

Keep verification permissions read-only.

Grant elevated release permissions only to the release job.

---

# 5. Configure the release job for npm Trusted Publishing

Use GitHub Actions OIDC / npm Trusted Publishing.

Use a GitHub-hosted runner.

The publication job must have only the permissions it requires, including:

```yaml
permissions:
  contents: write
  id-token: write
```

Configure Node/npm versions that satisfy npm Trusted Publishing requirements.

At the time of this mission, npm Trusted Publishing requires npm >= 11.5.1 and Node >= 22.14.0. Prefer the repository's Node 24 CI baseline and an explicitly suitable current npm release.

Configure npmjs.org as the publishing registry.

Do NOT introduce:

* `NPM_TOKEN`,
* npm automation tokens,
* PAT-based npm publishing,
* npm username/password credentials,
* private signing keys.

Assume that the repository owner separately configures npm Trusted Publishing for this workflow as described in Mission B.

---

# 6. Validate the proposed release before publishing

GitHub must inspect the trusted source rather than repair it.

Validate:

1. `package.json` contains valid SemVer.
2. `package-lock.json` contains the same version.
3. The proposed version does not already exist for `@magnusekdahl/parallix` on npm.
4. The proposed version is newer than the current published normal release under Parallix's existing release policy.
5. `v<version>` does not already point to another Git SHA.

Any inconsistency must fail closed.

Never respond to a stale version by calculating another one.

In particular, GitHub must never run:

`npm version patch`

or otherwise alter source version metadata.

---

# 7. Build/package verification

For the exact trusted SHA:

1. checkout the SHA,
2. install dependencies deterministically,
3. run release/package validation,
4. exercise the repository's normal package lifecycle,
5. publish the package.

Preserve relevant existing behavior including `prepack` and `prepublishOnly` unless a change is explicitly justified.

The generated npm package must declare exactly the version contained in the trusted source.

Avoid release-build caches where they could weaken reproducibility or make a release depend on mutable state.

---

# 8. Publish

Publish:

`@magnusekdahl/parallix@<package.json version>`

using `npm publish` through npm Trusted Publishing/OIDC.

Do not provide `NODE_AUTH_TOKEN` or another publication credential.

Do not disable provenance.

Trusted Publishing should automatically create npm provenance when published from the public GitHub repository.

---

# 9. Tag and GitHub Release

After successful npm publication, create:

`v<package-version>`

pointing to the exact trusted `github.sha`.

Then create the corresponding GitHub Release.

Example invariant:

```text
package.json                  1.5.110
npm                           @magnusekdahl/parallix@1.5.110
GitHub release                v1.5.110
GitHub tag v1.5.110           abc123
ci-required verified SHA      abc123
```

Do not create another Git commit merely to create the release.

Do not introduce a persistent GPG signing key.

The npm provenance generated through Trusted Publishing is the package's supply-chain attestation.

---

# 10. Collision semantics

Local version allocation can cause independently prepared missions to propose the same version.

Example:

```text
main:       1.5.109
mission A:  1.5.110
mission B:  1.5.110
```

If A publishes first, B must fail release validation when it later reaches the publication stage.

GitHub must not silently turn B into `1.5.111`.

The stale mission must instead be reintegrated/versioned locally and pass the trust layer again.

This is an accepted trade-off for the current Parallix development model.

---

# 11. Failure and recovery behavior

Publication must fail closed if:

* `ci-required` fails,
* the event isn't an eligible `main` push,
* versions disagree,
* SemVer is invalid,
* npm already contains the proposed version,
* the proposed version is stale,
* an existing tag points elsewhere,
* package/build verification fails,
* OIDC authentication fails,
* npm rejects publication.

Design partial-failure handling so that rerunning after a failure cannot associate one version with two different SHAs.

In particular, distinguish safely between:

* version absent from npm,
* version already published from this SHA,
* GitHub tag already correctly identifying this SHA,
* GitHub tag
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
