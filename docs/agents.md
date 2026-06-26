# parallix Agent Launcher — Supported Matrix and Policy

## Supported Agent Families (this workstation, 2026-04-11)

| Agent   | Launcher |
|---------|----------|
| codex   | `codex` |
| claude  | `claude` |
| mistral | `vibe` |
| custom    | `opencode` |

All four listed launchers are supported on this workstation. Step eligibility for all workflow steps (`draft`, `active`, `conflict-resolution`, `review`) is controlled by `parallix/config/agents.json`. If a launcher is missing from `PATH`, the harness fails loudly with the exact blocker before launching.

## Tool Calling Workaround (custom/opencode)

Opencode (custom agent family) may encounter issues with concurrent tool calls or tool call timeouts during long-running workflow sessions. When working with opencode:

- **Prefer sequential tool calls** over parallel calls for dependent operations — if tool B needs output from tool A, call them separately.
- **Use `workdir` parameter instead of `cd` chains** — avoid `cd <dir> && command` patterns; always use `workdir` for directory changes.
- **Keep bash commands simple** — prefer separate simple commands over complex one-liners with pipes and conditionals.
- **If a tool call times out or returns empty**, retry once before escalating.

## Non-interactive invocation shapes

| Agent   | Invocation shape                                                     |
|---------|----------------------------------------------------------------------|
| codex   | `codex exec --sandbox danger-full-access --cd <worktree> <prompt>` with a worktree-local `HOME` under `.workflow/codex-home`; resume uses `codex exec resume <session-id-or---last> <prompt>`; the launcher also seeds `.workflow/codex-home/.codex/config.toml` with the repo-standard trusted posture and copies `.codex/auth.json` so headless review commands can start and keep localhost Forgejo access |
| claude  | `claude --dangerously-skip-permissions --output-format stream-json --verbose --include-partial-messages -p <prompt>` (cwd=worktree) — uses `--output-format stream-json --verbose --include-partial-messages` to stream real-time JSONL events (tool calls, assistant text chunks) to the operator's terminal via the spawn-tee mechanism. `--include-partial-messages` is required: without it, the assistant event contains the full response at once and no intermediate progress is emitted. Session-id extraction parses the `result` event from stream-json output, falling back to the `claude --resume <id>` regex on plain text. |
| mistral | `vibe --prompt <prompt> --trust --output text` (cwd=worktree) — **Note: NOT resume-capable in current Vibe version**; session management uses internal state in `~/.vibe/logs/session/` but does not emit a parseable resume hint to stdout/stderr. |
| custom    | `opencode run --pure --dangerously-skip-permissions <prompt>` (cwd=worktree); resume uses `-s <session>` when a session id is known or `--continue` when only the family marker is known |

## Launch output watchdog

All workflow agent launches use the shared `startAgent` path and tee child stdout/stderr through the parent terminal. If the child process stays running but produces no stdout or stderr, the harness emits a bounded status line after a configurable delay and then once per that interval until output arrives or the process exits.

### Default watchdog timings

| Step | Initial delay |Interval |
|------|--------------|----------|
| `draft` | 15 seconds | 30 seconds |
| All other steps | 60 seconds | 60 seconds |

Draft uses shorter defaults so the operator can distinguish agent startup from a hang more quickly during the mission entrypoint (see `DRAFT_NO_OUTPUT_INITIAL_DELAY_MS` and `DRAFT_NO_OUTPUT_INTERVAL_MS` in `parallix/lib/agents/agents.js:54-55`). Other steps retain the generic 60-second defaults (`DEFAULT_NO_OUTPUT_INITIAL_DELAY_MS` and `DEFAULT_NO_OUTPUT_INTERVAL_MS` at `parallix/lib/agents/agents.js:52-53`).

### Override environment variables

Per-step timing can be overridden via environment variables:

| Variable | Applies to | Default effect |
|----------|-----------|----------------|
| `WORKFLOW_AGENT_NO_OUTPUT_INITIAL_MS` / `WORKFLOW_AGENT_NO_OUTPUT_INTERVAL_MS` | All steps | Fallback generic watchdog |
| `WORKFLOW_DRAFT_AGENT_NO_OUTPUT_INITIAL_MS` / `WORKFLOW_DRAFT_AGENT_NO_OUTPUT_INTERVAL_MS` | `draft` step only | Overrides the 15s/30s draft defaults |

Set `WORKFLOW_AGENT_NO_OUTPUT_WATCHDOG=0` to disable the watchdog entirely for a single command when investigating output interleaving.

Passing explicit `noOutputWatchdog: { initialDelayMs, intervalMs }` to `startAgent` bypasses both the env vars and the step defaults.

### Watchdog message format

When the watchdog fires, the harness emits:

```text
[INFO] No output yet from <agent> for step "<step>" after <elapsed> (pid <pid>, agent <stage>). Launcher is still running; stdout/stderr have not produced visible output.
```

The `<stage>` field is `"starting up"` when fewer than the step-specific initial delay have elapsed, and `"running"` once that threshold is crossed (`agents.js:736-738`). For draft, the threshold is 15 seconds; for all other steps it is 60 seconds.

This means the launcher process is alive but silent. It is not a launch failure by itself. A launch failure is still reported separately when the process cannot start, exits non-zero, is killed by a signal, or produces a detected usage-limit transcript that triggers fallback.

## Per-step eligibility policy

Eligibility is controlled by `parallix/config/agents.json`. The default config controls which agents are eligible for each step:

```json
{
  "steps": {
    "draft": { "eligible": ["codex", "custom", "mistral"], "selection": "random" },
    "active": { "eligible": ["codex", "claude", "custom", "mistral"], "selection": "random" },
    "conflict-resolution": { "eligible": ["claude", "codex", "mistral"], "selection": "random" },
    "review": { "eligible": ["codex", "claude", "custom", "mistral"], "selection": "random" }
  }
}
```

Note: these examples match the actual `parallix/config/agents.json` that controls eligibility at runtime. The executable config is the source of truth; any mismatch between the docs and the config is a bug.

To restrict a step to a specific agent, edit the `eligible` array. To force a specific agent for the current command invocation, use the CLI flags:

```sh
px draft task-XXX --agent codex
px active task-XXX --implementer claude
```

CLI flags (`--agent`, `--implementer`) take precedence over both the config and random selection. They are the preferred mechanism for operator override. As a fallback, the `WORKFLOW_AGENT` environment variable is also supported:

```sh
WORKFLOW_AGENT=codex px draft task-XXX
WORKFLOW_AGENT=claude px active task-XXX
```

## Local blocklist overrides

Temporary local blocking uses the operator-owned
`<PARALLIX_HOME>/agents.local.json`. `PARALLIX_HOME` is the highest-priority
whole-root override. Platform defaults are `~/.local/state/parallix` on Linux,
`~/Library/Application Support/parallix` on macOS, and `%LOCALAPPDATA%\parallix`
on Windows, with `~/.parallix` as the fallback.

On first use, if the effective file is absent, parallix migrates these legacy
locations in order, with later values taking precedence:

1. `parallix/config/agents.local.json`
2. repo-root `agents.local.json`
3. main-worktree `agents.local.json`

Migration never deletes a legacy file. Conflicting values are logged with the
selected and previous source/value. Malformed legacy files are reported and
skipped; malformed effective JSON is a hard failure and is left byte-unchanged.

Supported shape:

```json
{
  "blocklist": {
    "claude": { "until": "2026-05-02 09" },
    "codex": { "blocked": false }
  }
}
```

Per-agent values:
- `true` or `{ "blocked": true }`: permanently blocked
- `false` or `{ "blocked": false }`: explicitly unblocked
- `{ "until": "YYYY-MM-DD HH" }`: blocked until that local-machine hour passes

Malformed workflow or local agent JSON is a hard failure with the file path and parse error. Blocked agents are removed before launcher probing and random selection.

## Usage-limit handling — automatic fallback (TASK-1013)

The workflow detects limit-hit messages in agent stdout/stderr and automatically reroutes to another eligible agent.

### Detection

`parallix/lib/limit-hit.js` ships a regex catalog per agent family (`claude`, `codex`, `custom`, `mistral`) covering the common shapes:
- explicit phrases like `Claude usage limit reached`, `weekly limit`, `Quota exceeded`, `RESOURCE_EXHAUSTED`
- HTTP signals (`429 Too Many Requests`, `rate_limit_exceeded`, `Retry-After: ...`)

When a pattern matches, the parser also tries to extract a reset timestamp from the surrounding context:
1. ISO 8601 (`2026-05-01T15:30:00+00:00`)
2. 12-hour clock (`5pm`, `5:30 PM`) projected onto today/tomorrow
3. 24-hour clock (`17:00`)
4. Relative (`in 3 hours`)
5. `Retry-After: <n>` seconds/minutes

If extraction fails, the harness falls back to a 1-hour block. The result is rounded **up** to the next full hour and written as `YYYY-MM-DD HH` (the format `agents.local.json` already understands).

### Persistence

`updateAgentBlock(agent, until)` writes the timed entry to
`<PARALLIX_HOME>/agents.local.json`. Automatically persisted usage-limit blocks
therefore apply across every target repository driven by the same parallix
installation. Parent directories and a valid `{"blocklist": {}}` shape are
created on first write.

If the target file is already malformed (invalid JSON or a non-object root), `updateAgentBlock` raises a `WORKFLOW_AGENT_CONFIG_INVALID` error with the file path and original parse error and leaves the file untouched, matching the read-path contract. A limit hit must never silently overwrite a corrupted blocklist.

### Retry loop

`startAgent(step, opts)` is now async. It:
1. Picks an agent (honoring `WORKFLOW_AGENT`, the eligibility config, and the existing blocklist).
2. Spawns the launcher with a tee — output is mirrored to the user's terminal **and** captured to a bounded in-memory tail buffer (`DEFAULT_MAX_TAIL_BYTES`, currently 64 KiB per stream). Long-running, noisy agents cannot turn the harness into an `O(total output)` memory hog.
3. Runs `detectLimitHit` on the captured tail **only when the launcher actually failed** (non-zero exit, signal, or spawn error). A successful child run is never treated as a limit hit, even if the transcript happens to quote a phrase like "rate limit reached" — that path is the false-positive case where an agent reviews code, tests, or logs containing those strings.
4. On a hit, persists the block, records the agent as tried, and reselects from the remaining eligible+supported pool.
5. If every eligible agent hits a limit, the harness throws a clear "all eligible agents exhausted" error rather than silently retrying forever.

When the autonomous review loop rewrites `review-state.json` after a fallback (see `applyAgentFallback` in `parallix/lib/review/review.js`), it preserves the original `roundStartedAt` rather than stamping the rewrite time. Polling for the round's reviewer/disposition outcome uses `roundStartedAt` as the lower bound, so a crash between the fallback rewrite and pollFor* completing must not advance that bound past comments the fallback agent has already posted.

`WORKFLOW_AGENT` overrides survive their first attempt; if the pinned agent itself hits a limit, the retry falls back to normal selection (excluding the blocked one). A `WORKFLOW_AGENT` value that is already hard-blocked in `agents.local.json` (or excluded by step eligibility) is ignored at selection time and the harness falls back to the regular pool — overrides are honored *alongside* the blocklist, never *around* it.

The same rule applies to explicit `agent:` overrides passed into `startAgent({ agent })` — for example, the reviewer/implementer identities the autonomous review loop carries over from `review-state.json`. Before launching, `startAgent` consults the merged blocklist; if the pinned agent is currently blocked, it logs a warning, adds it to the tried-set, and reroutes through `selectAgent` instead of wasting a retry on a known-limited family.

### Active-step Backlog state-ordering contract

`px active` enforces this state order:

```
selectAgent (blocklist applied) → startAgent (launch) → record Backlog (status=active, assignee)
```

The Backlog task is moved to `active` with the correct implementer **only after** the launch exits cleanly (status 0, no error). A failed or exhausted launch leaves the task in its prior Backlog state — it does not record a wrong implementer or a misleading `active` status.

When `startAgent` falls back to a different agent family after a limit hit, the Backlog records the fallback family (the agent that actually ran), not the originally preselected one.

### Automatic post-execute handoff repair (TASK-1037)

The workflow harness automatically recovers from routine handoff hygiene issues after a successful execute-agent exit. When `px active <slug>` completes its execution phase, it attempts automated handoff. If handoff fails, the harness runs a repair step and retries exactly once before declaring failure.

#### Repaired conditions:
1. **Uncommitted mission artifacts**: If the worktree is dirty but only mission-owned files (the configured mission base dir for the repo, `backlog/tasks/<slug> - *`, or `backlog/completed/<slug> - *`) are modified, the harness automatically commits them with a deterministic message: `workflow(<slug>): auto-commit mission artifacts before handoff`.
2. **Branch behind primary branch (main)**: If the handoff fails because the branch is behind its remote (non-fast-forward), the harness automatically invokes `px rebase <slug>`.

#### Hard blockers:
Automatic repair is refused and the harness stops if:
- Dirty files include paths outside the mission-owned set.
- Rebase requires manual conflict resolution or agent assistance for shared files.
- Handoff fails for non-hygiene reasons (missing checkpoints, missing `## Goal Check` evidence, failed verification gates).

### Manual override is still supported

- `WORKFLOW_AGENT=<name>` — pin a specific agent for the next run.
- `parallix/config/agents.json` — restrict step eligibility.
- Edit `<PARALLIX_HOME>/agents.local.json` by hand to add or clear blocks; format remains `{"blocklist": {"agent": {"until": "YYYY-MM-DD HH"}}}`. Back up `PARALLIX_HOME` separately from target repositories and npm package backups.
