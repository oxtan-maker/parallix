# ADR 0056: Claude `stream-json` Terminal Output Rendering

Status: Accepted
Date: 2026-09-06

## Context

`buildClaudeInvocation` in `src/adapters/agents/claude.ts` runs the Claude CLI
with `--output-format stream-json --verbose --include-partial-messages`. That
flag set is load-bearing: unlike Codex, the Claude CLI writes no on-disk rollout
transcript, so `src/adapters/agents/claude-telemetry.ts` recovers token usage,
model, session id, and cost by parsing `message_start` / `message_delta` /
`result` events straight out of the captured stdout tail.

The side effect is that the operator watching a mission stage reads raw SSE
envelopes. `spawnAndTee` (`src/adapters/process/spawn-tee.ts`) pushes every
stdout chunk into a `TailBuffer` *and* writes the same chunk verbatim to
`stdoutSink` (default `process.stdout`). Both consumers see the same bytes, so
today the terminal shows JSONL.

Two facts constrain any fix:

1. **The tail is the only telemetry source for Claude.** Anything that consumes
   or transforms chunks before `stdoutTail.push` silently zeroes usage
   reporting.
2. **`spawnAndTee` already owns stdio.** `buildClaudeInvocation` sets
   `stdio: 'inherit'` in its options object, but `spawnAndTee` spreads those
   options and then overrides `stdio: ['inherit', 'pipe', 'pipe']` on the
   `childProcess.spawn` call. The override wins, so stdout is genuinely
   pipeable and a renderer can be attached without touching the invocation.

Fact 2 is what makes a sink-level renderer possible at all: `stdoutSink` is an
existing, already-injectable option, and it is downstream of the tail push.

The task asks for the three option classes to be evaluated in a fixed priority
order: (a) a generalized multi-agent library that could serve every launcher,
(b) a Claude/Anthropic-specific SDK, (c) a hand-rolled renderer.

### What the library options actually are

Parallix does not call model APIs from its launchers. It *shells out to vendor
CLIs* (`claude`, `codex`, `opencode`, `qwen`, `vibe`) and reads their stdout.
The generalized agent libraries — Vercel AI SDK (`ai`, Apache-2.0, ~7.0 MB
unpacked, 3 first-party runtime deps), OpenAI Agents, LangChain,
`@earendil-works/pi-coding-agent` (MIT, ~21.9 MB unpacked) — abstract *model
invocation and their own agent loop*. None of them consumes another vendor's
CLI stdout. Adopting one to render Claude output means replacing the Claude CLI
launch with that library's own agent loop, which is explicitly out of scope and
would also delete the telemetry seam described above. `pi.ts` already
demonstrates the shape: adopting pi's SDK meant adopting pi's session, not
gaining a renderer for anybody else.

The Claude-specific option is `@anthropic-ai/claude-agent-sdk` (v0.3.263,
`SEE LICENSE IN README.md`, ~5.0 MB unpacked, no runtime dependencies). It is a
real fit for the *event shapes* — it is the same `stream-json` protocol — but it
works by spawning and owning its own `claude` CLI subprocess and yielding
structured messages over an async iterator. It offers no terminal renderer at
all: the formatting work is identical either way. Using it would mean giving up
`spawnAndTee` (and with it bubblewrap wrapping, the tail buffer, the no-output
watchdog, and the stale-session retry) in exchange for a JSON parse we already
perform in `claude-telemetry.ts`.

## Decision

Hand-roll a dependency-free renderer: a new module
`src/adapters/agents/claude-stream-render.ts` that exposes a
`stdoutSink`-shaped object (a `{ write() }` writable-alike) which `spawnAndTee`
writes to *after* `stdoutTail.push`. It splits the byte stream on newlines
across chunk boundaries, normalizes both documented envelope shapes
(`{"type":"stream_event","event":{…}}` and bare top-level SSE events) plus the
CLI's top-level `system` / `assistant` / `user` / `result` events into a small
internal event union, and renders each to the real terminal sink.

Colour follows ADR 0042: `util.styleText` only, no ANSI literals, no new
dependency. Ink stays reserved for the interactive TUI (ADR 0051).

**This decision adds no runtime dependency.** `package.json` is unchanged.

An escape hatch (`PARALLIX_CLAUDE_RAW_STREAM=1`) restores the previous verbatim
JSONL passthrough for anyone piping Parallix stdout into a machine consumer.

## Decision matrix

| Option | Summary | Benefits | Risks / Costs | Fit to constraints | Decision |
|--------|---------|----------|---------------|--------------------|----------|
| A: Generalized multi-agent library (`ai` / OpenAI Agents / `pi-coding-agent`) | Replace per-launcher code with one agent abstraction | One event model for every launcher; upstream maintains provider drift | None of them read another vendor CLI's stdout; adopting one replaces the Claude CLI launch, deleting the stdout-tail telemetry seam and the `spawnAndTee` bubblewrap/watchdog/stale-resume path; 7.0–21.9 MB unpacked runtime dependency; still ships no terminal renderer, so the formatting code gets written anyway | Solves a different problem (model invocation) than the one at hand (rendering a CLI's stdout). Violates the out-of-scope rule on the Claude invocation | Reject |
| B: Claude/Anthropic SDK (`@anthropic-ai/claude-agent-sdk` 0.3.263) | Consume `stream-json` through Anthropic's typed async iterator | Vendor-maintained event types, exact protocol match, zero transitive runtime deps | Spawns and owns its own `claude` subprocess, so `spawnAndTee` (tail buffer, bubblewrap, no-output watchdog, stale-session retry) is bypassed; ~5.0 MB unpacked and a proprietary `SEE LICENSE IN README.md` licence inside an AGPL-3.0 package that runs `npm audit --omit=dev` and `scripts/package-content-audit.ts` on publish; provides no rendering, only parsing — and `claude-telemetry.ts` already parses these events with no dependency | Buys typed parsing at the cost of the telemetry seam it must not disturb; the rendering work, which is the actual mission, is unchanged | Reject |
| C: Hand-rolled sink renderer (`util.styleText`, no dependency) | Newline-split + normalize + format on the `stdoutSink` seam | Renders strictly downstream of `stdoutTail.push`, so telemetry is byte-identical by construction; no runtime dependency, no licence or bundle-audit impact; unknown event types degrade to a one-line fallback instead of throwing; `stdoutSink` is an existing `spawnAndTee` option, so the seam already exists; consistent with ADR 0042 colour handling | Parallix owns Claude's unversioned `stream-json` event shapes and must absorb upstream drift; a second launcher wanting this must reuse the module rather than inherit an abstraction | Only option that satisfies the invariant that the telemetry tail is untouched, and the only one that actually produces terminal output | **Accept** |

## Consequences

### Positive consequences

- Telemetry is safe by construction, not by care: the renderer lives on
  `stdoutSink`, and `stdoutTail.push(chunk)` runs first and unconditionally in
  `spawnAndTee`. Nothing in the render path can reach the tail.
- No runtime dependency, so no change to bundle size, `npm audit --omit=dev`,
  `scripts/package-content-audit.ts`, or the AGPL-3.0 licence posture.
- The Claude CLI invocation, `stream-json` format choice, and
  `CLAUDE_TELEMETRY_TAIL_BYTES` are all untouched.
- The module takes lines in and writes formatted text out, so a second launcher
  emitting Anthropic SSE JSONL can reuse it without a per-agent abstraction.

### Negative consequences

- Parallix owns the event-shape mapping for a schema the Claude CLI does not
  version for us. Mitigation: unknown `type` values render as a single dim
  fallback line, and malformed JSON is dropped, so drift degrades the view
  rather than crashing the stage.
- Two rendering paths now exist for terminal output (this renderer and the Ink
  TUI). This is the two-path maintenance cost ADR 0042 names. It is accepted
  here because launcher stdout is batch/headless output that must never
  initialize React or cursor control while an agent is streaming.
- Operators or scripts that parsed Parallix stdout for raw JSONL must set
  `PARALLIX_CLAUDE_RAW_STREAM=1`.

## Links

- [ADR 0042](0042-workflow-cli-color-rendering-approach.md) — `util.styleText`
  governs batch/headless terminal colour; this renderer follows it.
- [ADR 0051](0051-ui-neutral-application-boundary.md) — Ink is the interactive
  TUI stack and is deliberately not pulled into launcher output.
- [ADR 0044](0044-workflow-distribution-model.md) — canonical ESM bundle; a
  dependency-free renderer needs no bundling change.
- `src/adapters/agents/claude-telemetry.ts` — documents the two envelope shapes
  this renderer normalizes.
