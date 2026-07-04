# CP 2: Trustworthy success signals identified

## Summary

Traced the launch-result classification path and each family's launcher adapter to find a signal that is (a) already emitted by the launcher/telemetry side effect, (b) hermetically reproducible, and (c) strong enough not to convert real failures into false successes.

- **Decision point**: `lib/agents/agents.ts:942-961` (post-fix numbering; was `agents.ts:942-955` on the mission parent commit) — the `launchFailed` boolean inside `startAgent()`. It already carves out an exception for opencode via `isSpuriousOpencodeExit(result)` (`lib/agents/opencode.ts:218-224`); Codex and Mistral had no equivalent carve-out.
- **Codex signal**: `lib/agents/codex.ts:114-131` (`processResult`) already reads the Codex rollout JSONL under `codexHomeRoot(worktree)/.codex/sessions` via `extractCodexTelemetry` (`lib/agents/codex-telemetry.ts:157`) and attaches it as `result.telemetry`. A `token_count` event with non-zero `total_token_usage` in that rollout is written directly by the Codex CLI as it processes a turn — trustworthy evidence the run did real work, independent of the final exit code. The rollout tree is worktree-scoped (fresh per launch), so there is no cross-invocation contamination risk.
- **Mistral signal**: `lib/agents/mistral.ts:58-158` (`processResult`) reads Vibe's session `meta.json` under `DEFAULT_MISTRAL_LOG_DIR` (`lib/agents/mistral-telemetry.ts:27`, `$HOME/.vibe/logs/session`) and attaches non-zero `stats` as `result.telemetry`. Unlike Codex, this directory is **shared across invocations** (not worktree-scoped) and the existing correlation window (`MAX_SESSION_AGE_MINUTES = 120`) matches sessions *before or after* the invocation start — verified empirically: this repo's own `~/.vibe/logs/session` had real leftover sessions from today's date, and a naive "telemetry present" check produced false positives in `test/agents.test.js` (e.g. `non-limit launch failure with transient error retries and persists a block for non-custom agents`, `hard launch failure (model not found) does not blocklist agent family`) by picking up unrelated old sessions. This is the mission's called-out risk ("a weak success heuristic could convert real failures into false successes").

## Refinement for Mistral

Added a `telemetryFresh` flag (`lib/agents/mistral.ts:132-149`) computed from the winning session's `meta.json` file **mtime**, requiring it be at or after (with a 1s grace) the invocation start — the same freshness contract Codex's `collectRolloutFiles` already applies via `sinceMs` (`lib/agents/codex-telemetry.ts:137`). Only `result.telemetry && result.telemetryFresh` with non-zero usage counts as a trustworthy success signal for Mistral.

## Goal Check

| Item | Evidence |
|---|---|
| Classification decision point named | `lib/agents/agents.ts:942-961` |
| Codex signal named | `result.telemetry` from `lib/agents/codex.ts:114-131`, sourced by `extractCodexTelemetry` (`lib/agents/codex-telemetry.ts:157`) |
| Mistral signal named | `result.telemetry` + `result.telemetryFresh` from `lib/agents/mistral.ts:58-158` |
| Cross-invocation contamination risk found and mitigated | `lib/agents/mistral.ts:132-149` (`telemetryFresh`), verified against real `~/.vibe/logs/session` data during test runs |

Next action: CP 3 — implement `isSpuriousCodexExit` (`lib/agents/codex.ts`) and `isSpuriousMistralExit` (`lib/agents/mistral.ts`) using these signals, and wire both into the `launchFailed` check at `lib/agents/agents.ts:952-961`, gated per-family by `chosen === 'codex'` / `chosen === 'mistral'` so `claude`/`custom` behavior is untouched.
