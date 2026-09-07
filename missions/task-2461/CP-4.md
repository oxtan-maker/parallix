# CP-4: Wiring and telemetry safety

## Summary

Attached the renderer to the Claude launcher and proved the telemetry path is
untouched.

- `createClaudeRenderSink()` (in `src/adapters/agents/claude-stream-view.ts`)
  builds the `stdoutSink` object `spawnAndTee` writes each stdout chunk to: it
  feeds the CP-2 normalizer, renders through the CP-3 view, runs the TTY
  progress timer (unref'd, cleared on `close()`), and flushes any unterminated
  final record on `close()`. A throw inside rendering is swallowed per ADR 0056
  — the operator loses a line, not the mission stage.
- `startClaudeAgent` now routes both spawn paths (first launch and the stale
  session retry) through one `launch()` helper that attaches the sink and calls
  `sink.close()` in a `.finally`. `stdoutSink` is placed *before* the spread of
  `invocation.options` and `teeOptions`, so an explicit caller-supplied sink
  still wins.
- `SpawnTeeOptions.stdoutSink` / `stderrSink` were widened from
  `NodeJS.WriteStream` to a new exported `TeeSink` (`{ write(chunk) }`). This is
  an additive option-type change only: `TailBuffer`, `maxTailBytes`, and the
  order `stdoutTail.push(chunk)` → `stdoutSink.write(chunk)` are all unchanged.
- Escape hatch: `PARALLIX_CLAUDE_RAW_STREAM=1` (also `RAW_STREAM_ENV` /
  `rawStreamRequested()`) returns a verbatim passthrough sink, restoring the
  previous raw JSONL terminal output. `=0` and unset both mean "render".
- `buildClaudeInvocation` was not touched: the argv still requests
  `--output-format stream-json --verbose --include-partial-messages`.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Claude argv still requests stream-json partial messages (criterion 2) | `test/claude.test.ts`, `"buildClaudeInvocation includes --output-format stream-json --verbose --include-partial-messages for streaming progress"`; run with `npm test -- test/claude.test.ts` | PASS |
| Telemetry is identical with and without the renderer attached (criterion 5) | `test/task-2461-claude-stream-render.test.ts`, `"telemetry from the fixture is identical with and without the renderer sink"` — deep-equals `extractClaudeTelemetryFromStdout` on both paths and asserts the captured tail is byte-identical to the raw fixture | PASS |
| Session-id extraction is unaffected | same test, `"telemetry from the fixture is identical with and without the renderer sink"` — `extractClaudeSessionId` equal on both paths and equal to `sess-2461` | PASS |
| The renderer sink is actually attached by the launcher and the tail budget is unchanged | `test/task-2461-claude-stream-render.test.ts`, `"startClaudeAgent attaches the renderer sink without changing the telemetry tail size"` (asserts `maxTailBytes === 8 MiB` and a `stdoutSink` with `write`/`close`) | PASS |
| An escape hatch restores raw JSONL on the terminal sink (criterion 10) | `test/task-2461-claude-stream-render.test.ts`, `"the raw-stream escape hatch writes the unmodified stream to the terminal sink"` | PASS |
| A chunk-split record renders exactly once through the real sink (criterion 6) | `test/task-2461-claude-stream-render.test.ts`, `"the render sink renders a chunk-split stream exactly once"` | PASS |
| `TailBuffer` semantics and `maxTailBytes` behaviour unchanged | `test/spawn-tee.test.ts` and `test/agents.test.ts` pass unchanged; the diff to `src/adapters/process/spawn-tee.ts` only widens the `stdoutSink`/`stderrSink` option types and adds the exported `TeeSink` interface | PASS |
| Stop rule "renderer cannot be attached without the telemetry tail changing" does not apply | `ADR 0056` (sink is downstream of `stdoutTail.push`), proven by `"telemetry from the fixture is identical with and without the renderer sink"` | PASS |
| Lint and typecheck clean | `npx eslint src/adapters/agents/claude.ts src/adapters/agents/claude-stream-view.ts src/adapters/process/spawn-tee.ts test/task-2461-claude-stream-render.test.ts` (no output); `npm run typecheck` | PASS |
| Related suites still green | `npx tsx --test --experimental-test-module-mocks test/spawn-tee*.test.ts test/agents.test.ts test/claude.test.ts` — 148 pass, 0 fail, 1 pre-existing skip; `npx tsx --test test/task-2461-claude-stream-render.test.ts` — 19 pass, 0 fail | PASS |

Next action: CP-5 — document the rendered view and `PARALLIX_CLAUDE_RAW_STREAM` in `docs/agents.md`, then run `./scripts/verify-local.sh all` on the final tree and record the closing goal-check table (mission criteria 11, 12).
