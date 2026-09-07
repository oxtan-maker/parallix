# Mission: Human-readable Claude stream-json output visualizer (task-2461)

## Goal
Replace the raw `stream-json` JSONL that Claude launches currently dump to the terminal with a rendered, human-readable activity view, without changing what the telemetry parser sees. `src/adapters/agents/claude.ts` runs the CLI with `--output-format stream-json --verbose --include-partial-messages`, and `spawnAndTee` (`src/adapters/process/spawn-tee.ts`) writes every stdout chunk verbatim to `process.stdout`. The operator therefore watches unreadable JSON. This mission introduces a renderer on the terminal-facing sink only — the `TailBuffer` capture that `extractClaudeTelemetryFromStdout` and `extractClaudeSessionId` consume keeps receiving byte-identical raw JSONL.

Rendered surfaces required (the mission explicitly rejects a 1/3-of-activity minimal view like the `pi` launcher's `text_delta`-only tee in `src/adapters/agents/pi.ts`):
- assistant text (streamed as it arrives)
- thinking / reasoning blocks
- tool calls: tool name, condensed input, and completion/error status
- sub-agent (Task tool) activity, including concurrent sub-agents
- a progress/liveness indicator while the model is working with no visible output
- init/system line (model, session id) and a final result line (duration, token usage, cost when present)

## Why Now
JSON mode is load-bearing: Claude telemetry has no on-disk transcript, so `src/adapters/agents/claude-telemetry.ts` parses `message_start` / `message_delta` / `result` events straight out of the captured stdout tail. That decision made the stream unreadable for humans as a side effect, and it is the launcher used for nearly every Parallix mission stage. Every operator watching a mission run today reads raw SSE envelopes. The fix is additive at the sink boundary, so it is cheap now and gets more expensive once more launchers copy the raw-tee pattern.

## Refinement Signals
- Predicted NEL bucket: Large (235+)
- Confidence: High
- Selection note: activate as-is
- Main drivers: new renderer module plus event-normalization layer, wiring through `spawnAndTee` sink options, a decision ADR comparing agent-library options, and event-shape unit tests covering assistant text, thinking, tool calls, sub-agents, and result events.

## Scope
- Research and record a decision ADR under `docs/adr/` (next free number, registered in `docs/adr/index.md`) evaluating, in the priority order the backlog task states: (a) a generalized multi-agent library that could serve every launcher, (b) an Anthropic/Claude-specific SDK, (c) a hand-rolled renderer. The ADR must contain a decision matrix with the same column shape used by `docs/adr/0042-workflow-cli-color-rendering-approach.md` and state explicitly whether the chosen option adds a runtime dependency.
- Implement the chosen renderer as a new module under `src/adapters/agents/` (or `src/adapters/process/` if it is launcher-neutral) that consumes Claude `stream-json` JSONL lines and emits formatted terminal output.
- Handle both envelope shapes `claude-telemetry.ts` already documents: `{"type":"stream_event","event":{...}}` and bare top-level SSE events, plus the CLI's top-level `system`, `assistant`, `user`, and `result` events.
- Wire the renderer into `startClaudeAgent` via a `stdoutSink`-shaped option on `spawnAndTee`, keeping `stdoutTail` fed with the unmodified chunks.
- Handle partial-line chunking: a JSONL record split across two stdout chunks must render once, correctly, not twice or as garbage.
- Degrade safely: non-JSON lines, unknown event types, and malformed JSON pass through or are dropped without throwing and without killing the stream.
- Respect non-TTY / `NO_COLOR` / `FORCE_COLOR` via `util.styleText` per ADR 0042; no ANSI escapes and no spinner animation when stdout is not a TTY.
- Add tests under `test/` covering event normalization and rendering for each required surface, and a test asserting the telemetry tail is unchanged by rendering.
- Update `docs/` for the user-visible output change and any new env var / flag that toggles raw mode.

## Out of Scope
- Changing the Claude CLI invocation flags, the `stream-json` format choice, or `CLAUDE_TELEMETRY_TAIL_BYTES`.
- Any change to `src/adapters/agents/claude-telemetry.ts` parsing logic or the telemetry schema.
- Porting the renderer to the `codex`, `opencode`, `qwen`, `vibe`, or `pi` launchers. Keep the seam clean enough that a second launcher can adopt it later, but do not build a per-agent abstraction with one consumer.
- The interactive Ink TUI (`src/interfaces/tui/`) and the web board (`src/interfaces/web/`).
- Replacing the pi launcher's own event subscription in `src/adapters/agents/pi.ts`.
- Persisting rendered output to disk or adding a new log file.

## Success Criteria
> **Falsifiability rule (ADR 0039 Part 2):** Each criterion must be falsifiable. Forbidden: subjective adjectives ("easy, fast, simple, intuitive, user-friendly, responsive, quick, efficient" without an attached metric) and vague quantifiers ("multiple, several, some, many, few, various"). For refactor / condense / migration missions, the criterion must enumerate the specific elements (rules, files, behaviours) that must survive — generic phrases like "preserve critical content" are not sufficient.

1. A new ADR file exists under `docs/adr/` with a decision matrix that scores all three researched options (generalized agent library, Claude/Anthropic SDK, hand-rolled) and marks exactly one **Accept**; it is listed in `docs/adr/index.md`.
2. `buildClaudeInvocation` in `src/adapters/agents/claude.ts` still produces the argv `--output-format stream-json --verbose --include-partial-messages`, proven by an existing or added assertion in `test/claude.test.ts`.
3. Feeding a recorded `stream-json` fixture through the renderer produces terminal output that contains, for each of these seven event kinds, at least one line and zero raw `{"type":` JSON envelopes: system/init, assistant text delta, thinking/reasoning block, tool call start (tool name visible), tool result/error, sub-agent (Task) activity, final result.
4. Two concurrent sub-agent activities interleaved in one fixture stream render as two separately labelled entries; neither is dropped and neither overwrites the other.
5. `extractClaudeTelemetryFromStdout` returns identical values for the fixture stream whether or not the renderer is attached — asserted by a test that runs the same fixture through both paths and deep-equals the telemetry objects.
6. A JSONL record split across two chunk boundaries renders exactly once, asserted by a test that writes the same fixture in one chunk and in byte-split chunks and compares rendered output.
7. Malformed input (a truncated JSON line, a plain-text line, an unknown `type`) does not throw and does not abort rendering of subsequent valid events, asserted by a test.
8. With `stdout` non-TTY or `NO_COLOR=1`, rendered output contains no `\x1b[` sequences and no spinner frames, asserted by a test.
9. A progress indicator is emitted while the stream is idle and is cleared before the next rendered line, so no spinner residue appears in captured non-TTY output (criterion 8 covers the non-TTY case; TTY behaviour asserted against a fake TTY-flagged sink).
10. An escape hatch exists to restore raw JSONL output (documented env var or CLI flag), asserted by a test that the raw path writes the unmodified stream to the terminal sink.
11. Docs under `docs/` describe the new output view and the escape hatch from criterion 10.
12. `./scripts/verify-local.sh all` passes on the final tree; no `.only` and no bare `.skip` introduced.

## Risks and Assumptions
- **Telemetry regression is the top risk.** The tail buffer is the only telemetry source for Claude. Any renderer that consumes/transforms the chunks before `stdoutTail.push` silently zeroes usage reporting. Mitigation: render on a separate sink, never in the tail path; criterion 5 locks it.
- **`stdio: 'inherit'` mismatch.** `buildClaudeInvocation` sets `stdio: 'inherit'` in its options while `spawnAndTee` overrides stdio to `['inherit','pipe','pipe']`. Confirm which wins before assuming stdout is pipeable; if inherit ever leaks through, the renderer never sees data.
- **Event-shape drift.** The Claude CLI's `stream-json` schema is not versioned by Parallix. Unknown event types must degrade to a one-line fallback rather than an exception (criterion 7).
- **New dependency risk.** If the ADR selects a library option it adds a runtime dependency to a package that currently ships only `@earendil-works/pi-coding-agent` as an optional peer. The ADR must state bundle-size and licence impact, since `scripts/package-content-audit.ts` and `npm audit --omit=dev` run on publish.
- **Assumption:** ADR 0042's `util.styleText` decision governs colour here; Ink is reserved for the interactive TUI (ADR 0051) and is not to be pulled into launcher output.
- **Assumption:** rendered output is for a human at a terminal; machine consumers of Parallix stdout (if any exist in scripts) use the raw escape hatch from criterion 10.

## Checkpoints
- CP 1: Research and ADR. Read `src/adapters/agents/claude.ts`, `claude-telemetry.ts`, `spawn-tee.ts`, and `pi.ts`; evaluate the three option classes in the backlog's priority order; write the ADR with its decision matrix and index entry. No production code changes in this checkpoint.
- CP 2: Event normalization core. Parse JSONL (both envelope shapes), handle chunk-boundary buffering, and normalize into a small internal event union covering the seven kinds in criterion 3 plus sub-agent attribution. Tests for parsing, chunk splitting, and malformed input (criteria 6, 7).
- CP 3: Renderer and colour/TTY behaviour. Format each normalized event, add the idle progress indicator, honour `util.styleText` / `NO_COLOR` / non-TTY (criteria 3, 4, 8, 9).
- CP 4: Wiring and telemetry safety. Attach the renderer sink in `startClaudeAgent`, add the raw-output escape hatch, and prove the telemetry tail and session-id extraction are byte-identical with and without rendering (criteria 2, 5, 10).
- CP 5: Docs and gate. Update `docs/` for the new view and escape hatch, run `./scripts/verify-local.sh all`, and record the goal-check table (criteria 11, 12).

### Checkpoint Documentation Requirements
Every checkpoint document (CP-N.md) MUST include:
- A summary of work done
- A `## Goal Check` section
- A 3-column pipe-delimited markdown table with columns: Criterion | Evidence | Status
- At least one evidence row per criterion using durable, verifiable references. Parallix already accepts:
  1. **Recognized repo commands or paths** — e.g., `` `npm test -- test/claude.test.ts` ``, `` `node --enable-source-maps build/px.mjs --version` ``, or `` `./scripts/verify-local.sh all` ``
  2. **Test names** — e.g., `"renderer output is identical for one-chunk and byte-split fixture streams"` (must match a test name in the repo)
  3. **Test file paths** — e.g., `test/claude.test.ts` or the new renderer test file under `test/` (must be an existing test file)
  4. **ADR references** — e.g., `ADR 0042` or the new renderer ADR (must correspond to an existing file under `docs/adr/`)
  5. **File:line references** — accepted when needed, but line numbers eventually rot; prefer the forms above
- Raw `stat`/`ls` output or generic prose may appear as supplemental context, but pair them with one of the accepted references above. A row whose Evidence column is only `stat src/adapters/agents/claude-stream-render.ts` or only prose such as "renderer now shows tool calls" is not acceptable and will be treated as missing evidence — add the test name, test file path, ADR, or runnable command that proves it.
- A non-generic `Next action:` line at the bottom

Example Goal Check table:

| Criterion | Evidence | Status |
|---|---|---|
| Renderer leaves telemetry tail byte-identical | `test/task-2461-claude-stream-render.test.ts`, `"telemetry from fixture is identical with and without the renderer sink"` | PASS |
| Claude argv still requests stream-json partial messages | `npm test -- test/claude.test.ts` | PASS |
| Colour approach follows the recorded decision | `ADR 0042` | PASS |
| Verification gate ran | `./scripts/verify-local.sh all` | PASS |

## Gates
- [ ] `./scripts/verify-local.sh all`

## Restricted Areas
- `src/adapters/agents/claude-telemetry.ts` — parsing logic and exported shape must not change.
- `src/adapters/agents/codex.ts`, `opencode.ts`, `qwen.ts`, `vibe.ts`, `pi.ts` and their telemetry siblings.
- `src/interfaces/tui/` and `src/interfaces/web/`.
- `TailBuffer` semantics in `src/adapters/process/spawn-tee.ts` — new sink options may be added, but tail capture and `maxTailBytes` behaviour stay as-is.
- `backlog/` — only `backlog/tasks/task-2461 - implement-a-better-claude-output-visualizer.md` may be touched, and not its `assignee` field.
- `package.json` dependencies — only editable if the CP 1 ADR selected an option that requires it, and the ADR must say so first.

## Stop Rules
- Stop and report if the renderer cannot be attached without the telemetry tail changing (criterion 5 unsatisfiable) — that means the sink seam is wrong and the design needs review before more code.
- Stop if `stdio: 'inherit'` from `buildClaudeInvocation` actually reaches the spawn and stdout is not pipeable; changing the invocation is out of scope, so surface it instead.
- Stop if satisfying the seven rendered surfaces requires a new runtime dependency that CP 1's ADR did not select.
- Stop if the change would exceed the per-mission change-size budget in ADR 0047; report the overrun rather than splitting work silently.
- Stop if `./scripts/verify-local.sh all` fails for reasons outside this mission's diff; report the failing test name and the baseline status rather than patching unrelated production code to make it green.
