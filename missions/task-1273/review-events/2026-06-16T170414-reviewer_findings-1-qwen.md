---
event_type: reviewer_findings
timestamp: 2026-06-16T17:04:14.753Z
round: 1
phase: reviewing
actor: qwen
slug: task-1273
---

# Task-1273 Review Findings

## Scope

Review of `mission/task-1273` (round 1) — all deliverables: `lib/agents/opencode.js`, `test/opencode-retry.test.js`, `missions/task-1273/{MISSION,CP-1,CP-2,CP-3}.md`, backlog task, `review-state.json`.

## Findings

### F1 — Classification logic is sound and correctly ordered (no issue)

`shouldRetryOpencodeFailure` (`lib/agents/opencode.js:111-132`) short-circuits in the correct priority order:
1. Null check → no retry
2. ENOENT/EACCES spawn errors → no retry
3. Killing signal → no retry
4. Non-zero exit code required → no retry on clean exits
5. `detectLimitHit(agent='qwen')` → no retry (agents.js owns limit-accounting)
6. `isHardOpencodeFailure` → no retry (model-not-found, auth)
7. `isTransientOpencodeFailure` → final decision

The gate correctly excludes limit-hits (via `detectLimitHit` at line 120-127) and hard errors (line 129) before reaching the transient check (line 131). A clean exit with transient text in logs is excluded by the `status !== 0` check at line 118.

### F2 — Bounded retry loop is correctly capped (no issue)

`runWithRetry` (`lib/agents/opencode.js:142-151`) uses a `while (attempts < maxTransientRetries && shouldRetryOpencodeFailure(result))` loop. With `maxTransientRetries = 1` (default), the loop executes at most once additional iteration. `result.transientRetries` is set to the actual attempt count (line 149). No infinite-loop risk.

### F3 — Telemetry isolation confirmed intact (no issue)

The telemetry chain (`lib/agents/opencode.js:153-185`) wraps `_captureExport(...).then(...).catch(...)` in a `.catch(() => result)` at line 176, with an outer `try/catch` at line 180-182. Even if `_captureExport` throws synchronously or rejects, the original `result` is returned unchanged. `captureOpencodeExport` (`lib/agents/opencode-export.js:30-108`) never rejects — it resolves to `null` on any error. Two tests lock this invariant.

### F4 — Test coverage is adequate but has a minor gap

**Covered (10 test blocks):**
- Classification: transient (5 stderr variants), clean exit, hard errors (model-not-found, ENOENT, EACCES), limit-hit, signal
- Bounded retry: transient→success (2 spawns), persistent-transient (2 spawns, failure surfaces), hard-error (1 spawn)
- Telemetry: throwing export, rejecting export

**Gap:** `isTransientOpencodeFailure` and `isHardOpencodeFailure` are exported but only tested indirectly through `shouldRetryOpencodeFailure`. Direct unit tests for these two functions would strengthen coverage. Not blocking — the indirect tests exercise the same paths.

### F5 — `detectLimitHit` coupling is intentional, not a bug (no issue)

`shouldRetryOpencodeFailure` imports `detectLimitHit` and calls it with `agent: 'qwen'` (line 120-127). This hardcodes the agent type, but `shouldRetryOpencodeFailure` is only called from within `startOpencodeAgent`, which is opencode-specific. The coupling is deliberate and scoped correctly.

### F6 — Backward compatibility of `startOpencodeAgent` signature (no issue)

`startOpencodeAgent` gained `maxTransientRetries = 1` as an optional trailing parameter in the destructured arg object. Existing callers pass `{ prompt, worktree, env, resume, sessionId, model, teeOptions }` — none pass `maxTransientRetries`, so they get the default of 1. No breaking change.

### F7 — Restricted areas honored (no issue)

`git diff` confirms zero changes to `lib/agents/codex.js`, `lib/agents/claude.js`, `lib/agents/mistral.js`, or `lib/agents/agents.js`. Only `lib/agents/opencode.js` was modified (plus the new test file and mission artifacts).

### F8 — Workflow state is consistent (no issue)

- `review-state.json`: `phase: "reviewing"`, `round: 1`, `disposition: null`, `reviewer: mistral`, `implementer: claude`
- Backlog task: `status: review`, `assignee: [claude]`
- Reviewer (mistral) ≠ implementer (claude) — correct segregation
- Commit `49b12df1f` set phase to "reviewing" [mistral -> claude] — consistent

### F9 — CP-3 Goal Check table cites verifiable evidence (no issue)

All 6 success criteria in `CP-3.md:27-34` reference real file:line coordinates and test names that exist:
- SC1: `CP-1.md`, `agents.js:801-823`, `limit-hit.js:25-29`, `spawn-tee.js:161-168` — all verified
- SC2: `opencode.js:107`, test names match `test/opencode-retry.test.js` lines 17, 54
- SC3: `opencode.js:147-166`, `opencode-export.js:18-19,39`, test names at lines 103, 114
- SC4: `opencode.js:142-150`, test names at lines 71, 86, 43, 48
- SC5: `task-1273 - qwen-draft-bug.md:8-9` — labels frontmatter confirmed
- SC6: `npm test` → 1566 pass / 0 fail / 22 skipped — confirmed by `px review --verify`

### F10 — Label is exactly `["ai_sdlc"]` (no issue)

Backlog task frontmatter at `task-1273 - qwen-draft-bug.md:8-9` contains:
```yaml
labels:
  - ai_sdlc
```
Exactly one label, value `ai_sdlc`. Assignee field `[claude]` was not modified.

## Summary

No blocking findings. The implementation correctly diagnoses the root cause (transient backend errors misclassified as generic launch failures with no in-family retry) and applies a minimal, bounded fix inside the opencode launcher only. All 6 success criteria are met, tests pass, restricted areas are honored, and the checkpoint documents contain real evidence.

Minor improvement suggested: add direct unit tests for the exported `isTransientOpencodeFailure` and `isHardOpencodeFailure` functions (F4).

---
`[workflow-round:1, workflow-phase:reviewing]`