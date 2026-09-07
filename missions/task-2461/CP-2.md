# CP-2: Event normalization core

## Summary

Added `src/adapters/agents/claude-stream-render.ts` — the normalization half of
the ADR 0056 renderer. It takes raw stdout chunks and returns a small
`NormalizedEvent` union; no terminal formatting yet (CP-3) and no wiring yet
(CP-4).

- **Framing.** `ClaudeStreamNormalizer.push()` buffers across chunk boundaries
  and splits on `\n`, so a JSONL record split across two writes is emitted
  exactly once. A `node:string_decoder` `StringDecoder` guards the other split
  case: a multi-byte UTF-8 character cut in half by a chunk boundary.
  `flush()` emits a final record that arrived without a trailing newline.
- **Envelopes.** Both shapes `claude-telemetry.ts` documents are handled —
  `{"type":"stream_event","event":{…}}` and bare top-level SSE — plus the CLI's
  top-level `system`, `assistant`, `user`, and `result` events.
- **Event union.** `system`, `text`, `thinking`, `tool_start` (name + condensed
  input), `tool_result` (with `isError`), `result` (duration, cost, tokens,
  turns), `passthrough` (plain-text lines), `unknown` (type drift fallback).
- **Sub-agent attribution.** `parent_tool_use_id` on the envelope resolves to
  the label minted when the owning `Task` tool call was seen
  (`Task#1 Explore`, `Task#2 Plan`). Open content blocks are keyed
  `<agent>:<index>` rather than by index alone, because concurrent sub-agents
  reuse the same block indices — without that key, two parallel sub-agents
  overwrite each other's open tool call.
- **Degradation.** Malformed JSON is dropped, plain text passes through,
  unknown types become a single `unknown` event, and any throw inside event
  handling is caught and downgraded to `unknown`. Nothing aborts the stream.
- **Duplicate suppression.** With `--include-partial-messages` the CLI emits
  both partial `stream_event`s and a complete top-level `assistant` message for
  the same content. The complete record is dropped only when its own message id
  was already streamed, so a later turn delivered whole — with no partial events
  of its own — still renders. (Revised in review round 1, finding F1; the
  original global flag dropped every complete message after the first partial.)
  When events carry no message id at all, the earlier global-flag behaviour is
  the fallback, since an id-less complete record cannot be distinguished from
  the duplicate.

`test/fixtures/claude-stream-json.ts` holds the recorded-shape fixture used by
this and the remaining checkpoints: init, thinking, split text deltas, a Bash
tool call whose input arrives as two `input_json_delta` fragments, a successful
and an errored tool result, two concurrent `Task` sub-agents interleaved on the
same block index, a bare SSE `message_delta`, an unknown event type, and the
final `result` event with usage and `total_cost_usd`.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Both envelope shapes and the CLI's top-level events normalize | `test/task-2461-claude-stream-render.test.ts`, `"normalizer covers every required surface of the recorded stream-json fixture"` | PASS |
| Sub-agent attribution keeps two concurrent Task activities separate (criterion 4 groundwork) | `test/task-2461-claude-stream-render.test.ts`, `"normalizer keeps two concurrent sub-agents separately labelled"` | PASS |
| A record split across chunk boundaries is emitted exactly once (criterion 6) | `test/task-2461-claude-stream-render.test.ts`, `"normalizer emits identical events for a whole-stream write and byte-split writes"` (deep-equals whole-stream vs 1-byte vs 7-byte chunking) | PASS |
| A multi-byte character split across chunks is not corrupted | `test/task-2461-claude-stream-render.test.ts`, `"normalizer does not corrupt a multi-byte character split across two chunks"` | PASS |
| Malformed / plain-text / unknown records do not throw and do not abort later events (criterion 7) | `test/task-2461-claude-stream-render.test.ts`, `"normalizer survives malformed, plain-text, and unknown records"` | PASS |
| Assistant text is not rendered twice when partial and complete forms both arrive, and a later whole-message turn is not lost | `test/task-2461-claude-stream-render.test.ts`, `"normalizer keeps a whole-message turn that follows a streamed turn"` and `"normalizer treats an id-less assistant fallback message as a duplicate once partial events were seen"` | PASS |
| Tool calls carry a readable condensed input | `test/task-2461-claude-stream-render.test.ts`, `"tool input is condensed to its salient field"` and `"condense collapses whitespace and caps length"` | PASS |
| New files are lint- and type-clean | `npx eslint src/adapters/agents/claude-stream-render.ts test/task-2461-claude-stream-render.test.ts test/fixtures/claude-stream-json.ts` (no output) and `npm run typecheck` | PASS |
| Design matches the recorded decision | `ADR 0056` — hand-rolled, dependency-free; `package.json` unchanged in this checkpoint | PASS |
| Suite run for this checkpoint | `npx tsx --test test/task-2461-claude-stream-render.test.ts` — 9 pass, 0 fail | PASS |

Next action: CP-3 — add `src/adapters/agents/claude-stream-view.ts`, formatting each `NormalizedEvent` with `util.styleText` per ADR 0042, plus the idle progress indicator that is suppressed on a non-TTY sink and cleared before the next rendered line (mission criteria 3, 4, 8, 9).
