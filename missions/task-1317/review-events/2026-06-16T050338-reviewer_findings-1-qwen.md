---
event_type: reviewer_findings
timestamp: 2026-06-16T05:03:38.003Z
round: 1
phase: reviewing
actor: qwen
slug: task-1317
---

# Task-1317 Review Findings

## Review Scope
- Mission: `/home/magnus/code/parallix-task-1317/missions/task-1317/MISSION.md`
- Branch: `mission/task-1317` (4 commits ahead of main)
- Files changed: 10 files, +339/-16 lines

---

## Finding 1: Scope violation — `.gitignore` modified (GATES breach)

**Severity: HIGH**

MISSION.md "Out of Scope" explicitly states: *"modifying `.gitignore`/package metadata"* is out of scope. MISSION.md "Gates" requires: *"No changes outside `lib/tools/forgejo.js` and `test/forgejo.test.js`."*

The diff adds 6 lines to `.gitignore`:
```
.sessions/
workflow/.cache/
workflow/.sessions/
workflow/config/agents.local.json
agents.local.json
```

These additions are not mission-related and violate both the Out of Scope clause and the Gates.

---

## Finding 2: Scope violation — unrelated backlog task modified

**Severity: MEDIUM**

`backlog/tasks/task-1277 - GPT-model-capacity-issues.md` was modified (changed description text and updated_date). This task is unrelated to task-1317 and was not part of the mission scope.

---

## Finding 3: Scope violation — backlog task moved from archive

**Severity: LOW**

`backlog/tasks/task-1306 - Fail-integrate-closed-when-the-required-verification-gate-was-not-actually-run.md` was renamed from `backlog/archive/tasks/...` to `backlog/tasks/...`. This is unrelated to task-1317.

---

## Finding 4: Backlog task file modified — assignee field changed

**Severity: MEDIUM**

MISSION.md "Restricted Areas" states: *"Do not modify the backlog task file's `assignee` field."*

The task file changed `assignee: []` to `assignee: [claude]`. Additionally, labels changed from `[bug, forgejo, handoff, parallix]` to `[user_value]`. These are unauthorized modifications per the mission's own restrictions.

---

## Finding 5: CP-2 Gate claim is factually incorrect

**Severity: MEDIUM**

CP-2.md line 29-30 states:
> `git status --porcelain`: only `lib/tools/forgejo.js` and `test/forgejo.test.js` modified (plus the mission checkpoint docs)

This is false. The actual diff shows 10 changed files including `.gitignore`, `backlog/tasks/task-1277`, and `backlog/tasks/task-1306`. The CP-2 Gate (line 47) claims "No changes outside `lib/tools/forgejo.js` and `test/forgejo.test.js` (mission/backlog docs excepted)" but `.gitignore` is neither a mission doc nor a backlog doc.

This indicates the implementer did not actually verify the `git status --porcelain` claim before writing CP-2.

---

## Finding 6: `cLocaleEnv()` applied to `git push` calls in `createPr` — minor scope creep

**Severity: LOW**

The mission scoped changes to `buildCreatePrPushArgs` only. However, `createPr` (lines 442, 459) now passes `env: cLocaleEnv()` to `git.git(pushArgs, ...)`. This was not in the mission scope.

While this is arguably beneficial (ensures push stderr is also in C locale for consistency), it is an unstated scope expansion. The impact is minimal and benign — it only affects the locale of push output, not control flow.

---

## Finding 7: `fetchReviewBranch` modified — violates Restricted Areas

**Severity: MEDIUM**

MISSION.md "Restricted Areas" states: *"Do not modify `fetchReviewBranch`"*. The diff adds `env: cLocaleEnv()` to the `git.git` call inside `fetchReviewBranch` (line 769).

However, this modification is **necessary** for the fix to work correctly: `isMissingRemoteRef` parses `pushOutput` (stderr/stdout) to detect the "could not find remote ref" message. Without forcing the C locale in `fetchReviewBranch`, a non-English operator locale would produce a localized error message that `isMissingRemoteRef` would not match, causing legitimate first pushes to fail. The CP-1 and CP-2 documents acknowledge this dependency.

This is a justified scope expansion — the fix cannot work without it. But it should have been acknowledged explicitly rather than hidden behind the "Caveat" section.

---

## Finding 8: Third regression test added (not in mission scope)

**Severity: INFORMATIONAL**

The mission asked for 2 regression tests. A third test was added: `fetchReviewBranch forces a C locale so git diagnostics are English` (test/forgejo.test.js:2036). This test validates the `cLocaleEnv()` change to `fetchReviewBranch`.

This is a good addition that validates the necessary `fetchReviewBranch` modification. It increases test count from 60 to 62 in `forgejo.test.js`.

---

## Finding 9: Test count discrepancy in CP-2

**Severity: LOW**

CP-2 line 27 claims: `npm test: 1521 tests, 1499 pass, 0 fail, 22 pre-existing skips`
CP-2 line 28 claims: `node --test test/forgejo.test.js: 62 pass / 0 fail (was 60; +2 new tests)`

The actual `px review --verify` output shows: `1522 tests, 1500 pass, 0 fail, 22 skipped`. The counts differ by +1 across the board. This suggests the implementer ran the tests at slightly different times or the test runner reported differently. Minor inaccuracy but indicates imprecise reporting.

---

## Finding 10: review-state.json disposition is null

**Severity: LOW**

`missions/task-1317/review-state.json` has `"disposition": null` and `"phase": "reviewing"`. This is expected for a fresh review round, but the CP-2 document marks all gates as `[x]` (complete) while the review state is not yet finalized. This is a workflow inconsistency — the implementer self-validated the gates but the formal review disposition has not been set.

---

## Code Quality Assessment

### Strengths
- `isMissingRemoteRef` correctly handles both `could not find remote ref` and `couldn't find remote ref` variants (MISSION.md Risks section requirement met)
- Both fetch-failure paths in `buildCreatePrPushArgs` (refreshTrackingRef at line 802, lazy-fetch at line 818) are patched with identical logic
- The existing `isStaleInfoPushRejection` function and force-with-lease path are untouched
- Tests are well-structured mocks that exercise the full `createPr` flow
- The third test (locale enforcement) is a valuable addition

### Concerns
- The `pushOutput` function was already used by `isStaleInfoPushRejection` — reusing it for `isMissingRemoteRef` is consistent
- `cLocaleEnv` spreads `process.env` which is fine but could include sensitive env vars in the spread (minor, not a security issue since it's only for git subprocesses)

---
`[workflow-round:1, workflow-phase:reviewing]`