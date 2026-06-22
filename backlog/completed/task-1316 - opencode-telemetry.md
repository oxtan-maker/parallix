---
id: TASK-1316
title: opencode telemetry
status: done
assignee: [claude]
created_date: '2026-06-15 20:45'
labels: ["ai_sdlc"]
dependencies: []
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
its possible to get json export of an opencode session using opencode export, use this to capture telemetry from qwen similar to what is being done for codex and claude
<!-- SECTION:DESCRIPTION:END -->

## Implementation Summary

- Replaced honest-zero stub in `lib/agents/opencode-telemetry.js` with real parser (`extractOpencodeTelemetryFromExport`) that parses `opencode export` JSON
- Wired parser into `lib/agents/opencode.js` `startOpencodeAgent` — runs `opencode export <sessionId>` after session completion, attaches telemetry to `result.telemetry`
- Created `test/opencode-telemetry.test.js` with 24 offline unit tests covering: valid JSON parsing, all nesting paths (including real opencode v2.x `info.tokens` format), invalid inputs, graceful zero fallback, telemetry shape validation
- Updated `test/telemetry-stubs.test.js` assertions to reflect new parser behavior
- Verified E2E with real opencode session: non-zero `inputTokens=2802261`, `outputTokens=23469` extracted from actual export JSON
- All tests pass: 1521 pass, 0 fail (no regressions)
