# CP-3: First Live Release Through the Normal Integration Path

## Summary

The first live OIDC release is blocked by a repository dependency, not only by
operator access. TASK-2509 added the release job (`needs: ci-required`,
`contents: write`, `id-token: write`, `npm run release:publish`) to
`.github/workflows/ci-required.yml`, and it has landed on local `main`. The
GitHub `origin/main` (`fa19486eb`) predates that landing, though, so no run on
GitHub can request an OIDC token or publish until `main` is pushed. This
mission's Restricted Areas forbid editing the workflow.

GitHub state that the release path depends on, verified at this checkpoint:

- The `Protect main` ruleset is active on the default branch. It requires the
  `ci-required` status check, forbids non-fast-forward pushes and deletion,
  requires linear history, and has no bypass actors. A `main` push therefore has
  to land a commit that `ci-required` already verified, which is the
  `github-publish/**` verification-ref flow of ADR 0058 that `origin/main`'s
  workflow already triggers on.
- No `v*` tags or GitHub releases exist yet, so the first release has no tag to
  collide with.
- The newest published npm version is `1.3.4`, and every 1.5.x version is
  unpublished, so the source-declared version at integration will be new on
  npm. Local `main` moved from `1.5.121` back to `1.5.119` in the task-2500.05 post-integrate bump. That
  is harmless for npm, but it would break TASK-2509's rule that versions must
  not go stale once 1.5.x versions are published.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Release job exists in the trusted workflow | `.github/workflows/ci-required.yml` `release` job on local `main` (TASK-2509); `git ls-remote origin refs/heads/main` → `fa19486eb`, which predates it | BLOCKED (push `main`) |
| npm publish of the source version with provenance | `npm view @magnusekdahl/parallix versions` newest `1.3.4`; provenance per ADR 0046 after the first CD publish | BLOCKED (push `main`) |
| GitHub tag/release on the published SHA | `gh release list --repo oxtan-maker/parallix` empty; `git ls-remote --tags origin` empty | BLOCKED (push `main`) |
| `main` accepts only verified commits | `gh api repos/oxtan-maker/parallix/rulesets/23337030` requires `ci-required`, no bypass; ADR 0058 | PASS |
| OIDC only, no persistent credential | `gh secret list --repo oxtan-maker/parallix` empty | PASS |

## Next action
Push local `main` (which carries TASK-2509's release job) to `origin`, let
`ci-required` and the release job run on that SHA, and confirm provenance plus
`v<version>` on the published SHA.
