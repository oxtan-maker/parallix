# CP-5: Docs and gate

## Summary

Documented the user-visible output change and ran the mission gate on the final
tree.

- `docs/agents.md` gains a **Claude live output view** section: why the launcher
  runs in `stream-json` mode at all (no on-disk transcript, telemetry is parsed
  from the stdout tail), a sample of the rendered view, the `Task#N` labelling
  of concurrent sub-agents, the idle progress indicator, the ADR 0042 colour
  rules, and the guarantee that the telemetry tail is byte-identical because the
  renderer sits downstream of `stdoutTail.push`.
- A **Restoring raw JSONL output** subsection documents the escape hatch
  `PARALLIX_CLAUDE_RAW_STREAM=1`, states that `=0` and unset both mean "render",
  and links `docs/adr/0056-claude-stream-json-output-rendering.md`.
- `./scripts/verify-local.sh all` passes on the final tree: 2421 pass, 0 fail,
  0 skipped. `static-analysis` and `docs` gates also pass.

Change size (ADR 0047): 1090 added / 6 deleted across `src/` and `test/`,
inside the mission's predicted Large (235+) NEL bucket. No stop rule fired: the
telemetry tail is provably unchanged, `stdio: 'inherit'` never reaches the
spawn (`spawnAndTee` overrides it), no runtime dependency was added, and the
gate failed nothing.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| 1. ADR scores all three options with exactly one Accept and is indexed | `ADR 0056` "Decision matrix" (rows A/B/C, C = **Accept**); `docs/adr/index.md` entry for `docs/adr/0056-claude-stream-json-output-rendering.md` | PASS |
| 2. `buildClaudeInvocation` still emits `--output-format stream-json --verbose --include-partial-messages` | `test/claude.test.ts`, `"buildClaudeInvocation includes --output-format stream-json --verbose --include-partial-messages for streaming progress"` | PASS |
| 3. All seven event kinds render a line, zero raw `{"type":` envelopes | `test/task-2461-claude-stream-render.test.ts`, `"rendered fixture shows every required surface and no raw JSON envelope"` | PASS |
| 4. Two concurrent sub-agents render as two separately labelled entries | `test/task-2461-claude-stream-render.test.ts`, `"two concurrent sub-agents render as two separately labelled entries"` and `"normalizer keeps two concurrent sub-agents separately labelled"` | PASS |
| 5. `extractClaudeTelemetryFromStdout` is identical with and without the renderer | `test/task-2461-claude-stream-render.test.ts`, `"telemetry from the fixture is identical with and without the renderer sink"` | PASS |
| 6. A record split across chunk boundaries renders exactly once | `test/task-2461-claude-stream-render.test.ts`, `"the render sink renders a chunk-split stream exactly once"`, `"renderer output is identical for one-chunk and byte-split fixture streams"`, `"normalizer emits identical events for a whole-stream write and byte-split writes"` | PASS |
| 7. Malformed / plain-text / unknown input neither throws nor aborts later events | `test/task-2461-claude-stream-render.test.ts`, `"normalizer survives malformed, plain-text, and unknown records"` | PASS |
| 8. Non-TTY or `NO_COLOR` output has no `\x1b[` and no spinner frames | `test/task-2461-claude-stream-render.test.ts`, `"non-TTY output carries no ANSI escapes and no spinner frames"`, `"NO_COLOR suppresses ANSI escapes even on a TTY sink"`; colour policy per `ADR 0042` | PASS |
| 9. Idle progress indicator is emitted on a TTY and cleared before the next line | `test/task-2461-claude-stream-render.test.ts`, `"idle progress indicator is emitted on a TTY and cleared before the next line"` (fake TTY-flagged sink, injected clock) | PASS |
| 10. Escape hatch restores raw JSONL to the terminal sink | `test/task-2461-claude-stream-render.test.ts`, `"the raw-stream escape hatch writes the unmodified stream to the terminal sink"` | PASS |
| 11. Docs describe the new view and the escape hatch | `docs/agents.md` — sections "Claude live output view" and "Restoring raw JSONL output"; verified by `./scripts/verify-local.sh docs` | PASS |
| 12. `./scripts/verify-local.sh all` passes; no `.only`, no bare `.skip` | `./scripts/verify-local.sh all` — exit 0, tests 2421, fail 0, skipped 0; `./scripts/verify-local.sh static-analysis` — "PASS: no test-hygiene violations", exit 0 | PASS |
| Restricted area untouched: `claude-telemetry.ts` | `git diff main...HEAD -- src/adapters/agents/claude-telemetry.ts` is empty; its parsing is exercised by `test/claude.test.ts` and `test/codex-telemetry.test.ts` | PASS |
| Restricted area respected: `TailBuffer` semantics | `test/spawn-tee.test.ts` passes unchanged; the `src/adapters/process/spawn-tee.ts` diff only widens the `stdoutSink`/`stderrSink` option types and exports `TeeSink` | PASS |
| No runtime dependency added | `ADR 0056` "Decision"; `git diff main...HEAD -- package.json` is empty, and no checkpoint commit touches `package-lock.json` (`git log --oneline main..HEAD -- package-lock.json` lists only the pre-mission commit `22afc2cdd draft(task-2461): capture agent output`) | PASS |

## Review round 1 response (codex, REQUEST_CHANGES)

Both findings were accepted and fixed.

- **F1 — Preserve later complete assistant messages after streamed output.**
  Deduplication is now per message id rather than a single global flag: a
  complete top-level `assistant` record is dropped only when that message id was
  already streamed as partial events, so a turn delivered whole after a streamed
  turn still renders (its text *and* its tool calls). Streams whose events carry
  no message id keep the previous conservative behaviour. Regression test added:
  `"normalizer keeps a whole-message turn that follows a streamed turn"`, which
  fails against the previous global-flag logic and passes after the fix.
- **F2 — Remove volatile implementation references from live documentation.**
  The `docs/agents.md` section no longer names source modules, internal call
  ordering, or the CLI flag inventory. It states the durable operator-facing
  guarantees instead: rendering is display-only so recorded telemetry is
  unchanged, unrecognized activity degrades to one line rather than failing the
  run, colour rules, and the `PARALLIX_CLAUDE_RAW_STREAM` escape hatch, with
  rationale linked to ADR 0042 and ADR 0056.

| Round 1 finding | Evidence | Status |
|---|---|---|
| F1 later whole-message turns survive | `test/task-2461-claude-stream-render.test.ts`, `"normalizer keeps a whole-message turn that follows a streamed turn"` (red before the fix, green after) | FIXED |
| F2 docs carry no volatile implementation facts | `./scripts/verify-local.sh docs` — "PASS: authored documentation contains no volatile implementation evidence and relative links resolve"; `docs/agents.md` "Claude live output view" | FIXED |
| Round 1 fixes do not regress the gate | `./scripts/verify-local.sh all` re-run on the post-fix tree | PASS |

## Post-approval live-run fixes

Running the renderer against a real `--output-format stream-json --verbose
--include-partial-messages` capture (rather than the synthetic fixture) exposed
two operator-visible defects that the fixture did not model:

- **CLI bookkeeping records rendered as activity.** The CLI emits `system`
  records with subtypes `status`, `hook_started`, `hook_response`,
  `task_progress`, `task_started`, `task_updated`, `task_notification` and
  `thinking_tokens`, plus top-level `rate_limit_event` and `tool_progress`
  records. Only `system`/`init` describes the session, so the others were
  printing a repeated `● session <id>` header (no model, no new information)
  several times per turn, and the top-level ones printed as `· rate_limit_event`
  unknown-event lines. Only the init record now renders; the rest are ignored.
- **The sub-agent tool is named `Agent`, not only `Task`.** The sub-agent test
  was `name === 'Task'`, so every real sub-agent launch fell through to the
  generic tool path: the line printed the compact JSON of the whole tool input —
  including the full sub-agent prompt — and, because no label was registered,
  the sub-agent's nested activity was attributed as `Task <id-suffix>` instead
  of a named entry. Both `Task` and `Agent` are now recognized as sub-agent
  tools, share the `subagent_type`/`description` condensed summary, and the
  label is derived from the tool name (`Agent#1 Explore`).

- **Thinking was invisible when the CLI returns it encrypted.** The recorded
  stream carries `thinking_delta`s with an empty string plus a `signature_delta`,
  so the thinking surface rendered nothing at all and a long reasoning pause
  looked like a hang. The CLI's `system`/`thinking_tokens` counter is the only
  observable evidence in that case: it now drives the progress indicator
  (`⠋ thinking 148 tokens · 12.0s`) and closes as one `✳ thinking · 148 tokens`
  line, while thinking that *does* arrive as text still streams as before.
- **The progress indicator did not say what was happening.** It read `working…`
  regardless. It now names the outstanding tool call or the reasoning in flight,
  which is the operator's only signal during a long silent tool call.
- **A silent sub-agent had no visible status.** Sub-agent activity was only
  visible when the CLI relayed the sub-agent's own events inline; a backgrounded
  agent showed nothing between launch and completion. The CLI's
  `system`/`task_progress` records now render for exactly those sub-agents, and
  are suppressed for the ones already relayed inline so nothing is narrated
  twice.

| Fix | Evidence | Status |
|---|---|---|
| CLI bookkeeping records are not rendered | `test/task-2461-claude-stream-render.test.ts`, `"normalizer drops CLI bookkeeping records that carry no activity"` | FIXED |
| `Agent` sub-agent launches are labelled, not dumped | `test/task-2461-claude-stream-render.test.ts`, `"the Agent sub-agent tool is labelled as a sub-agent, not dumped as raw input"` | FIXED |
| Opaque thinking is observable | `test/task-2461-claude-stream-render.test.ts`, `"encrypted thinking still reports that the model reasoned"` and `"visible thinking text is streamed and not replaced by a token summary"` | FIXED |
| The progress indicator names the current activity | `test/task-2461-claude-stream-render.test.ts`, `"the progress indicator names the current activity"` | FIXED |
| A silent sub-agent still reports progress, without double narration | `test/task-2461-claude-stream-render.test.ts`, `"a silent sub-agent reports progress; a relayed one is not narrated twice"` | FIXED |
| Docs describe both sub-agent tool names, the suppressed bookkeeping, and the activity indicator | `docs/agents.md` "Claude live output view" | FIXED |
| Fixes do not regress the gate | `./scripts/verify-local.sh all` re-run on the post-fix tree | PASS |

Next action: hand off task-2461 for review — the reviewer should focus on the `stdoutSink` seam in `src/adapters/agents/claude.ts` (`launch()`) and confirm that no future caller can move rendering ahead of `stdoutTail.push` in `src/adapters/process/spawn-tee.ts`.
