# CP-2: Rewrite the draft-time mission contract

## Summary

Reworked the mission-authoring path so the generated mission contract itself carries the checkpoint rules instead of leaving them as draft-agent inference. The draft prompt now requires the scaffolded checkpoint-documentation block to be filled with concrete instructions for a canonical `## Goal Check` section, the exact 3-column table shape, and the evidence forms that Parallix already verifies at handoff.

Updated the mission scaffold to encode the same rule set by default. It now lists file:line references, exact test names, test file paths, ADR references, and recognized repo commands/paths as accepted evidence forms, while calling out raw `stat`/`ls` output and generic prose as insufficient on their own.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Draft prompt now requires explicit checkpoint instructions in generated missions | `prompts/draft.md:28` | PASS |
| Draft prompt now lists the evidence forms Parallix already verifies, including recognized repo commands/paths | `prompts/draft.md:30` | PASS |
| Mission scaffold now ships the checkpoint requirements block with the canonical Goal Check heading and table shape | `templates/mission-scaffold.md:29` | PASS |
| Mission scaffold now includes a concrete Goal Check table example implementers can copy safely | `templates/mission-scaffold.md:41` | PASS |

Next action: Align the execute and repair-loop prompts with this same runtime-aligned evidence contract so implementers and autobounce retries operate from the same rules.
