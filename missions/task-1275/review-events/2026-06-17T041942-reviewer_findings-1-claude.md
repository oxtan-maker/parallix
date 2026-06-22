---
event_type: reviewer_findings
timestamp: 2026-06-17T04:19:42.022Z
round: 1
phase: reviewing
actor: claude
slug: task-1275
---

# Review Findings — task-1275

Mission: Guard `transitionTask`/`commitTaskFileUpdate` against slug/task-id mismatch to prevent stray commits.
Branch: `mission/task-1275` (PR #9). Implementer: qwen. Reviewer: claude. Round 1.

## Summary of change

- `lib/tools/backlog.js:413-426` — new guard in `transitionTask()`: after `resolveTaskFile` succeeds, if the
  slug matches `/^(task-\d+)-/i` (i.e. has a suffix after the numeric base id), log a WARN and `return false`
  before any assignee/status write or commit.
- `test/backlog.test.js:817-866` — two new tests (reject suffixed slug; permit exact slug).
- `test/backlog.test.js:682-723` — an EXISTING test was rewritten (suffixed slug `task-1104-sibling` → exact slug
  `task-2104`) because the new guard rejects the slug it previously used.

Diff also shows unrelated paths (task-1303 mission/backlog removals, review-loop.js, review.test.js, task-1319):
these are `main`-ahead changes absent from this branch (merge-base `b867d04e2`, main tip `10698f24c`), i.e.
branch-divergence noise, not work by this mission. Not a defect.

## Findings

### F1 — Gate is non-deterministic; `px review --verify` failed on `npm test` (blocker as written)
`px review task-1275 --verify` reported `[FAIL] Reviewer gate failed` with one failing test:
`test/task-1109.test.js:344` — "integrate Variant B resumed partial state prints sync diagnostics on sync failure".
- The test passes in isolation (`node --test test/task-1109.test.js` → 13/13).
- Full-suite runs are flaky: reproduced 1 failure in ~4 full runs (`node --test test/*.test.js`); 3/4 runs report
  0 fail.
- `task-1109.test.js` is NOT touched by this branch (identical at merge-base and HEAD). The failure is a
  pre-existing cross-file test-pollution/ordering flake (a forgejo `syncMerged` mock assertion), **not**
  attributable to the transitionTask guard.
- Impact: Mission Gate "npm test (zero failures)" and Success Criterion 5 cannot be satisfied **deterministically**.
  CP-3 reports "0 fail" — true for some runs, not all. The verifier observed a real failure this round.

### F2 — Implementation diverges from the mission's Goal/Scope design (mission is internally contradictory)
The mission spec contradicts itself:
- Goal (MISSION.md:5) and Scope (MISSION.md:21) require reading the resolved file's **frontmatter `id`** and
  comparing it to the slug's base id, and explicitly say the base-ID suffix-stripping path should be **permitted**:
  "When `resolveTaskFile` uses this fallback path to find a single file, the guard permits it."
- Success Criteria 1 & 4 (MISSION.md:35,38) require the same `task-1048-regress -> TASK-1048` case to be
  **rejected** (return false, no commit).

These are mutually exclusive. The implementer followed the Success Criteria (reject all suffixed slugs), which
also better matches the actual intent in "Why Now" (the TASK-1265 incident was a base-ID match that should NOT
have committed — so the Goal/Scope "permit base-ID match" wording would re-open the very bug). Reasonable call,
but the chosen design (reject purely on slug shape) is NOT what Goal/Scope describe. Per the review contract this
spec inconsistency is reported, not fixed — the mission should be reconciled so the binding criteria and the
Goal/Scope agree.

### F3 — Guard never reads frontmatter `id`; test name and CP-3 Goal Check claim id-comparison that the code does not implement
- The guard (`backlog.js:419-425`) rejects on `slug` regex alone; it never compares the resolved file's `id`.
- The new test is named "rejects suffixed slug **when resolved file id differs from slug base id**"
  (`test/backlog.test.js:817`) and CP-3's Goal Check row 1 cites it as evidence the guard "rejects ... id
  differs". But the test would pass identically if the trap file had `id: TASK-1048` (a base-ID *match*), because
  the guard does no id comparison. The test does not actually exercise any "id differs" logic — the evidence in
  CP-3 overstates what the code does.
- Corollary: Success Criterion 2's design intent ("permits base-ID fallback to the *same* id") is not
  implemented — a suffixed slug that legitimately base-ID-resolves to the same task is now rejected. (Consistent
  with SC1, inconsistent with Goal/Scope — see F2.)

### F4 — "Guard applies transparently / existing callers remain functional" is overstated
Scope (MISSION.md:23) and CP-3 imply the guard is transparent to existing callers. In fact an existing passing
test had to be rewritten (`test/backlog.test.js:682-723`, suffixed `task-1104-sibling` → exact `task-2104`)
because the guard changes behavior for suffixed slugs that previously committed successfully. Caller audit
(below) shows no production caller passes a suffixed slug, so this is acceptable fallout — but the transparency
claim is not literally true and the rewrite should be called out as a behavior change.

## Caller audit (supports that F4 is low-risk)
All `transitionTask`/`transitionVirtual` callers pass a slug derived from the mission/branch (`task-NNNN`), never
a suffixed slug:
- `lib/review/review-commands.js:605,796,865`
- `lib/review/review-loop.js:603,641,785,858`
- `lib/commands/draft.js:179,271` (normalizedSlug)
- `lib/commands/active.js:193,217,269`
- `lib/commands/handoff.js:303`
No production path is broken by rejecting suffixed slugs.

## What is correct / good
- Guard is a single pre-commit check, placed at the decision boundary in `transitionTask` (Restricted Areas
  respected: `resolveTaskFile`, `commitTaskFileUpdate`, `transitionVirtual` untouched). Verified by diff.
- Returns `false` and logs WARN; early return prevents assignee/status writes and the commit. Matches SC1/SC3
  observable behavior and SC6 (exact-slug path returns true).
- New tests assert no stray commit and no file mutation; the exact-slug test asserts commit + `ok===true`.
- CP-1/CP-2/CP-3 exist; CP-3 contains a Goal Check table with file:line + test-name evidence (accuracy caveats in
  F3).

## Verdict rationale
The mission Gate ("npm test zero failures") was observed failing during `--verify` (F1), and the checkpoint
evidence overstates the implementation (F3). Per the contract ("if you have findings but the criteria pass, use
request-changes"), and because the gate did not cleanly pass this round, the outcome is **request-changes**.

---
`[workflow-round:1, workflow-phase:reviewing]`