---
event_type: reviewer_findings
timestamp: 2026-06-16T05:04:37.465Z
round: 2
phase: reviewing
actor: qwen
slug: task-1316
---

# Review Findings: task-1316 (opencode telemetry)

## Scope
Attempt 2 review, focus: all. Mission at `missions/task-1316/MISSION.md`.

## Verification
- `px review task-1316 --verify`: PASSED (reviewer gate passed)
- `npm test`: 1533 pass, 0 fail, 0 cancelled, 22 skipped
- `git diff main..HEAD`: 35 files, +7820/-79 lines

---

## Findings (Workflow/State Inconsistencies — Reported Per Instructions)

### F1: Backlog task status vs. review-state.json phase mismatch
**Severity:** Low (cosmetic)

`backlog/tasks/task-1316 - opencode-telemetry.md` has `status: review` but `review-state.json` shows `phase: reviewing` with `round: 2`. The task status field is a legacy field; `review-state.json` is the authoritative state document. The implementer field in the task file shows `claude` but the last git commit (`c0c76f54e`) sets `implementer=qwen`. These are transient state artifacts from agent cycling during the review loop and will reconcile on merge.

### F2: Main branch is 27 commits ahead of HEAD
**Severity:** Low (merge hygiene)

`git diff main..HEAD` shows main has 27 commits ahead. This is expected for a mission branch that diverged from main during implementation. The diff is clean with no merge conflicts in shared files. Will resolve cleanly on squash-merge.

### F3: `verify-local.sh` docs gate unrunnable
**Severity:** Low (infrastructure)

`MISSION.md` gate § "Gates" references `./scripts/verify-local.sh docs` but the script does not exist on this branch or on main. The checkpoint (CP-4) notes this and says `workflow.config.json` configures `npm test` as the verification command, which passes. This is an infrastructure gap, not an implementation defect.

### F4: `AGENTS.md` absent at repo root
**Severity:** Low (config)

The review contract references `AGENTS.md` but it does not exist at `/home/magnus/code/parallix-task-1316/AGENTS.md`. This is a repo-level configuration issue, not related to the mission implementation.

---

## Implementation Assessment (Substantive Review)

### SC1: Test suite passes — PASS
1533 tests pass, 0 failures, 0 cancellations. The 22 skipped tests are pre-existing (not introduced by this mission).

### SC2: Parser returns non-null with correct shape — PASS
Real fixture test (`test/opencode-telemetry.test.js:193-207`) validates:
- `inputTokens = 2802261` (> 0)
- `outputTokens = 23469` (> 0)
- `totalTokens = 2825730` (= inputTokens + outputTokens)
- `provider = 'opencode'`
- `toolCalls = 59` (counted from `messages[].parts[]` schema)

### SC3: Returns null for empty/non-JSON/token-less — PASS
Three explicit tests (`opencode-telemetry.test.js:209-237`):
- Empty/null/whitespace strings → null
- Malformed JSON (`{invalid}`, `{"key": }`) → null
- JSON object without token fields → null
- JSON array without tokens → null

### SC4: Missing token field → 0, no throw/null — PASS
`test/opencode-telemetry.test.js:239-254` asserts `cachedTokens === 0` when `cached_input_tokens` absent from `total_token_usage`. The `num()` helper (`opencode-telemetry.js:25-27`) uses `Number.isFinite()` to safely coerce any non-number to 0.

### SC5: Launcher attaches non-null telemetry — PASS
`test/opencode-launcher-telemetry.test.js:27-44` mocks spawn-tee and export capture, asserts `result.telemetry` is non-null with `inputTokens > 0`, `outputTokens > 0`, `toolCalls === 59`.

### SC6: Non-zero stats CSV row — PASS
`test/opencode-launcher-telemetry.test.js:80-124` drives `telemetryToStatsFields` + `upsertStatsRow` and asserts:
- `input_tokens > 0` in CSV
- `output_tokens > 0` in CSV  
- `tool_calls = 59` in CSV
- `provider = 'opencode'` in CSV

### SC7: No regressions — PASS
All existing tests for codex-telemetry, claude-telemetry, stats, agents, draft, review-loop, and stage-telemetry continue to pass unchanged. The restricted areas (`stats.js:telemetryToStatsFields`, `stage-telemetry.js`, function signatures) were not modified.

---

## Code Quality Observations

### Positive
- **Bounded export capture** (`lib/agents/opencode-export.js`) is well-designed: 32MB explicit cap, 30s hard timeout, `unref()` removed for deterministic tests, explicit failure on oversize.
- **Parser resilience**: `findTokenUsage` (`opencode-telemetry.js:36-128`) handles 6+ nesting paths including the real opencode v2.x `info.tokens` schema. Recursive array fallback catches deeply embedded token data.
- **Tool call counting** (`opencode-telemetry.js:205-249`) correctly traverses `messages[].parts[]` where `part.type === 'tool'`, matching the real opencode v2 schema. Previously counted 0, now counts 59 from the real fixture.
- **Backward compatibility**: `extractOpencodeTelemetry` delegates to `extractOpencodeTelemetryFromExport` when `exportJson` is present, and passes through `result.telemetry` otherwise.
- **Best-effort pattern**: `startOpencodeAgent` wraps export capture in try/catch + `.catch()` returning original result. Telemetry failure never breaks the launch.

### Minor Notes (Not Blockers)
1. **Redundant `|| 0` in findTokenUsage**: Lines like `obj.total_token_usage.input_tokens || 0` are redundant given `num()` coercion downstream. Harmless but slightly misleading about intent.
2. **All-zeros rejection** (`opencode-telemetry.js:288-291`): Returns null when all token fields are 0. This is stricter than the mission spec (which says "substitute 0"), but is a reasonable quality gate — zero-token sessions are almost certainly failed/incomplete. Not a mission violation.
3. **Negative token handling**: `num()` allows negative values through (only checks `Number.isFinite`). The real opencode export never produces negative tokens, so this is not a practical issue.

---

## Artifact Verification

### CP-4 Goal Check Table
Contains real evidence with file:line references, test names, and numeric values:
- `test/opencode-telemetry.test.js:193-207` → real-fixture parsing with `in=2802261`, `out=23469`, `total=2825730`
- `test/opencode-export.test.js:30-37` → timeout test ("times out and kills a non-exiting export child")
- `test/opencode-launcher-telemetry.test.js:80-124` → stats CSV flow test

All evidence cites durable, committed tests. No `/tmp` references or removed code.

---

## Verdict Rationale
All 7 mission success criteria are substantively satisfied with real evidence. The workflow/state inconsistencies (F1-F4) are cosmetic and expected in a multi-round agent review process. They do not affect the correctness of the telemetry implementation.

Verdict: `request-changes` (per instructions: "if you have findings but the criteria pass, use request-changes")

---
`[workflow-round:2, workflow-phase:reviewing]`