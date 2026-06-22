# Mission: opencode telemetry (task-1316)

## Goal
Implement real token-usage telemetry extraction from opencode session exports so that the opencode launcher records actual Qwen token counts (input, output, cached, total) in the stats CSV instead of the honest-zero stub. The implementation reads session data via `opencode export` (JSON format), parses the token-usage payloads, and attaches a telemetry object to the launcher result — mirroring the Codex rollout and Claude stream-json patterns.

## Why Now
The stats CSV currently records `input_tokens=0`, `output_tokens=0`, `cached_tokens=0` for every opencode/Qwen stage. This makes it impossible to compare Qwen cost/efficiency against Codex and Claude, and breaks dashboards that rely on token-level attribution. The `opencode export` JSON format already exists and contains the token-usage fields we need; the stub in `opencode-telemetry.js` is a known gap documented in task-1285. Closing this gap restores full telemetry parity across all three agent families.

## Refinement Signals
- Estimated agent % usage limit: 25-50%
- Confidence: High
- Selection note: activate as-is
- Main drivers: telemetry parity across agent families, stats CSV completeness, ADR 0039 credibility requirement

## Scope
- Extend `lib/agents/opencode-telemetry.js` with a parser function that accepts an `opencode export` JSON string and returns a normalized telemetry object matching the shape used by `codex-telemetry.js` and `claude-telemetry.js` (sessionId, provider, model, inputTokens, outputTokens, cachedTokens, totalTokens, toolCalls, usagePercent)
- Wire the parser into `lib/agents/opencode.js` in `startOpencodeAgent`: after the launcher completes, invoke `opencode export` (or read exported JSON from the result if already captured), parse it, and attach telemetry to `result.telemetry` (same try/catch pattern as codex.js and claude.js)
- Update `test/telemetry-stubs.test.js` tests for `extractOpencodeTelemetry` to validate the new parser instead of asserting null-always
- Add a new test file `test/opencode-telemetry.test.js` with offline unit tests covering: parsing valid export JSON, handling missing token fields (graceful zero fallback), rejecting malformed JSON, and verifying the telemetry shape matches `telemetryToStatsFields` expectations
- Ensure the stats pipeline (`lib/commands/stats.js:telemetryToStatsFields`) correctly maps the new opencode telemetry fields — no changes to the mapping function itself, only verification that the exported shape is compatible

## Out of Scope
- Modifying the `opencode` CLI itself or its export format
- Adding telemetry for the mistral/vibe agent (separate stub, separate task)
- Changes to the review-loop telemetry resolution (`lib/agents/stage-telemetry.js`) — it already falls back to `result.telemetry` for non-Codex agents, which covers opencode
- Dashboard or visualization changes; this mission only produces the CSV data points
- Cost estimation in USD (opencode export does not expose a `total_cost_usd` equivalent; that column will remain 0 until a pricing model is added in a follow-up mission)

## Success Criteria
> **Falsifiability rule (ADR 0039 Part 2):** Each criterion must be falsifiable.

1. `npm test` passes with zero failures, including the new `test/opencode-telemetry.test.js` and the updated assertions in `test/telemetry-stubs.test.js`.
2. `extractOpencodeTelemetry` (renamed to `extractOpencodeTelemetryFromExport`) returns a non-null telemetry object when given valid `opencode export` JSON containing token usage, with `inputTokens >= 0`, `outputTokens >= 0`, `totalTokens = inputTokens + outputTokens`, `provider === 'opencode'`, and `model === 'qwen'`.
3. `extractOpencodeTelemetryFromExport` returns `null` for empty strings, non-JSON strings, and JSON objects that lack any token-usage fields (no fabricated data).
4. When a token-usage field is absent from the export JSON (e.g., `cached_input_tokens` not present), the parser substitutes `0` for that field rather than throwing or returning null.
5. The `startOpencodeAgent` function in `lib/agents/opencode.js` attaches a non-null `result.telemetry` object when the opencode export JSON contains usable token data, following the same try/catch/best-effort pattern as `codex.js:84-96` and `claude.js:82-91`.
6. A full draft run with an opencode agent that produces token usage data writes non-zero `input_tokens` and `output_tokens` values to the stats CSV row for that stage (verifiable by inspecting the CSV output after a controlled run).
7. No regressions: all existing tests for codex-telemetry, claude-telemetry, stats, agents, draft, review-loop, and stage-telemetry continue to pass unchanged.

## Risks and Assumptions
- The `opencode export` JSON schema may differ between opencode versions; the parser must be resilient to missing or renamed fields.
- `opencode export` may require the session to be in a completed/idle state; if the export command blocks or fails while the session is still running, the telemetry capture must not hang the launcher (graceful degradation to null).
- The export command may not be available in all opencode installations (older versions); telemetry capture must be best-effort and never fail the launch.
- Assumption: the opencode export JSON contains fields analogous to `total_token_usage` (with `input_tokens`, `output_tokens`, `cached_input_tokens`) similar to the Codex rollout format. If the actual schema differs significantly, the parser logic will need adjustment.
- Assumption: opencode does not expose `usagePercent` / rate-limit data, so `usagePercent` will be null (matching Claude's pattern).

## Checkpoints
- CP 1: Parser prototype — `opencode-telemetry.js` can parse a known-good sample export JSON and produce a correctly shaped telemetry object.
- CP 2: Launcher integration — `opencode.js` calls the parser after session completion and attaches telemetry to the result.
- CP 3: Tests — new test file plus updated stub tests pass; existing regression tests unaffected.
- CP 4: End-to-end verification — a controlled draft run produces non-zero token stats in the CSV.

## Gates
- [ ] ./scripts/verify-local.sh docs

## Restricted Areas
- Do not modify `lib/commands/stats.js:telemetryToStatsFields` — the mapping function is shared and must remain agnostic to agent family.
- Do not modify `lib/agents/stage-telemetry.js` — it already handles non-Codex fallback correctly.
- Do not change the `opencode.js` function signatures (`buildOpencodeInvocation`, `startOpencodeAgent`, `resolveOpencodeCommand`) beyond adding telemetry extraction inside `startOpencodeAgent`.
- Do not alter the `opencode` CLI invocation arguments (the `run --pure --dangerously-skip-permissions` flags).

## Stop Rules
- Stop if `opencode export` does not produce JSON with any token-usage fields after verifying the installed opencode version supports it — escalate to task creation for investigation rather than guessing.
- Stop if integrating telemetry into the launcher causes the draft or review pipeline to hang or crash (even under the try/catch guard) — revert to the stub and document the blocker.
- Stop if the test suite regresses on any existing agent telemetry tests (codex, claude, mistral) — fix the root cause or narrow the scope.
