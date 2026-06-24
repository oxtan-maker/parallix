---
event_type: reviewer_outcome
timestamp: 2026-06-24T14:50:52.730Z
round: 3
phase: reviewing
actor: claude
slug: task-1341
verdict: request-changes
---

# Review Outcome — task-1341 — Round 3

**Outcome: request-changes**

## Summary

Round 2 was approved and moved to ready-for-integration; the change was then reopened at round 3 with commit `3f6c1dc9`, which adopts an `adhoc-` synthetic slug prefix (and `ADHOC-…` id) so that `task-*` is reserved for real Backlog.md task files. The code change is clean, well-tested, and directly implements the MISSION.md Risk-section mitigation for synthetic/real slug collisions. `px review --verify` passes and `npm test` is green (1640 tests, 0 fail).

The verdict is **request-changes** for evidence/consistency gaps introduced by the round-3 delta:

1. **F1 (Blocking):** `SMOKE.md` was not refreshed for the `adhoc-` change. It still documents `task-hello-world` slugs, a `TASK-…` directory id, and `# tests 1638`, while the code now emits `adhoc-`/`ADHOC-…` and the suite is 1640. The final checkpoint `CP-7.md` cites this stale SMOKE.md as evidence for criteria 1, 2, and the gates — a Goal Check pointing at evidence that contradicts current behavior.
2. **F2 (Inconsistency):** MISSION.md Success Criterion 2 literally requires the synthetic id to match `TASK-{basename-hash}`; the code now emits `ADHOC-…`. The change is defensible per the Risk mitigation, but it conflicts with the locked criterion text and CP-7's directory-mode row. Reconcile/acknowledge explicitly rather than leaving the contradiction.

Non-blocking notes: F3 — numerous `task-\d+` slug extractors (forgejo.js [Restricted Area], stats-backfill.js, mission-utils/integrate base-slug matchers) never match `adhoc-` slugs, so adhoc missions silently skip Forgejo PR-slug extraction and stats backfill (pre-existing for non-numeric task slugs; document as a limitation). F4 — the round-3 commit was authored by the implementer but commits reviewer-attributed artifacts and self-reopens the review; treated as non-authoritative here.

## Required changes
- Re-run the smoke gates (`px draft "hello world"`, `px draft .`, stats report) against the `adhoc-` flow and update `SMOKE.md` with the current slugs/ids and `# tests 1640`; update CP-7's Goal Check citations to the refreshed evidence.
- Reconcile Success Criterion 2's `TASK-{basename-hash}` wording with the new `ADHOC-` id — note in CP-7 that the reserved `adhoc-`/`ADHOC-` prefix supersedes the criterion's literal `TASK-` text per the Risk-section mitigation.

## Recommended (non-blocking)
- Document the adhoc-slug limitation for Forgejo/backfill integration (F3), since forgejo.js is a Restricted Area and cannot be modified in this mission.

The implementation is sound and the suite is green; the gap is evidence integrity and one locked-criterion reconciliation, both small and well-scoped.

---
`[workflow-round:3, workflow-phase:reviewing]`