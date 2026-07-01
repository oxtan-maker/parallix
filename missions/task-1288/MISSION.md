# Mission: Verify vibe/mistral telemetry once usage-unblocked (task-1288)

## Goal
Determine whether Mistral Vibe emits any structured token-usage data in a live session once the account is no longer usage-blocked. If a stable, parseable source exists (stdout JSON, `~/.vibe/logs/session/*/meta.json`, or another on-disk artifact), implement `extractMistralTelemetry()` in `lib/agents/mistral-telemetry.ts` to parse it and add a fixture-backed test mirroring `test/codex-telemetry.test.js`. If no stable source exists, update the module docblock and exports to document the negative result and keep honest zeros.

## Why Now
Task-1285 established the telemetry credibility framework and left mistral/vibe as a deliberate honest-zero stub because the test environment account was usage-blocked, preventing live capture of any structured usage artifact. With the block removed, this is the last agent-family telemetry gap to resolve before the telemetry system can claim full credibility across all supported agents.

## Refinement Signals
- Predicted NEL bucket: Small (0–80)
- Confidence: High
- Selection note: activate as-is
- Main drivers: direct follow-up to task-1285; single-file implementation or documentation update; fixture-backed test if implementation proceeds; no cross-module dependencies

## Scope
- Run a live Mistral Vibe session (programmatic mode) and capture all output artifacts: stdout/stderr content and any files written under `~/.vibe/logs/`.
- Analyze captured artifacts for any structured token-usage data (JSON, metrics, counters).
- If structured data found: implement `extractMistralTelemetry()` in `lib/agents/mistral-telemetry.ts` to parse it, following the pattern in `lib/agents/codex-telemetry.ts` (parse function + extract function + fixture-backed test).
- If no structured data found: update the module docblock in `lib/agents/mistral-telemetry.ts` to reflect findings and keep honest zeros.
- Update or add tests in `test/telemetry-stubs.test.js` to cover the new implementation or the documented negative result.

## Out of Scope
- Modifying the Mistral Vibe CLI or launcher flags (e.g., adding `--output json`).
- Implementing telemetry for any agent other than mistral/vibe.
- Changes to `lib/agents/stage-telemetry.ts`, `lib/agents/agents.ts`, or the stats CSV pipeline.
- Any changes to `lib/agents/mistral.ts` launcher logic beyond minor env-var wiring if needed by the parser.
- Cross-mission workflow changes or orchestration logic.

## Success Criteria
> **Falsifiability rule (ADR 0039 Part 2):** Each criterion must be falsifiable.

- At least one live Mistral Vibe session is run and its output artifacts (stdout, stderr, on-disk files) are captured and reviewed.
- If structured token-usage data is found: `extractMistralTelemetry()` in `lib/agents/mistral-telemetry.ts` returns a non-null telemetry object with at least `inputTokens`, `outputTokens`, and `totalTokens` fields for a sample parsed artifact, AND a corresponding test in `test/telemetry-stubs.test.js` validates the parse function against a fixture.
- If no structured token-usage data is found: `lib/agents/mistral-telemetry.ts` contains a docblock stating the negative finding, and `extractMistralTelemetry()` continues to return null with an updated comment explaining why.
- All existing tests pass: `npm test` succeeds with zero failures, including `test/telemetry-stubs.test.js` and `test/mistral.test.js`.
- Static analysis passes: `./scripts/verify-local.sh static-analysis` reports clean ESLint, tsc, and test-hygiene.

## Risks and Assumptions
- Assumption: Once the account is unblocked, Mistral Vibe will produce at least some output artifacts under `~/.vibe/logs/` that can be inspected.
- Risk: Mistral Vibe may genuinely not emit any structured usage data, in which case the mission's implementation path is closed and only documentation updates remain.
- Risk: The `meta.json` structure under `~/.vibe/logs/session/` may be undocumented or unstable, making a parser fragile. The implementation must include defensive parsing with graceful null-fallback.
- Assumption: The `VIBE_ACTIVE_MODEL` env var mechanism (already wired in `lib/agents/mistral.ts`) remains the correct model identification approach.
- Risk: Live session capture requires network access and a valid Mistral API key — if unavailable, the mission's verification step cannot proceed.

## Checkpoints
- CP 1: Capture and review live Vibe session artifacts. Identify whether any structured token-usage data exists (stdout JSON, `meta.json`, or other). Record the decision: implement parser or document negative result.
- CP 2: If implementing parser — write `extractMistralTelemetry()` in `lib/agents/mistral-telemetry.ts` with a parse function following the codex-telemetry pattern, and add a fixture-backed test in `test/telemetry-stubs.test.js`. If documenting negative result — update the module docblock and comments.
- CP 3: Run `npm test` and `./scripts/verify-local.sh static-analysis`. Confirm all tests pass and static analysis is clean.

## Gates
- [ ] ./scripts/verify-local.sh all

## Restricted Areas
- Do not modify `lib/agents/stage-telemetry.ts` — the mistral telemetry integration point is already wired through the existing launcher result pipeline.
- Do not modify `lib/agents/agents.ts` or any resume-capability logic.
- Do not change the test harness structure in `test/` beyond adding or updating tests in `test/telemetry-stubs.test.js` and `test/mistral.test.js`.
- Do not modify `lib/agents/mistral.ts` beyond minimal env-var additions if the parser needs them.

## Stop Rules
- Stop if no structured usage data can be captured after 2 live session attempts — document the negative result and close implementation.
- Stop if the `meta.json` structure proves undocumented/unstable and no alternative structured source is found.
- Stop if a required dependency (network access, valid API key, Vibe binary) is unavailable and cannot be provisioned.
- Stop if the implementation requires changes outside `lib/agents/mistral-telemetry.ts` and `test/telemetry-stubs.test.js` — escalate for scope review.
