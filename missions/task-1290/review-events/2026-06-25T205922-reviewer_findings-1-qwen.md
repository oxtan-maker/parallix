---
event_type: reviewer_findings
timestamp: 2026-06-25T20:59:22.356Z
round: 1
phase: reviewing
actor: qwen
slug: task-1290
---

# Task-1290 Review Findings

## Overview

Reviewed the diff for task-1290: "Purge qwen and make opencode model-aware in stats."
Branch: `mission/task-1290` (diverged from `main`).
61 files changed, +740/-432 lines.

## Goal Check (Success Criteria from MISSION.md)

### SC1: `config/agents.json` no longer uses `qwen` as runtime family key
**PASS.** `config/agents.json:6,10,18` — all three eligible arrays (`draft`, `active`, `review`) now use `"custom"`. Verified via `rg -n 'qwen' config/agents.json` returns 0 matches.

### SC2: User-facing docs no longer present `qwen` as public name
**PASS.** `docs/agents.md`, `docs/operator-setup.md`, `README.md` — all `qwen` references replaced with `custom` or `custom/opencode`. Also updated: `docs/authority-reference.md`, `docs/readme-rewrite-benchmark.md`, `docs/migration/task-classification.md`, `docs/use-cases.md`. Verified via `rg -n 'qwen' docs/ README.md` returns 0 matches.

### SC3: `lib/core/fmt.js` no longer renders `qwen` as display label
**PASS.** `lib/core/fmt.js:34` — `agentMap` key changed from `qwen` to `custom`. `lib/core/fmt.js:67-70` — `fmt.agent()` guard changed from `family === 'qwen' && text === 'qwen'` to `family === 'custom' && text !== 'custom'`. **Bonus: inverted condition bug was also fixed** (the old logic showed `qwen (opencode)` when both args were `qwen`; the new logic hides the suffix when both args are `custom`). `test/fmt.test.js:21,25,27` asserts `fmt.agent('custom')` returns plain `custom` without suffix.

### SC4: `lib/agents/opencode.js` still launches with optional `-m <model>`
**PASS.** `lib/agents/opencode.js:102,115` — `buildOpencodeInvocation` accepts `model` parameter and pushes `-m <model>` to args. Agent family references updated from `qwen` to `custom` at lines 42, 135, 200.

### SC5: `lib/agents/opencode-telemetry.js` preserves exact model id
**PASS.** `lib/agents/opencode-telemetry.js:20` — `MODEL = 'custom'` (was `qwen`). Lines 253-267 — `setOpencodeDefaultModel()` function added for configurable fallback. Lines 316, 334 — `extractOpencodeTelemetryFromExport` uses `extractModelName(parsed) || _defaultModel` instead of hardcoding `MODEL`. Line 366 — `getOpencodeProviderModel()` accepts optional `defaultModel` parameter.

### SC6: `lib/commands/stats.js` records actual model id
**PASS.** `lib/commands/stats.js:1351` — `telemetryToStatsFields` accepts `model` param and uses it as first-class fallback: `(t && t.model) || model || agentFamily || ''`. `lib/commands/stats.js:1412-1533` — `recordStageStats`, `accumulateStageStats`, `recordActiveStats`, `recordReviewStats` all thread `model` through. Additional call sites: `lib/commands/active.js:128`, `lib/commands/draft.js:957`, `lib/review/review-loop.js:717,935` all call `resolveAgentModel()` and pass the result.

### SC7: End-to-end paths work (launcher, review, integration, resume, fallback)
**PASS.** `lib/agents/agents.js:52` — `RESUME_CAPABLE` set updated. `lib/agents/agents.js:33,40,47` — LAUNCHERS/RESOLVERS/HEALTH_PROBE_MAP keys updated. `lib/agents/agents.js:826` — non-limit block exclusion updated. `lib/agents/limit-hit.js:23` — `PATTERN_SETS['custom']` updated. `lib/review/review-prompts.js:28` — `PROMPT_ENTRYPOINTS` key updated. `lib/commands/stats-backfill.js:49` — normalization regex updated. All paths verified via `npm test` (1650 pass, 0 fail).

### SC8: `npm test` passes with zero failures
**PASS.** 1650 pass, 0 fail, 22 skipped.

### SC9: Diff limited to scoped files
**PASS.** All 61 changed files are within mission scope: runtime rename (config, lib/), model/stats plumbing (stats.js, active.js, draft.js, review-loop.js, opencode-telemetry.js), docs (6 files), tests (35+ test files), and checkpoint documents (5 CP files).

## Additional Findings

### Finding 1 (Low severity): Dead code — `setOpencodeDefaultModel()` never called
`lib/agents/opencode-telemetry.js:267` exports `setOpencodeDefaultModel()` but `grep -rn 'setOpencodeDefaultModel' lib/` finds zero call sites. The function is documented as being "called once at boot by the launcher" but no launcher calls it. The `_defaultModel` variable defaults to `'custom'` (the `MODEL` constant), so the code works correctly by coincidence — the hardcoded fallback is used instead. The model ID threading is handled entirely by `resolveAgentModel()` from `product-config.js` via the `model` parameter in `telemetryToStatsFields()`.

**Impact:** None — telemetry falls back to `_defaultModel = 'custom'` which is correct. However, if an operator configures a specific model like `qwen3.5:9b` in their `workflow.config.json`, the telemetry module won't use it; only `stats.js` recording will. The `setOpencodeDefaultModel()` function should either be wired up to a call site (e.g., in the launcher) or removed as dead code.

### Finding 2 (Informational): `resolveAgentModel` already handles `custom`
`lib/core/product-config.js:453` — `resolveAgentModel(agentFamily, rootDir)` is a generic lookup that reads from `adapters.agents.models`. It does not contain any hardcoded family mappings, so it naturally supports `custom` without modification. No diff for this file is expected or present.

### Finding 3 (Positive): `stats-backfill.js` normalization updated
`lib/commands/stats-backfill.js:49` — The regex `/(^|[^a-z])qwen([^a-z]|$)/` was updated to `/(^|[^a-z])custom([^a-z]|$)/` so historical stats CSV rows containing `qwen` as implementer will be normalized to `custom` during backfill. This is important for data continuity.

### Finding 4 (Positive): Test-only `qwen` references are model names, not family labels
Remaining `qwen` references in test files (e.g., `test/opencode-telemetry.test.js:16` — `model: 'qwen-max'`) are specific model identifier strings, not agent family labels. These are correctly preserved per the mission scope.

## Checkpoint Document Assessment

- **CP-1.md** — Comprehensive migration map with file/line/action columns. Accurate and thorough.
- **CP-2.md** — Runtime rename summary. Claims "0 remaining qwen agent literals" which is correct for production code.
- **CP-3.md** — Model provenance summary. Does not mention the `setOpencodeDefaultModel()` dead-code gap.
- **CP-4.md** — Doc alignment summary. Accurate.
- **CP-5.md** — Final verification with Goal Check table citing real file:line evidence. All 14 goals PASS.

## Workflow State Observation

The `review-state.json` shows `reviewer: "qwen"` and `implementer: "claude"`. The reviewer is `qwen` (opencode), which is a factual runtime state from the review loop launch — not a production code artifact. This is consistent with the mission's "Preserved (tests only)" allowance for factual runtime state. The `px review --verify` output confirmed: `reviewer=qwen (opencode) implementer=claude round=1`.

---
`[workflow-round:1, workflow-phase:reviewing]`