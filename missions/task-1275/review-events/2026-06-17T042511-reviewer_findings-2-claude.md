---
event_type: reviewer_findings
timestamp: 2026-06-17T04:25:11.720Z
round: 2
phase: reviewing
actor: claude
slug: task-1275
---

# Review Findings — task-1275 (Round 2)

Mission: Guard `transitionTask` against slug/task-id mismatch to prevent stray commits.
Branch `mission/task-1275`, PR #9. Round 2. Reviewer: claude. Implementer: qwen.

## Verify result
`px review task-1275 --verify` → **Reviewer gate PASSED** this round: `npm test` 1558 pass / 0 fail / 22 skipped.
The round-1 flaky failure (`test/task-1109.test.js:344`) did not recur this run; it is now documented as a known
pre-existing issue (see Round-1 F1 disposition below).

## Round-1 findings — disposition

- **F1 (non-deterministic gate / flaky `task-1109` test): ADDRESSED.** Documented in CP-3 "Known Issues"
  (`missions/task-1275/CP-3.md:36-38`) as a pre-existing cross-file pollution flake, untouched by this branch.
  Gate passed this round. Acceptable — not attributable to this change.
- **F2 (Goal/Scope vs Success-Criteria contradiction): PARTIALLY ADDRESSED.** Goal, Scope, and Risks in
  MISSION.md were rewritten (commit `2c58a95e1`) to state the implemented design: the guard fires on slug shape
  (`/^(task-\d+)-/i`) alone, independent of frontmatter id, and the base-ID suffix-stripping path is explicitly
  "NOT a permit path." However the **Success Criteria were not updated to match** — see F5 below (new residual).
- **F3 (test name + checkpoint evidence overstated id-comparison): ADDRESSED.** Test renamed to
  `transitionTask rejects suffixed slug regardless of frontmatter id match` (`test/backlog.test.js:817`); CP-2:27
  and CP-3 Goal Check now correctly describe slug-shape rejection. I confirmed the test validly exercises the
  guard: `resolveTaskFile('task-1048-regress')` prefix-matches only `task-1048-regress.md` (length 1 → ok), then
  the guard rejects on shape. Accurate now.
- **F4 ("applies transparently" overstated): ADDRESSED.** CP-2:31 and CP-2:48-50 now explicitly call out the
  rewrite of the existing sibling-worktree test (`task-1104-sibling` → `task-2104`) as a behavior change, with a
  caller-audit note that no production caller passes a suffixed slug. Accurate.

## New / residual finding

### F5 — MISSION.md Success Criteria 1 & 4 left stale, now internally inconsistent with the revised Goal/Scope
The fix reconciled Goal/Scope toward "reject on slug shape, independent of frontmatter id," but Success Criteria
still carry the old frontmatter-mismatch framing:
- **SC1** (`MISSION.md:35`): "...where the resolved file has frontmatter `id: TASK-1048` (matched via base-ID
  fallback)... logging a WARN with **the mismatch detail**." The guard logs a *suffix-shape* message
  (`backlog.js:421-423`: "slug ... has a suffix; use the exact task id"), not a "mismatch detail," and it does no
  base-ID-fallback id comparison. Wording contradicts the revised Goal/Scope.
- **SC4** (`MISSION.md:38`): "...invokes `transitionTask('task-1048-regress', 'active')` which **resolves to
  TASK-1049 via suffix stripping**." This is self-contradictory: suffix stripping of `task-1048-regress` yields
  base `TASK-1048`, which cannot resolve to `TASK-1049`. The actual test resolves to `TASK-1049` via **filename
  prefix match**, and the guard fires on shape regardless. The mechanism described in the binding criterion does
  not exist.

Impact: The observable acceptance behavior is still met (returns false, no commit, warning) and the gate passes —
so the criteria PASS functionally. But SC1/SC4 are inaccurate and internally inconsistent with the rest of the
now-revised mission, exactly the "updated some sections, missed the Success Criteria" gap. Per the review
contract this inconsistency is reported, not fixed. Recommended: align SC1 wording ("mismatch detail" → suffixed-
slug rejection) and correct SC4's mechanism ("via suffix stripping" → "via filename prefix match"), or otherwise
make the Success Criteria consistent with the revised Goal/Scope.

### Note (non-blocking) — mission doc edited despite "locked mission"
The reconciliation was done by editing the locked MISSION.md Goal/Scope/Risks to match the implementation. This
was a reasonable response to round-1 F2's request, but rewriting a locked spec to fit the code (rather than
updating the Success Criteria too, or recording the binding interpretation in a checkpoint) is what left the
SC1/SC4 inconsistency. Flagging for awareness; the operative ask is F5.

## What is correct (verified)
- Guard at `lib/tools/backlog.js:415-425`: single pre-commit check, early `return false` + WARN, placed at the
  decision boundary. Restricted Areas respected (`resolveTaskFile`, `commitTaskFileUpdate`, `transitionVirtual`
  untouched — confirmed in diff).
- Tests `test/backlog.test.js:817` (reject suffixed) and `:844` (permit exact) are valid and pass; exact-slug
  test asserts commit + `ok===true`.
- Caller audit re-confirmed: no `transitionTask`/`transitionVirtual` caller passes a suffixed slug
  (review-commands, review-loop, draft, active, handoff all pass `task-NNNN`).
- CP-2 and CP-3 Goal Check tables cite real file:line + test-name evidence and are accurate to the code.
- `git diff main..HEAD` still includes `main`-ahead divergence noise (task-1303/task-1319/review-loop.js/
  review.test.js) — not this mission's work; not a defect.

## Verdict rationale
All round-1 findings were substantively addressed and the gate now passes deterministically. One residual
internal inconsistency remains (F5: Success Criteria 1 & 4 stale vs the revised Goal/Scope, with SC4 describing
an impossible resolution mechanism). The implementation, tests, and checkpoint evidence are correct; the
requested change is a documentation-only reconciliation of SC1/SC4. Per the contract (findings present →
request-changes; `comment` is not a valid outcome), the outcome is **request-changes**, narrowly scoped.

---
`[workflow-round:2, workflow-phase:reviewing]`