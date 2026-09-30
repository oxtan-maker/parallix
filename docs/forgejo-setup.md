# Forgejo Setup

Standalone workflow installs need three review-surface pieces before `active`, `review`, `handoff`, `rebase --push`, or `integrate` can talk to Forgejo:

1. a reachable Forgejo base URL
2. a review repository matching `adapters.review.repo`
3. token files for the agent users that will push branches or post reviews

## Happy Path

1. Export the workflow into the repo.
2. If you need a local Forgejo instance, run `parallix/tools/setup-forgejo-docker.sh` and start it with Docker Compose.
3. Create the Forgejo accounts the workflow will use (see [Create the agent accounts](#create-the-agent-accounts-fresh-instance)). Create the site admin owner first. With that owner’s credentials, interactive setup can create missing agent accounts when you supply their passwords; owner-token bootstrap can create them without agent passwords.
4. Run `px setup`.
5. Choose whether to keep the standard Backlog.md-style layout:
   - task storage in `backlog/`
   - missions in `missions/`
   - `mission/*` branches on `main`
   - worktrees in `../<repo>-<slug>`
   - verification via `npm test`
6. If you keep Forgejo bootstrap enabled, enter the password of the Forgejo site admin that owns the review repo. Setup mints its owner token with `write:admin` in addition to the review scopes so it can bootstrap agent tokens; agent tokens retain the review scopes only.
7. Enter passwords for the agent users you want available on this machine, or leave them blank to skip token creation for that user.

`setup` writes `workflow.config.json`, writes token files into `.forgejo-local/tokens/`, grants the listed agent users write access to the configured review repo, creates or updates the git `review` remote, and runs `verify-env` so the install is validated before you start missions.

## Create the agent accounts (fresh instance)

`px setup` / `px setup-review` mint tokens and grant repository access. Interactive setup creates missing agent accounts using the site admin owner’s credentials and the supplied agent passwords. Noninteractive bootstrap creates missing accounts using the owner token with `write:admin` and generated passwords, then mints their tokens. The site admin owner must already exist; a repository owner without site admin privileges cannot create accounts or mint other users’ tokens.

Create one account per identity the workflow uses:

- `human`, the **site admin owner** that bootstraps the review repo and agent accounts (the default for general installs),
- one account per agent family that runs `active`/`review` steps. The canonical list comes from `suggestedForgejoUsers()` — currently `codex`, `claude`, `custom`, `mistral`. (`custom` is the opencode-backed local-model family; it is a first-class identity just like the hosted agents.)
- `parallix`, the account Parallix acts as when an integration repair makes an approval stale: it dismisses that approval instead of posting a review as the reviewer. Setup grants it admin on the review repo, which Forgejo requires for dismissing a review. Without its token, `px integrate` refuses to land a repaired revision under the old approval and says how to create it.

For the bundled Docker instance, create them with the Forgejo admin CLI inside the container (replace `<container>` with your Forgejo container name, e.g. `workflow-forgejo`):

```bash
docker exec -u 1000 <container> forgejo admin user create \
  --username human --email human@localhost --admin \
  --password "CHANGE-ME-human" --must-change-password=false

for u in codex claude custom mistral parallix; do
  docker exec -u 1000 <container> forgejo admin user create \
    --username "$u" --email "$u@localhost" \
    --password "CHANGE-ME-$u" --must-change-password=false
done
```

Then run `px setup` and enter each account's password so the token files are minted into `.forgejo-local/tokens/`.

> **Adding or renaming an agent family later** (e.g. the `qwen` → `custom` rename): the new family name is a new Forgejo identity. Create its account with `forgejo admin user create`, grant it write on the review repo, then re-run `px setup-review` to mint its token. Without this, `integrate`/`review` fail with `no token file found for <family>` even though every other agent works.

## Notes

An owner token minted before setup included `write:admin` may return HTTP 403 when bootstrapping another user’s token even if its owner is a site admin. Re-run `px setup-review` with the site admin’s password to rotate that token. Repository admin access, such as the access granted to `parallix`, does not confer site admin privileges.

- The configured review repo is created only if it does not already exist.
- Existing review repos are updated to grant the listed agent users `write` access, so implementer identities can see and update their own PRs, and `parallix` `admin` access, so it can dismiss stale approvals.
- You can leave an agent password blank to skip that token on this machine.
- Re-running `px setup` lets you change config and rotate the local token files.
- `px setup-review` still exists as a narrower Forgejo-only repair path if you only need to refresh token or remote wiring.
