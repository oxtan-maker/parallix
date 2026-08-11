# CP-1: Prompt and scaffold evidence guidance

Updated execution, review, and drafting prompts plus the mission scaffold to lead with durable evidence: rerunnable commands, test names, ADR references, and test file paths. File:line remains accepted only as a discouraged fallback, and the scaffold’s worked Goal Check example no longer contains a line number.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Prompt templates lead with stale-proof evidence forms | `prompts/execute.md`, `prompts/review.md`, `prompts/draft.md` | PASS |
| Mission scaffold avoids line-number worked examples | `templates/mission-scaffold.md` | PASS |
| Edited prompt/template markdown is structurally clean | `git diff --check` | PASS |

Next action: Update runtime handoff, review, gatekeeper, repair, active-command, and domain guidance without altering evidence-validator acceptance logic.
