---
event_type: reviewer_findings
timestamp: 2026-06-24T14:50:52.730Z
round: 3
phase: reviewing
actor: claude
slug: task-1341
---

# Review Findings — task-1341 (Make backlog.md optional) — Round 3

Mode: review (attempt 3, focus: all).
Diff reviewed: `git diff main..HEAD`. Delta since round-2 approval: commit `3f6c1dc9 task-1341: adopt adhoc- synthetic slug prefix; reopen review (round 3)`.

## Verification

- `px review task-1341 --verify`: **PASS** (exit 0). Reviewer gate passed; Review verification complete.
- `npm test`: **1640 tests, 1618 pass, 0 fail, 22 skipped**.
- Affected test files (`draft-command`, `draft`, `mission-utils`): 104 pass, 0 fail.

## Round-3 change summary

Commit `3f6c1dc9` reserves `task-*` slugs for real Backlog.md task files and mints an `adhoc-` prefix (and `ADHOC-…` id) for synthetic free-text/directory drafts:
- `lib/commands/draft.js`: `SYNTHETIC_SLUG_PREFIX = 'adhoc-'`; `syntheticTaskId` emits `ADHOC-…` for adhoc slugs; `resolveDraftTarget` routes free-text, directory, and explicit `adhoc-` inputs through the prefix (draft.js:18,32-39,52-61,81).
- `lib/core/mission-utils.js`: new `isMissionSlugCandidate` accepts `task-`/`adhoc-`; `inferSlug` recognizes both from explicit arg and directory name (mission-utils.js:57,661,679).
- README quick start + draft/mission-utils tests updated to `adhoc-`; tests pass.

The change is functionally clean and directly implements the MISSION.md Risk-section mitigation ("synthetic tasks use a reserved prefix in the `id` (e.g., `SYNTH-`) … so they can be identified"). It resolves the synthetic/real slug collision risk.

## Findings

### F1 (Blocking) — Final checkpoint cites stale SMOKE.md evidence that contradicts current code
`missions/task-1341/SMOKE.md` was last updated in the original implementation commit (`3f540619`) and was **not** refreshed for the round-3 `adhoc-` change (`grep -c adhoc SMOKE.md` → 0). It still documents pre-adhoc behavior:
- Free-text draft: worktree `…-task-hello-world`, task file `backlog/tasks/task-hello-world - hello-world.md` (SMOKE.md:7-9). Current code produces an **`adhoc-hello-world`** slug.
- Directory draft: `id: TASK-TASK1341-DIR-RERUN-BVRDMS-14A1218D` (SMOKE.md:23). Current code produces an **`ADHOC-…`** id.
- Test count: `# tests 1638` (SMOKE.md:34). Current suite is **1640**.

`missions/task-1341/CP-7.md` (the final checkpoint) cites SMOKE.md:3/13/23/30 as evidence for Success Criteria 1, 2, and the gates row (`grep -c adhoc CP-7.md` → 0). The Goal Check therefore points at evidence that no longer reflects the code — exactly the "checkbox without live evidence" failure mode. Re-run the smoke gates against the `adhoc-` flow and update SMOKE.md (and CP-7 citations) to the current slugs/ids and test count.

### F2 (Finding — locked-mission vs implementation inconsistency; report, do not fix)
MISSION.md Success Criterion 2 states verbatim: *"the task file's `id` frontmatter matches `TASK-{basename-hash}`."* The round-3 change makes directory-mode emit **`ADHOC-{BASE}-{hash}`** (draft.js:33-39). The criterion's literal falsifiable check no longer matches the code. The change is defensible (it satisfies the Risk-section mitigation and fixes a real collision risk), but it conflicts with the locked criterion text and with CP-7's directory-mode row (which still cites the old `TASK-…` id via SMOKE.md:13). Reconcile explicitly: acknowledge in the checkpoint that the `ADHOC-` prefix supersedes the criterion-2 `TASK-` wording per the Risk mitigation, and update the evidence accordingly. Per the review contract I report this inconsistency rather than editing the mission.

### F3 (Non-blocking — known limitation; forgejo.js is a Restricted Area)
Many slug extractors gate on numeric `task-\d+`:
- `lib/tools/forgejo.js` — 12+ sites use `branch.match(/^mission\/(task-\d+)/)` (e.g. :136,403,549,946,977,1057,1152,1184,1271,1414,1504).
- `lib/commands/stats-backfill.js:28` skips slugs not matching `/^task-\d+/i`.
- `lib/core/mission-utils.js` (:257,382,410,904), `lib/tools/backlog.js` (:74,423), `lib/commands/integrate.js` (:808,969,1049) use `/^(task-\d+)/i` base-slug matching.

These never match `adhoc-*` (nor non-numeric `task-*`, which round-2's `task-hello-world` also failed), so for adhoc missions the Forgejo PR slug extraction, stats backfill, and base-slug-suffix handling silently no-op. This pre-existed for non-numeric task slugs and is not introduced by round 3, but round 3 makes `adhoc-` the default synthetic path, so it is now the common case. `lib/tools/forgejo.js` and `lib/review/` are explicit Restricted Areas, so the implementer correctly left them unmodified; the falsifiable criteria do not require Forgejo for adhoc missions. Surface as a documented limitation for adhoc-slug Forgejo/backfill integration.

### F4 (Workflow inconsistency — report, do not fix)
The round-3 commit `3f6c1dc9` (authored by the implementer, `Magnus Ekdahl`) commits reviewer-attributed artifacts `docs/.../2026-06-24T061447-reviewer_findings-3-claude.md` and `…reviewer_outcome-3-claude.md`, and its message states it "Reopens review at round 3 (request-changes), overturning the round-2 approval." The implementer pre-authored reviewer-attributed artifacts and self-reopened the review. Per the contract I treat those as non-authoritative and base this verdict on my own independent review. Flagging the provenance inconsistency.

## Criteria status (post round-3)

1. Free-text draft → synthetic `unknown` task — PASS functionally (now `adhoc-` slug); SMOKE evidence stale (F1).
2. Directory draft → synthetic id + `labels:[unknown]` — id is now `ADHOC-…`, conflicts with criterion's literal `TASK-{basename-hash}` (F2); SMOKE evidence stale (F1).
3. Stats accepts `unknown` — PASS (stats.test.js:146,156).
4. Mission-start preflight passes without task file — PASS (mission-start.test.js:65).
5. Gatekeeper not blocked — PASS (gatekeeper.test.js:73).
6. Integrate records `classification=unknown` row — PASS (integrate.test.js:399).
7. No `backlog_task_create` in lib/ — PASS (grep clean).
8. README quick start without task-file creation — PASS (updated to `adhoc-`).
9. `npm test` exit 0 — PASS (1640/0 fail).
10. Backward compatibility — PASS (real `task-NNN` flows unchanged; reserving `task-*` actually strengthens this).

---
`[workflow-round:3, workflow-phase:reviewing]`