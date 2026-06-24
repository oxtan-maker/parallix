# CP-2: Reproduce the failure in focused automated tests

## Summary

Added three regression tests that encode the CP-1 root cause and **fail against
the current (unfixed) code**:

1. `test/opencode.test.js` — `extractOpencodeSessionId reads the sessionID field
   from JSON stdout (task-1339)`: feeds opencode v2.0.0 `--format json` stdout
   (a `"sessionID":"ses_..."` line, no legacy footer) and expects the id back.
2. `test/opencode.test.js` — `buildOpencodeInvocation requests JSON output so the
   session id is recoverable (task-1339)`: asserts the invocation passes
   `--format json` so a recoverable id is actually emitted.
3. `test/opencode-launcher-telemetry.test.js` — `startOpencodeAgent recovers the
   session id from opencode v2.0.0 JSON stdout`: end-to-end through the launcher
   — JSON stdout → session id → `opencode export` (injected) → attached
   non-zero telemetry.

## Goal Check

| Mission goal (CP2) | Evidence |
| --- | --- |
| Reproduce failure in a focused automated test | 3 tests added; run below |
| Test fails BEFORE the fix | All 3 marked `✖` (see command output) |
| Covers the previously failing scenario end-to-end | `test/opencode-launcher-telemetry.test.js:47-72` drives `startOpencodeAgent` from JSON stdout to attached telemetry |
| Unit coverage of the broken link | `test/opencode.test.js:25-31` (session id) and `:38-44` (`--format json` flag) |

Failing run (pre-fix):

```
✖ startOpencodeAgent recovers the session id from opencode v2.0.0 JSON stdout
✖ extractOpencodeSessionId reads the sessionID field from JSON stdout (task-1339)
✖ buildOpencodeInvocation requests JSON output so the session id is recoverable (task-1339)
```

Next action: Implement the minimal fix in `lib/agents/opencode.js` (add
`--format json` to `buildOpencodeInvocation`; broaden `extractOpencodeSessionId`
to read the JSON `sessionID` field with the footer regex kept as fallback) and
get the full `npm test` suite green (CP-3).
