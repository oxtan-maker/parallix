# Operator Setup — Graphify Skill Installation

## Prerequisites

The `graphify` CLI is a pinned pip package. Bootstrap it on your workstation:

```sh
pip3 install --user graphifyy==0.9.78
```

This installs the `graphify` entry-point script to `~/.local/bin/graphify` (on Linux/macOS). Verify:

```sh
~/.local/bin/graphify --version
# → graphify 0.9.78
```

The CLI resolves in this order: `$GRAPHIFY_BIN` → `graphify` on `$PATH` → `~/.local/bin/graphify`.

## Repository Input Exclusions

Graphify reads `.graphifyignore` before it creates graph nodes. The file uses
gitignore-style patterns, so a repository can keep generated workflow text out
of the input corpus without filtering a graph after it has been built.

Parallix's own `.graphifyignore` excludes only generated mission documents:

```text
missions/**/MISSION.md
missions/**/CP-*.md
```

These patterns omit mission plans and checkpoint records while leaving other
files under `missions/`, plus source and repository documentation elsewhere,
available for Graphify relationships. Run `graphify update .` after changing
the file to refresh an existing repository graph.

## One-Time Platform Install

Run the installer once per agent family. It copies a platform-specific skill (and, for Claude, a `CLAUDE.md` directive) into the agent's config directory. **Do not use `--project` scope** — it writes artifacts into the current working directory.

| Family | Command | Target Directory |
|--------|---------|-----------------|
| claude | `graphify install --platform claude` | `~/.claude/skills/graphify/` + `CLAUDE.md` directive |
| codex | `graphify install --platform codex` | `~/.agents/skills/graphify/` |
| custom/opencode | `graphify install --platform opencode` | `~/.config/opencode/skills/graphify/` |
| custom/pi | No CLI subcommand needed | Add `"skills": ["~/.claude/skills"]` to `~/.pi/agent/settings.json` — Pi loads the same `SKILL.md` directly (see "Graphify Support" below) |

Each command produces a `SKILL.md` file in the target directory. After running all three (opencode-capable) commands, verify:

## Pi Agent Setup (for Custom Runner)

Pi requires separate setup for local model support since it does not include built-in vLLM like opencode.

### Installation

```sh
npm install -g @earendil-works/pi-coding-agent
```

Verify installation:
```sh
pi --version
# → 0.80.6 (or newer)
```

### Local Model Configuration

Pi uses `~/.pi/agent/models.json` to configure local providers like vLLM. Point `baseUrl` at wherever your vLLM server actually runs — `localhost:8000` if it's on this workstation, or a LAN address (e.g. `http://192.168.x.x:8080/v1`) if it runs on a separate machine, as is common for GPU-hosted local models:

```json
{
  "providers": {
    "vllm": {
      "baseUrl": "http://localhost:8000/v1",
      "api": "openai-completions",
      "apiKey": "dummy-key",
      "compat": { "supportsDeveloperRole": false, "supportsReasoningEffort": false },
      "models": [
        { "id": "QuantTrio/Qwen3.6-27B-AWQ-6Bit", "reasoning": true }
      ]
    }
  }
}
```

To avoid pinning a model string in `workflow.config.json` (see "Model selection" in `docs/agents.md` — pinning is a footgun that goes stale whenever the served model changes), also set a default in `~/.pi/agent/settings.json` so `pi` works with no `--model` flag, matching how opencode already remembers its own default local model:

```json
{
  "defaultProvider": "vllm",
  "defaultModel": "QuantTrio/Qwen3.6-27B-AWQ-6Bit",
  "defaultProjectTrust": "always"
}
```

### vLLM Server Setup

1. Install vLLM:
   ```sh
   pip install vllm
   ```

2. Download the QuantTrio model (model must be available locally)

3. Start vLLM server:
   ```sh
   vllm serve QuantTrio/Qwen3.6-27B-AWQ-6Bit --api-key dummy-key
   ```

4. Test Pi with the model (`--print`/`-p` is required for a one-shot, non-interactive run — without it, `pi` opens its interactive TUI):
   ```sh
   pi --print --mode json --approve "Reply with exactly OK"
   ```
   With `defaultModel` set in `settings.json` this needs no `--model` flag; pass `--model <id>` only to override it for one run.

### Switching Custom Runner to Pi

In your `workflow.config.json`:
```json
{
  "adapters": {
    "agents": {
      "runners": { "custom": "pi" }
    }
  }
}
```

### Graphify Support

**Pi supports Graphify** — no `graphify install --platform pi` subcommand is needed. Pi implements the [Agent Skills standard](https://agentskills.io/specification) natively and can load the exact same skill used by Claude and opencode directly from its existing directory:

```json
// ~/.pi/agent/settings.json
{ "skills": ["~/.claude/skills"] }
```

Verified directly: with that setting, `/skill:graphify` in a real `pi --print --mode json --approve` session returns the actual `~/.claude/skills/graphify/SKILL.md` content — the identical skill opencode and Claude use, kept in sync automatically since it's the same file on disk. See ADR 0050 "Graphify on Pi" for the full investigation, including a more integrated (but less mature, third-party) alternative extension.

After running all three (opencode-capable) commands, verify:

```sh
test -f ~/.claude/skills/graphify/SKILL.md && echo OK   # claude
test -f ~/.agents/skills/graphify/SKILL.md && echo OK    # codex
test -f ~/.config/opencode/skills/graphify/SKILL.md && echo OK  # opencode
```

The install is idempotent — re-running any command overwrites the target with the latest skill file.

### Environment variable overrides

- **Claude**: Honors `$CLAUDE_CONFIG_DIR` to change the base config path.
- **Opencode**: No env-var overrides; always writes to `~/.config/opencode/skills/graphify/`.

## Codex configuration and isolated state

Codex runs each mission with a worktree-local `CODEX_HOME`, preserving separate sessions, rollouts, and cache. When an originating Codex configuration or file-based auth file exists, the harness links it into that state root instead of copying its contents. This keeps configured MCP servers available while avoiding secret values in the mission worktree. The installed Graphify skill remains copied into the mission's Codex area, as before. The operator `HOME` and `PATH` remain available for nested commands such as `opencode` and `pi`.

The Parallix harness handles this automatically in `ensureCodexHome`
(`src/adapters/agents/codex.ts`):

```
Source (originating CODEX_HOME):
  config.toml and, when present, auth.json

Targets (worktree-local Codex state):
  <worktree>/.workflow/codex-home/.codex/config.toml
  <worktree>/.workflow/codex-home/.codex/auth.json
```

The links are replaced safely on a repeat bootstrap. If the originating files
do not exist, the mission still launches with its isolated Codex state root.
When installed, `~/.agents/skills/graphify/` is also copied to
`<worktree>/.workflow/codex-home/.agents/skills/graphify/`; it is instruction
content and not a Codex configuration or credential file.

## Claude credentials across missions

A `claude` login stores an OAuth access token that expires after about eight
hours, plus a refresh token that the server replaces on every refresh. When a
Claude agent finds its access token expired, it refreshes it and saves the new
pair to `~/.claude/.credentials.json`. Parallix makes that save work inside the
Bubblewrap sandbox for every lifecycle step (draft, execute, review, fix,
integration, and smoke), so one login keeps working across missions.

Inside the sandbox, `~/.claude` is a Parallix-owned directory,
`<parallix state home>/claude-config-cell` (on Linux
`~/.local/state/parallix/claude-config-cell`), which shows your real `~/.claude`
entries read-only. Only `.credentials.json`, `session-env`, and the mission's
transcript directory are writable; settings, hooks, skills, agents, commands,
plugins, `CLAUDE.md`, and memory stay read-only, and so do the ones you do not
have, which the sandbox sees as empty. Claude's refresh lock is created in that shared
directory, so concurrent missions refresh one at a time and never reuse a
refresh token that another mission has already replaced. Anything else an agent
creates there is removed at the next Claude launch. The sandbox always uses
`~/.claude`, even when `CLAUDE_CONFIG_DIR` is set.

A running mission keeps using the credential file it started with. If a `claude`
session outside Parallix refreshes the token in the meantime, it replaces that
file, and the running mission cannot see the new token. New launches pick up
the new file.

When a refresh is impossible, for example because the refresh token was
revoked, the launch fails with the "credentials need refreshing" warning and
Parallix tries the next eligible agent without blocking the Claude family. Run
`claude` once on the host to log in again.

As an alternative, run `claude setup-token` and export the long-lived token as
`CLAUDE_CODE_OAUTH_TOKEN` in the environment that runs `px`. Claude then uses
that token directly, never refreshes, and leaves `.credentials.json` untouched.

## Mistral Exclusion

Graphify ships no `mistral` or `vibe` platform. The `graphify install --platform mistral` command does not exist and will fail. The parallix harness skips mistral without error during any Graphify-related operations.

## Reading workflow progress

Review output distinguishes an initial reviewer selection from a resumed review.
Round 1 starts with initial-selection wording; continuing an existing round or
starting a later round retains resume wording. During integration, `Next:` names
an operator action, while verification progress describes checks the workflow
handles. Missing workflow statistics display as `n/a`. If dirty paths prevent
noise squashing, the message names a bounded set of paths and explains that the
trailing backlog commits remain separate; untracked-only state uses debug output.

## Correcting an unfounded review approval

An operator may withdraw the current approval when they determine that it was
not earned — for example, when a reviewer claimed a gate result it did not
obtain. Use `px revoke-review --help` for the current invocation. This is a
human judgement call, not a retry mechanism and not an implementer escape
hatch.

When a human requests changes on the review provider for a round that is
already approved, `px review <slug> --continue` treats that human as the
operator: it revokes the approval with the provider author and the change
request as the recorded operator and reason, then acts on the correction. The
loop never launches an implementer under an effective approval. If the
revocation fails, it stops with the `px revoke-review` guidance and keeps the
change request pending for a retry.

Revocation preserves the original decision, its reviewed revision, the named
operator, and the stated reason in the review history. It returns the mission
to review and opens a new round. When the review provider is available,
Parallix also dismisses the matching pull-request approval; if it is unavailable,
the local correction remains durable and the command reports that the provider
was not updated.

The same correction accepts a historical mission whose approval was recorded
while its authoritative lane remained active. It opens review directly and
preserves the withdrawn approval; a later review must earn its own approval.

## Re-reviewing an approval the branch moved away from

A stale approval is different from an unfounded one. The reviewer approved real
work, and then the branch changed: a rebase resolved conflicts differently, a
dependency landed part of the change first, or the mission was re-scoped. The
approval is not wrong. It is about code that would no longer land.

Parallix detects this itself. An approval covers the branch while the branch
would land the same change: the diff from its target, ignoring Backlog lifecycle
commits. A clean rebase replays the same change and keeps the approval. Any
other change makes it stale. `px status`, `px status --json` and the board report
a stale approval as soon as the branch moves. `px rebase` also records the move
against the approval, naming the revision that superseded it. If an integration
gate later refuses the merge, the refusal names the staleness already reported.

When a rebase pauses on shared conflicts, the implementer completes the Git
rebase and runs the repository's verification against the final repaired tree.
A failed check or unfinished rebase stops completion and automatic push.
Repair verification can succeed while the mission is active and awaiting review.
Integration preflight, including a dry run, still requires the appropriate lane
and current approval; it is not a required check for completing conflict repair.
A changed repair returns through the lifecycle's independent review process.

A stale approval does not request changes and raises no finding, so the
implementer owes nothing. It is not re-approved automatically, and no agent or
review loop can withdraw it. An operator stands it down with the same
`px revoke-review` command used for an unfounded approval. The new round reviews
the revision that would land. The superseded approval stays in the review
history.

Use `px revoke-review` for either case. The difference is the trigger: an
unfounded approval is withdrawn on the operator's judgement; a stale approval is
reported by Parallix, and the operator only confirms that it should be reviewed
again.

Integration accepts a mission contract recorded in the operator database;
it does not require a `MISSION.md` file for those missions. Use `px status
<slug> --json` to inspect the recorded brief. Historical missions without a
recorded brief still require their mission document.

An integration-gate failure follows a separate, automatic repair path. Before
launching the implementer, Parallix withdraws the old approval and preserves it
in review history. If the launcher falls back to another agent family during
that repair, its identity is persisted against the live current review round,
not the integration context's earlier snapshot. Once the repair passes its
gates, a fresh round reviews the repaired commit. Change requests return to
implementation until review approves the new revision; integration then
restarts with fresh review and gate state. An older mission stranded by a gate
rebound is recovered through the same path.

If the review loop escalates to a human, run `px review <slug> --continue` to
resume its persisted review. This clears the recorded stop and grants another
review attempt, including when the previous round limit was exhausted. After
approval, run `px integrate <slug>` to continue integration. Repair budgets and
mandatory gates still apply; a failed gate never counts as approval.

If continuation reports that the mission has no persisted Review, run
`px review <slug> --start` to begin one. Start performs handoff, creates the
Review, and runs the autonomous review and repair loop. An existing Review is
not required. Continuation stops before clearing intervention or blocker state
or launching an agent. Handoff still checks completed success criteria and
checkpoint evidence; starting review does not supply approval evidence.
A missing Review alone does not establish that review state was lost.

If a request-changes review was interrupted and repaired by hand, the mission
can be left active while its next round awaits review. A human reviewer
approves that round with `px review <slug> --submit-review approve`; the one
command records the approval and moves the mission to integration. An approve
is still refused while the round awaits implementation, so the requested
changes and their findings stay intact, and a round reopened by an
integration-gate repair must go back through review first.

## Summary Checklist

After setup, an operator should be able to:

1. Run `graphify install --platform claude` → skill at `~/.claude/skills/graphify/`
2. Run `graphify install --platform codex` → skill at `~/.agents/skills/graphify/`
3. Run `graphify install --platform opencode` → skill at `~/.config/opencode/skills/graphify/`
4. Launch any mission — Codex keeps isolated session state while linked MCP configuration remains available
5. mistral agents will not receive a Graphify skill (by design)
6. Switch custom runner to pi in workflow.config.json → uses Pi with configured vLLM models
7. Add `"skills": ["~/.claude/skills"]` to `~/.pi/agent/settings.json` → pi custom runner gets Graphify too (no `graphify install --platform pi` needed)
