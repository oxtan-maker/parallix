---
id: TASK-2362
title: Add qwen CLI as a new agent family
status: backlog
assignee: []
created_date: '2026-08-11 16:40'
labels:
  - ai_sdlc
  - agents
dependencies: []
references:
  - src/adapters/agents/launcher-selection.ts
  - src/adapters/agents/vibe.ts
  - src/adapters/agents/codex.ts
  - src/adapters/agents/codex-telemetry.ts
  - src/application/services/agent-limit.ts
  - src/adapters/cli/commands/stats.ts
  - src/adapters/agents/custom-capacity.ts
  - config/agents.json
  - docs/agents.md
  - https://help.aliyun.com/zh/model-studio/token-plan-personal-overview
  - https://help.aliyun.com/zh/model-studio/token-plan-personal-faq
  - https://qwenlm.github.io/qwen-code-docs/en/users/features/approval-mode/
  - backlog/completed/task-1398 - mistral-fails-to-launch.md
  - backlog/completed/task-1288 - Verify-vibe-mistral-telemetry-once-usage-unblocked.md
  - backlog/completed/task-1316 - opencode-telemetry.md
  - backlog/completed/task-1339 - qwen-statistics-are-not-captured.md
  - backlog/completed/task-1422 - change-name-for-mistral-to-vibe.md
  - backlog/completed/task-1290 - Replace-qwen-naming.md
  - backlog/completed/task-1351 - Fix-opencode-launcher-model-handling-m-flag-rejects-valid-model.md
  - backlog/completed/task-1311 - after-pi-tech-change-console-is-empty.md
  - backlog/tasks/task-2266 - codex-isolation-is-broken.md
  - backlog/tasks/task-2267 - stop-false-Codex-Mistral-autoblocks-and-persist-blocklist-reasons.md
  - backlog/archive/tasks/task-1392 - deterministic-launch-failures-should-not-blocklist-agent-families.md
  - backlog/completed/task-1322 - prevent-backlog-task-id-recycling-collision.md
priority: medium
ordinal: 88913
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Add the Qwen Code CLI (`qwen`, v0.21.9 verified installed on this workstation)
as a fifth agent family alongside `codex`, `claude`, `vibe`, and `custom`,
following the same adapter pattern those families use. The telemetry must go
beyond "tokens in/out": it must measure what actually consumes credits on the
operator's subscription so qwen usage can be understood and managed.

## Neutrality contract (hard requirement)

Parallix is an agent-neutral harness. This task adds one more family with the
same rights and obligations as the existing ones — nothing more:

- No selection weights, eligibility ordering, or default-agent changes that
  favor `qwen`. It enters `config/agents.json` eligible arrays under the same
  `random` selection semantics as the other families.
- No qwen-specific special paths in selection, review exclusion, blocklist
  handling, or stats. All of those are string-keyed on family name today and
  must stay that way. Plan-tier awareness (credits, concurrency limits) is
  operator configuration and documentation, never hardcoded plan logic.
- No comparative quality or performance claims about `qwen` in docs. README and
  docs/agents.md changes only enumerate it alongside the existing families.

## Naming and disambiguation

- Family name is `qwen`, after the CLI binary — matching the convention from
  TASK-1422 (families are named after launcher CLIs: codex, claude, vibe, not
  after companies or models).
- This family is NOT the same thing as the `custom` family. `custom` runs
  locally served models through the `opencode` or `pi` runner — including the
  operator's local Qwen 3.6 27B model on the workstation GPUs. That stays
  `custom`; this task must not touch its configuration or attribution.
- Historical collision: before TASK-1290 (2026-06) the `custom` family was
  named `qwen`, so old stats rows can carry provider/model values like
  `qwen` or `cyankiwi/Qwen3.6-35B-A3B-AWQ-4bit` for missions that actually
  ran `custom`. The new family must not re-attribute or rewrite those rows,
  and `px stats` output must keep them distinguishable (see TASK-1339 for the
  earlier stats-capture failure in this area).

## The plan this runs on (researched 2026-08-11)

The workstation's `qwen` CLI is configured against the Alibaba Cloud Model
Studio (Bailian) **Token Plan, Personal edition, Lite tier** via the dedicated
endpoint `token-plan.ap-southeast-1.maas.aliyuncs.com` (auth type `openai` in
qwen terms; keys in `settings.json` env). Verified facts, with the
authoritative sources in the task references:

- Credits are the consumption unit. Lite tier: 7-day fixed window of
  2,500 credits (counted from the first call, not calendar weeks, no
  rollover); a 5-hour rolling window of 700 credits exists but is currently
  suspended ("限时取消"). Hitting a cap blocks calls — there is no
  pay-as-you-go overflow.
- Credit cost per call is dynamically determined by model type, token usage,
  thinking mode, and tool calls, with per-model deduction coefficients
  (higher-tier models like qwen3.7-max consume more credits per token).
- Cached input tokens are billed LOWER than normal input tokens but are not
  free. Thinking/reasoning tokens consume credits. System prompt, tool
  schemas, conversation-history accumulation, and tool-call payloads also
  consume credits but are NOT all visible in client-side token counts — the
  console usage analytics page is the authoritative credit statistic, and
  client telemetry is a lower bound.
- qwen3.8-max calls between 22:00 and 08:00 consume credits at a 50%
  discount.
- Lite tier recommends 1-2 concurrent agents. Usage packs (20,000 credits
  each, max 5) exist for overflow and are exempt from window caps.
- Documented quota error shapes: `429 Allocated quota exceeded` (5-hour or
  7-day window exhausted) and `429 Requests rate limit exceeded` (transient
  request-rate throttling; guidance is to retry after ~1 minute).

## Launcher

Mirror the per-family module convention (`src/adapters/agents/vibe.ts` is the
most recent reference; `codex.ts` for the home-isolation reference):

- Non-interactive invocation shape: `qwen -p <prompt>` with cwd=worktree,
  launched through the shared `startAgent`/`spawnAndTee` path so output
  teeing, the no-output watchdog, and the bounded tail buffer are inherited.
- Output stays human-readable text (the default). Do NOT switch to
  `--output-format json` or `stream-json` as the default: operator-readable
  output is a requirement (TASK-2311 — "console is empty" regression), and
  telemetry must come from disk artifacts instead (codex pattern, below).
- Tool-approval bypass for non-interactive runs — the TASK-1398 failure mode.
  Qwen Code has no `--yolo` CLI flag (verified against v0.21.9 `--help`);
  approval mode is configured via `tools.approvalMode` in settings.json,
  with values `plan | default | auto-edit | auto | yolo`. The launcher must
  ensure `yolo` is effective for the mission run — the worktree-local
  `QWEN_HOME` settings path is the natural place (see isolation below).
  Without this, any prompt needing a tool call fails outside a TTY and the
  generic error gets misread as a launch failure, writing a false blocklist
  entry on every launch. This needs a hermetic red-to-green test, exactly
  like the one TASK-1398 added for vibe's `--yolo`.
- Model handling: do not pass `-m` unless the operator pins
  `adapters.agents.models.qwen` in `workflow.config.json`. TASK-1351 is the
  prior art for model-flag footguns; the CLI's own remembered default is the
  correct unconfigured behavior.
- Resume: `qwen` supports `-r/--resume <session-id>` and `-c/--continue`
  (verified in `qwen --help`); chat recording (`--chat-recording`) must be on
  for resume to work. Add `qwen` to `RESUME_CAPABLE` only if session-id
  extraction is proven reliable; if a resume fails with session-not-found,
  fall back to a fresh session and record that session instead (TASK-1322
  lesson). If extraction cannot be made reliable, leave it out of
  `RESUME_CAPABLE` and document why, the way vibe.ts documents it.

## Session and state isolation

- Use `QWEN_HOME=<worktree>/.workflow/qwen-home` (verified in the v0.21.9
  bundle: the global qwen dir resolves from `env.QWEN_HOME` before falling
  back to `~/.qwen`). This mirrors codex's worktree-local `CODEX_HOME` and
  vibe's `VIBE_HOME`, so sessions, chat recordings, and usage artifacts
  cannot cross missions.
- Link or copy what the agent needs from the operator's `~/.qwen` (auth
  credentials, settings) into the worktree-local home, mirroring
  `ensureVibeHome` and codex's config linking — without copying secret values
  into git-tracked paths.
- Do NOT replace `HOME` or `PATH` (TASK-2266 lesson: replacing HOME hid
  nested tools like opencode/pi from the agent environment).

## Telemetry (codex-style disk extraction, no output-format switch)

Verified on this workstation with qwen v0.21.9 — the CLI writes structured
usage artifacts independent of `--output-format`:

- `<QWEN_HOME>/usage/token-usage-YYYY-MM.jsonl` — one JSONL record per API
  call (`schemaVersion: 1`): `sessionId`, `model`, `authType`,
  `inputTokens`, `outputTokens`, `cachedTokens`, `thoughtsTokens`,
  `totalTokens`, `apiDurationMs`. Written by the core `tokenUsageService`.
- `<QWEN_HOME>/usage_record.jsonl` — one session summary record:
  `sessionId`, `project`, `startTime`, `endTime`, `durationMs`, per-model
  token totals, tool-call counts (`totalCalls`/`totalSuccess`/`totalFail`),
  lines added/removed. Written by the core `usageHistoryService`
  (`getGlobalQwenDir()`, so it respects `QWEN_HOME`).

With the worktree-local `QWEN_HOME` these land inside the mission worktree,
so cross-mission misattribution is structurally prevented; still keep an
invocation-window correlation guard as defense in depth (vibe.ts
`MAX_SESSION_AGE_MINUTES` precedent).

### What must be measured, and why

The point of this telemetry is to understand what consumes the plan's credits
so qwen can be used deliberately. Observed on this workstation: one session
consumed ~4.8M input tokens of which ~97% were cache hits, ~32k output
tokens, and ~18.5k thinking tokens — the cache-hit rate, the thinking share,
and the model mix are exactly the levers that decide credit consumption, so
they must be visible per mission and stage, not collapsed into one number.

Requirements:

- Implement `src/adapters/agents/qwen-telemetry.ts` producing telemetry that
  flows into `telemetryToStatsFields` in
  `src/adapters/cli/commands/stats.ts`. Input, output, and cached tokens
  already map onto existing stats fields. `thoughtsTokens` has NO home in the
  current telemetry contract: either extend it with a justified, minimal new
  field (documented in the checkpoint, per the slop guardrails below) or
  record it in an existing extensible slot — but it must NOT be silently
  dropped or folded into output tokens without saying so, because thinking
  tokens are a distinct credit-consuming category the operator needs to see.
- Keep `provider` and `model` from the usage records (the plan's credit
  coefficients are per-model, so model-level attribution matters). Report
  per-model breakdowns where the existing stats shape already supports them.
- Fixture-backed offline tests mirroring `codex-telemetry.test.ts`.
- Known failure mode observed live: a session whose requests were recorded
  with all-zero token counts (the endpoint did not report usage). When no
  trustworthy numbers exist, record honest zeros with a documented reason —
  never fabricate or estimate (TASK-1288 policy). Verify against a real
  launch for each endpoint the operator actually uses, and capture the sample
  artifacts as fixture evidence.
- Session id extraction for resume must also come from disk (new
  `<QWEN_HOME>/projects/<project-hash>/chats/<sessionId>.jsonl` appearing in
  the invocation window), not from forcing a JSON output format.

### Credit reconciliation spike (part of this task)

Client-side token counts are a LOWER BOUND on credit consumption — the plan
also charges for system prompt, tool schemas, accumulated history, and
reasoning content that client counters only partially reflect, and the
per-model deduction coefficients are not published. To make the telemetry
actionable:

- Run one bounded real mission (or one representative stage) on qwen, record
  the parallix-measured token breakdown, and capture the before/after credit
  consumption from the Bailian console usage analytics page (Token Plan >
  我的订阅 / 用量分析) as checkpoint evidence.
- Record the observed ratio between measured tokens and consumed credits for
  that run as calibration evidence — explicitly labeled as a single-run
  observation, not a published conversion rate.
- Document in the checkpoint that console usage analytics is the authoritative
  credit source and parallix telemetry is the per-mission attribution layer;
  do not invent a cost_usd conversion beyond what that evidence supports
  (leave `cost_usd` at honest values, per existing policy).
- There is NO local credit artifact to extract (verified 2026-08-11 against
  the v0.21.9 bundle: the CLI is credit-unaware, and the docs name no usage
  query API — the console is the only channel, mirroring codex's situation
  where the rollout is token-level, not billing-level). The token JSONL is
  the codex-rollout-equivalent; credits stay console-sourced. If Bailian
  publishes a usage query API by implementation time, record it as a
  follow-up task — do not add account-level credential handling or network
  billing calls inside this mission.

## Limit-hit detection (quota vs rate limit — they are different)

- Add a `qwen` entry to `PATTERN_SETS` in
  `src/application/services/agent-limit.ts` for the two documented shapes,
  with DIFFERENT handling:
  - `429 Allocated quota exceeded` — the 5-hour/7-day credit window is
    exhausted. This is the genuine limit-hit: persist a timed block with
    reason. The 7-day window is anchored to the first call of the window, so
    a reset time is usually not derivable — but quota-exhaustion transcripts
    CAN carry one (the CLI's own `quotaErrorDetection` parses "will reset" /
    "reset at" phrasing), so run the shared `parseResetTime` extraction over
    the transcript first and fall back to the default block hours when it
    finds nothing, saying which case applied in the persisted reason.
  - `429 Requests rate limit exceeded` — transient request-rate throttling
    (provider guidance: retry after ~1 minute). This must NOT write a long
    timed block; it is the deterministic/transient category from TASK-1392.
    Route it through the non-blocking reroute path (or a short retry) so a
    burst of parallel launches does not poison the blocklist — the
    TASK-1412/2267 failure mode.
- Hermetic tests prove all three directions: quota-shaped transcript → timed
  block with reason; rate-limit-shaped transcript → reroute without a long
  persisted block; non-quota failures (auth, connectivity) → reroute without
  a block.
- The 22:00-08:00 qwen3.8-max discount is a cost observation for the docs,
  not a scheduler input — do not build time-of-day selection logic.

## Concurrency reality (document, don't hardcode)

The Lite tier is rated for 1-2 concurrent agents, and parallix legitimately
runs several agents at once across missions. Do NOT add qwen-specific
concurrency code in this mission. Instead:

- Document the plan's concurrency guidance in `docs/agents.md` so the
  operator can size qwen's role (step eligibility in `config/agents.json`,
  manual blocks, or simply not running parallel qwen missions).
- If a generic per-family concurrency cap turns out to be needed, note the
  existing `custom-capacity.ts` seam as the reference and file it as a
  separate follow-up task — that is a harness feature, not a qwen feature.

## Registration surfaces (all existing, string-keyed)

- `src/adapters/agents/launcher-selection.ts`: `LAUNCHERS`, `RESOLVERS`,
  `HEALTH_PROBE_ARGS` (`qwen --help` verified exit 0 — the standard probe),
  `WORKFLOW_AGENT_NAMES`, `KNOWN_AGENT_NAMES`, and `RESUME_CAPABLE` per the
  resume decision above.
- `config/agents.json`: add `qwen` to the step eligibility arrays under the
  same random-selection policy as the existing families. The board agent
  strip derives known families from this file, so no TUI changes are needed —
  verify with the existing agent-strip tests.
- `docs/agents.md`: supported-matrix row, invocation shape, isolation model,
  telemetry source, resume status, and the plan operating notes (credit
  windows, concurrency guidance, quota-vs-rate-limit behavior, night
  discount). Consult `docs/doc-standards.md` before editing authored docs.
  README updates only where families are enumerated.

## Agent Slop Guardrails

1. New production files are limited to `src/adapters/agents/qwen.ts` and
   `src/adapters/agents/qwen-telemetry.ts`, mirroring the existing per-family
   module layout. Everything else extends existing modules; no new selection
   path, no new registry, no new projection types. Any telemetry-contract
   extension (e.g. a thoughts-tokens field) gets a one-paragraph
   justification in CP-1 before it is implemented.
2. Characterize before changing: selection, blocklist, and stats behavior get
   tests that fail before the change where applicable (red-to-green for the
   approval-bypass and false-block paths).
3. Unit tests are hermetic and mock the launcher (AGENTS.md test rule — no
   real agent launches from the unit suite). Real-launch evidence is captured
   once, manually, as fixture/proof artifacts (including the credit
   reconciliation spike).
4. No hardcoded model names, no plan-tier logic in code, no time-of-day
   scheduling, no speculative config knobs.
5. Do not broaden the mission into unrelated fixes; record separate defects
   instead.

## Failure-mode ledger (do not repeat)

| Prior task | What went wrong | Encoded requirement here |
|---|---|---|
| TASK-1398 | Missing non-interactive approval bypass → every launch persisted a false block | yolo via settings proven by red-to-green hermetic test |
| TASK-1412 / TASK-1392 / TASK-2267 | Non-quota failures persisted as autoblocks; no block reason | quota vs rate-limit vs deterministic failure handled distinctly; reasons persisted |
| TASK-1406 / TASK-1288 | Telemetry captured duration only / honest zeros policy | disk-based structured telemetry with fixture tests; honest zeros documented |
| TASK-1339 | qwen-era statistics not captured, corrupted global stats | verify stats attribution on a temp repo, then clean temp data out of global stats |
| TASK-1351 | Model flag rejected valid models | no `-m` unless operator-configured |
| TASK-2266 | HOME replacement broke nested tools | only `QWEN_HOME` scoped; HOME/PATH untouched |
| TASK-2311 | Console empty after tech change | readable text output teed via spawnAndTee |
| TASK-1322 | Resume "Session not found" with no fallback | fresh-session fallback recorded as the session |
| TASK-1422 | Family named after company instead of CLI | family named `qwen` after the binary |
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria

<!-- AC:BEGIN -->
- [ ] #1 `qwen` launches non-interactively via `startAgent` with cwd=worktree, readable text output through spawnAndTee, and an effective non-interactive tool-approval bypass; a hermetic red-to-green test proves a tool-call-requiring prompt is not blocked on approval and does not write a blocklist entry
- [ ] #2 Sessions, chat recordings, and usage artifacts are written under a worktree-local `QWEN_HOME` (`.workflow/qwen-home`), operator auth/settings are linked in without copying secrets into git-tracked paths, and `HOME`/`PATH` are untouched
- [ ] #3 Telemetry is extracted from `usage/token-usage-*.jsonl` (and `usage_record.jsonl` for tool calls/duration) without switching the CLI output format away from text, keeping input, output, cached, and thoughts token categories separately visible per mission/stage with per-model attribution, and consuming the existing `telemetryToStatsFields` path (any contract extension justified in CP-1); fixture-backed offline tests mirror `codex-telemetry.test.ts`
- [ ] #4 When the serving endpoint reports no usage, telemetry records honest zeros with a documented reason, verified against a real launch and captured as fixture evidence
- [ ] #5 A credit reconciliation spike compares the parallix-measured token breakdown of one bounded real run against the Bailian console usage-analytics delta, records the observed ratio as single-run calibration evidence, and the checkpoint documents that the console is the authoritative credit source while client telemetry is a lower bound
- [ ] #6 `agent-limit.ts` distinguishes `429 Allocated quota exceeded` (timed block with reason; reset time extracted from the transcript when present via the shared parser, default fallback otherwise) from `429 Requests rate limit exceeded` (reroute/short retry, no long block) and from non-quota failures (no block), with hermetic tests for all three paths
- [ ] #7 Resume works via `-r <session-id>` with the session id extracted from disk artifacts, and a session-not-found error falls back to a fresh session that becomes the recorded one; or `qwen` is explicitly left out of `RESUME_CAPABLE` with the reason documented in the launcher module
- [ ] #8 `config/agents.json` lists `qwen` in the eligible arrays with unchanged selection semantics (no weights, no bias, no other family removed), and the board agent strip renders it via the existing config-derived path
- [ ] #9 New stats rows attribute provider/model from the usage artifacts, and legacy pre-TASK-1290 `qwen` rows plus `custom`-family rows serving local Qwen models remain distinguishable and unmodified; verified on a temp repo whose data is removed from global stats afterwards
- [ ] #10 `docs/agents.md` documents the family (matrix, invocation shape, isolation, telemetry source, resume status) plus the plan operating notes (credit windows, 1-2 concurrent agents guidance, quota-vs-rate-limit behavior, night discount) per `docs/doc-standards.md`, with no plan-tier logic in code and README mentions enumeration-only
- [ ] #11 `./scripts/verify-local.sh static-analysis` and `./scripts/verify-local.sh all` pass on the final tree with captured proof
<!-- AC:END -->

## Definition of Done

<!-- DOD:BEGIN -->
- [ ] #1 Verification gate ran and passed on the final tree with captured proof rather than an unverified claim
- [ ] #2 Lint and static analysis report clean on every changed file
- [ ] #3 No focused or unannotated skipped tests were introduced (no .only and no bare .skip)
- [ ] #4 Final checkpoint Goal Check table cites real evidence using file:line references and test names
- [ ] #5 Docs updated to reflect any workflow or user-facing behavior change
- [ ] #6 Bug-labeled missions include a red-to-green reproduction test that fails before the fix and passes after
<!-- DOD:END -->
