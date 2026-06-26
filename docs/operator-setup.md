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

## One-Time Platform Install

Run the installer once per agent family. It copies a platform-specific skill (and, for Claude, a `CLAUDE.md` directive) into the agent's config directory. **Do not use `--project` scope** — it writes artifacts into the current working directory.

| Family | Command | Target Directory |
|--------|---------|-----------------|
| claude | `graphify install --platform claude` | `~/.claude/skills/graphify/` + `CLAUDE.md` directive |
| codex | `graphify install --platform codex` | `~/.agents/skills/graphify/` |
| custom/opencode | `graphify install --platform opencode` | `~/.config/opencode/skills/graphify/` |

Each command produces a `SKILL.md` file in the target directory. After running all three, verify:

```sh
test -f ~/.claude/skills/graphify/SKILL.md && echo OK   # claude
test -f ~/.agents/skills/graphify/SKILL.md && echo OK    # codex
test -f ~/.config/opencode/skills/graphify/SKILL.md && echo OK  # opencode
```

The install is idempotent — re-running any command overwrites the target with the latest skill file.

### Environment variable overrides

- **Claude**: Honors `$CLAUDE_CONFIG_DIR` to change the base config path.
- **Opencode**: No env-var overrides; always writes to `~/.config/opencode/skills/graphify/`.

## Codex Isolated HOME — Copy-Seed

Codex runs with a worktree-local HOME (`<worktree>/.workflow/codex-home`). The global `~/.agents/skills/graphify/` is invisible to codex unless copied into that isolated HOME.

The parallix harness handles this automatically. In `ensureCodexHome` (`lib/agents/codex.js`), a plain `fs.cpSync` copies the global skill into the worktree-local HOME **before** the `HOME` environment variable is overridden for the codex child process. This mirrors the existing `auth.json` copy pattern:

```
Source (operator's real HOME):
  ~/.agents/skills/graphify/SKILL.md

Target (worktree-local codex HOME):
  <worktree>/.workflow/codex-home/.agents/skills/graphify/SKILL.md
```

The copy is:
- **Idempotent**: re-running `ensureCodexHome` leaves the target unchanged.
- **Clean skip**: if no global skill is installed (`fs.existsSync` returns false), the copy step is silently skipped — config is still written, but no skill directory is created.
- **Not a per-launch install**: this is a filesystem copy of an already-installed skill. No subprocess is spawned.

## Mistral Exclusion

Graphify ships no `mistral` or `vibe` platform. The `graphify install --platform mistral` command does not exist and will fail. The parallix harness skips mistral without error during any Graphify-related operations.

## Summary Checklist

After setup, an operator should be able to:

1. Run `graphify install --platform claude` → skill at `~/.claude/skills/graphify/`
2. Run `graphify install --platform codex` → skill at `~/.agents/skills/graphify/`
3. Run `graphify install --platform opencode` → skill at `~/.config/opencode/skills/graphify/`
4. Launch any mission — codex will receive the skill via the copy-seed in `ensureCodexHome`
5. mistral agents will not receive a Graphify skill (by design)
