# CP-4: Verify qwen stats write correctly in an isolated run and clean up

## Summary

Verified the repaired telemetry path through the full component pipeline against
the **real** `opencode` binary (v2.0.0, model `cyankiwi/Qwen3.6-35B-A3B-AWQ-4bit`)
and confirmed it produces a non-zero qwen stats row, while leaving the shared
stats CSV byte-identical.

Note: the launcher's `spawnAndTee` process-exit path was not driven to completion
(hangs due to a lingering opencode server holding stdout open — unrelated to this
fix). Telemetry capture was verified using live opencode output injected directly
into `extractOpencodeSessionId` and `extractOpencodeTelemetryFromExport`, bypassing
the `spawnAndTee` exit dependency.

### Verification chain (all real components)

1. A real `opencode run --pure --dangerously-skip-permissions --format json`
   first stdout line (captured live this session, `ses_10acbf09...`) fed to the
   **patched** `extractOpencodeSessionId` → recovered
   `ses_10acbf09fffeimKc7ouh0Kjh2d`.
2. Real `opencode export ses_10acbf09...` → 3716-byte JSON with
   `info.tokens {input:11090, output:22}`.
3. Real `extractOpencodeTelemetryFromExport` →
   `{inputTokens:11090, outputTokens:22, totalTokens:11112, provider:"opencode",
   model:"cyankiwi/Qwen3.6-35B-A3B-AWQ-4bit"}`.
4. Real `telemetryToStatsFields` + `upsertStatsRow` into an **isolated** temp CSV
   → row:
   `2026-06-23,Workflow,task-verify-1339,ai_sdlc,qwen,0,opencode,cyankiwi/Qwen3.6-35B-A3B-AWQ-4bit,,,active,11090,22,0,11112,0,0,0,0,1,0`
   (`input_tokens=11090`, `output_tokens=22` — both non-zero).

This is the same drop the production CSV showed: before the fix every one of the
140 qwen rows had `input_tokens=output_tokens=0`; the verified path now writes
real usage.

### Cleanup / no pollution

- Verification wrote only to a `mktemp` CSV (`rootDir`/`filePath` overridden);
  the shared CSV `~/.local/state/parallix/stats.csv` was **byte-identical**
  before and after (sha256 `d67277ec...`, unchanged; `grep -c task-verify-1339`
  on the shared CSV = `0`).
- All temp scripts and artifacts removed (`/tmp/verify-1339*.js`,
  `/tmp/t-spawn*.js`, `/tmp/v1339_*`, `/tmp/oc_*`, `/tmp/exp*`).

### Environmental note (out of scope)

Driving the launcher's `spawnAndTee` to completion hangs in this sandbox because
a lingering `opencode` server holds the stdout pipe open, so the pipe never
EOFs and `child.on('close')` never fires. This reproduces with the **default**
output format too, so it is unrelated to this fix (the mission is telemetry
capture, not spawn-tee process management). The verification therefore drives the
telemetry components with real opencode output without depending on that
process-exit behavior.

## Goal Check

| Mission success criterion | Evidence |
| --- | --- |
| 1. Root cause written down with file refs + reproducible condition | `missions/task-1339/CP-1.md`; session id regex `lib/agents/opencode.js:45-53`; repro: `opencode run --pure ...` emits no `ses_` footer |
| 2. Path patched so a valid qwen run no longer resolves to null/all-zero | `lib/agents/opencode.js:102-115` (`--format json` via `buildOpencodeInvocation`/`checkJsonFormatSupport`) + `:45-53` (JSON `sessionID` match); telemetry now `{inputTokens:11090,...}` |
| 3. Automated regression covering the failing scenario end-to-end | `test/opencode-launcher-telemetry.test.js:48-73` (`startOpencodeAgent recovers the session id from opencode v2.0.0 JSON stdout`) |
| 4. `npm test` passes, no new failures | Full suite `tests 1636 / pass 1614 / fail 0 / skipped 22` |
| 5. Isolated run yields a non-zero qwen stats row | Real opencode v2.0.0 export → parser → `telemetryToStatsFields`+`upsertStatsRow` wrote CSV row `input_tokens=11090, output_tokens=22` (live session `ses_10acbf09fffeimKc7ouh0Kjh2d`); corroborated by automated test `test/opencode-launcher-telemetry.test.js:109-154` (`startOpencodeAgent telemetry flows through to a non-zero stats CSV row`) which asserts `input_tokens > 0` and `output_tokens > 0` in the persisted CSV (`:147-148`) |
| 6. Temp verification artifacts removed; shared CSV not polluted | Shared CSV `~/.local/state/parallix/stats.csv` sha256 `d67277ec...` unchanged; `grep -c task-verify-1339` on shared CSV = 0; temp files (`/tmp/verify-1339*.js`, `/tmp/t-spawn*.js`, `/tmp/v1339_*`, `/tmp/oc_*`, `/tmp/exp*`) deleted; test fixture cleanup verified by `test/opencode-launcher-telemetry.test.js:152` (`fs.rmSync(dir, { recursive: true, force: true })`) |
| 7. Backlog labels exactly `ai_sdlc` | `backlog/tasks/task-1339 - qwen-statistics-are-not-captured.md:7` → `labels: ["ai_sdlc"]` |

## Gates

| Gate | Status |
| --- | --- |
| Root cause is concrete and reproducible | PASS — CP-1, `lib/agents/opencode.js:45-53` |
| Fix limited to qwen/opencode telemetry capture and related tests | PASS — only `lib/agents/opencode.js` (added `checkJsonFormatSupport`, `preferJson` param, JSON `sessionID` recovery) + opencode/agents tests |
| Automated regression coverage for the failing case | PASS — `test/opencode-launcher-telemetry.test.js:48-73`, `test/opencode.test.js:35-40,54-61` |
| `npm test` passes | PASS — 1614 pass / 0 fail / 22 skipped (1636 total) |
| Verification shows a non-zero qwen stats row | PASS — `input_tokens=11090, output_tokens=22` |
| Temporary verification data removed from shared stats CSV | PASS — shared CSV byte-identical; 0 verify rows |
| Backlog labels remain exactly `["ai_sdlc"]` | PASS — frontmatter line 7 |

Next action: Commit the mission docs and code change on `mission/task-1339`, then
hand off to review.
