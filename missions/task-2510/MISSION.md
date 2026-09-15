# Mission: Authorize Parallix GitHub CD to publish to npm (task-2510)

## Goal
Establish the npm Trusted Publisher (OIDC) trust relationship so that the
Parallix GitHub Actions workflow `ci-required.yml` can publish
`@magnusekdahl/parallix` to the public npm registry directly, with no persistent
npm credential. Concretely: add a GitHub Actions trusted publisher to the npm
package `@magnusekdahl/parallix` for organization `oxtan-maker`, repository
`parallix`, workflow filename `ci-required.yml`, with the allowed action set to
direct `npm publish`. Then confirm one normal trusted-main integration produces
the intended npm version, npm provenance, and the matching GitHub release/tag on
the same source SHA, and harden the package's npm Publishing Access to
"Require two-factor authentication and disallow tokens" once Trusted Publishing
is demonstrated.

## Why Now
ADR 0046 adopted public npm registry publication for `@magnusekdahl/parallix`
but scoped it to manual, operator-driven `npm publish` and explicitly deferred
CI/CD automation. ADR 0058 then established the `github-publish` mode and the
`ci-required.yml` pipeline now runs the GitHub-safe `npm run test:ci` tier on
push to `main`. The publication trigger in `ci-required.yml` is currently a
real `push` trigger only and is not wired to any npm publishing authority. The
trust layer is the single remaining dependency for true continuous delivery
(`main → ci-required → CD → npm`); without it, the pipeline verifies but never
publishes. This mission closes that gap.

## Refinement Signals
- Predicted NEL bucket: Small (0–80)
- Confidence: High
- Selection note: activate as-is
- Main drivers: ADR 0046 publication decision, ADR 0058 github-publish mode, the `ci-required.yml` `push` trigger left unwired to npm.

## Scope
In scope:
- Configure the npm Trusted Publisher for `@magnusekdahl/parallix`:
  - GitHub org/user `oxtan-maker`
  - GitHub repository `parallix`
  - Workflow filename `ci-required.yml` (the exact filename under
    `.github/workflows/`, verified from the repo — not guessed)
  - Allowed action: direct `npm publish` (true CD; not stage-only)
  - No GitHub environment restriction (unless the executor is explicitly told
    Mission A introduced one — it has not)
- Preserve account security: keep npm 2FA enabled, do not create an npm
  automation token, do not add an `NPM_TOKEN` GitHub secret, do not grant a
  reusable npm credential. GitHub authenticates via the OIDC relationship only.
- First live release: let the next normal Parallix change flow through the
  regular integration path (`normal mission → protected main → ci-required → CD
  → npm`) and confirm the publish.
- Harden: after a successful demonstration, set npm Publishing Access to
  "Require two-factor authentication and disallow tokens" and revoke any obsolete
  npm publishing/automation tokens.
- Documentation: update ADR 0046 (or add a referenced note) to record that direct
  npm publish is now trusted from `ci-required.yml` and that token publication is
  disabled.

## Out of Scope
- No changes to `.github/workflows/ci-required.yml` contents (the workflow file
  is owned by the CD mission; this mission only reads its filename as a value).
- No changes to `package.json`, `publishConfig`, the `files` allowlist, or the
  `bin.px` entry.
- No creation of GitHub Actions secrets, OAuth apps, or reusable workflows.
- No dist-tag management beyond `latest` (ADR 0046).
- No switch to a private npm scope, staged publishing, or a different package name.
- No multi-maintainer / multi-organization npm setup.
- No changes to the `github-publish` engine or branch model (ADR 0058).

## Success Criteria
> **Falsifiability rule (ADR 0039 Part 2):** Each criterion is falsifiable with a
> concrete, observable evidence form. No subjective adjectives or vague
> quantifiers.

- SC1 The npm package `@magnusekdahl/parallix` Trusted Publisher settings record exactly one GitHub Actions trusted publisher with org `oxtan-maker`, repo `parallix`, workflow filename `ci-required.yml`, allowed action `npm publish`.
  Evidence: screenshot or exported settings of the npm Trusted Publisher page for `@magnusekdahl/parallix` showing the four fields above; or `npm` CLI settings export.
- SC2 No `NPM_TOKEN` (or any npm credential) secret exists in the `oxtan-maker/parallix` GitHub repository or organization secrets.
  Evidence: GitHub repository settings Secrets screen for `oxtan-maker/parallix` shows zero npm-related secrets; or `gh secret list --repo oxtan-maker/parallix` returns an empty list.
- SC3 npm Publishing Access (once hardened) is set to "Require two-factor authentication and disallow tokens".
  Evidence: npm package Settings > Publishing Access screen shows that selection; or the package's access setting reflects token disallowal.
- SC4 A normal trusted-main integration produced an npm publish of the on-disk version with npm provenance attestation present.
  Evidence: npm registry page for the published version shows a "Verified provenance" / Sigstore attestation badge, and the version matches the `package.json` version at integration (`1.5.119` or the patched version at publish time).
- SC5 The GitHub release/tag for that version references the same source SHA that npm published.
  Evidence: `git rev-parse <tag>` equals the SHA of the commit the CI run published, and the npm provenance attestation binds to that same SHA.
- SC6 No persistent npm publication credential is required by the workflow (OIDC only).
  Evidence: the OIDC trust relationship exists and no token is referenced anywhere in `ci-required.yml` or GitHub secrets.
- SC7 Draft verification passes.
  Evidence: `./scripts/verify-local.sh all` exits 0 on the final tree with captured output.

## Risks and Assumptions
- The workflow filename is read as a value from the implemented
  `.github/workflows/ci-required.yml`, not guessed. Assumption: this filename is
  stable for this mission; if it changes, the trusted-publisher value must match.
- The executor is an npm maintainer/owner with write access to `@magnusekdahl/parallix`
  and admin access to the `oxtan-maker/parallix` repository (to configure
  trusted publishers and secrets). This cannot be done by a coding agent.
- Enabling "disallow tokens" before all legitimate publishing routes run through
  OIDC would block publication. Guard: verify no npm token is still required
  before enabling, and do the live-release confirmation first.
- npm permanence: published versions cannot be unpublished after 72h or with >3
  dependents (ADR 0046). Choose the direct-publish trust carefully.
- The `push` trigger in `ci-required.yml` fires on every push to `main`, so the
  first push that reaches `main` after trust is configured may publish a version
  the operator did not individually select. Assumption: this is the intended true
  CD behavior; quiesce concurrent publish sequences per ADR 0046 procedure 4.
- 2FA must stay enabled on the npm account; the OIDC path still requires the
  package scope to be claimed (already true per ADR 0046).

## Checkpoints
- CP 1: Draft mission contract complete and verified (`./scripts/verify-local.sh all` green).
- CP 2: Trusted Publisher configured on npm for `@magnusekdahl/parallix` (org `oxtan-maker`, repo `parallix`, workflow `ci-required.yml`, allowed action `npm publish`); no `NPM_TOKEN` secret added.
- CP 3: First live release through the normal integration path succeeds with npm provenance and a matching GitHub release/tag on the same SHA.
- CP 4: npm Publishing Access hardened to "Require two-factor authentication and disallow tokens"; obsolete tokens revoked; ADR 0046 updated.

### Checkpoint Documentation Requirements
Every checkpoint document (CP-N.md) MUST include:
- A summary of work done
- A `## Goal Check` section
- A 3-column pipe-delimited markdown table with columns: Criterion | Evidence | Status
- At least one evidence row per criterion using durable, verifiable references. Parallix already accepts:
  1. **Recognized repo commands or paths** — e.g., `` `npm view @magnusekdahl/parallix` ``, `` `./scripts/verify-local.sh all` ``, `` `gh secret list --repo oxtan-maker/parallix` ``, `` `git rev-parse <tag>` ``
  2. **Test names** — e.g., names from `test/domain-mission.test.ts` if the checkpoint touches mission workflow behavior
  3. **Test file paths** — e.g., `test/domain-mission.test.ts` (must be an existing test file)
  4. **ADR references** — e.g., `ADR 0046` and `ADR 0058` (must correspond to existing files under `docs/adr/`)
  5. **File:line references** — accepted when needed, but line numbers eventually rot; prefer the forms above
- Raw `stat`/`ls` output or generic prose may appear as supplemental context, but pair them with one of the accepted references above. A raw `gh secret list` or `npm` CLI output dump paired with nothing else is NOT enough — attach the recognized command or ADR reference that interprets it.
- A non-generic `Next action:` line at the bottom

Example Goal Check table:

| Criterion | Evidence | Status |
|---|---|---|
| Trusted Publisher records correct fields | npm Trusted Publisher settings for `@magnusekdahl/parallix`; org `oxtan-maker`, repo `parallix`, workflow `ci-required.yml`, action `npm publish` | PASS |
| No npm secret present | `` `gh secret list --repo oxtan-maker/parallix` `` returns empty | PASS |
| Draft verification passes | `./scripts/verify-local.sh all` | PASS |

## Gates
- [ ] ./scripts/verify-local.sh all

## Restricted Areas
- Do not modify `.github/workflows/ci-required.yml` or any other workflow file.
- Do not modify `package.json`, `parallix/.npmignore`, the `files` allowlist, or the `bin.px` entry.
- Do not create GitHub Actions secrets, OAuth applications, or reusable workflows.
- Do not write, commit, or push any code; this mission is operator-facing configuration.
- Do not push the mission branch to `origin` (only `main` may be pushed to origin; the `review` remote is the sole review push target).
- Do not hand a coding agent npm credentials, cookies, recovery codes, or 2FA codes.

## Stop Rules
- Stop if the executor lacks maintainer write access to `@magnusekdahl/parallix` or admin access to `oxtan-maker/parallix` — cannot proceed without those.
- Stop before enabling "disallow tokens" if any legitimate npm publishing route still depends on a token.
- Stop and escalate if the on-disk published version does not match the `package.json` version at integration time (possible version drift from the post-integrate hook).
- Stop if configuring the trusted publisher would require creating a token or secret — the OIDC-only model must hold.
- Do not transition the backlog task to `ready`; the harness does that after a clean draft.

## Scope Amendment (operator request, 2026-09-14)
The operator made one-commit-per-mission a prerequisite for continuing this
mission, so the following moves into scope here (it was listed in TASK-2509 §2):

- In scope: `px integrate` runs an optional `adapters.integrate.preCommitCommand`
  in the mission worktree after the integration rebase onto the base branch and
  before the integration gates, committing the tracked files it modifies onto the
  mission branch. The squash then lands implementation and version metadata as
  one commit.
- In scope: Parallix's own version bump moves from the post-integrate hook into
  that pre-commit hook, is computed from the base branch version, and never
  moves the version backwards. The post-integrate hook no longer commits.
- The Restricted Areas entry "Do not write, commit, or push any code" is lifted
  for this amendment only. Workflow files, `package.json` fields other than the
  version the hook writes, and GitHub secrets remain restricted.

- SC8 A normal integration lands exactly one mission commit carrying the hook's
  version change, with no follow-up `chore: bump version` commit.
  Evidence: `test/e2e-mission-lifecycle.test.ts` test "pre-commit hook changes
  land inside the mission squash commit, not a follow-up commit (task-2510)".
