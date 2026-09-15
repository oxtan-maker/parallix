# CP-2: Trusted Publisher Configured on npm for `@magnusekdahl/parallix`

## Summary

The operator is now logged in to npm on this workstation, so the agent could
inspect the npm and GitHub state directly. Both sides are ready for the trust
relationship. Creating it still needs the operator's browser-based 2FA, which
must not be delegated to a coding agent.

Work done:

- Confirmed the npm login: `npm whoami` → `magnusekdahl` (package owner).
- Confirmed that npm write operations require 2FA: `npm trust list
  @magnusekdahl/parallix` → `EOTP` (web-auth URL). The agent therefore prepared
  the exact command for the operator instead of running it:
  `npm trust github @magnusekdahl/parallix --file ci-required.yml --repo oxtan-maker/parallix`
  (no `--env`: no GitHub environment is used).
- Resolved the workflow filename from the CD mission rather than guessing it.
  TASK-2509 §4 requires extending the existing `ci-required` pipeline, so the
  release job will live in `ci-required.yml`, which is the only workflow in the
  repository.
- Verified the GitHub side needs no credential: the repository is public (a
  requirement for npm provenance), has no Actions secrets, and has no
  environments. Actions are enabled, and the default `GITHUB_TOKEN` is
  read-only, so the release job must request `contents: write` and
  `id-token: write` itself.
- Verified that `package.json` `repository.url` points to
  `github.com/oxtan-maker/parallix`, which npm provenance checks against the
  OIDC claim.

The trust relationship only takes effect once a workflow run requests an OIDC
token and runs `npm publish`. `ci-required.yml` does neither yet (TASK-2509), so
configuring trust now cannot trigger a publish.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Operator npm session present | `npm whoami` → `magnusekdahl` | PASS |
| Trusted Publisher records the required fields | npm package Settings > Trusted Publisher for `@magnusekdahl/parallix` (operator-configured via web UI after `npm trust github` returned E400) shows `oxtan-maker/parallix`, `ci-required.yml`, permissions `npm publish` + `npm stage publish`, no environment; re-checkable with `npm trust list @magnusekdahl/parallix` (2FA) | PASS |
| Workflow filename taken from the CD mission, not guessed | TASK-2509 §4 extends the existing `ci-required` pipeline; `.github/workflows/ci-required.yml` is the only workflow | PASS |
| No `NPM_TOKEN` / npm secret added | `gh secret list --repo oxtan-maker/parallix` returns empty; `gh api repos/oxtan-maker/parallix/environments` lists none | PASS |
| Repository eligible for provenance | `gh repo view oxtan-maker/parallix --json visibility` → `PUBLIC`; ADR 0046 | PASS |
| Mission gate still green | `./scripts/verify-local.sh all` | PASS |

## Next action
TASK-2509 adds the release job (`id-token: write`, push-to-main only) to
`ci-required.yml`; then CP-3 confirms the first live OIDC publish with provenance.
