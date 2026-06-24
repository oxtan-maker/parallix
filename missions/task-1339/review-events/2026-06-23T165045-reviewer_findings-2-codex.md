---
event_type: reviewer_findings
timestamp: 2026-06-23T16:50:45.120Z
round: 2
phase: reviewing
actor: codex
slug: task-1339
---

# Review Findings — task-1339

## Finding 1 — Branch scope is far outside the locked mission, so this change set cannot be approved against task-1339
Severity: high

The mission explicitly limits the work to qwen/opencode telemetry capture and related tests, and its Restricted Areas say not to broaden the change into unrelated workflow work. But `git diff main..HEAD` contains 124 changed files with large unrelated edits and deletions across other missions and workflow subsystems, including `lib/review/review-loop.js`, `lib/commands/handoff.js`, `lib/commands/integrate.js`, `lib/tools/forgejo.js`, multiple unrelated tests, `README.md`, and whole mission directories such as `missions/task-1323/` / `missions/task-1335/` / `missions/task-1336/`. That directly contradicts CP-4’s claim that the fix is limited to `lib/agents/opencode.js` plus opencode tests (`missions/task-1339/CP-4.md:91`).

Evidence:
- Mission restriction: `missions/task-1339/MISSION.md:70-82`
- Branch-wide diff scope: `git diff --stat main..HEAD` shows 124 changed files / 5067 deletions
- Example unrelated code changes in diff: `lib/commands/handoff.js`, `lib/commands/integrate.js`, `lib/review/review-loop.js`, `lib/tools/forgejo.js`
- Contradictory checkpoint claim: `missions/task-1339/CP-4.md:91`

## Finding 2 — The launcher now hard-requires `--format json` without any compatibility guard, so older opencode installs will fail to launch instead of merely losing telemetry
Severity: high

The actual fix is `lib/agents/opencode.js:45-52`, which unconditionally adds `--format json` to every qwen launch. That is only safe if the repo guarantees an opencode version that supports this flag. I could not find any such version floor. The repo’s operator contract still documents the qwen launcher as `opencode run --pure --dangerously-skip-permissions <prompt>` (`docs/agents.md:30`), with no required version, and the README still describes opencode telemetry as zero-by-design (`README.md:227-231`). On an older install that still emits the legacy footer but does not support `--format`, this change turns a telemetry gap into a hard launch failure.

What is missing is either:
- an explicit minimum opencode version contract, or
- a feature-detect / retry path that falls back to the legacy invocation when `--format json` is unsupported.

Evidence:
- Hard requirement introduced here: `lib/agents/opencode.js:45-52`
- Existing launcher contract: `docs/agents.md:23-30`
- No updated product contract for qwen telemetry: `README.md:227-231`
- Tests added only cover the JSON path, not unsupported-flag fallback: `test/opencode.test.js:43-49`, `test/opencode-launcher-telemetry.test.js:48-73`

## Finding 3 — The final checkpoint’s verification claims are only partially backed by durable evidence, but several Goal Check rows still mark PASS
Severity: medium

The review contract asked for the final checkpoint document to contain a Goal Check table citing real evidence such as file:line references and test names. `missions/task-1339/CP-4.md` does contain the required Goal Check table (`missions/task-1339/CP-4.md:73-96`), but the rows for the isolated verification and cleanup claims are not backed by durable file/test evidence. They rely on prose assertions about a real session, a temp CSV row, a shared-CSV hash, and deleted temp files (`missions/task-1339/CP-4.md:34-61`, `:80-82`), while the same document also states the launcher wrapper was not actually driven end-to-end because the process never closed in this environment (`missions/task-1339/CP-4.md:18-32`, `:65-70`). That means the CP is materially more precise than the earlier review found, but it still does not fully satisfy the “cite real evidence” bar for those PASS rows.

Evidence:
- Goal Check table exists: `missions/task-1339/CP-4.md:73-96`
- Verification scope excludes full launcher completion: `missions/task-1339/CP-4.md:18-32`, `:65-70`
- PASS rows that rely on non-file/test prose evidence: `missions/task-1339/CP-4.md:80-82`

## Notes

- The narrow code fix itself is coherent: `extractOpencodeSessionId` now recognizes JSON `sessionID`, and the new tests exercise that path (`lib/agents/opencode.js:33-38`, `test/opencode.test.js:25-49`, `test/opencode-launcher-telemetry.test.js:48-73`).
- The final checkpoint document does contain a Goal Check table, so that minimum artifact exists; the issue is the quality of evidence for some PASS claims, not the absence of the table.
- Required verifier command note: `px review task-1339 --verify` was not available on `PATH` in this shell; the repo-local `./px.js review task-1339 --verify` entrypoint was used instead. `graphify` was also not on `PATH`, so the existing graph artifacts could not be queried via CLI.

---
`[workflow-round:2, workflow-phase:reviewing]`