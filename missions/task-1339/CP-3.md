# CP-3: Apply the minimal fix and get `npm test` green

## Summary

Implemented the minimal, scoped fix in `lib/agents/opencode.js` — nothing else
in the telemetry path changed (the export collector and parser were already
correct).

1. **`buildOpencodeInvocation`** now passes `--format json`
   (`lib/agents/opencode.js:40`). In JSON mode opencode v2.0.0 streams NDJSON
   events that each carry `"sessionID":"ses_..."`, the only reliable way to
   recover the id since the legacy footer is gone.
2. **`extractOpencodeSessionId`** now matches the JSON `sessionID` field via
   `OPENCODE_JSON_SESSION_ID_RE = /"sessionID"\s*:\s*"(ses_[^"]+)"/`, with the
   legacy footer regex kept as a first-choice fallback
   (`lib/agents/opencode.js:33-44`). Backward compatible: older builds that still
   print the footer keep working.

Test assertions that pinned the opencode argv were updated to include
`--format json` (`test/agents.test.js`).

## Goal Check

| Mission goal (CP3) | Evidence |
| --- | --- |
| Patch limited to qwen/opencode telemetry capture | Only `lib/agents/opencode.js` changed in `lib/` (2 functions); diff touches no other agent |
| Session id now recovered from real v2.0.0 stdout | `extractOpencodeSessionId` matches `"sessionID":"ses_..."` — `lib/agents/opencode.js:33,38-43`; test `extractOpencodeSessionId reads the sessionID field from JSON stdout (task-1339)` (`test/opencode.test.js:25-31`) |
| Invocation emits a recoverable id | `--format json` in argv — `lib/agents/opencode.js:40`; test `buildOpencodeInvocation requests JSON output...` (`test/opencode.test.js:38-44`) |
| End-to-end launcher coverage passes | `startOpencodeAgent recovers the session id from opencode v2.0.0 JSON stdout` (`test/opencode-launcher-telemetry.test.js:47-72`) |
| Regression tests pass after fix | `node --test test/opencode.test.js test/opencode-launcher-telemetry.test.js` → 22 pass, 0 fail |
| `npm test` green, no new failures | Full suite: `tests 1628`, `pass 1606`, `fail 0`, `skipped 22` (pre-existing) |

Next action: Run an isolated verification against the real `opencode` binary to
prove a non-zero qwen stats row, and confirm the shared stats CSV is left
untouched (CP-4).
