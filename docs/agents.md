# parallix Agent Launcher — Supported Matrix and Policy

## Supported Agent Families (this workstation, 2026-04-11)

| Agent   | Launcher | Runner Configuration |
|---------|----------|---------------------|
| codex   | `codex` | Fixed |
| claude  | `claude` | Fixed |
| mistral | `vibe` | Fixed |
| qwen    | `qwen` | Fixed |
| custom    | `opencode` or `pi` | Configurable via `adapters.agents.runners.custom` |

All five listed launchers are supported on this workstation. The `custom` agent family can switch between `opencode` and `pi` runners via configuration. Step eligibility for the configurable workflow steps (`draft`, `active`, `review`) is controlled by `parallix/config/agents.json`. Conflict resolution is not a separately configurable step — it always runs as the mission's recorded implementer (TASK-2294.01). If a launcher is missing from `PATH`, the harness fails loudly with the exact blocker before launching.

## Bubblewrap agent guard

On Linux, Parallix confines workflow-agent processes with `bwrap` when it is
available. The sandbox presents the host filesystem read-only and grants write
access only to the mission worktree. A review agent receives a read-only
worktree and may write its configured review-artifact directory and temporary
diagnostics under `/tmp`.

If `bwrap` is unavailable, Parallix emits a warning and preserves the normal
unsandboxed launch. Set `PARALLIX_NO_BUBBLEWRAP=1` to deliberately opt out for
one invocation. A present but misconfigured guard fails the launch rather than
silently running the agent unsandboxed.

### Custom Runner Configuration

The `custom` agent family supports multiple backends through the `adapters.agents.runners.custom` configuration field in `workflow.config.json`:

```json
{
  "adapters": {
    "agents": {
      "runners": { "custom": "opencode" },  // or "pi"
      "maxConcurrentCustom": 2,
      "subagents": { "maxParallel": 2 }
    }
  }
}
```

**Supported runners:**
- `"opencode"` (default): Uses the opencode binary with built-in vLLM support
- `"pi"`: Uses the Pi coding agent with external vLLM/Ollama configuration. Execution goes through the Pi SDK (`@earendil-works/pi-coding-agent`) — `createAgentSession` manages the session lifecycle and event subscription filters SDK chatter (tool events, thinking deltas, lifecycle signals) so only the final assistant text reaches the user.

**Model selection:** `adapters.agents.models.custom` is an optional override, not a requirement — when unset, `opencode` reuses its own remembered default local model and `pi` reads `defaultProvider`/`defaultModel` from `~/.pi/agent/settings.json`. Pinning a specific model string in `workflow.config.json` is a footgun: it goes stale the moment the operator repoints the locally-served model, and silently breaks the launcher until someone edits the repo config. Only set it when you need to force a specific model for a specific run.

**Switching runners:** Change the `runners.custom` value and restart your workflow. No code changes required.

**Per-step eligibility:** The `custom` family is eligible for steps based on `config/agents.json`, regardless of which runner is configured.

### Custom capacity

`adapters.agents.maxConcurrentCustom` optionally sets the maximum number of local `custom` instances that can run simultaneously in one workflow process. When unset, launches are unlimited; configured values must be positive integers. Invalid values are rejected by workflow configuration validation.

The launcher reserves capacity immediately before starting a custom instance and releases it when that instance completes, fails to launch, exits with an error or cancellation signal, or its launcher promise rejects. A no-output watchdog message does not itself release capacity because the process is still running. While the custom pool is full, selection treats `custom` as unavailable and chooses another eligible, working non-custom family. If no such family exists, selection retains its explicit exhausted-pool error.

## Tool Calling Workaround (custom/opencode)

Opencode (custom agent family) may encounter issues with concurrent tool calls or tool call timeouts during long-running workflow sessions. When working with opencode:

- **Prefer sequential tool calls** over parallel calls for dependent operations — if tool B needs output from tool A, call them separately.
- **Use `workdir` parameter instead of `cd` chains** — avoid `cd <dir> && command` patterns; always use `workdir` for directory changes.
- **Keep bash commands simple** — prefer separate simple commands over complex one-liners with pipes and conditionals.
- **If a tool call times out or returns empty**, retry once before escalating.

## Non-interactive invocation shapes

| Agent   | Invocation shape                                                     |
|---------|----------------------------------------------------------------------|
| codex   | `codex exec --sandbox danger-full-access --cd <worktree> <prompt>`; resume uses `codex exec resume <session-id-or---last> <prompt>`. `CODEX_HOME` stays worktree-local so sessions and rollouts cannot cross missions. When present, the originating `config.toml` and file-based `auth.json` are linked into that state root, preserving MCP configuration without copying secret values. `HOME` and `PATH` remain available for nested tools such as `opencode` and `pi`. |
| claude  | `claude --dangerously-skip-permissions --output-format stream-json --verbose --include-partial-messages -p <prompt>` (cwd=worktree) — uses `--output-format stream-json --verbose --include-partial-messages` to stream real-time JSONL events (tool calls, assistant text chunks) to the operator's terminal via the spawn-tee mechanism. `--include-partial-messages` is required: without it, the assistant event contains the full response at once and no intermediate progress is emitted. Session-id extraction parses the `result` event from stream-json output, falling back to the `claude --resume <id>` regex on plain text. |
| mistral | `vibe --prompt <prompt> --trust --yolo --output text` (cwd=worktree) — `--yolo` approves tool calls non-interactively (mirrors `--dangerously-skip-permissions` for claude/opencode and codex's `trust_level = "trusted"`); `--trust` only bypasses the working-directory trust prompt and does not itself skip tool-call approval. **Note: NOT resume-capable in current Vibe version**; session management uses internal state in `~/.vibe/logs/session/` but does not emit a parseable resume hint to stdout/stderr. |
| qwen    | `qwen -p <prompt> --output-format text` (cwd=worktree). `QWEN_HOME` set to worktree-local `.workflow/qwen-home` so sessions, chat recordings, and usage artifacts cannot cross missions. Tool-approval bypass via `tools.approvalMode: yolo` in worktree-local `settings.json` (mirrors vibe's `--yolo`; qwen CLI has no `--yolo` flag). `HOME` and `PATH` remain untouched. Resume via `-r <session-id>` (session id extracted from `<QWEN_HOME>/projects/<hash>/chats/<id>.jsonl`) or `-c` for most recent; session-not-found falls back to fresh session. Telemetry extracted from disk artifacts: `usage/token-usage-YYYY-MM.jsonl` (per-call tokens) and `usage_record.jsonl` (session summary with tool calls/duration). |
| custom    | `opencode run --pure --dangerously-skip-permissions <prompt>` (cwd=worktree) or `pi --print --mode json --approve <prompt>` (cwd=worktree); resume uses `-s <session>` (opencode) or `--session-id <id>` (pi) when a session id is known or `--continue` when only the family marker is known. `pi` uses the Pi SDK (`createAgentSession`) for execution: SDK event subscription in `lib/agents/pi.ts` collects only `text_delta` events from `message_update` as user-facing stdout, filtering out all other SDK events (tool execution, thinking deltas, lifecycle signals). Telemetry (token usage, tool call count, session ID) is extracted from `session.getSessionStats()` and `session.getLastAssistantText()` |

### Qwen plan operating notes

The `qwen` family runs against the Alibaba Cloud Model Studio (Bailian) Token Plan, Personal edition, Lite tier. Operator-facing guidance (not enforced in code):

- **Credit windows**: 7-day fixed window of 2,500 credits from first call (no rollover). A 5-hour rolling window of 700 credits exists but may be suspended.
- **Concurrency**: Plan recommends 1-2 concurrent agents. Operator manages via step eligibility in `config/agents.json`.
- **Quota vs rate-limit**: `429 Allocated quota exceeded` writes a timed block (window exhausted). `429 Requests rate limit exceeded` is transient — agent rerouted without a block persist.
- **Night discount**: qwen3.8-max calls between 22:00 and 08:00 consume credits at 50% discount (cost observation, no scheduler logic).
- **Telemetry**: Client-side token counts are a lower bound on credit consumption (system prompt, tool schemas, and history also consume credits). Bailian console usage analytics is the authoritative credit source. `thoughts_tokens` column in stats tracks thinking/reasoning tokens separately.

## Launch output watchdog

All workflow agent launches use the shared `startAgent` path and tee child stdout/stderr through the parent terminal. If the child process stays running but produces no stdout or stderr, the harness emits a bounded status line after a configurable delay and then once per that interval until output arrives or the process exits.

### Default watchdog timings

| Step | Initial delay |Interval |
|------|--------------|----------|
| `draft` | 15 seconds | 30 seconds |
| All other steps | 60 seconds | 60 seconds |

Draft uses shorter defaults so the operator can distinguish agent startup from a hang more quickly during the mission entrypoint. Other steps retain the generic 60-second defaults.

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

The `<stage>` field is `"starting up"` before the step-specific initial delay elapses and `"running"` afterwards. For draft, the threshold is 15 seconds; for all other steps it is 60 seconds.

This means the launcher process is alive but silent. It is not a launch failure by itself. A launch failure is still reported separately when the process cannot start, exits non-zero, is killed by a signal, or produces a detected usage-limit transcript that triggers fallback.

## Per-step eligibility policy

Eligibility is controlled by `parallix/config/agents.json`. The default config controls which agents are eligible for each step:

```json
{
  "steps": {
    "draft": { "eligible": ["codex", "custom", "qwen", "vibe"], "selection": "random" },
    "active": { "eligible": ["codex", "claude", "custom", "qwen", "vibe"], "selection": "random" },
    "review": { "eligible": ["codex", "claude", "custom", "qwen", "vibe"], "selection": "random" }
  }
}
```

Note: these examples match the actual `parallix/config/agents.json` that controls eligibility at runtime. The executable config is the source of truth; any mismatch between the docs and the config is a bug.

To restrict a step to a specific agent, edit the `eligible` array. The top-level `px --help` command synopsis shows the current-invocation overrides: `px draft [<slug>] [--agent <family>]` and `px active [<slug>] [--implementer <family>]`. Use those CLI flags to force a specific agent for one command:

```sh
px draft task-XXX --agent codex
px active task-XXX --implementer claude
```

CLI flags (`--agent`, `--implementer`) take precedence over both the config and random selection. They are the preferred mechanism for operator override. As a fallback, the `WORKFLOW_AGENT` environment variable is also supported:

```sh
WORKFLOW_AGENT=codex px draft task-XXX
WORKFLOW_AGENT=claude px active task-XXX
```

## Agent availability in the board (px UI)

The `px` board renders an agent strip above the lanes with one entry per known
agent family:

```
● claude 0 running   ● codex 39m · 0 running exit 1   ● custom 1 running   ● vibe 39m · 0 running exit 1   1 running · family unknown
```

- a green dot when the family is usable, a red dot when it is not;
- for a red dot, the reason: the remaining-block countdown plus the block
  reason for a blocked family, or the launcher probe's explanation
  (`launcher missing`, `launcher probe-failed: exit 1`) when the family's CLI
  is not usable on this workstation;
- `N running` — missions this family is running right now.

Only current and future state is shown. A block whose `until` has elapsed
releases the family for the launcher and leaves no trace on the strip — no
lapsed countdown, no past block reason.

### Running sessions are observed, not inferred

`N running` counts missions with a live agent-launching `px` process
(`detectRunningMissionSessions`, `src/adapters/agents/running-sessions.ts`).
Live processes come from `ps`, and each one is placed like this:

- the mission is the slug on the command line (`px draft task-2217`) — that
  works before the mission worktree exists, which matters because `px draft`
  runs from the main repository;
- for slug-less commands (`px review --continue`) the mission is the worktree
  the process runs in, matched from `git worktree list --porcelain` by working
  directory, or by a worktree path in the arguments where `/proc` is
  unavailable;
- the family is the `session_markers` row for that (mission, role) **written
  after the process started**, else the family pinned on the command line
  (`--agent`/`--implementer`/`--reviewer`). The marker is written after a
  launch exits, so an older one describes a previous run and may name a family
  that has since fallen back; the mission assignee is not used at all, because
  it says who owns the mission, not who is running it.

Roles follow the subcommand: `draft` → draft, `active`/`execute` → execute.
Two commands carry no usable role and stay **unattributed**:

- `px review` runs the reviewer and then the act-on-review implementer in one
  process (`review-loop.ts` passes `role: 'reviewer'`, later
  `role: 'implementer'`), so a live `px review` proves nothing about which
  family is at work;
- `px resolve-conflict` launches as the mission implementer with `slug` and
  `role: 'implementer'`, so its session marker is attributed.

Unattributed sessions are not dropped and not guessed: they are counted in a
trailing `N running · family unknown` entry, so the strip's total still matches
what is running. `px board` and other non-launching commands are not sessions,
and the shell, parent, and child node processes of one command count once.

Nothing durable records that an agent is running: `session_markers` holds only
the last launch per (mission, role) and is never cleared on exit, and board
lanes describe mission state, not process state. So when the process table, the
worktree list, or the session markers cannot answer, the strip prints
`running unknown` — the count is never derived from board cards and an
unobserved state is never rendered as `0 running`.

The known-family list comes from `config/agents.json`
(`resolveKnownAgentFamilies`, `src/interfaces/tui/agent-config-resolver.ts`):

- an explicit top-level `families` array is used when the config declares one;
- otherwise the list is the de-duplicated, sorted union of every
  `steps.<step>.eligible` entry — the shape the shipped config uses, so no extra
  configuration is required;
- entries that are not valid agent family names are dropped;
- a missing or malformed `config/agents.json` yields an empty list, and the
  strip then renders `agents: unavailable` instead of per-family entries.

Block state itself is read from the operator blocklist, so an automatically
persisted usage-limit block (see *Usage-limit handling* below) becomes visible
on the board as a red dot with its countdown and reason.

Launcher state comes from the same probe the launcher itself uses
(`workflowLauncherStatus`), wrapped by `createLauncherProbe`
(`src/adapters/agents/launcher-availability.ts`) and wired at the composition
root (`src/composition/board-projection.ts`). The probe shells out per family,
so results are cached for `DEFAULT_LAUNCHER_PROBE_TTL_MS` (5 minutes) — a
launcher installed or removed while the board is open is picked up on the next
refresh after that window, not instantly.

## Local blocklist overrides

Temporary local blocking uses the operator-owned
`<PARALLIX_HOME>/agents.local.json`. `PARALLIX_HOME` is the highest-priority
whole-root override. Platform defaults are `~/.local/state/parallix` on Linux,
`~/Library/Application Support/parallix` on macOS, and `%LOCALAPPDATA%\parallix`
on Windows, with `~/.parallix` as the fallback.

The SQLite blocklist is the runtime authority for every family. A block in
`agents.local.json` is an operator override: a local block adds or replaces the
runtime result, and an explicit local `false` unblocks that family even while
SQLite holds a runtime block. The launcher and the board apply this same rule
when they report whether a family is blocked.

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

### Backlog branch ownership

Mission lifecycle state changes are committed to the mission's integration branch: `main` for a normal mission, or the recorded `Base-Branch` for a feature-branch mission. Parallix then rebases the mission worktree onto that branch before later mission work uses the new task state. A launch callback or dirty agent worktree defers that rebase until the next clean lifecycle boundary instead of racing uncommitted output. At that boundary, Parallix automatically keeps mission-owned metadata while restoring integration-owned task `status` and `assignee`; conflicts in shared source files still abort the rebase and leave the mission worktree at its pre-rebase commit. This keeps `backlog.md` state visible in the checkout that owns integration without discarding mission metadata or rebasing underneath an agent.

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

### Pre-review bounce policy — verified fixes and a per-failure budget

When the pre-review verification gate fails, when a Git hook rejects the
pre-review commit or rebase, or when a reviewer or implementer hands back
incomplete artifacts, the harness bounces the mission back to the responsible
agent with a fix prompt built from the failure's structured evidence and its
classification. Three guarantees govern that bounce:

- **A bounce counts as fixed only when the failing check passes again.** After
  the agent exits, the harness re-runs the check that failed: the pre-review
  rebase and the verification gate for gate and hook failures, and a fresh
  re-consumption of the role's artifacts for an incomplete-artifact failure.
  Relaunching an agent is never, on its own, evidence of a repair, and an
  ambiguous agent exit status is treated as a failed launch rather than a fix.
- **The retry budget is per failure occurrence, not cumulative, and nothing
  about it is persisted.** Each failing occurrence gets two attempts, held in
  memory for the duration of that occurrence. No retry counter is written to
  review state, to its metadata, or to the database, so two concurrent
  processes can never consume one shared counter, and a later occurrence of the
  same failure class starts with a full budget.
- **A per-round relaunch cap bounds the total fan-out.** Per-occurrence budgets
  alone do not bound how many bounces a single review round can accumulate, so
  a round-local counter caps the total bounce relaunches in one review round at
  six by default. Before each bounce the occurrence budget is clamped to the
  remaining round budget; when the round budget is spent the loop logs the cap
  diagnostic, escalates for human review, and performs no further relaunches.
  The counter is in-memory, is never persisted, and resets when the next round
  starts.

If both attempts fail their re-run, the mission strands and the harness reports
the diagnostic from the most recent re-run — not the original failure. A failure
the classifier judges human-only (infrastructure or task-state blockers) strands
immediately without launching an agent, because no implementer relaunch can fix
it.

Agent-timeout recovery — a reviewer that never posts a review, or an
implementer that never posts a disposition — is not part of this verified-fix
path. The classifier treats a timeout as an infrastructure blocker, which is
not relaunchable, so timeout recovery stays a bounded review-loop relaunch that
re-polls rather than a verified bounce. Those relaunches still count against
the per-round cap.

### Manual override is still supported

- `WORKFLOW_AGENT=<name>` — pin a specific agent for the next run.
- `parallix/config/agents.json` — restrict step eligibility.
- Edit `<PARALLIX_HOME>/agents.local.json` by hand to add or clear blocks; format remains `{"blocklist": {"agent": {"until": "YYYY-MM-DD HH"}}}`. Back up `PARALLIX_HOME` separately from target repositories and npm package backups.
