# CP 3: Implement family-specific success classification

## Summary

Implemented the smallest change needed for Codex and Mistral to stop entering the launch-failure reroute/blocklist path when their family-specific success signal is present, following the existing `isSpuriousOpencodeExit` pattern exactly.

- `lib/agents/codex.ts:231-235` — added `isSpuriousCodexExit(result)`: `true` only when `status === 1`, no `signal`, no spawn `error`, and `result.telemetry` carries non-zero `totalTokens`/`inputTokens`/`outputTokens`.
- `lib/agents/mistral.ts:140-149,239-244` — added the `telemetryFresh` computation inside `processResult` and `isSpuriousMistralExit(result)`: same shape as Codex's check, plus the `telemetryFresh` requirement to reject stale/unrelated sessions from the shared `$HOME/.vibe/logs/session` directory.
- `lib/agents/agents.ts:5,7,955-961` — imported both helpers and extended the existing `launchFailed` boolean:
  ```
  !isSpuriousOpencodeExit(result) &&
  !(chosen === 'codex' && isSpuriousCodexExit(result)) &&
  !(chosen === 'mistral' && isSpuriousMistralExit(result));
  ```
  Gating by `chosen === <family>` keeps `claude` and `custom` (opencode) behavior completely unchanged (Restricted Areas).

No changes were made to blocklist schema, retry budgeting, agent selection policy, limit-hit parsing, or telemetry/stats reporting — `result.telemetry`'s shape used by `lib/agents/stage-telemetry.ts` for stats is untouched; only an additive `telemetryFresh` boolean was introduced on the mistral result object.

## Goal Check

| Item | Evidence |
|---|---|
| Codex helper implemented | `lib/agents/codex.ts:231-235` (`isSpuriousCodexExit`) |
| Mistral helper implemented | `lib/agents/mistral.ts:140-149` (`telemetryFresh`), `lib/agents/mistral.ts:239-244` (`isSpuriousMistralExit`) |
| Wired into launch-result decision | `lib/agents/agents.ts:955-961` |
| SC 2 (codex accepted despite exit 1) | `test/task-1416-repro.test.js:67-118` — `codex exit 1 with real rollout telemetry is misclassified as a launch failure`, now green |
| SC 3 (mistral accepted despite exit 1) | `test/task-1416-repro.test.js:120-176` — `mistral exit 1 with real session telemetry is misclassified as a launch failure`, now green |
| `custom`/opencode untouched (SC 5) | `chosen === 'codex'` / `chosen === 'mistral'` gates in `lib/agents/agents.ts:960-961`; full `test/agents.test.js` suite (including all opencode/custom launch-failure tests) passes unchanged |

Next action: CP 4 — add focused regression tests proving genuine (non-telemetry) Codex/Mistral failures still reroute and blocklist exactly as before (SC 4), including a stale-telemetry case for Mistral to prove the `telemetryFresh` guard actually rejects unrelated old sessions rather than accepting any nearby telemetry.
