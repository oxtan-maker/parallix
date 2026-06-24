---
event_type: reviewer_findings
timestamp: 2026-06-24T04:15:00.060Z
round: 1
phase: reviewing
actor: claude
slug: task-1341
---

# Review Findings — task-1341 (Make backlog.md optional)

Mode: review (attempt 1, focus: all). Reviewer state: reviewer=qwen, implementer=codex, round 1.
Diff reviewed: `git diff main..HEAD` (31 files, +668/-93).

## Verification

- `px review task-1341 --verify`: PASS. Mission doc, branch, backlog task (review state), PR #22 open, reviewer gate `npm test` green.
- `npm test`: **1638 tests, 1616 pass, 0 fail, 22 skipped** (exit 0).
- `grep -rn 'backlog_task_create' lib/` → **NONE** (criterion 7 met).
- `grep -rnE 'backlog/tasks/|backlog/completed/|backlog/archive/|Backlog\.md' lib/` → **NONE** (hardcoded coupling removed).
- README first 85 lines reviewed: no instruction to create a task file in quick start; capability statement first; Git named in line 5; `px draft "..."` / `px draft .` shown as first command (criterion 8 met).

## What is solid

- **Stats layer (CP-2, criterion 3).** `VALID_CLASSIFICATIONS` adds `unknown` (stats.js:35); `resolveMissionClassification` returns `{ classification: 'unknown', taskFile: null }` instead of throwing (stats.js:1183); weekly/range reports add an `# unknown missions` bucket (stats.js:556,717,754). Backed by real tests: `resolveMissionClassification returns unknown when no task file exists` and `upsertStatsRow accepts unknown classification rows and weekly report counts them` (test/stats.test.js:146,156).
- **Draft free-text/dir mode (CP-3, criteria 1–2).** `resolveDraftTarget`/`slugifyDraftIntent`/`syntheticTaskId` (draft.js:19–73) synthesize a slug + synthetic task; `bootstrapBacklogTask` writes a committed task file with `labels: [unknown]` and `source: synthetic` (draft.js:583–618). Tested (draft-command.test.js:370, draft.test.js:657) and smoke-evidenced (SMOKE.md). Synthetic-task prompt preserves `unknown` via `resolveClassificationInstructions` + `{{classificationInstructions}}` (draft.js:659, prompts/draft.md:12), tested at draft.test.js:121.
- **Adapter cleanup (CP-5, criterion 7).** Task storage paths routed through `getTaskStorage`/`resolveTaskStorage`; `archiveTasksDir` + `storagePath` added (product-config.js:374,420); backlog.js, mission-utils.js `isMissionArtifact`, gatekeeper.js all use adapter paths; error/setup copy de-Backlog.md'd.
- **Gatekeeper (criterion 5).** `checkMandatoryFiles` returns `{ ok: true }` when MISSION.md + ≥1 checkpoint exist even without a task file (gatekeeper.js:45). Test rewritten to assert this (gatekeeper.test.js:73).
- **Backward compat (criterion 10).** Existing `ok:true` paths unchanged; full suite (draft/backlog/integrate) green without spec regressions.

## Findings (request-changes)

### F1 (Medium) — New mission-start missing-task branch ships with zero test coverage; criterion 4's specified test does not exist
`lib/commands/mission-start.js:153-157` adds a new branch: when `taskResolution.reason === 'missing'`, it warns and passes with `unknown` classification. **No test exercises this branch.** Every `resolveTaskFileFn` mock in `test/mission-start.test.js` returns `{ ok: true, ... }` (lines 15,45,125,150,168,194,214,241,276,310); `grep "ok: false" test/mission-start.test.js` → NONE. `test/mission-start.test.js` was not modified in this diff.

Criterion 4 explicitly requires: *"mission-start.test.js asserts `missionStart(['task-free-text'], { returnResult: true })` returns `{ pass: true }`."* That test was not added. CP-7's Goal Check marks the mission-start row **PASS** citing `lib/commands/mission-start.js:153`, but the tests it cites (`checkMandatoryFiles...`, `printIntegrationPreflight...`) cover gatekeeper/integrate — none cover the mission-start path. This is a checkbox marked PASS without backing evidence.

Fix: add a mission-start test with `resolveTaskFileFn: () => ({ ok: false, reason: 'missing' })` asserting `{ pass: true }` and that classification falls back to `unknown`.

### F2 (Low-Medium) — Criterion 6's specified integrate verification is only partially met
The added test `printIntegrationPreflight tolerates a missing task file and reports unknown classification` (integrate.test.js:692) asserts the preflight no longer pushes `task-missing` and prints `Backlog classification: unknown`. It does **not** assert what criterion 6 specifies: *"integration succeeds and the stats CSV contains a row with `classification=unknown`."* `grep "classification=unknown" test/integrate.test.js` → no end-to-end stats-row assertion. The functional path exists (integrate.js:990 / 1013 use `resolveMissionClassification`, and `deriveImplementerAndFixRounds` now returns an `unknown` fallback at stats.js:1170-1178), but the criterion's falsifiable evidence (a recorded CSV row) is untested.

Fix: add an integrate test asserting a draft-created mission records a stats row with `classification=unknown`.

### F3 (Low) — Scope items 6 (status.js) & 7 (active.js) claimed in scope but unchanged and unverified
The mission lists `lib/commands/status.js` and `lib/commands/active.js` resilience as in-scope (Scope §6, §7), but neither file is in the diff and no checkpoint provides evidence for them. Functionally they appear already tolerant: `status.js findStaleMissionWorktrees` does not resolve task files at all; `active.js:76` resolves `taskResolution` but does not gate on `.ok` (it is passed through to the launcher). So behavior is acceptable, but the implementer neither demonstrated nor documented this — CP-4 covers mission-start/gatekeeper/integrate/mission-utils only. Recommend a one-line checkpoint note (or a guard test for `findStaleMissionWorktrees`/`active` with a missing task file) stating no change was needed and why.

### F4 (Informational) — Live integrate path records `implementer=unknown` rather than deriving from branch history
Scope §5 says: when no task file exists, *"derive the implementer from the mission branch history or review-state."* The git-history fallback was added only to the **backfill** path (`stats-backfill.js:218`, now also triggers when implementer === 'unknown'). The **live** `deriveImplementerAndFixRounds` (stats.js:1170-1178) returns `implementer: 'unknown', source: 'unknown-fallback'` without consulting branch history/review-state. A live integration of a synthetic mission therefore records `implementer=unknown`; backfill later corrects it. Not in the falsifiable criteria, but a deviation from scope wording worth noting.

### F5 (Informational) — Frontmatter is `labels: [unknown]` (unquoted) vs criteria's `labels: ["unknown"]`
Criterion 1 wording shows `labels: ["unknown"]`; the writer emits unquoted `labels: [unknown]` (draft.js:589). This is valid YAML and parsed correctly by `getTaskClassification` (backlog.js:506,514). No defect — noted only because the smoke/criterion strings differ.

## Goal Check table audit (CP-7)
The CP-7 Goal Check table cites real file:line evidence and test names, and most rows are genuinely backed. The one row that overstates is the "Mission-start, gatekeeper, and integrate no longer hard-fail" row marked **PASS**: its `mission-start.js:153` citation has no corresponding test (see F1). The three named tests in that row only cover gatekeeper and integrate-preflight.

---
`[workflow-round:1, workflow-phase:reviewing]`