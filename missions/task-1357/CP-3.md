# CP-3 — Committed and verified

## Summary

Committed the 6 frozen DoD default items via `definition_of_done_defaults_upsert`,
confirmed persistence via `definition_of_done_defaults_get` and the underlying
`backlog/config.yml`, and proved SC5 by creating a throwaway task that inherited
all 6 defaults verbatim. The throwaway draft was then removed. The mission Gate
(`./scripts/verify-local.sh docs`) passes.

### What was done

1. `definition_of_done_defaults_upsert` called with the 6-item set → tool returned
   "Updated project Definition of Done defaults" and echoed all 6 items.
2. `definition_of_done_defaults_get` → returns the same 6 items (non-empty).
3. `backlog/config.yml` `definition_of_done:` now holds the 6-item array
   (previously `[]`).
4. Created throwaway `DRAFT-001` with no `disableDefinitionOfDoneDefaults` → its
   Definition of Done populated automatically with exactly the 6 default items
   (`#1`–`#6`), matching defaults verbatim.
5. Removed the throwaway draft (`git rm`) to avoid polluting the board.
6. Companion note `DOD_DEFAULTS_NOTE.md` records gate-enforced vs manual-checklist
   status (1 gate-enforced + 5 manual-checklist).

### Success-criteria verification

| SC | Requirement | Evidence | Status |
|----|-------------|----------|--------|
| SC1 | `..._get` returns non-empty after commit | `definition_of_done_defaults_get` → 6 items | ✅ |
| SC2 | Array has 4–8 items inclusive | 6 items | ✅ |
| SC3 | Each item non-empty, 1–500 chars, no commas | All 6 verified comma-free and within length; `backlog/config.yml` `definition_of_done` array | ✅ |
| SC4 | ≥1 gate-enforced and ≥1 manual-checklist in note | `DOD_DEFAULTS_NOTE.md` table: item 1 gate-enforced; items 2–6 manual-checklist | ✅ |
| SC5 | New task inherits all defaults | Throwaway task created with no `disableDefinitionOfDoneDefaults` inherited DoD `#1`–`#6` matching `backlog/config.yml:5` verbatim; durable evidence preserved in commit `2f6ddeb6` (file later removed from tree) | ✅ |
| SC6 | No aspirational phrasing in any item | `grep -niE 'when built\|once gate lands\|pending'` over the 6 items → no match | ✅ |

## Goal Check

| Goal | Evidence | Status |
|------|----------|--------|
| Defaults committed via upsert | `definition_of_done_defaults_upsert` returned "Updated project Definition of Done defaults" with 6 items | ✅ |
| Persisted in config | `backlog/config.yml:5` `definition_of_done: [...6 items...]` (was `[]`) | ✅ |
| `..._get` confirms commit (SC1/SC2/SC3) | 6 non-empty comma-free items returned | ✅ |
| Gate-enforced vs manual-checklist labeled (SC4, AC#3/#4) | `missions/task-1357/DOD_DEFAULTS_NOTE.md` table | ✅ |
| New task inherits defaults (SC5, AC#5) | Throwaway task inherited DoD `#1`–`#6` verbatim from `backlog/config.yml:5`; preserved in commit `2f6ddeb6`, then removed from tree | ✅ |
| No aspirational items (SC6) | grep for "when built"/"once gate lands"/"pending" over items → 0 matches | ✅ |
| Mission Gate passes | `./scripts/verify-local.sh docs` → `PASS: all required documentation present` (exit 0) | ✅ |
| Minimal & universal; mission-specific stays per-task (AC#1/#2) | 6 universal items; `DOD_DEFAULTS_NOTE.md` records per-task items use `definitionOfDoneAdd` | ✅ |

## Round 1 review resolution

| Finding | Severity | Disposition | Action |
|---------|----------|-------------|--------|
| F2 — "Unapproved modification of TASK-1358" | Medium (blocking) | **Fixed** | False positive: the branch was behind `main`. The `updated_date` + design prose were ADDED by main's own commit `ddf61077` (`Update task TASK-1358`) AFTER this branch diverged (merge-base `8b8bdfb0`); the branch never touched TASK-1358 (`git merge-base --is-ancestor ddf61077 HEAD` → false before merge). Resolved by merging `main` into the branch, incorporating `ddf61077`. `git diff main..HEAD -- task-1358*` is now empty. |
| F1 — TASK-1357 label change | Low-Med | **Fixed** | Labels restored to `quality / guardrail / bug-reduction`. The change to `ai_sdlc` was introduced by workflow commit `64db36c5` (pre-execute), not by mission work, but restored per reviewer request. |
| F4 — MISSION.md gate checkbox `[ ]` | Low | **Fixed** | `MISSION.md:65` changed to `[x]` (gate passes, exit 0). |
| F5 — CP-3 evidence cites deleted DRAFT-001 | Low | **Fixed** | SC5 rows now cite `backlog/config.yml:5` and commit `2f6ddeb6` instead of the removed file. |
| F3 — Orphaned DRAFT-001 commit `2f6ddeb6` | Low | **Pushed back** | Reviewer-verified SC5 evidence lives in this commit. Squashing would rewrite already-committed workflow/review-state commits stacked on top of it mid-review-loop (risky) for a "consider"-level housekeeping item. Keeping it as durable, externally-verifiable SC5 proof. |

Gate re-run after fixes: `./scripts/verify-local.sh docs` → `PASS` (exit 0).

Next action: Commit the review fixes (merge of main, label restore, MISSION.md checkbox, CP-3 evidence) on `mission/task-1357` and write the round-resolution artifacts for the review loop.
