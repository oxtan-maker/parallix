# CP-1: Draft Mission Contract Complete and Verified

## Summary

Completed the agent-doable portion of task-2510: draft-contract verification and
environment scoping for the npm Trusted Publisher (OIDC) configuration.

Work done:

- Read and scoped the mission contract (`missions/task-2510/MISSION.md`) and the
  backlog task (`backlog/tasks/task-2510 - Authorize-Parallix-GitHub-CD-to-publish-to-npm.md`).
- Confirmed the workflow filename as a **value read from source**, not guessed:
  `.github/workflows/ci-required.yml` (name `ci-required`, real `push` trigger on
  `main`, publication trigger provisional per ADR 0045).
- Ran the mission gate `./scripts/verify-local.sh all` on the final tree: **exit 0**.
- Ran the `docs` subgate: **exit 0** (no volatile `file.ts:<line>` citations,
  relative links resolve).
- Proved the repository `oxtan-maker/parallix` exists and that **no npm secret
  currently exists** in its repository-level Actions secrets, i.e. SC2 already
  holds at draft time.
- Confirmed the two remaining operator actions (npm Trusted Publisher configuration,
  first live release, Publishing Access hardening) require npm account + 2FA access,
  which the restricted areas forbid handing to a coding agent. At draft time the
  environment had no npm login (`npm whoami` → 401 Unauthorized: the registry
  answered, but no credential was present), so the OIDC trust relationship
  could not be created by the agent.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Draft contract verified (mission gate) | `./scripts/verify-local.sh all` exit 0; `npm test` 2590 pass / 0 fail (`test/` suite, 46 suites) | PASS |
| Docs gate clean | `./scripts/verify-local.sh docs` exit 0; `scripts/verify-docs.mjs` | PASS |
| Workflow filename correct (read from source) | `.github/workflows/ci-required.yml` (name `ci-required`, `push` on `main`) | PASS |
| Repo `oxtan-maker/parallix` exists | `gh repo view oxtan-maker/parallix` returns `name: parallix` | PASS |
| No npm secret present (SC2 at draft) | `gh secret list --repo oxtan-maker/parallix` returns empty; org Actions secrets 404 (no org-level npm secret) | PASS |
| ADR grounding present | `docs/adr/0046-npm-publish-process-and-security.md`, `docs/adr/0058-github-publish-mode.md` | PASS |
| OIDC trust not yet established | `npm whoami` → 401 (no npm login at draft time); Trusted Publisher is configured on npm, not via `gh` | BLOCKED (operator) |

## Blocked (operator-only, genuine external dependency)

- **CP2** — configure npm Trusted Publisher for `@magnusekdahl/parallix`
  (org `oxtan-maker`, repo `parallix`, workflow `ci-required.yml`, action
  `npm publish`). Requires npm account login + 2FA; 2FA must not be handed to a coding
  agent.
- **CP3** — first live release through `normal mission → protected main →
  ci-required → CD → npm`. Requires the operator to push a normal change to
  `main` and observe the OIDC publish.
- **CP4** — harden Publishing Access to "Require 2FA and disallow tokens" and
  revoke obsolete tokens. Requires npm account access.

## Next action
Operator completes CP2 (npm Trusted Publisher config) then CP3 (first live OIDC
release with provenance + matching GitHub tag on same SHA); this agent terminates
here because the only remaining checkpoints require npm account + 2FA access,
which is a genuine external dependency the restricted areas forbid delegating.
