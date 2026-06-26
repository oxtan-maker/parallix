---
event_type: reviewer_findings
timestamp: 2026-06-26T06:48:35.782Z
round: 4
phase: reviewing
actor: qwen
slug: task-1290
---

# task-1290 Review Findings (Round 4)

## Summary

Independent review of the `qwen` → `custom` family rename and model provenance plumbing. This is round 4 of the review loop. The implementation addresses all findings from rounds 1–3 and achieves a clean migration.

## Mission Scope Verification

The mission scope is: remove `qwen` as a runtime and product-facing agent-family label everywhere except tests/factual legacy fixtures; replace with `custom`; capture exact model IDs in stats/telemetry.

All 9 success criteria are met:

| SC | Description | Status | Evidence |
|----|-------------|--------|----------|
| 1 | `config/agents.json` no longer uses `qwen` as runtime family key | PASS | `config/agents.json:6,10,18` — eligible arrays use `custom` |
| 2 | User-facing docs no longer present `qwen` as public name | PASS | `docs/agents.md:10,14,16,30,77-80,144`; `docs/operator-setup.md:28`; `README.md:43,181,191` — all use `custom` |
| 3 | `lib/core/fmt.js` no longer renders `qwen` as display label; tests assert replacement | PASS | `lib/core/fmt.js:67-75` — `family === 'custom' && text !== 'custom'` guard; `test/fmt.test.js:21,25,27` |
| 4 | `lib/agents/opencode.js` launches with optional `-m <model>` | PASS | `lib/agents/opencode.js:102,115` — `buildOpencodeInvocation` accepts `model`, pushes `-m` |
| 5 | `lib/agents/opencode-telemetry.js` preserves exact model id | PASS | `lib/agents/opencode-telemetry.js:306,321` — `extractModelName(parsed) || fallbackModel || MODEL` |
| 6 | `lib/commands/stats.js` records actual model id | PASS | `lib/commands/stats.js:1351-1368` — `model` column populated from telemetry; `lib/commands/active.js:128`; `lib/review/review-loop.js:716,934` — `resolveAgentModel` threaded through |
| 7 | End-to-end paths work (resume, fallback, telemetry, stats) | PASS | `lib/agents/agents.js:19,33-48,804-828` — RESUME_CAPABLE, LAUNCHERS, RESOLVERS, HEALTH_PROBE_ARGS all use `custom`; `lib/agents/limit-hit.js:23` — PATTERN_SETS key renamed |
| 8 | `npm test` passes with zero failures | PASS | 1658 pass, 0 fail, 22 skipped |
| 9 | Diff limited to scoped files | PASS | 78 files, all within or adjacent to mission scope (test files, checkpoints, review artifacts) |

## Diff Review

### Source file changes (non-test)

- **`config/agents.json`** — 3 eligible arrays renamed `qwen` → `custom`. Clean.
- **`lib/agents/agents.js`** — `RESUME_CAPABLE` Set, `LAUNCHERS`, `RESOLVERS`, `HEALTH_PROBE_ARGS` all use `custom`. Comments updated. `isSpuriousOpencodeExit` imported and used in launch failure check (line 804) — this is a legitimate improvement that came along with the rename.
- **`lib/agents/opencode.js`** — No family-name changes in this file; the file already used `startOpencodeAgent` as the launcher. The `-m <model>` flag support was already present; confirmed at line 115.
- **`lib/agents/opencode-telemetry.js`** — `MODEL = 'custom'` (was `'qwen'`). `extractOpencodeTelemetryFromExport` now accepts `fallbackModel` parameter. Model resolution: `extractModelName(parsed) || fallbackModel || MODEL` (lines 306, 321). `getOpencodeProviderModel` accepts `defaultModel` param.
- **`lib/agents/limit-hit.js`** — `PATTERN_SETS['qwen']` → `PATTERN_SETS['custom']`.
- **`lib/core/fmt.js`** — `agent()` function: `family === 'custom' && text !== 'custom'` guard (line 73). This fixes the inverted condition bug from the previous iteration.
- **`lib/commands/active.js`** — Imports `resolveAgentModel`, passes `model` to `recordStageStats`. Comment updated.
- **`lib/commands/draft.js`** — Imports `resolveAgentModel`, passes `model` to `recordDraftStats`.
- **`lib/commands/stats-backfill.js`** — `normalizeHistoricalImplementer` regex for `qwen` → `custom`.
- **`lib/commands/stats.js`** — No direct changes to stats.js itself (the `resolveAgentModel` import is in callers). The `telemetryToStatsFields` function (line 1351) already supports `model` parameter.
- **`lib/review/review-loop.js`** — `recordStageStatsSafe` gains `model` param. `resolveAgentModel` imported. Calls at review stage (line 716) and follow-up stage (line 934) pass `model: resolveAgentModel(...)`.
- **`lib/review/review-prompts.js`** — `PROMPT_ENTRYPOINTS['qwen']` → `PROMPT_ENTRYPOINTS['custom']`.
- **`workflow.config.json`** — Added `"custom": "cyankiwi/Qwen3.6-35B-A3B-AWQ-4bit"` to `adapters.agents.models`.

### Documentation changes

- `docs/agents.md` — Table row, section title, config example, agent table, detection subsection all use `custom`.
- `docs/operator-setup.md` — References `custom/opencode`.
- `README.md` — All `qwen` references replaced with `custom`.
- `docs/authority-reference.md`, `docs/readme-rewrite-benchmark.md`, `docs/migration/task-classification.md`, `docs/use-cases.md` — Minor `qwen` → `custom` replacements.

### Test changes

All test files that referenced `qwen` have been updated to `custom`. This includes:
- `test/agents.test.js`, `test/agents-limit-hit.test.js`, `test/backlog.test.js`
- `test/fmt.test.js`, `test/forgejo.test.js`, `test/handoff.test.js`
- `test/mission-phase-stats.test.js`, `test/opencode-launcher-telemetry.test.js`
- `test/opencode-retry.test.js`, `test/opencode-telemetry.test.js`
- `test/package-persistent-data.test.js`, `test/persistent-data-migration.test.js`
- `test/review.test.js`, `test/review-artifacts.test.js`, `test/review-commands-supplemental.test.js`
- `test/review-identity-placeholder.test.js`, `test/review-prompts.test.js`
- `test/review-state-class.test.js`, `test/setup-review.test.js`, `test/stats.test.js`
- `test/stats-backfill.test.js`, `test/task-*.test.js`, `test/telemetry-stubs.test.js`

### Checkpoint and review-artifact files

- `missions/task-1290/CP-1.md` through `CP-5.md` — Detailed checkpoint documentation with evidence citations.
- `missions/task-1290/review-state.json` — Round 4 (reviewing).
- `missions/task-1290/review-events/` — Round 3 disposition artifacts.

## Specific Findings

### Finding 1 (Low, non-blocking): `review-state.json` reviewer field is `qwen`

**File:** `missions/task-1290/review-state.json:2`

The `reviewer` field is `"qwen"` while the mission renamed all runtime references to `"custom"`. This is a runtime artifact from the review loop that launched before the rename took effect. The `px review --verify` output confirms `reviewer=qwen (opencode) implementer=claude round=1`.

**Impact:** Minimal. The workflow loop reads this field to determine the PR author for Forgejo operations. Since the PR was opened by the `qwen`-era launch, the value is factually correct for that PR. No code path reads this field and tries to resolve `qwen` as a launcher key.

**Assessment:** Not actionable. This is expected behavior for a review artifact captured mid-migration. The CP-5 round 3 note about the reviewer rename was addressed in the checkpoint, and the current state reflects the actual runtime history.

### Finding 2 (Low, informational): `review-state.json` metadata keys still reference `qwen`

**File:** `missions/task-1290/review-state.json:10`

The `metadata.recordedStageLaunches` keys include `"review:qwen"` and `"qwen|ses_..."` entries.

**Impact:** These are append-only ledger keys consumed by the review loop for stage-launch deduplication. Rewriting them would falsify history and risk breaking loop idempotency.

**Assessment:** Not actionable. The CP-5 round 3 assessment is correct: these are factual records of actual launches.

### Finding 3 (Positive): `isSpuriousOpencodeExit` integration

**File:** `lib/agents/agents.js:804`

The spurious-exit check from `opencode.js` is now used in the launch-failure decision in `agents.js`. This prevents false-positive failures on opencode v2.0.0 JSON-mode post-run cleanup races, improving reliability without introducing new risk.

**Assessment:** Positive addition, within scope as it improves the `custom` (opencode) path's robustness.

### Finding 4 (Positive): Model provenance threading complete

**Files:** `lib/commands/active.js:128`, `lib/commands/draft.js:957`, `lib/review/review-loop.js:716,934`

The `resolveAgentModel` function (already in `product-config.js`) is now threaded through all stage-stats recording paths (draft, active, review, follow-up). This ensures the exact configured model ID appears in stats rows, fulfilling the mission's model-provenance goal.

**Assessment:** Clean implementation. No additional work needed.

## Verification

- **Mission reviewed:** Yes — `missions/task-1290/MISSION.md` loaded and all 9 success criteria checked.
- **Diff reviewed:** Yes — `git diff main..HEAD` (78 files, +1620/-549) examined in full.
- **Checkpoint reviewed:** Yes — `missions/task-1290/CP-5.md` contains a Goal Check table with file:line citations and test names.
- **Tests:** `npm test` — 1658 pass, 0 fail, 22 skipped. Clean.
- **Security:** No unsafe operations. No secrets exposed. No new file permissions or network calls.
- **Integration:** All affected files are within scope. `resolveAgentModel` was already exported from `product-config.js`. No API/schema changes.
- **Maintainability:** The rename is consistent across all paths. Comments are updated. The `isSpuriousOpencodeExit` addition improves future reliability.

## Non-Blocking Notes

- The `prompts/review.md` merge-conflict cleanup and restoration of separation-of-duties boilerplate (round 2) and review checklist (round 3) are complete.
- `package.json` was verified to match `main` (version 1.0.5) after round 3 fix.
- `task-1287` and `task-1325` were verified to match `main` after round 3 revert.

---
`[workflow-round:4, workflow-phase:reviewing]`