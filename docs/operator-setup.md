# Operator Setup — Graphify Skill Installation

## Prerequisites

The `graphify` CLI is a pinned pip package. Bootstrap it on your workstation:

```sh
pip3 install --user graphifyy==0.8.30
```

This installs the `graphify` entry-point script to `~/.local/bin/graphify` (on Linux/macOS). Verify:

```sh
~/.local/bin/graphify --version
# → graphify 0.8.30
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

## Mistral Exclusion

Graphify ships no `mistral` or `vibe` platform. The `graphify install --platform mistral` command does not exist and will fail. The parallix harness skips mistral without error during any Graphify-related operations.

## Summary Checklist

After setup, an operator should be able to:

1. Run `graphify install --platform claude` → skill at `~/.claude/skills/graphify/`
2. Run `graphify install --platform codex` → skill at `~/.agents/skills/graphify/`
3. Run `graphify install --platform opencode` → skill at `~/.config/opencode/skills/graphify/`
4. Launch any mission — Codex keeps isolated session state while linked MCP configuration remains available
5. mistral agents will not receive a Graphify skill (by design)
6. Switch custom runner to pi in workflow.config.json → uses Pi with configured vLLM models
7. Add `"skills": ["~/.claude/skills"]` to `~/.pi/agent/settings.json` → pi custom runner gets Graphify too (no `graphify install --platform pi` needed)
