# CP 5: Verification gates

## Summary

Ran both mission-declared gates on the final tree (after `npm run build:cjs`, invoked automatically by `pretest`):

```
$ ./scripts/verify-local.sh static-analysis
=== Static Analysis Gate ===
[1/3] Running ESLint...
PASS: ESLint clean
[2/3] Running npm run typecheck...
PASS: tsc typecheck clean
[3/3] Running test-hygiene check...
PASS: no test-hygiene violations
PASS: test-hygiene clean
=== Static Analysis Gate: ALL STAGES PASSED ===
```

```
$ ./scripts/verify-local.sh all
...
ℹ tests 2016
ℹ pass 1994
ℹ fail 0
ℹ cancelled 0
ℹ skipped 22
ℹ todo 0
$ echo $?
0
```

Both gates exit `0` with no failures. Skip count (22) matches the pre-existing baseline; no new skips were introduced (no `.only`, no bare `.skip` — enforced by `scripts/test-hygiene.sh`, which passed above).

## What changed, end to end

1. **CP 1** — authored `test/task-1416-repro.test.js`, reproducing the real bug: a Codex or Mistral launcher result with `status === 1` plus real, on-disk success telemetry (rollout `token_count` for codex; session `meta.json` stats for mistral) was still classified as a launch failure by `startAgent()`, exhausting the (single-candidate) agent pool. Confirmed red on the mission parent commit.
2. **CP 2** — traced the decision point (`lib/agents/agents.ts`'s `launchFailed` boolean) and each family's telemetry-attachment code (`lib/agents/codex.ts`, `lib/agents/mistral.ts`, `lib/agents/codex-telemetry.ts`, `lib/agents/mistral-telemetry.ts`). Discovered and mitigated a contamination risk: Mistral's log directory is shared across invocations (not worktree-scoped like Codex's), so a naive "telemetry present" check picked up real leftover sessions from unrelated runs on this machine.
3. **CP 3** — implemented `isSpuriousCodexExit` (`lib/agents/codex.ts`) and `isSpuriousMistralExit` + `telemetryFresh` (`lib/agents/mistral.ts`), wired into `lib/agents/agents.ts`'s `launchFailed` check, gated per-family (`chosen === 'codex'` / `chosen === 'mistral'`) so `claude` and `custom` (opencode) are untouched.
4. **CP 4** — added regression tests proving genuine failures (no telemetry, or only stale/pre-existing telemetry) still reroute and blocklist exactly as before; ran the full suite to confirm no regressions.
5. **CP 5** (this document) — ran both mission gates on the final tree.

## Goal Check

| Goal Check | Evidence | Status |
|---|---|---|
| SC 1: repro test fails on mission parent commit | `test/task-1416-repro.test.js:67` and `:120` (added in CP 1); red run documented in `missions/task-1416/CP-1.md:18-25` | PASS |
| SC 2: codex accepted despite exit 1 | Test `codex exit 1 with real rollout telemetry is misclassified as a launch failure` at `test/task-1416-repro.test.js:67` asserts `result.agent === 'codex'`, `attempts === 1`, `blockCalls` empty; fix at `lib/agents/codex.ts:231-235` (`isSpuriousCodexExit`), wired at `lib/agents/agents.ts:955-961` | PASS |
| SC 3: mistral accepted despite exit 1 | Test `mistral exit 1 with real session telemetry is misclassified as a launch failure` at `test/task-1416-repro.test.js:120` asserts `result.agent === 'mistral'`, `attempts === 1`, `blockCalls` empty; fix at `lib/agents/mistral.ts:140-149,239-244` (`telemetryFresh`, `isSpuriousMistralExit`) | PASS |
| SC 4: genuine failures still reroute/block | Test `codex exit 1 with no telemetry still reroutes and blocklists (real-failure path unchanged)` at `test/task-1416-repro.test.js:182`; test `mistral exit 1 with only stale telemetry still reroutes and blocklists (real-failure path unchanged)` at `test/task-1416-repro.test.js:221` | PASS |
| SC 5: `custom`/opencode unregressed | `lib/agents/agents.ts:960-961` gates the new checks by agent name (`chosen === 'codex'` / `chosen === 'mistral'`); `test/agents.test.js` opencode/custom launch-failure tests (e.g. `hard launch failure (model not found) does not blocklist agent family`) pass unchanged | PASS |
| SC 6: static-analysis passes (lib/ changed) | `./scripts/verify-local.sh static-analysis` output: `=== Static Analysis Gate: ALL STAGES PASSED ===` (ESLint, tsc, test-hygiene) | PASS |
| SC 7: full verification passes | `./scripts/verify-local.sh all` exits `0`; `node --test` summary: `tests 2016 / pass 1994 / fail 0 / skipped 22` | PASS |

Next action: Mission complete — hand off for review. No further checkpoints required; all Gates and Success Criteria are satisfied with evidence above.
