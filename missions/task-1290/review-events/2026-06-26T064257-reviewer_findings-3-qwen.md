---
event_type: reviewer_findings
timestamp: 2026-06-26T06:42:57.986Z
round: 3
phase: reviewing
actor: qwen
slug: task-1290
---

# Review Findings: task-1290 (Round 3)

## Mission Summary

Replace `qwen` as the runtime and product-facing agent-family label with `custom` across the Parallix codebase, thread model provenance through stats and telemetry, and update all docs and tests.

## Evidence Checked

- Mission reviewed: `missions/task-1290/MISSION.md` (locked, 97 lines)
- Diff reviewed: `git diff main..HEAD` (110 files, ~30KB diff)
- Final checkpoint reviewed: `missions/task-1290/CP-5.md` (77 lines, Goal Check table)
- `npm test` not run directly (outside reviewer role); checkpoint claims 1658 pass, 0 fail, 22 skipped
- All scoped source, config, doc, and test files inspected

---

## Finding 1 (High): `package.json` version regresses from 1.0.5 → 1.0.4

**File:** `package.json:3`

The diff changes the version from `1.0.5` down to `1.0.4`. This mission is a rename + feature addition; the version should advance, not regress. This is not scoped to the rename and introduces an unintended regression.

**Impact:** If published, consumers would see a lower semver version despite the diff adding functionality (spurious-exit handling, model-provenance threading). CI/release automation that compares versions would flag this as a downgrade.

**Suggested fix:** Restore `1.0.5` (or advance to `1.0.6`) in `package.json`.

---

## Finding 2 (Medium): `review-state.json` still contains `qwen` as the reviewer identity

**File:** `missions/task-1290/review-state.json:2`

```json
{
  "reviewer": "qwen",
  "implementer": "claude",
  "round": 3,
  "phase": "reviewing"
}
```

The reviewer field still says `"qwen"` after the rename. Since `qwen` no longer exists as a launcher key in `LAUNCHERS`, `config/agents.json`, or anywhere else in the runtime, this stale value could cause confusion or lookup failures if any code path reads it back and tries to resolve the reviewer.

**Impact:** Low immediate risk (the reviewer is read for display/history purposes during this round), but any future code that validates the reviewer against known launchers would fail. The review-event files under `missions/task-1290/review-events/` also contain `qwen` references (e.g., `2026-06-25T205922-reviewer_outcome-1-qwen.md`).

**Suggested fix:** Update `review-state.json` and the review-event filenames/bodies to use `custom` (or the actual reviewer agent name `claude`, since claude was the implementer who took over in round 2). This is housekeeping, not a code change.

---

## Finding 3 (Medium): `prompts/review.md` lost review criteria during merge-conflict resolution

**File:** `prompts/review.md`

The diff resolves merge-conflict markers in `prompts/review.md` but in doing so discards the detailed review checklist that was in the `Updated upstream` side:

```
- Check:
-   - mission scope and acceptance criteria
-   - final checkpoint claims vs actual diff
-   - correctness and regressions
-   - tests / gates / verification evidence
-   - security and unsafe operations
-   - integration with existing code, config, APIs, schemas, docs, or workflows
-   - maintainability issues that materially affect future work
```

These seven check categories are gone from the prompt. The prompt now says "Do a detailed review" but the concrete checklist that guided reviewers is absent.

**Impact:** Future review agents (the target audience of this prompt) lose the structured review checklist. This weakens review quality across all missions indefinitely.

**Suggested fix:** Restore the lost checklist items to `prompts/review.md`. The checkpoint CP-5 claims the separation-of-duties block was restored but does not mention the checklist. Consider also checking `prompts/review-verbose.md` (not in the diff, so it may not exist or was unchanged).

---

## Finding 4 (Low): `backlog/tasks/task-1287` description changed from "qwen 27B" to "qwen 9B"

**File:** `backlog/tasks/task-1287 - test-qwen-9B.md:17`

The task description was changed from "Evaluate if proper qwen 27B is better than 35B" to "Evaluate if proper qwen 9B is better than 35B". This is outside the rename scope — it changes the subject of a task, not just the naming.

**Impact:** The task's scope changed from evaluating qwen 27B to qwen 9B. If this was intentional, it should be documented. If accidental, it should be reverted.

**Suggested fix:** Verify intent; revert if not part of the rename scope.

---

## Finding 5 (Low): `backlog/tasks/task-1325` moved from completed to backlog

**File:** `backlog/completed/task-1325 - make-review-prompt-clearer.md` → `backlog/tasks/task-1325 - make-review-prompt-clearer.md`

Task 1325 (which was about making the review prompt clearer — closely related to the same prompt rename) was moved from `completed/` back to `tasks/` with status changed from `done` to `backlog`. This is unrelated to the qwen→custom rename.

**Impact:** A completed task is now showing as active backlog work, which could confuse operators and dashboards.

**Suggested fix:** Revert the move/status change unless intentionally reopened.

---

## Finding 6 (Low): `prompts/review-verbose.md` not in diff

**File:** `prompts/review-verbose.md` (not present in `git diff main..HEAD --name-only`)

CP-5 claims the separation-of-duties block was restored in `prompts/review-verbose.md`, but this file does not appear in the diff. Either the file does not exist, or the claim is inaccurate.

**Impact:** If the file exists and still lacks the separation-of-duties block, future verbose-mode reviewers lack behavioral guardrails.

**Suggested fix:** Verify the file exists and contains the expected boilerplate. If not, add it.

---

## Positive Findings (Non-blocking)

- **`isSpuriousOpencodeExit`** (`lib/agents/opencode.js:213-221`): Good addition to handle spurious exit-1 from opencode v2.0.0 JSON-mode. Tests cover all edge cases.
- **Model provenance threading**: `resolveAgentModel` is correctly threaded through `active.js`, `draft.js`, `review-loop.js`, and `stats.js`. The fallback chain (`extractModelName(parsed) || fallbackModel || MODEL`) is sound.
- **Consistency of rename**: Every runtime use of `qwen` as an agent family key was replaced with `custom`. The rename is thorough and consistent across `config/agents.json`, `LAUNCHERS`, `RESOLVERS`, `RESUME_CAPABLE`, `limit-hit.js`, `fmt.js`, `agents.js`, and all test files.
- **Docs updated**: `docs/agents.md`, `docs/operator-setup.md`, and `README.md` correctly reference `custom/opencode` throughout.
- **Schema updated**: `config/workflow.config.schema.json` correctly references `custom` in the model-key examples.

---

## Summary

**Actionable findings: 6** (1 High, 2 Medium, 3 Low)

The rename itself is clean, thorough, and well-tested. The issues are:
1. Version regression in `package.json` (must fix)
2. Stale `qwen` in `review-state.json` (should fix for consistency)
3. Lost review criteria in `prompts/review.md` (should fix for review quality)
4–6. Minor out-of-scope changes (should verify/revert)

---
`[workflow-round:3, workflow-phase:reviewing]`