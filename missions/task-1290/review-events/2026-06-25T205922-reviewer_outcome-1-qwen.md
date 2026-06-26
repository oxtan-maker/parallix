---
event_type: reviewer_outcome
timestamp: 2026-06-25T20:59:22.357Z
round: 1
phase: reviewing
actor: qwen
slug: task-1290
verdict: request-changes
---

# Task-1290 Review Outcome

## Mission
Purge `qwen` as a runtime and product-facing agent-family label; replace with `custom`; make exact model IDs capturable in stats for opencode runs.

## Verification
- `px review task-1290 --verify`: PASSED (1650 tests, 0 failures, 22 skipped)
- `npm test`: PASSED (1650 pass, 0 fail, 22 skipped)
- `git diff main..HEAD`: 61 files, +740/-432 lines
- `rg 'qwen' lib/ config/ docs/ README.md`: 0 matches in production code

## Success Criteria Assessment

| # | Criterion | Result |
|---|-----------|--------|
| 1 | `config/agents.json` no longer uses `qwen` | PASS |
| 2 | User-facing docs no longer present `qwen` | PASS |
| 3 | `fmt.js` no longer renders `qwen`; tests assert replacement | PASS |
| 4 | `opencode.js` launches with optional `-m <model>` | PASS |
| 5 | `opencode-telemetry.js` preserves exact model id | PASS |
| 6 | `stats.js` records actual model id | PASS |
| 7 | End-to-end paths work (resume, fallback, telemetry, stats) | PASS |
| 8 | `npm test` passes zero failures | PASS |
| 9 | Diff limited to scoped files | PASS |

All 9 success criteria pass.

## Findings Summary

1. **Low: Dead code — `setOpencodeDefaultModel()` never called.** The function is exported from `opencode-telemetry.js` but has zero call sites in `lib/`. Telemetry correctly falls back to `_defaultModel = 'custom'` (hardcoded), and model ID threading is handled by `resolveAgentModel()` via `stats.js` params. Recommendation: wire the function to a launcher call site or remove it.

2. **Positive: `fmt.agent()` inverted condition bug fixed.** The old logic (`family === 'qwen' && text === 'qwen'`) would show `qwen (opencode)` when both args matched — the opposite of the intended behavior. New logic (`family === 'custom' && text !== 'custom'`) correctly hides the suffix when both are `'custom'`.

3. **Positive: `stats-backfill.js` normalization updated.** Historical CSV rows with `qwen` implementer will normalize to `custom` during backfill, preserving data continuity.

4. **Test-only `qwen` references are model names.** Strings like `qwen-max`, `qwen3.5:9b` in test fixtures are specific model identifiers, not agent family labels. Correctly preserved.

## Verdict

**request-changes**

All 9 success criteria pass and the migration is substantively complete. The sole finding (dead code `setOpencodeDefaultModel()`) is low-severity and does not prevent approval, but it warrants a follow-up cleanup to either wire the function to a call site or remove it. The reviewer is asked to address this before final sign-off.

---
`[workflow-round:1, workflow-phase:reviewing]`