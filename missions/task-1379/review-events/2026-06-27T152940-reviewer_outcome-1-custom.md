---
event_type: reviewer_outcome
timestamp: 2026-06-27T15:29:40.324Z
round: 1
phase: reviewing
actor: custom
slug: task-1379
verdict: request-changes
---

# Task-1379 Review Outcome

## Review Scope

- Mission: Replace agent-usage % size signal with Net Engineering Lines (NEL) bucket capture at handoff
- Attempt: 1
- Reviewer: Independent senior engineer (review-only mode)
- Entrypoint: Review all changes in `git diff main..HEAD`

## Verification

All NEL-specific success criteria verified against actual diff:

- **SC1:** TEMPLATE UPDATED — `templates/mission-scaffold.md:10` contains NEL bucket text; no "% usage limit" remains. PASS
- **SC2:** NEL FUNCTION EXISTS — `lib/core/nels.js` exports `computeNEL`, `computeNELRecord`, `classifyBucket`, `isExcluded`; accepts git diff range at `nels.js:119`. PASS
- **SC3:** EXCLUSIONS CORRECT — All 9+ ADR 0047 exclusion patterns implemented; 27 unit tests cover inclusion, exclusion, and edge cases. PASS
- **SC4:** HANDOFF CAPTURE WIRED — `captureNelAtHandoff()` at `handoff.js:596-664` computes NEL from merge diff and persists `nel-record.json` with all 4 required fields. PASS
- **SC5:** NO ENFORCEMENT — Zero `if NEL > threshold then block/escalate` branches exist in handoff flow. PASS
- **SC6:** ADR 0032 UPDATED — "% usage limit" replaced with NEL bucket; ADR 0047 cross-referenced. PASS
- **SC7:** ADR 0036 UPDATED — Agent Budget → NEL Budget; "Too Large" restated in NEL terms; ADR 0047 cross-referenced. PASS
- **SC8:** TESTS PASS — `npm test`: 1746 tests, 1724 pass, 0 fail, 22 skipped. PASS

## Findings

Three findings identified (see `/tmp/task-1379-review-findings.md` for full details):

1. **F1 [HIGH]:** Out-of-scope removal of subagent-limit feature (task-1363's entire codebase, config, and schema) — not part of NEL scope
2. **F2 [MEDIUM]:** Unexplained package.json version downgrade from 1.1.1 to 1.1.0
3. **F3 [LOW]:** Reviewer outcome artifact from task-1363 destroyed without separate review

## Verdict

### request-changes

The NEL implementation itself (SC1-SC8) is correct, well-tested, and safe to integrate. However, the diff contains significant out-of-scope changes — specifically the complete removal of the subagent-limit feature and task-1363 mission — that violate the mission's restricted areas and scope boundaries. These changes should be separated into their own task with proper scope definition and review.

Actions required before re-submission:
1. Separate the subagent-limit removal into its own task with explicit scope and rationale
2. Explain or revert the package.json version downgrade
3. Re-submit with only NEL-related changes

---
`[workflow-round:1, workflow-phase:reviewing]`