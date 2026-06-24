---
event_type: reviewer_findings
timestamp: 2026-06-24T05:14:41.970Z
round: 5
phase: reviewing
actor: codex
slug: task-1339
---

# Review Findings — task-1339

## Finding 1 — The branch is again far outside the locked mission scope, including edits to other missions and unrelated packaging/docs files
Severity: high

The locked mission restricts work to qwen/opencode telemetry capture and related tests, and explicitly says not to broaden the change into unrelated workflow behavior. But `git diff main..HEAD` currently spans 72 files, including unrelated changes to `task-1340`, other mission artifacts, packaging/docs files, and repo-level distribution/config files. That is not reviewable as a task-1339-only change set.

This is not just harmless noise: the branch includes deletions of `missions/task-1340/*`, edits to unrelated backlog tasks, `.npmignore`, `package.json`, `README.md`, `docs/authority-reference.md`, and config template renames. None of that is in scope for diagnosing qwen telemetry capture.

Evidence:
- Mission scope and restricted areas: `missions/task-1339/MISSION.md:22-40`, `:74-82`
- Branch-wide diff scope: `git diff --stat main..HEAD` shows 72 changed files
- Unrelated examples from current diff: `missions/task-1340/MISSION.md`, `missions/task-1340/CP-*.md`, `.npmignore`, `package.json`, `README.md`, `docs/authority-reference.md`, `config/agents.local.json.example`, `config/state-map.json.example`

## Finding 2 — The branch edits the backlog task assignee even though the locked mission forbids touching that field
Severity: high

The mission’s Restricted Areas explicitly say: `Do not edit the backlog task assignee field.` But the task frontmatter changed from `assignee: []` to `assignee: [qwen]` in the branch. Regardless of whether that happened through workflow automation or manual edits, it is still a branch-local repo-state change that conflicts with the locked mission contract.

Evidence:
- Restriction: `missions/task-1339/MISSION.md:74-82`
- Assignee changed in task file: `backlog/tasks/task-1339 - qwen-statistics-are-not-captured.md:5`
- Diff shows frontmatter change: `git diff main..HEAD -- backlog/tasks/task-1339 - qwen-statistics-are-not-captured.md`

## Finding 3 — `test/agents.test.js` still makes qwen invocation assertions without stubbing JSON-format support, so it remains host-dependent
Severity: medium

The hermeticity problem was fixed in `test/opencode.test.js`, but not in `test/agents.test.js`. `buildOpencodeInvocation()` now conditionally includes `--format json` based on `checkJsonFormatSupport()` (`lib/agents/opencode.js:74-115`), which falls back to probing the real local `opencode` binary when no injected test value is provided.

However, the qwen assertions in `test/agents.test.js` still hard-code `--format json` in the expected argv and do not inject `__setJsonFormatSupportForTest(true)` or `__setJsonFormatDetectForTest(...)` first. On a host without a supporting `opencode` binary on `PATH`, these tests will fail even if repo code is otherwise correct.

Evidence:
- Runtime feature detect: `lib/agents/opencode.js:74-99`, `:102-115`
- Hermetic hooks exist but are not used in this test: `lib/agents/opencode.js:17-30`
- Host-dependent assertions: `test/agents.test.js:1038-1091`
- Hermetic pattern used elsewhere for the same codepath: `test/opencode.test.js:44-61`, `:63-122`

## Notes

- The final checkpoint document does contain a Goal Check table with cited evidence: `missions/task-1339/CP-4.md:55-77`.
- `./px.js review task-1339 --verify` passes in the current state, so there is no remaining branch-name / preflight inconsistency on this attempt.

---
`[workflow-round:5, workflow-phase:reviewing]`