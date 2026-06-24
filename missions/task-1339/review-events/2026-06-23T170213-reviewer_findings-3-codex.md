---
event_type: reviewer_findings
timestamp: 2026-06-23T17:02:13.266Z
round: 3
phase: reviewing
actor: codex
slug: task-1339
---

# Review Findings — task-1339

## Finding 1 — The mission is in an inconsistent workflow state: reviewer preflight fails because the branch name no longer matches the mission slug
Severity: high

The required verifier still fails its own branch preflight. `./px.js review task-1339 --verify` reports:

- current branch: `mission/task-1339-clean`
- expected branch: `mission/task-1339`

That means the review loop cannot be started from the current state even though the backlog task is already in `review` and round 3 review artifacts have been recorded. The user explicitly asked that workflow-state inconsistencies be reported rather than fixed, and this one is material because the repo’s own verifier marks the environment `NOT USABLE` before review start.

Evidence:
- Verifier output: `./px.js review task-1339 --verify` → `[FAIL] Branch: current branch is mission/task-1339-clean, expected mission/task-1339`
- Current branch: `git branch --show-current` → `mission/task-1339-clean`
- Review state already in round 3 reviewing: `missions/task-1339/review-state.json:2-7`

## Finding 2 — The new compatibility guard makes pure unit tests depend on the real local `opencode` installation
Severity: high

`buildOpencodeInvocation()` is no longer a pure argument builder. It now calls `checkJsonFormatSupport()`, which shells out to the real `opencode` binary via `spawnSync('opencode', ['--format', 'json', '--help'])` (`lib/agents/opencode.js:53-75`, `:77-89`). The updated tests in both `test/opencode.test.js` and `test/agents.test.js` still assert that `--format json` is present by default (`test/opencode.test.js:43-49`, `test/agents.test.js:1030-1087` in the diff), but there is no injection hook or stub for the feature-detect.

So test pass/fail now depends on the workstation having a sufficiently new `opencode` on `PATH`. On a machine without `opencode`, or with an older binary that rejects `--format json`, these tests fail even if the repository code is otherwise correct. That is a real regression in test hermeticity and portability.

Evidence:
- Feature-detect shells out to real binary: `lib/agents/opencode.js:53-75`
- Invocation now branches on that external probe: `lib/agents/opencode.js:77-89`
- Assertions that assume JSON support unconditionally: `test/opencode.test.js:43-49`, `test/agents.test.js` qwen invocation expectations in the current diff
- No test hook exists for `_jsonFormatSupported` / `checkJsonFormatSupport`: `rg -n "checkJsonFormatSupport|jsonFormatSupported|preferJson" test lib`

## Finding 3 — CP-4 still overstates the verification depth by calling it “end-to-end” while the document itself says the launcher was not driven to completion
Severity: medium

`missions/task-1339/CP-4.md` now has the required Goal Check table and much better evidence than before, but the headline claim is still too strong. The summary says the repaired telemetry path was verified “end-to-end against the real `opencode` binary” (`missions/task-1339/CP-4.md:5-8`). Later in the same document, the Environmental note says the launcher’s `spawnAndTee` path could not be driven to completion because the child never closed, and that verification instead drove the telemetry components without depending on that process-exit behavior (`missions/task-1339/CP-4.md:39-47`).

Those two statements are not equivalent. The underlying evidence is useful, and the Goal Check table exists, but the document still overclaims what the live verification actually exercised.

Evidence:
- End-to-end summary claim: `missions/task-1339/CP-4.md:5-8`
- Environmental limitation / bypassed launcher completion: `missions/task-1339/CP-4.md:39-47`
- Goal Check table is present: `missions/task-1339/CP-4.md:49-59`

## Notes

- The branch diff is now appropriately scoped for this mission: `git diff main..HEAD` is limited to task-1339 artifacts, `lib/agents/opencode.js`, and related tests.
- The final checkpoint document does contain a Goal Check table with file/test citations. The remaining issue is the accuracy of one verification claim, not the absence of the table.

---
`[workflow-round:3, workflow-phase:reviewing]`