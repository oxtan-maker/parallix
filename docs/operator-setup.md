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

After a successful squash integration, Parallix runs `graphify update .` in the
receiving base worktree after required bookkeeping and the repository's
post-integrate hook, before mission cleanup and closure. This applies to any
base branch. It runs only when that worktree already contains
`graphify-out/graph.json`; Parallix does not build a graph or probe Graphify for
repositories without one. Missing executables and failed updates produce a
warning and allow closeout to continue without rolling back the landed commit.
Review start, edits, checkpoints and handoff do not trigger Graphify updates.

Graphify's installed Git hooks are not a substitute for this operation: the
post-commit hook launches a detached rebuild and skips linked worktrees, so its
presence does not establish a completed update of the final landed base tree.
See [Graphify's upstream workflow guidance](https://github.com/Graphify-Labs/graphify)
and the documentation shipped with your installed version for hook behavior.

## Dependencies for Parallix's own mission worktrees

Missions on the Parallix repository install dependencies with the pnpm version
pinned in `package.json` (`packageManager`); `pnpm` must be on `PATH` (for
example through Corepack). All worktrees share pnpm's content-addressable store
but each keeps its own `node_modules`. Keep the store on the same filesystem as
the worktrees so pnpm hard-links; on another filesystem pnpm copies, which still
works but is slower. If `px draft` stops with an environment failure, the printed
exit code and output tail come from the pre-draft install: fix the cause and
re-run the draft.

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

To avoid pinning a model string in `workflow.config.json` (a pinned model goes stale whenever the served model changes), also set a default in `~/.pi/agent/settings.json` so `pi` works with no `--model` flag, matching how opencode already remembers its own default local model:

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

## Integration repair agent policy

Integration recovery launches as `act-on-review` and inherits the `active`
agent policy: eligible families, selection strategy and weights. Configure
`active` in `config/agents.json`; no separate `act-on-review` entry is needed,
and a conflicting entry cannot override `active`. Normal policy loads pick up
operator changes. Recovery retries and fallback remain within that eligible
pool, subject to launcher availability and agent blocks; an exhausted pool
stops recovery.

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

The first activation selects an eligible implementer independently of the agent
used to draft the mission. Once activated, the recorded implementer continues
across stop/restart, review responses and integration repair. An explicit
implementer override takes precedence. If the recorded family becomes ineligible
or a provider block requires recovery, an eligible replacement can take over;
the family that actually launches becomes the implementer for subsequent work.


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

An explicit `px review --continue --implementer <family>` changes the Mission
and current review implementer through the lifecycle authority before resuming.
`--dry-run` previews the selection without changing the assignment. An effective
approval must be revoked before changing implementer.

Rebase recovery uses the database-assigned Mission implementer even before a
review round exists. Missing identity or an unreadable database stops recovery;
replayed task files cannot replace that identity.

Handoff publishes with the actual implementer's credentials and stops if the
Mission and review disagree about that identity. Missing implementer credentials
cannot be replaced with reviewer or owner credentials. An existing PR with a
different author must be replaced under the implementer's identity because PR
authorship cannot change. A PR author's review remains advisory: independent
review is required before local approval or integration.

When a rebase pauses on shared conflicts, the implementer completes the Git
rebase and runs the repository's verification against the final repaired tree.
A failed repository check stops completion and automatic push. After an agent
attempt, Parallix checks Git: the rebase must have ended, no unmerged files may
remain, and the checkout must be on the mission branch captured before launch.
An unfinished rebase or wrong checkout automatically returns to the implementer
through bounded recovery. Each completion retry asks only to complete the rebase
and end on that captured branch. If recovery exhausts its budget, Parallix reports
the remaining Git state and recovery instructions, then stops without automatic
push or workflow advancement. Resolve and stage the remaining conflicts, continue
the rebase, and restore the mission checkout before retrying; use
`git rebase --abort` to abandon the rebase.
Current conflicts come from the paused Git index. Review shared conflicts
semantically, preserving unique mission changes and newer base behavior, including
file moves and completed tasks. Do not revive retired metadata or use blanket
ours/theirs resolution. A new ordinary conflict pause can be continued; an
ambiguous decision or failed hook, command or verifier needs its own diagnosis.
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

Backlog intake tasks continue to reflect workflow status even when the Mission
contract lives in the database. A successful single-family self-author review
also repairs a stale `active` Backlog task to `review`; advisory reviews that
require another reviewer do not advance it.

An integration-gate failure follows a separate, automatic repair path. Before
launching the implementer, Parallix withdraws the old approval and preserves it
in review history. If the launcher falls back to another agent family during
that repair, its identity is persisted against the live current review round,
not the integration context's earlier snapshot. Once the repair passes its
gates, the fresh round compares the approved and candidate mission patches,
each against its recorded main baseline. An unchanged patch can restore the
prior approval mechanically before any reviewer or classifier runs, provided
recorded green integration validation names the failed gate and covers the
candidate or an equivalent mission patch. The validation must follow the
withdrawal and precede restoration. Backlog task records and the integrate
hook's release-version-only bump are excluded from comparison; other manifest,
configuration and source changes remain substantive. Missing revisions,
baselines, a failed validation, and Git errors prevent mechanical restoration.
Substantive repairs can instead reach the weakening questions without an admitted
gate fact; unavailable required evidence or a non-clearing answer retains general
review. All approvals still require the mandatory pre-integration gates. Change requests return to implementation until review approves the new
revision. Both restored and reviewed approvals stop in the integration lane;
a human runs `px integrate <slug>` to land. An older mission stranded by a gate
rebound is recovered through the same path.

`px status <slug>` retains the withdrawn approval and labels the new decision's
source as `mechanical-restoration`, with both revisions, the failed gate and a
validation citation. This is a restoration of prior review authority, not a
new model verdict. Initial reviews and integration gates are still required.

An agent's child CLI can record its assigned evidence and review verdict, but
cannot start or resume a review workflow under inherited authority. It returns
to the parent workflow, which owns handoff and reviewer launch. This prevents a
nested review from leaving a stop behind for the parent's later handoff.

A retained reviewer-launch failure stops automatic review entry before another
reviewer is launched. The diagnostic names the cause and operator continuation.
Reviewer-output retries retain independent verdict authority and require only
reviewer output; they create no implementer repair checkpoint. Gate and hook
failures still return to the implementer and rerun the failing prerequisite
before independent review resumes.

If the review loop escalates to a human, run `px review <slug> --continue` to
resume its persisted review. This clears the recorded stop and grants another
review attempt, including when the previous round limit was exhausted. After
approval, run `px integrate <slug>` to continue integration. Repair budgets and
mandatory gates still apply; a failed gate never counts as approval. An interrupted
repair resumes the implementer even with unfinished checkpoints. Checkpoint
evidence is required before leaving active work for reviewer handoff.

Direct operator continuation also acknowledges a retained invalid-contract stop,
including when the slug is inferred from the current worktree with
`px review --continue`. Repair the recorded contract first. Continuation retains
the prior diagnostic and proposed correction with the acknowledgment actor and
time, and refreshes unfinished repair authorization to the current recorded
checks and success criteria. Settled repair history stays intact. Automatic or
nested continuation does not acknowledge these stops.

To clear a false report or a stop whose operator decision is already recorded,
run `px checkpoint correct-invalid-contract --name CP-5 --operator <name>
--decision <correction> --evidence <verifiable-reference>` directly. This works
while later implementation checkpoints still lack evidence. Supply an explicit
decision and a repository-relative path, recognized command, quoted test name
or ADR supporting it. The command checks the current Mission version; a pinned
stale version or invalid reference leaves the blocker unchanged. Nested and
automatic invocations have no correction authority.

`px checkpoint read --name CP-5` and `px status --json` retain the original
blocker's diagnostic, authority reason and proposed correction alongside each
operator correction, its evidence, identity and time. Clearing resumes work at
the first unfinished planned checkpoint. It records no Goal Check rows, completes
no criteria and certifies no gate. Inspect `px checkpoint check --json` for the
remaining evidence obligations; fresh repair proof and the original required
checks are still owed before handoff.

Acknowledgment supplies no repair evidence, verification or approval. Retained
failure diagnostics, fresh checkpoint evidence and successful reruns of the
original required checks are still required; a newly reported blocker stops
recovery again. Successful repair automatically performs the required handoff
and resumes normal review without another continuation command. Integration
remains an explicit operator action.

Before verification and rebase, handoff automatically commits tracked and
untracked changes in the selected mission worktree, including edits left by a
repair agent. A clean worktree creates no commit. Conflicts or Git status,
staging or commit failures stop handoff; resolve the reported Git error in that
worktree before retrying. Verification proof must still match the committed
candidate, and checkpoint evidence and completed criteria remain required.

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
integration-gate repair must pass normal review or the unchanged-patch
restoration check first.

## Summary Checklist

After setup, an operator should be able to:

1. Run `graphify install --platform claude` → skill at `~/.claude/skills/graphify/`
2. Run `graphify install --platform codex` → skill at `~/.agents/skills/graphify/`
3. Run `graphify install --platform opencode` → skill at `~/.config/opencode/skills/graphify/`
4. Launch any mission — Codex keeps isolated session state while linked MCP configuration remains available
5. mistral agents will not receive a Graphify skill (by design)
6. Switch custom runner to pi in workflow.config.json → uses Pi with configured vLLM models
7. Add `"skills": ["~/.claude/skills"]` to `~/.pi/agent/settings.json` → pi custom runner gets Graphify too (no `graphify install --platform pi` needed)
