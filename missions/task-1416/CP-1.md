# CP 1: Failing reproduction

## Summary

Authored `test/task-1416-repro.test.js` with two hermetic reproduction cases proving the real bug on the mission parent commit:

- **Codex case**: a fake `codex` binary writes a real rollout JSONL (`<worktree>/.workflow/codex-home/.codex/sessions/2026/07/04/rollout-1416.jsonl`) containing a `session_meta` event and a `token_count` event with non-zero `total_token_usage` (100 input / 50 output / 150 total tokens) — the exact on-disk shape `extractCodexTelemetry` (`lib/agents/codex-telemetry.ts`) parses — then exits with status `1`.
- **Mistral case**: a real Vibe session `meta.json` is pre-seeded under `$HOME/.vibe/logs/session/session_20260704_000000_task1416/meta.json` with a non-zero `stats` block (200 prompt / 80 completion / 280 total tokens) — the exact shape `parseMistralMeta` (`lib/agents/mistral-telemetry.ts`) parses — then the fake `vibe` binary exits with status `1`.

`HOME` is redirected to a per-test tmp dir before requiring the agents/mistral modules, so the mistral case never touches the real user home directory, and the codex telemetry lives entirely inside a per-test worktree tmp dir. Both cases go through the real `startAgent()` public API (`lib/agents/agents.ts`) with a single-candidate `selectAgentFn`, so a false-failure classification manifests as pool exhaustion (`"All eligible agents exhausted"`).

## Reproduction confirmed red

Ran on the current (unfixed) tree:

```
$ npm run build:cjs && FORCE_COLOR=0 node --test test/task-1416-repro.test.js
✔ codex exit 1 with real rollout telemetry is misclassified as a launch failure (57.13ms)
✔ mistral exit 1 with real session telemetry is misclassified as a launch failure (53.58ms)
ℹ tests 2
ℹ pass 2
ℹ fail 0
```

Both tests currently assert (and confirm) the **buggy** behavior: `startAgent()` throws `"All eligible agents exhausted for step \"draft\""` after exactly one attempt at `codex`/`mistral`, even though each launcher produced real, on-disk success telemetry alongside `status === 1`. After the fix (CP 3), these assertions will be inverted to expect a successful `{ agent: 'codex'/'mistral', ... }` result instead (SC 2 / SC 3), which is why they currently "pass" — they pass by proving the red condition on the parent commit, matching the DoD's red-to-green reproduction requirement for bug-labeled missions.

## Goal Check

| Item | Evidence |
|---|---|
| Reproduction test file exists | `test/task-1416-repro.test.js` |
| Codex false-failure reproduced | `test/task-1416-repro.test.js:76-113` — test `codex exit 1 with real rollout telemetry is misclassified as a launch failure`, confirmed failing-as-expected on parent commit (throws pool-exhaustion error) |
| Mistral false-failure reproduced | `test/task-1416-repro.test.js:115-157` — test `mistral exit 1 with real session telemetry is misclassified as a launch failure`, confirmed failing-as-expected on parent commit (throws pool-exhaustion error) |
| Telemetry parsing paths traced | `lib/agents/codex-telemetry.ts:157` (`extractCodexTelemetry`), `lib/agents/mistral-telemetry.ts:65` (`parseMistralMeta`) |
| Classification decision point traced | `lib/agents/agents.ts:942-955` (`launchFailed` computation, currently only excludes `isSpuriousOpencodeExit`) |

Next action: CP 2 — name the exact trustworthy success signal and decision point for each family (codex: non-zero-usage rollout telemetry attached to `result.telemetry` by `lib/agents/codex.ts:114-131`; mistral: non-zero-usage session telemetry attached to `result.telemetry` by `lib/agents/mistral.ts:58-157`), then implement family-specific `isSpuriousCodexExit`/`isSpuriousMistralExit` helpers analogous to `isSpuriousOpencodeExit` (`lib/agents/opencode.ts:218-224`) and wire them into `lib/agents/agents.ts:952-955`.
