# CP-1: Prompt Template Rewritten

## Work Done

Verified `prompts/draft.md` meets all success criteria:

- The ambiguous `Mode: draft. No execution.` header has been replaced with: `Mode: draft. Do not implement the mission — produce the mission contract document only.` (line 1)
- Explicit "Allowed actions" section at lines 8-12 covering:
  - read files (backlog task, MISSION.md scaffold, graphify index)
  - write/edit files (MISSION.md, backlog task labels)
  - run graphify queries and updates
  - run `{{verifyCmd}}` to verify the draft
- Explicit "Forbidden actions" section at lines 14-18 covering:
  - implement any feature or fix described in the mission
  - modify source code outside MISSION.md and the backlog task file
  - run tests beyond the single `{{verifyCmd}}` gate
  - start a review, execute, or integrate phase

## Goal Check

| Goal Check | Evidence | Status |
|---|---|---|
| `Mode: draft. No execution.` removed from prompt | `grep -n "Mode: draft. No execution" prompts/draft.md` returns no matches — verified at 2026-06-25 | PASS |
| Prompt header replaced with unambiguous directive | `prompts/draft.md:1` — `Mode: draft. Do not implement the mission — produce the mission contract document only.` | PASS |
| "Allowed actions" section present | `prompts/draft.md:8` — `Allowed actions:` | PASS |
| "Forbidden actions" section present | `prompts/draft.md:14` — `Forbidden actions:` | PASS |
| Allowed: read files | `prompts/draft.md:9` — `read files (backlog task, MISSION.md scaffold, graphify index if present)` | PASS |
| Allowed: write/edit files | `prompts/draft.md:10` — `write/edit files (MISSION.md, backlog task labels)` | PASS |
| Allowed: graphify queries/updates | `prompts/draft.md:11` — `run graphify queries and updates` | PASS |
| Allowed: verification gate | `prompts/draft.md:12` — `run {{verifyCmd}} to verify the draft` | PASS |
| Forbidden: implement features | `prompts/draft.md:15` — `implement any feature or fix described in the mission` | PASS |
| Forbidden: modify source code | `prompts/draft.md:16` — `modify source code outside MISSION.md and the backlog task file` | PASS |
| Forbidden: run extra tests | `prompts/draft.md:17` — `run tests beyond the single {{verifyCmd}} gate` | PASS |
| Forbidden: start other phases | `prompts/draft.md:18` — `start a review, execute, or integrate phase` | PASS |

## Next action: CP-2 — verify backlog task label is ai_sdlc
