# Mission: Stream pi SDK output to console so user can see agent activity (task-2311)

## Goal
Restore real-time console visibility for the pi agent launcher so users can see what pi is doing while it runs, matching the behavior of other agent families (claude, codex, opencode) that use `spawnAndTee`.

## Why Now
After switching pi from a subprocess launcher (`spawnAndTee`) to the `@earendil-works/pi-coding-agent` SDK (`createAgentSession`), the console is empty during agent execution. The SDK collects output through event subscriptions and only returns it at the end. The `teeOptions` parameter is received but ignored. Users have no visibility into agent progress, making it impossible to tell if the agent is working, stalled, or thinking.

## Refinement Signals
- Predicted NEL bucket: Small (0–80)
- Confidence: High
- Selection note: activate as-is
- Main drivers: one-file change in `src/platform/runtime/lib/agents/pi.ts` event subscription handler; add stdout tee for `text_delta` events; update existing test coverage

## Scope
- Modify `startPiAgent` in `src/platform/runtime/lib/agents/pi.ts` to write `text_delta` event content to `process.stdout` as it arrives during `session.prompt()` / `session.waitForIdle()` execution
- Wire `teeOptions.noOutputWatchdog.onNoOutput` through the pi SDK launcher so the no-output watchdog fires correctly (currently the parameter is ignored)
- Update or add tests in `test/pi-runner.test.ts` to verify that text output is written to stdout during SDK execution and that the watchdog callback is invoked

## Out of Scope
- Changing the output format or adding progress bars / spinners — those are separate UX improvements
- Modifying other agent launchers (claude, codex, opencode) — they already use `spawnAndTee` and work correctly
- Adding stderr streaming for pi SDK tool execution events — focus is on assistant text visibility
- SDK event types other than `text_delta` (e.g., `thinking_delta`, `tool_execution_start`) — only assistant text is visible output

## Success Criteria
> **Falsifiability rule (ADR 0039 Part 2):** Each criterion must be falsifiable. Forbidden: subjective adjectives ("easy, fast, simple, intuitive, user-friendly, responsive, quick, efficient" without an attached metric) and vague quantifiers ("multiple, several, some, many, few, various"). For refactor / condense / migration missions, the criterion must enumerate the specific elements (rules, files, behaviours) that must survive — generic phrases like "preserve critical content" are not sufficient.

- SC1: `text_delta` events from the pi SDK `message_update` subscription are written to `process.stdout` synchronously inside the `subscribe` callback, so terminal output appears in real time during `session.prompt()` / `session.waitForIdle()`
- SC2: The `teeOptions` parameter is no longer ignored in `startPiAgent` — it is unpacked and its `noOutputWatchdog` sub-object is used to create a watchdog timer that calls `onNoOutput` when no text_delta has arrived within the configured `initialDelayMs`
- SC3: The test file `test/pi-runner.test.ts` contains at least one test that verifies `process.stdout.write` is called with text content during a mocked pi SDK session execution
- SC4: The test file `test/pi-runner.test.ts` contains at least one test that verifies the `teeOptions.noOutputWatchdog.onNoOutput` callback is invoked when no text output arrives within the configured delay
- SC5: Existing tests in `test/pi-runner.test.ts` continue to pass — no regression in SDK output filtering (chatter suppression), session ID propagation, telemetry extraction, error handling, resume flow, model propagation, or environment propagation
- SC6: `./scripts/verify-local.sh all` passes on the final tree

## Risks and Assumptions
- The SDK's `subscribe` callback is called synchronously for each event; writing to `process.stdout` inside the callback does not block the event loop in a way that affects agent performance
- `process.stdout` is available and writable during SDK execution (it is a Node.js TTY or piped stream)
- The `text_delta` delta strings are already newline-free or can be safely written as-is without adding extra newlines (the existing `assistantText` accumulator concatenates them directly)
- The no-output watchdog timer in pi can reuse the same pattern as `spawnAndTee.ts` (schedule a `setTimeout`, clear on first output)

## Checkpoints
Reproduction-Test: test/task-2311-console-empty-repro.test.ts
- CP 1: Author a failing reproduction test at `test/task-2311-console-empty-repro.test.ts` that locks the bug before any fix is written. The test verifies that `process.stdout.write` is called with text content during a mocked pi SDK session execution. It must fail (red) on the parent commit because the current `startPiAgent` ignores `teeOptions` and does not tee text_delta to stdout. It will pass (green) once the fix lands.
- CP 2: Implement stdout tee in `src/platform/runtime/lib/agents/pi.ts` — write `text_delta` content to `process.stdout` inside the `subscribe` callback. Wire `teeOptions.noOutputWatchdog` with a timer that fires `onNoOutput` when no text_delta arrives within the configured delay. Verify the reproduction test turns green and all existing tests still pass.

### Checkpoint Documentation Requirements
Every checkpoint document (CP-N.md) MUST include:
- A summary of work done
- A `## Goal Check` section
- A 3-column pipe-delimited markdown table with columns: Criterion | Evidence | Status
- At least one evidence row per criterion using verifiable references. Parallix already accepts:
  1. **File:line references** — e.g., `src/platform/runtime/lib/agents/pi.ts:250` (must point to an existing file and line)
  2. **Test names** — e.g., `"startPiAgent writes text_delta to process.stdout during execution"` (must match a test name in the repo)
  3. **Test file paths** — e.g., `test/pi-runner.test.ts` (must be an existing test file)
  4. **ADR references** — e.g., `ADR 0042` (must correspond to an existing file under `docs/adr/`)
  5. **Recognized repo commands or paths** — e.g., `` `node --import tsx test/pi-runner.test.ts` ``, `` `./scripts/verify-local.sh all` ``
- Raw `stat`/`ls` output or generic prose may appear as supplemental context, but pair them with one of the accepted references above
- A non-generic `Next action:` line at the bottom

Example Goal Check table:

| Criterion | Evidence | Status |
|---|---|---|
| text_delta events tee to stdout | `src/platform/runtime/lib/agents/pi.ts:248` | PASS |
| Watchdog callback wired from teeOptions | `src/platform/runtime/lib/agents/pi.ts:255` | PASS |
| Stdout tee test passes | `test/pi-runner.test.ts`, `"startPiAgent writes text_delta to process.stdout during execution"` | PASS |
| Verification gate ran | `./scripts/verify-local.sh all` | PASS |

## Gates
- [ ] `./scripts/verify-local.sh all`

## Restricted Areas
- `src/platform/runtime/lib/agents/claude.ts`, `codex.ts`, `opencode.ts`, `vibe.ts` — other agent launchers are not in scope
- `src/platform/runtime/lib/core/spawn-tee.ts` — do not modify the shared spawn-tee module
- `src/interfaces/cli/dispatcher.ts` — dispatcher is not in scope

## Stop Rules
- Do not add progress bars, spinners, or ANSI cursor manipulation — scope is limited to streaming text to stdout
- Do not modify the event subscription logic beyond adding the stdout write and watchdog timer
- Do not change the result shape returned by `startPiAgent` — the existing contract with `agents.ts` must be preserved
- Do not introduce new dependencies — use only `node:process` (already available)
- If stdout writing causes test failures in existing tests, the fix is to mock `process.stdout.write` in those tests, not to remove the feature
