# Forgejo Setup

Standalone workflow installs need three review-surface pieces before `active`, `review`, `handoff`, `rebase --push`, or `integrate` can talk to Forgejo:

1. a reachable Forgejo base URL
2. a review repository matching `adapters.review.repo`
3. token files for the agent users that will push branches or post reviews

## Happy Path

1. Export the workflow into the repo.
2. If you need a local Forgejo instance, run `parallix/tools/setup-forgejo-docker.sh` and start it with Docker Compose.
3. Run `px setup`.
4. Choose whether to keep the standard Backlog.md-style layout:
   - task storage in `backlog/`
   - missions in `missions/`
   - `mission/*` branches on `main`
   - worktrees in `../<repo>-<slug>`
   - verification via `npm test`
5. If you keep Forgejo bootstrap enabled, enter the Forgejo password for the login that can create the review repo.
6. Enter passwords for the agent users you want available on this machine, or leave them blank to skip token creation for that user.

`setup` writes `workflow.config.json`, writes token files into `.forgejo-local/tokens/`, grants the listed agent users write access to the configured review repo, creates or updates the git `review` remote, and runs `verify-env` so the install is validated before you start missions.

## Notes

- The configured review repo is created only if it does not already exist.
- Existing review repos are updated to grant the listed agent users `write` access, so implementer identities can see and update their own PRs.
- You can leave an agent password blank to skip that token on this machine.
- Re-running `px setup` lets you change config and rotate the local token files.
- `px setup-review` still exists as a narrower Forgejo-only repair path if you only need to refresh token or remote wiring.
