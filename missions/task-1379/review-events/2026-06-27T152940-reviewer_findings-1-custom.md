---
event_type: reviewer_findings
timestamp: 2026-06-27T15:29:40.323Z
round: 1
phase: reviewing
actor: custom
slug: task-1379
---

# Task-1379 Review Findings

## Mission

Replace agent-usage % size signal with Net Engineering Lines (NEL) bucket capture at handoff.

## Scope Compliance Issues

### F1 [HIGH]: Subagent-limit feature removal is out of scope

The mission scope explicitly states: "do not modify any ADR beyond 0032 and 0036" and the overall scope is limited to NEL estimation unit and data-recording mechanism. However, the diff removes the entire subagent-limit feature:

- **Deleted** `lib/core/subagent-limit.js` (28 lines) — the subagent-limit prompt injection module
- **Modified** `lib/agents/opencode.js` — removed `buildSubagentLimitPrefix` import and all `injectedPrompt` wiring (5 lines removed, 3 sites updated)
- **Removed** `subagents.maxParallel` from `workflow.config.json` (was `"subagents": { "maxParallel": 2 }`)
- **Removed** `adapters.agents.subagents` schema definition from `config/workflow.config.schema.json` (14 lines)
- **Deleted** entire `missions/task-1363/` directory — the entire mission that authored the subagent-limit feature, including MISSION.md, 3 checkpoint documents, review-state.json, and reviewer outcome file

This is not a NEL-related change. The subagent-limit feature was authored by task-1363, which had its own separate mission and review cycle. Removing it here conflates two distinct concerns and bypasses any review process that task-1363 may have warranted.

**Impact:** If the subagent-limit feature was intentional and approved, removing it here is a regression. If it was experimental and meant to be reverted, that should be a separate task with its own scope and rationale.

### F2 [MEDIUM]: Package version regression without NEL justification

`package.json` version changed from `1.1.1` to `1.1.0`. This is a version downgrade unrelated to NEL bucket capture. No explanation in the mission or diff connects this version change to the NEL scope.

### F3 [LOW]: Reviewer outcome file deletion is unexplained

`missions/task-1363/2026-06-27T151519-reviewer_outcome-1-unknown.md` was deleted as part of the task-1363 directory removal. While this is technically a consequence of F1, it deserves noting — a reviewer outcome artifact was destroyed without a separate review of that decision.

## Correctness Assessment

### NEL Computation Module (`lib/core/nels.js`)

- **Exclusion patterns:** All 9+ required patterns from ADR 0047 are implemented correctly at `nels.js:25-36`. The custom glob matcher at `nels.js:86-124` handles `*`, `**`, and `?` patterns correctly.
- **Bucket classification:** `classifyBucket()` at `nels.js:50-58` correctly implements Small (0-80), Medium (81-235), Large (235+) with boundary values matching ADR 0047 terciles.
- **Edge cases:** `computeNEL()` returns 0 for git errors, empty diffs, non-existent ranges, and binary files — all handled gracefully without throwing.
- **Pure function:** The module has no side effects, no I/O beyond the git subprocess, and no state mutation.

### Handoff Integration (`lib/commands/handoff.js`)

- NEL capture is inserted at Step 1.7 (`handoff.js:232-239`), after verification and rebase but before Forgejo PR creation — appropriate placement.
- `captureNelAtHandoff()` at `handoff.js:596-664` is purely observational: no conditional gates, no `if NEL > threshold then block/escalate` branches exist.
- The NEL record is persisted as `nel-record.json` in the mission directory with all required fields: `slug`, `predictedBucket`, `actualNel`, `actualBucket`, `reviewRounds`, `capturedAt`.
- Graceful degradation: if NEL computation fails, the handoff continues with a warning (`handoff.js:238`).

### ADR Updates

- **ADR 0032:** `Estimated agent % usage limit` replaced with `Predicted NEL bucket` at line 58. Interpretation rule and default activation guidance updated to reference NEL buckets. ADR 0047 cross-referenced in Links section.
- **ADR 0036:** Agent Budget column replaced with NEL Budget. "Too Large" thresholds restated in NEL bucket terms. ADR 0047 cross-referenced.

### Template Update

- `templates/mission-scaffold.md:10` now reads `- Predicted NEL bucket: Small (0–80) / Medium (81–235) / Large (235+)` — correct.
- No remaining "% usage limit" references in the template.

## Test Coverage

- **`test/nels.test.js`:** 27 tests covering:
  - 9 exclusion pattern tests (each exclusion category individually)
  - 6 bucket classification tests (boundary values for all 3 buckets)
  - 6 git diff integration tests (empty diff, included files, excluded paths, mixed changes, non-existent range, record structure)
  - 2 exclusion pattern regression tests
- **`test/handoff.test.js`:** 3 tests for `captureNelAtHandoff`:
  - Primary branch detection failure
  - NEL record persistence with correct fields
  - Predicted bucket extraction from MISSION.md

Both test files use Node's native `node:test` runner — no external test framework dependencies.

## Security Assessment

- No secrets, tokens, or credentials exposed in the diff.
- `nels.js` uses `spawnSync` (synchronous) for git — appropriate for handoff time, but the 50MB maxBuffer is reasonable.
- `nel-record.json` is written with `fs.writeFileSync` — no permission issues expected in the mission directory.
- The NEL function runs `git diff --numstat -w` with no user-controlled input — no injection risk.

## Maintainability

- NEL module is well-documented with JSDoc comments on all exported functions.
- Bucket constants are named (`BUCKET_SMALL_MAX`, `BUCKET_MEDIUM_MAX`) at module level for easy future tuning.
- Exclusion patterns are a single array constant — easy to audit and modify.
- The handoff NEL capture is a standalone function (`captureNelAtHandoff`) that can be unit-tested independently.

## Verification Evidence

- `npm test`: 1746 tests, 1724 pass, 0 fail, 22 skipped — all green.
- `./scripts/verify-local.sh docs`: PASS (as claimed in CP-5).
- Final checkpoint `missions/task-1379/CP-5.md` contains a comprehensive Goal Check table with 22 evidence rows, all marked PASS, citing specific file:line references.

## Summary of Findings

| ID | Severity | Description |
|----|----------|-------------|
| F1 | HIGH | Subagent-limit feature removal is entirely out of scope for task-1379 |
| F2 | MEDIUM | Package version downgrade (1.1.1 → 1.1.0) without NEL justification |
| F3 | LOW | Reviewer outcome artifact destroyed as part of task-1363 cleanup |

All NEL-specific success criteria (SC1, SC2, SC3, SC4, SC5, SC6, SC7) are satisfied. SC8 (npm test passes) is confirmed. The NEL implementation is correct, well-tested, and safe to integrate on its own merits.

However, the out-of-scope removal of the subagent-limit feature (F1) and the unexplained version regression (F2) prevent approval of this diff as-is.

---
`[workflow-round:1, workflow-phase:reviewing]`