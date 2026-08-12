# Mission: Add qwen CLI as a new agent family (task-2362)

## Goal
Add `qwen` as a fifth agent family alongside `codex`, `claude`, `vibe`, and `custom`, with launcher, worktree-isolated home, disk-based telemetry, quota-aware limit detection, and registration in all existing selection surfaces — following the per-family adapter pattern exactly.

## Why Now
Qwen Code CLI v0.21.9 is verified installed and the Alibaba Cloud Model Studio Token Plan (Personal Lite tier) is active. Prior tasks (TASK-1339, TASK-1398, TASK-1290) left qwen-era stats broken, approval-bypass regressions unencoded for qwen, and naming collisions unresolved. Adding qwen as a proper family closes those gaps and makes qwen eligible for workflow steps with correct telemetry and blocklist behavior.

## Refinement Signals
- Predicted NEL bucket: Medium (81–235)
- Confidence: High
- Selection note: activate as-is
- Main drivers: two new adapter files (qwen.ts, qwen-telemetry.ts), extensions to launcher-selection.ts, agent-limit.ts, stats.ts, config/agents.json, docs/agents.md, and fixture-backed test files. Pattern well-established from vibe/codex.

## Scope
- `src/adapters/agents/qwen.ts` — launcher module: `startQwenAgent`, `resolveQwenCommand`, `buildQwenInvocation`, `ensureQwenHome`, `extractQwenSessionId`, `isSpuriousQwenExit`, `processResult`. Non-interactive `qwen -p <prompt>` via shared `spawnAndTee`. Tool-approval bypass via `QWEN_HOME` settings.json `tools.approvalMode: yolo`. Worktree-local `QWEN_HOME=.workflow/qwen-home`. Operator auth/settings linked from `~/.qwen` without copying secrets. HOME/PATH untouched.
- `src/adapters/agents/qwen-telemetry.ts` — telemetry module: parse `usage/token-usage-YYYY-MM.jsonl` (per-call: inputTokens, outputTokens, cachedTokens, thoughtsTokens, totalTokens) and `usage_record.jsonl` (per-session: tool calls, duration). Invocation-window correlation guard (MAX_SESSION_AGE_MINUTES pattern from vibe.ts). Honest-zeros policy when endpoint reports no usage.
- `src/adapters/agents/launcher-selection.ts` — add `qwen` to `LAUNCHERS`, `RESOLVERS`, `HEALTH_PROBE_ARGS`, `WORKFLOW_AGENT_NAMES`, and `KNOWN_AGENT_NAMES`. Resume capability decision (add to `RESUME_CAPABLE` only if session-id extraction proven; document if excluded).
- `src/application/services/agent-limit.ts` — add `qwen` entry to `PATTERN_SETS` with two distinct patterns: `429 Allocated quota exceeded` (timed block with reason; parseResetTime extraction first, fallback default block hours) and `429 Requests rate limit exceeded` (reroute/short retry, no long block).
- `src/adapters/cli/commands/stats.ts` — qwen telemetry flows through `telemetryToStatsFields`. If `thoughtsTokens` requires a new stats field, justify in CP-1 checkpoint.
- `config/agents.json` — add `qwen` to step eligibility arrays under existing `random` selection. No weights, no bias, no other family removed.
- `docs/agents.md` — supported-matrix row, invocation shape, isolation model, telemetry source, resume status, plan operating notes (credit windows, 1-2 concurrent agents, quota-vs-rate-limit, night discount). Per `docs/doc-standards.md`.
- README — enumeration-only mention if families listed.
- `test/qwen-telemetry.test.ts` — fixture-backed offline tests mirroring `codex-telemetry.test.ts` pattern.
- `test/qwen-launcher.test.ts` — hermetic tests for approval-bypass (red-to-green: tool-call prompt not blocked, no false blocklist), QWEN_HOME isolation, and limit-detection three-way (quota→block, rate-limit→reroute, non-quota→no block).
- Credit reconciliation spike — one bounded real run, compare parallix token breakdown vs Bailian console delta, record single-run calibration ratio.

## Out of Scope
- Time-of-day scheduling for qwen3.8-max night discount (document only, no scheduler logic).
- Per-family concurrency cap (document plan guidance in docs; `custom-capacity.ts` seam noted for future task).
- Hardcoded plan-tier logic or model names in code.
- Rewriting or re-attributing legacy pre-TASK-1290 stats rows where `custom` was named `qwen`.
- Adding account-level credential handling or network billing calls (credit reconciliation is manual console comparison).
- TUI/board agent strip changes (derived from config/agents.json automatically).
- Modifying `custom` family configuration or attribution.

## Success Criteria
- SC1: `qwen` launches non-interactively via `startAgent` with cwd=worktree, readable text output through `spawnAndTee`, and effective tool-approval bypass; hermetic test `"qwen approval bypass: tool-call prompt completes without approval block"` passes and no blocklist entry written.
- SC2: Sessions, chat recordings, and usage artifacts written under worktree-local `QWEN_HOME` (`.workflow/qwen-home`); operator auth/settings linked from `~/.qwen` without copying secrets into git-tracked paths; HOME and PATH untouched in spawn env.
- SC3: Telemetry extracted from `usage/token-usage-*.jsonl` and `usage_record.jsonl` without switching CLI output format from text; input, output, cached, and thoughts token categories separately visible; per-model attribution preserved; flows through `telemetryToStatsFields`. Any new stats field justified in CP-1.
- SC4: When endpoint reports no usage, telemetry records honest zeros with documented reason; verified against real launch, sample artifacts captured as fixtures.
- SC5: Credit reconciliation spike produces checkpoint evidence: parallix-measured token breakdown vs Bailian console credit delta, with observed ratio recorded as single-run calibration (labeled as such, not a published rate).
- SC6: `agent-limit.ts` `qwen` PATTERN_SETS entry distinguishes three paths: quota-exceeded→timed block with reason (parseResetTime tried first, fallback hours when no reset text), rate-limit→reroute without long block, non-quota→no block; hermetic tests cover all three.
- SC7: Resume via `-r <session-id>` with session-id extracted from disk artifacts (`<QWEN_HOME>/projects/<project-hash>/chats/<sessionId>.jsonl`); session-not-found falls back to fresh session; or `qwen` explicitly excluded from `RESUME_CAPABLE` with reason documented in launcher module.
- SC8: `config/agents.json` lists `qwen` in all step eligible arrays with `random` selection unchanged; board agent strip renders qwen via existing config-derived path (verified by existing agent-strip tests).
- SC9: New stats rows attribute provider/model from usage artifacts; legacy pre-TASK-1290 `qwen` rows and `custom`-family rows serving local Qwen models remain distinguishable and unmodified; verified on temp repo, temp data removed from global stats.
- SC10: `docs/agents.md` documents qwen family (matrix, invocation, isolation, telemetry, resume, plan notes) per `docs/doc-standards.md`; README enumeration-only; no plan-tier logic in code.
- SC11: `./scripts/verify-local.sh static-analysis` passes (ESLint + tsc --checkJs + test-hygiene); `./scripts/verify-local.sh all` passes.

## Risks and Assumptions
- R1: Qwen CLI v0.21.9 behavior (settings.json path, usage artifact format) may differ in future versions. Assumption: v0.21.9 is the target; version pinning in docs.
- R2: Credit deduction coefficients are not published — reconciliation spike yields a single-run observation, not a stable conversion rate. Assumption: single-run calibration is sufficient for initial visibility.
- R3: Session-id extraction from disk depends on `QWEN_HOME` chat file naming convention. Assumption: `<QWEN_HOME>/projects/<project-hash>/chats/<sessionId>.jsonl` is stable; if not, resume excluded with documented reason.
- R4: Concurrent qwen runs across missions: plan recommends 1-2 agents. Assumption: operator manages concurrency via config/agents.json eligibility; no code-level cap added.
- R5: The 5-hour rolling credit window is currently suspended ("限时取消"). Assumption: pattern matching for both quota shapes covers future reactivation.

## Checkpoints
- CP 1: Launcher + home isolation + approval bypass. Deliver `qwen.ts` with `startQwenAgent`, `ensureQwenHome`, `buildQwenInvocation`, `resolveQwenCommand`, `isSpuriousQwenExit`. `QWEN_HOME` env set, settings.json `tools.approvalMode: yolo` written. Hermetic red-to-green test for approval bypass. Update `launcher-selection.ts` (LAUNCHERS, RESOLVERS, HEALTH_PROBE_ARGS, WORKFLOW_AGENT_NAMES, KNOWN_AGENT_NAMES). Justify thoughtsTokens handling for telemetry contract (new field vs extensible slot).
- CP 2: Telemetry + limit detection. Deliver `qwen-telemetry.ts` with JSONL parsing, invocation-window correlation, honest-zeros path. `test/qwen-telemetry.test.ts` with fixture-backed offline tests. `agent-limit.ts` qwen PATTERN_SETS with quota-vs-rate-limit distinction. Hermetic tests for all three limit-detection paths.
- CP 3: Registration + docs + credit spike. `config/agents.json` updated, `docs/agents.md` updated per doc-standards, README enumeration. Resume decision finalized (RESUME_CAPABLE or documented exclusion). Stats integration verified on temp repo. Credit reconciliation spike: one real run, console comparison recorded. Verification gate.

### Checkpoint Documentation Requirements
Every checkpoint document (CP-N.md) MUST include:
- A summary of work done
- A `## Goal Check` section
- A 3-column pipe-delimited markdown table with columns: Criterion | Evidence | Status
- At least one evidence row per criterion using durable, verifiable references. Parallix already accepts:
  1. **Recognized repo commands or paths** — e.g., `` `npm test -- test/qwen-telemetry.test.ts` ``, `` `./scripts/verify-local.sh static-analysis` ``
  2. **Test names** — e.g., `"qwen approval bypass: tool-call prompt completes without approval block"` (must match a test name in the repo)
  3. **Test file paths** — e.g., `test/qwen-telemetry.test.ts` (must be an existing test file)
  4. **ADR references** — e.g., `ADR 0039` (must correspond to an existing file under `docs/adr/`)
  5. **File:line references** — accepted when needed, but line numbers eventually rot; prefer the forms above
- Raw `stat`/`ls` output or generic prose may appear as supplemental context, but pair them with one of the accepted references above
- A non-generic `Next action:` line at the bottom

Example Goal Check table:

| Criterion | Evidence | Status |
|---|---|---|
| Qwen launcher module exists and exports startQwenAgent | `src/adapters/agents/qwen.ts` | PASS |
| Approval bypass test passes | `test/qwen-launcher.test.ts`, `"qwen approval bypass: tool-call prompt completes without approval block"` | PASS |
| QWEN_HOME isolation verified | `test/qwen-launcher.test.ts`, `"qwen home: QWEN_HOME set to worktree .workflow/qwen-home"` | PASS |
| Static analysis clean | `./scripts/verify-local.sh static-analysis` | PASS |

## Gates
- [ ] `./scripts/verify-local.sh static-analysis`
- [ ] `./scripts/verify-local.sh all`

## Restricted Areas
- `src/adapters/agents/custom-capacity.ts` — do not modify; noted as future concurrency-cap seam only.
- `src/adapters/agents/agent-config.ts` — do not add qwen-specific config logic; family is string-keyed.
- `src/adapters/agents/codex.ts`, `claude.ts`, `opencode.ts`, `pi.ts` — do not modify existing family adapters.
- `src/application/services/agent-limit.ts` — add `qwen` PATTERN_SETS entry only; do not refactor shared detection logic.
- `config/agents.json` — add `qwen` to eligible arrays only; do not change selection semantics or other families.
- Legacy stats rows — do not rewrite or re-attribute pre-TASK-1290 rows.

## Stop Rules
- Stop if Qwen CLI v0.21.9 settings.json path or usage artifact schema differs from documented format — record the deviation, file follow-up task, and proceed with best-effort parsing.
- Stop if session-id extraction from disk cannot be proven reliable after CP-1 — exclude qwen from RESUME_CAPABLE, document reason, and continue.
- Stop if credit reconciliation spike cannot access Bailian console — record as deferred, proceed with token-only telemetry.
- Do not broaden mission into unrelated agent fixes; record separate defects as follow-up tasks.
- Do not add speculative config knobs, hardcoded model names, or plan-tier logic.
