# CP-4: Final checkpoint — fail-closed harness defense against agent hallucinations

## Summary

Produced ADR 0048 recommending how Parallix should defend the codebase against agent hallucinations by detecting incomplete/invalid handoffs mechanically and sending missions back to the implementer automatically when possible. The ADR inventories 23 existing check points, classifies 8 failure classes, evaluates 7 candidate controls, and recommends a prioritized implementation sequence. The backlog (parent TASK-1384 and 5 child tasks TASK-1385 through TASK-1389) is aligned to the ADR's plan.

## Goal Check

| Criterion | Evidence | Status |
|-----------|----------|--------|
| SC1: ADR exists under docs/adr/, listed in index, cites 4+ prior artifacts including task-1268 and task-1335 | `docs/adr/0048-fail-closed-harness-defense-against-agent-hallucinations.md` created and listed in `docs/adr/index.md`. Inputs section cites task-1268, task-1335, ADR 0041, ADR 0047 | PASS |
| SC2: ADR contains inventory of 5+ existing checks mapped to failure classes | ADR 0048 "Inventory of Existing Checks" section: 23 check points across 5 phases (Before Handoff: checks #1-3, During Handoff: #4-13, Before Review: #14-16, During Integration: #17-20, Repair Path: #21-23), each mapped to failure classes 1-8 | PASS |
| SC3: Decision matrix with 5+ candidates, each classified as implement-now / defer / human-only | ADR 0048 "Decision Matrix" section: 7 candidates (C1-C7). C1/C2/C3 = implement now, C4/C5/C6 = defer, C7 = human-only. No candidate unclassified | PASS |
| SC4: 5+ failure classes classified as auto-repair / auto-send-back / requires-human | ADR 0048 "Failure Classification" table: 8 classes. Classes 2,5(mission-only) = auto-repair. Classes 1,3,4,6 = auto-send-back. Classes 5(shared),7,8 = human-only | PASS |
| SC5: Parent TASK-1384 rewritten, 4+ child tasks with integer slugs | TASK-1384 description rewritten. 5 child tasks: TASK-1385 (C1), TASK-1386 (C4), TASK-1387 (C2), TASK-1388 (C5), TASK-1389 (C3). All integer slugs, no `task-1384.01`-style slugs | PASS |
| SC6: Goal Check table has 6+ evidence rows with file:line / ADR / test references | This table: 6 rows, each citing specific ADR sections, file paths, or task IDs | PASS |
| Gate: ./scripts/verify-local.sh docs passes | Ran successfully: "PASS: all required documentation present" | PASS |
| No modifications to lib/, scripts/, config/, test/ by this mission | Confirmed: git diff main..HEAD shows no lib/, test/, scripts/, config/, px.ts, or package.json changes. All drift from main synced back in round-3 fix commits | PASS |

## Rationale for Key Decisions

**Why C3 (error classifier) first:** The dispatch table is the foundation that C1 (pre-review gate) and C2 (gate-failure send-back) plug into. Without it, each new auto-send-back path would add another ad-hoc pattern match to `repair-handoff.js`.

**Why C2 (gate-failure send-back) before C1 (pre-review gate):** C2 is lower complexity (capture output, build prompt, relaunch) and addresses the most common human-intervention scenario today. C1 adds a new enforcement point (pre-review-round), which is higher impact but requires more coordination with the review loop.

**Why C4/C5/C6 deferred:** C4 (gate syntax validation) has low incidence rate. C5 (gatekeeper send-back) is partially covered by auto-checkpoint generation. C6 (infra error labeling) is cosmetic. All three benefit from the C3 dispatch framework being in place first.

**Why C7 human-only:** Defining "sufficient evidence" programmatically risks false positives. The reviewer is better positioned to judge evidence quality than a regex.

Next action: Commit all mission artifacts and hand off for review.
