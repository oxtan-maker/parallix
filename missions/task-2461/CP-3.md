# CP-3: Renderer, colour, and TTY behaviour

## Summary

Added `src/adapters/agents/claude-stream-view.ts` — the formatting half of the
ADR 0056 renderer. `ClaudeStreamView` takes the `NormalizedEvent[]` from CP-2
and writes human-readable lines to an injected sink.

Rendered surfaces (the full non-TTY render of `test/fixtures/claude-stream-json.ts`):

```
● claude-opus-5 · session sess-2461 · 3 tools
✳ The tail buffer is fed before the sink.
Checking the launcher wiring.
⚒ Bash ls src/adapters
  ✓ Bash agents process
⚒ Read /nope.ts
  ✗ Read ENOENT: no such file
▶ sub-agent Explore · map renderers
▶ sub-agent Plan · plan the wiring
  ↳ Task#1 Explore scanning src/adapters
  ↳ Task#2 Plan drafting the plan
◀ ✓ Task#1 Explore found 3 renderers
◀ ✓ Task#2 Plan plan ready
· some_future_event
● done 42.0s · 4 turns · 1200 in / 640 out · $0.1234
```

- **Colour.** Every escape code comes from `util.styleText` per ADR 0042; the
  file contains no ANSI literal. Because the sink is injected (and is a plain
  object in tests) rather than a real stream, `styleText`'s stream validation is
  bypassed and the same `NO_COLOR` / `FORCE_COLOR` / `TERM=dumb` / TTY rules are
  applied to the sink by `colorEnabled()`. `FORCE_COLOR=0` force-disables, which
  is what the repo's own `FORCE_COLOR=0 tsx test/run-default-tests.ts` relies on.
- **Progress indicator.** A braille spinner with an elapsed-time label appears
  only after `idleMs` of silence and only when `sink.isTTY === true`. It is
  erased with a carriage return before the next rendered line, so a captured
  non-TTY log contains no spinner residue and no `\r`. The clock and the tick
  are injected, so the test needs no real timer.
- **Sub-agent labelling.** Sub-agent text is prefixed with its Task label at
  every line start, so two interleaved sub-agents stay separable in a flat
  stream.
- **Stream separation.** Thinking and assistant text carry a stream identity
  (`<kind>:<agent>`); a change forces a line break, so a thinking block never
  runs into the assistant sentence that follows it.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| All seven event kinds render at least one line, and no raw `{"type":` envelope reaches the terminal (criterion 3) | `test/task-2461-claude-stream-render.test.ts`, `"rendered fixture shows every required surface and no raw JSON envelope"` | PASS |
| Two concurrent sub-agents render as two separately labelled entries, neither dropped nor overwritten (criterion 4) | `test/task-2461-claude-stream-render.test.ts`, `"two concurrent sub-agents render as two separately labelled entries"` | PASS |
| Non-TTY output has no `\x1b[` sequences and no spinner frames (criterion 8) | `test/task-2461-claude-stream-render.test.ts`, `"non-TTY output carries no ANSI escapes and no spinner frames"` | PASS |
| `NO_COLOR` / `FORCE_COLOR` honoured per the recorded colour decision | `ADR 0042`; `test/task-2461-claude-stream-render.test.ts`, `"NO_COLOR suppresses ANSI escapes even on a TTY sink"` | PASS |
| Idle progress indicator appears on a TTY sink and is cleared before the next line, leaving no residue (criterion 9) | `test/task-2461-claude-stream-render.test.ts`, `"idle progress indicator is emitted on a TTY and cleared before the next line"` | PASS |
| Chunk-split input produces byte-identical rendered output (criterion 6, render side) | `test/task-2461-claude-stream-render.test.ts`, `"renderer output is identical for one-chunk and byte-split fixture streams"` | PASS |
| Renderer stays dependency-free as decided | `ADR 0056`; `src/adapters/agents/claude-stream-view.ts` imports only `node:util`; `package.json` unchanged | PASS |
| Lint and typecheck clean | `npx eslint src/adapters/agents/claude-stream-view.ts test/task-2461-claude-stream-render.test.ts` (no output), `npm run typecheck` | PASS |
| Checkpoint suite run | `npx tsx --test test/task-2461-claude-stream-render.test.ts` — 15 pass, 0 fail | PASS |

Next action: CP-4 — attach the renderer as `spawnAndTee`'s `stdoutSink` inside `startClaudeAgent`, add the `PARALLIX_CLAUDE_RAW_STREAM=1` escape hatch, and assert with a test that `extractClaudeTelemetryFromStdout` and `extractClaudeSessionId` return deep-equal values with and without the renderer attached (mission criteria 2, 5, 10).
