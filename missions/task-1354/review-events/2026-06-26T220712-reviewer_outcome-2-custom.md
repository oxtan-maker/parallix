---
event_type: reviewer_outcome
timestamp: 2026-06-26T22:07:12.743Z
round: 2
phase: reviewing
actor: custom
slug: task-1354
verdict: request-changes
---

# Task-1354 Review Outcome (Round 2)

## Review Summary

Independent senior-engineer review of mission task-1354: "regression-test-first lock-the-bug for bug-labeled missions"

## Scope Compliance Assessment

The locked MISSION.md specifies a precise architecture:
1. Shared `getTaskLabels` primitive consumed by both `getTaskClassification` and `hasBugLabel`
2. Generic `## Gates` runner that parses mission-declared gates (no bug-specific code)
3. Reusable `px verify-repro` CLI command (mission-agnostic, no bug branching)
4. `prompts/execute.md` left UNCHANGED — repro-before-fix lives only in drafted MISSION.md
5. NO `verifyRedGreenProof` in gatekeeper.js
6. NO bug-specific steps in handoff.js

The diff delivers NONE of items 2-5 and partially delivers item 1.

## Violations of Explicit Constraints

| Constraint (MISSION.md line) | Actual | Severity |
|------------------------------|--------|----------|
| Line 40: execute.md "No change" | Modified (+6 lines) | BLOCKING |
| Line 50: "no verifyRedGreenProof" | 173 lines added to gatekeeper.js | BLOCKING |
| Line 67: "no bug-specific gate function" | verifyRedGreenProof added | BLOCKING |
| Line 122: "Do not modify execute.md at all" | Modified | BLOCKING |
| Line 123: "no bug branch in gatekeeper.js" | Bug branch present | BLOCKING |
| Line 29: "shared label-parsing primitive" | Duplicated parsing code | HIGH |
| Line 42-43: "generic ## Gates runner" | Hardcoded verifyRedGreenProof call | BLOCKING |
| Line 44-50: "generic red→green proof command" | No CLI command created | BLOCKING |

## Out-of-Scope Changes

Six categories of out-of-scope changes are bundled in the diff:
1. **DOD cleared** (`backlog/config.yml`): All 6 DOD items removed — breaking change to project governance
2. **Static analysis removed**: ESLint, TypeScript, test-hygiene.sh deleted
3. **Verification gate weakened**: `verify-local.sh` static-analysis subcommand removed
4. **Mission 1353 deleted**: Entire prior mission and review artifacts removed
5. **Mission 1357 deleted**: Entire prior mission and review artifacts removed
6. **Dev dependency cleanup**: eslint and typescript removed from package.json

## Success Criteria Compliance

| # | Criterion | Met? |
|---|-----------|------|
| 1 | `getTaskClassification()` ignores `bug` | ✅ |
| 2 | `hasBugLabel()` works | ✅ |
| 3 | Draft instructions permit `bug` | ✅ |
| 4 | Non-bug classification unchanged | ✅ |
| 5 | Draft prompt includes bug-repro instruction | ✅ |
| 6 | Execute prompt unchanged | ❌ modified |
| 7 | Declarative gate runner | ❌ not implemented |
| 8 | Generic red→green proof command | ❌ not implemented |
| 9 | Non-bug missions unaffected by construction | ❌ bug-branch present |
| 10 | All existing tests pass | ✅ |

6 of 10 success criteria NOT met.

## CP-5 Accuracy

CP-5 claims all criteria met. Claims for SC#6, #7, #8, #9 are demonstrably false based on the diff.

## Verdict

**REQUEST CHANGES**

The core classification changes (SC#1-#5) are correct and tests pass. However, the implementer's architecture deviates from the mission spec in fundamental ways — violating multiple explicit constraints that were deliberately designed (generic gate runner, no execute.md changes, no hardcoded bug gates, shared label primitive).

Required changes:
1. Restore `prompts/execute.md` to original (remove bug-labeled section)
2. Remove `verifyRedGreenProof` and related functions from `gatekeeper.js`
3. Remove bug-specific handoff integration from `handoff.js`
4. Implement generic `## Gates` runner (mission-agnostic gate executor)
5. Implement generic red→green proof command as standalone CLI/tool
6. Extract shared `getTaskLabels` label-parsing primitive
7. Separate out-of-scope changes (DOD clearing, ESLint/TS removal, mission cleanup) into a distinct mission

---
`[workflow-round:2, workflow-phase:reviewing]`