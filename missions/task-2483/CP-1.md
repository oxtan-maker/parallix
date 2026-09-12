# CP-1: `buildCompletedControlsBlock`

## Summary

Added `buildCompletedControlsBlock(missionPath, repoRoot)` to
`src/adapters/review/review-prompts.ts` (no new module, so no architecture
boundary is crossed). The block is derived only from machine records, never
from agent prose (ADR 0048):

- the mission's `.workflow/gate-result.json` (`GATE_RESULT_RELATIVE_PATH`,
  read through a throw-free helper so a missing or corrupt artifact degrades),
  rendering `command`, `status`, `exitCode`, and `recordedAt`;
- the repository's configured `adapters.gates` `preHandoff` / `preReview`
  commands via `loadRepositoryGates`, each printed with its phase key;
- the command lines parsed from the mission `MISSION.md` `## Gates` checklist;
- a one-line statement that handoff already validated every checkpoint Goal
  Check table for structure and evidence references;
- a red-to-green reproduction line emitted only when `MISSION.md` carries a
  `Reproduction-Test:` line.

Pass/fail is derived from `exitCode === 0` alone, so a record whose `status`
field disagrees with its exit code is reported as failed. A control is never
reported as executed merely because it is configured — `preIntegration` gates
are deliberately excluded, because they have not run at review time.

Budget is enforced by construction: one line per control family, command
strings truncated at `CONTROL_COMMAND_MAX` (60 chars), exported caps
`COMPLETED_CONTROLS_MAX_LINES` (12) and `COMPLETED_CONTROLS_MAX_CHARS` (900)
asserted by every test. With no gate record, no configured gates and no
mission gates, the block is exactly one non-blank line granting permission to
run a verification command.

The `{{completedControls}}` substitution is also wired into
`buildCompactReviewPrompt`; the placeholder itself lands in
`prompts/review-core.md` in CP-2.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC2: passing record renders command, status, exitCode, recordedAt | `"task-2483: a recorded passing gate renders its command, status, exit code and timestamp (SC2)"` in `test/task-2483-completed-controls.test.ts` | PASS |
| SC2 (fail-closed half, ADR 0048): a failing record is never rendered as passed | `"task-2483: a recorded failing gate is never reported as passed (ADR 0048)"` in `test/task-2483-completed-controls.test.ts` | PASS |
| SC3: configured `adapters.gates` render with phase keys | `"task-2483: configured preHandoff and preReview gates render with their phase key (SC3)"` in `test/task-2483-completed-controls.test.ts` | PASS |
| SC4: every mission `## Gates` command appears | `"task-2483: every mission \`## Gates\` command line appears in the block (SC4)"` in `test/task-2483-completed-controls.test.ts` | PASS |
| SC5: empty case degrades to one non-blank line | `"task-2483: no gate record, no configured gates and no mission gates degrade to one line (SC5)"` and `"task-2483: an unreadable gate-result artifact degrades instead of throwing"` in `test/task-2483-completed-controls.test.ts` | PASS |
| SC6: ≤12 non-blank lines and ≤900 characters, including the populated case | `"task-2483: the fully-populated block stays within 12 non-blank lines and 900 characters (SC6)"` and `"task-2483: a long gate command is truncated rather than blowing the character budget"` in `test/task-2483-completed-controls.test.ts` | PASS |
| SC7: reproduction line iff `Reproduction-Test:` present | `"task-2483: the reproduction-gate line appears only when MISSION.md declares Reproduction-Test (SC7)"` in `test/task-2483-completed-controls.test.ts` | PASS |
| CP-1 suite green | `npx tsx --test test/task-2483-completed-controls.test.ts` — pass 9, fail 0 | PASS |
| Types clean on changed files | `npm run typecheck` exits 0 | PASS |
| SC1, SC8–SC12 | Deferred to CP-2 (`prompts/review-core.md`, `test/fixtures/prompt-split-parent.json`, `docs/config.md`, `./scripts/verify-local.sh all`) | DEFERRED |

Next action: CP-2 — replace the vague verification sentence in `prompts/review-core.md` with the `{{completedControls}}` placeholder plus the explicit do-not-re-run rule (SC1, SC8), regenerate only the `review` entry of `test/fixtures/prompt-split-parent.json` (SC9), document the placeholder in the `docs/config.md` Prompts section (SC11), restore the prompt-level substitution test from `/tmp/task-2483-cp2-test.txt`, and run `./scripts/verify-local.sh all` (SC12).
