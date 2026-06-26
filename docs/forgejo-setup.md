# Forgejo Setup

Standalone workflow installs need three review-surface pieces before `active`, `review`, `handoff`, `rebase --push`, or `integrate` can talk to Forgejo:

1. a reachable Forgejo base URL
2. a review repository matching `adapters.review.repo`
3. token files for the agent users that will push branches or post reviews

## Happy Path

1. Export the workflow into the repo.
2. If you need a local Forgejo instance, run `parallix/tools/setup-forgejo-docker.sh` and start it with Docker Compose.
3. Create the Forgejo accounts the workflow will use (see [Create the agent accounts](#create-the-agent-accounts-fresh-instance)). On a fresh instance these do not exist yet, and `px setup` only mints *tokens* for accounts that already exist — it does not create the accounts themselves.
4. Run `px setup`.
5. Choose whether to keep the standard Backlog.md-style layout:
   - task storage in `backlog/`
   - missions in `missions/`
   - `mission/*` branches on `main`
   - worktrees in `../<repo>-<slug>`
   - verification via `npm test`
6. If you keep Forgejo bootstrap enabled, enter the Forgejo password for the login that can create the review repo.
7. Enter passwords for the agent users you want available on this machine, or leave them blank to skip token creation for that user.

`setup` writes `workflow.config.json`, writes token files into `.forgejo-local/tokens/`, grants the listed agent users write access to the configured review repo, creates or updates the git `review` remote, and runs `verify-env` so the install is validated before you start missions.

## Create the agent accounts (fresh instance)

`px setup` / `px setup-review` create **tokens** and grant repo access, but they do **not** create Forgejo user accounts — both the basic-auth token path and the owner-token bootstrap path call `POST /users/<user>/tokens` and `PUT /repos/<repo>/collaborators/<user>`, which require the account to already exist. On a fresh Forgejo you must create the accounts first, or token creation fails with HTTP 404 / 401 for users that don't exist.

Create one account per identity the workflow uses:

- the **owner** that holds the review repo (default `human`),
- one account per agent family that runs `active`/`review` steps. The canonical list comes from `suggestedForgejoUsers()` — currently `codex`, `claude`, `custom`, `mistral`. (`custom` is the opencode-backed local-model family; it is a first-class identity just like the hosted agents.)

For the bundled Docker instance, create them with the Forgejo admin CLI inside the container (replace `<container>` with your Forgejo container name, e.g. `workflow-forgejo`):

```bash
for u in human codex claude custom mistral; do
  docker exec -u 1000 <container> forgejo admin user create \
    --username "$u" --email "$u@localhost" \
    --password "CHANGE-ME-$u" --must-change-password=false
done
```

Then run `px setup` and enter each account's password so the token files are minted into `.forgejo-local/tokens/`.

> **Adding or renaming an agent family later** (e.g. the `qwen` → `custom` rename): the new family name is a new Forgejo identity. Create its account with `forgejo admin user create`, grant it write on the review repo, then re-run `px setup-review` to mint its token. Without this, `integrate`/`review` fail with `no token file found for <family>` even though every other agent works.

## Notes

- The configured review repo is created only if it does not already exist.
- Existing review repos are updated to grant the listed agent users `write` access, so implementer identities can see and update their own PRs.
- You can leave an agent password blank to skip that token on this machine.
- Re-running `px setup` lets you change config and rotate the local token files.
- `px setup-review` still exists as a narrower Forgejo-only repair path if you only need to refresh token or remote wiring.
