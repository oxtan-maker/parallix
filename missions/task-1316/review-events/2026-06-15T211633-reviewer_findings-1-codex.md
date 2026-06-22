---
event_type: reviewer_findings
timestamp: 2026-06-15T21:16:33.647Z
round: 1
phase: reviewing
actor: codex
slug: task-1316
---

# Review Findings: task-1316

## 1. High: `opencode export` can hang the launcher indefinitely

`startOpencodeAgent` awaits a second `spawnAndTee` process for `opencode export`, but supplies no timeout, watchdog termination, or cancellation path (`lib/agents/opencode.js:55-74`). The `try/catch` and Promise `.catch()` only help after spawning throws or the child exits/rejects; they do not handle a child that remains running.

This directly violates the mission risk requirement that export capture "must not hang the launcher" and the stop rule covering launcher hangs. Add a bounded timeout that terminates the export child and returns the original launch result, with a launcher-level test proving a non-exiting export cannot block `resultPromise`.

## 2. High: exports larger than 1 MiB are silently truncated into invalid JSON

The export is captured through `spawnAndTee` with `maxTailBytes: 1024 * 1024` (`lib/agents/opencode.js:53-60`). `spawnAndTee` retains only the tail once output exceeds that limit. Because `opencode export` emits one JSON document beginning with `{`, any export larger than 1 MiB loses its prefix and `JSON.parse` returns `null`, so stats revert to zero.

This is reproducible with a 1,100,221-byte valid export: the full payload parses to non-zero telemetry, while its 1 MiB tail returns `null`. CP-4 only tested a 565,381-byte file, so it does not establish that the integration is safe for longer sessions. Capture the complete export through a bounded mechanism (for example a temporary file or a purpose-built capped collector that fails explicitly) and test an export larger than the previous cap.

## 3. Medium: real opencode tool calls are always reported as zero

`countToolCalls` only understands synthetic top-level fields and event arrays (`lib/agents/opencode-telemetry.js:205-236`). Actual `opencode export` data stores tool calls in `messages[].parts[]` where `part.type === "tool"`. The real `/tmp/opencode-export.json` used by CP-4 contains 59 such tool parts, but the parser reports `toolCalls: 0`.

The normalized telemetry contract includes `toolCalls`, and the stats pipeline writes this value. Traverse the actual export schema and add a real-format fixture/test that expects the correct count.

## 4. Medium: success criterion 6 and CP-4's end-to-end claim are not demonstrated

Mission success criterion 6 requires a controlled draft run that writes non-zero values to the stats CSV. CP-4 only runs an already-exported JSON file through the parser (`missions/task-1316/CP-4.md:5-20`); it does not exercise `startOpencodeAgent`, stage telemetry resolution, or `recordStageStats`. No CSV in the checkout contains the cited session ID or token values.

Add an integration test or controlled-run artifact that exercises launcher export attachment through stats-row creation and cites the resulting test name/file:line or CSV row. The final Goal Check table currently cites `/tmp/opencode-export.json` and prose rather than durable test evidence for this criterion.

## 5. Workflow inconsistency: required guidance/gate and verifier are not reliable

The requested root `AGENTS.md` does not exist in this checkout or on `main`. The mission gate `./scripts/verify-local.sh docs` also cannot run because `scripts/verify-local.sh` does not exist. The required `px review task-1316 --verify` command was unavailable on `PATH`; the repository-local equivalent `node px.js review task-1316 --verify` started, emitted a failure in `test/task-1109.test.js`, and then remained running for more than three minutes until its process tree was terminated. A separate direct `npm test` run passed with 1521 tests and 0 failures, showing the verifier result is inconsistent/flaky rather than a clean pass.

Per the review instructions, this inconsistency is reported rather than repaired.

---
`[workflow-round:1, workflow-phase:reviewing]`