# Mission: stop false Codex/Mistral autoblocks and persist blocklist reasons (task-1404)

## Goal

Expand `NON_BLOCKING_LAUNCH_ERROR_PATTERNS` in `lib/agents/agents.ts` to cover the remaining non-quota failure shapes that still poison Codex and Mistral into the persistent blocklist (websocket/connectivity errors, provider-unreachable errors, "os error 1"), and add a human-readable `reason` field to every timed blocklist entry written by `updateAgentBlock` so operators can diagnose why an agent is blocked by reading `agents.local.json` directly.

## Why Now

Tasks 1392 and 1398 fixed the most obvious false-block paths (deterministic config/setup failures and Mistral's missing `--yolo` flag), but live probes still show Codex getting autoblocked on connectivity/runtime errors like `failed to connect to websocket ... Operation not permitted (os error 1)` and `reachability ... required provider endpoints are unreachable over HTTP`. These are not quota events — they are transient infrastructure issues that should not poison the persistent blocklist. Additionally, blocklist entries currently only store `{ until }`, offering zero diagnostic context, so every future incident requires log archaeology instead of reading the file.

## Refinement Signals

- Predicted NEL bucket: Small (0–80)
- Confidence: High
- Selection note: narrow, well-scoped — one function to extend and one function to augment
- Main drivers: two remaining false-block error shapes + blocklist observability gap

## Scope

- Extend `NON_BLOCKING_LAUNCH_ERROR_PATTERNS` in `lib/agents/agents.ts` (line ~113-126) with regex patterns matching:
  - websocket/connection failures (e.g., `failed to connect to websocket`, `connection refused`, `ECONNREFUSED`, `os error 1`)
  - provider reachability errors (e.g., `provider endpoints are unreachable`, `reachability`, `endpoint unreachable`)
  - generic transient runtime errors that clearly indicate non-quota failures
- Add a `reason` field to blocklist entries persisted by `updateAgentBlock` in `lib/agents/agents.ts`:
  - Change `payload.blocklist[agent] = { until }` to `payload.blocklist[agent] = { until, reason }`
  - Thread the existing `blockReason` variable (currently only used in log messages at line 917-920) into the persisted entry
  - For limit-hit blocks, set `reason` to the limit-hit source (e.g., `"parsed"`, `"fallback"`, `"sigint"`) plus a brief description (e.g., `"usage limit reached"`)
- Add a `reason` parameter to `updateAgentBlock`'s public signature: `updateAgentBlock(agent, until, options?)` where `options.reason?: string`
- Update `detectLimitHit` in `lib/agents/limit-hit.ts` to return a `reason` field alongside `until` and `source`
- Regression tests covering both false-block prevention and reason persistence

## Out of Scope

- Fixes to other agent families (claude, opencode/custom) — they already have working patterns
- Changes to blocklist expiry mechanics (the `{ until }` timestamp format and `parseBlockUntil` logic)
- Blocklist cleanup or unblocking APIs
- Migration of existing blocklist entries to include reasons
- Changes to the agent selection algorithm or fallback logic

## Success Criteria

- SC 1: `NON_BLOCKING_LAUNCH_ERROR_PATTERNS` in `lib/agents/agents.ts` contains at least three new regex patterns covering: (a) websocket/connection errors, (b) provider-reachability errors, and (c) generic os-error/transient failures. Each pattern is verified by a unit test in `test/agents-limit-hit.test.js` asserting `shouldPersistLaunchFailureBlock` returns `false`.
- SC 2: `updateAgentBlock` accepts an optional `reason` string and persists it as `payload.blocklist[agent] = { until, reason }` in `agents.local.json`. A test in `test/agents-limit-hit.test.js` asserts the `reason` field is present in the written JSON.
- SC 3: `detectLimitHit` returns `{ until, source, reason }` with a human-readable reason derived from the matched limit-hit pattern (e.g., `"weekly usage limit reached"`). Tests in `test/limit-hit.test.js` validate the new `reason` field.
- SC 4: Existing limit-hit behavior is preserved — genuine quota/limit events for Codex and Mistral still produce timed blocks with correct `until` timestamps. Verified by tests in `test/agents-limit-hit.test.js` asserting `shouldPersistLaunchFailureBlock` returns `true` for real limit-hit error shapes.
- SC 5: All existing tests pass, and `./scripts/verify-local.sh static-analysis` reports zero ESLint errors and a clean tsc typecheck on every changed file.

## Risks and Assumptions

- Risk: Overly broad regex patterns could suppress legitimate blocks. Mitigation: each new pattern must be narrow enough to match only non-quota errors, and every pattern must have a corresponding regression test.
- Assumption: The `blockReason` variable already computed in `startAgent` (agents.ts:917-920) captures the right categorization for non-limit-hit failures.
- Assumption: Adding `reason` to `agents.local.json` is backward-compatible — consumers that only check `entry.until` will continue to work, and consumers that read `entry.reason` will get `undefined` for legacy entries.
- Risk: `detectLimitHit` consumers expect only `{ until, source }`. Mitigation: JavaScript objects are extensible; callers that destructure only `{ until, source }` will ignore the new field.

## Checkpoints

- CP 1: Author a failing reproduction test in `test/agents-limit-hit.test.js` that simulates a non-quota Codex failure with stderr `failed to connect to websocket ... Operation not permitted (os error 1)`, asserting `shouldPersistLaunchFailureBlock('codex', result)` returns `false` (red before fix, green after).
- CP 2: Add the three new regex patterns to `NON_BLOCKING_LAUNCH_ERROR_PATTERNS` and confirm the reproduction test from CP 1 passes.
- CP 3: Add `reason` field to `updateAgentBlock`'s persisted entry and thread the existing `blockReason` into it; add a test asserting `{ until, reason }` shape in `agents.local.json`.
- CP 4: Add `reason` to `detectLimitHit`'s return value and update the limit-hit block path in `startAgent` to pass it to `updateAgentBlock`; add tests in `test/limit-hit.test.js`.
- CP 5: Run `./scripts/verify-local.sh all` and `./scripts/verify-local.sh static-analysis` — both must pass.

## Gates

- [ ] ./scripts/verify-local.sh docs
- [ ] ./scripts/verify-local.sh static-analysis
- [ ] ./scripts/verify-local.sh all

## Restricted Areas

- `config/` — do not modify integration or agent configuration files
- `docs/` — do not modify documentation (no user-facing behavior change for docs)
- `lib/agents/claude.ts`, `lib/agents/opencode.ts` — out of scope, do not modify
- `test/package-persistent-data.test.js` — do not modify (snapshot test of CLI commands)

## Stop Rules

- Stop adding patterns if any new regex risks matching real quota/limit messages — narrow the pattern instead.
- Stop if `./scripts/verify-local.sh static-analysis` fails with type errors that suggest the `reason` field breaks downstream consumers — revert to a simpler approach.
- Stop if the reproduction test cannot be made hermetic (e.g., requires real network or external agents) — rewrite the test to mock the launcher output directly.

## Bug Lock

Reproduction-Test: test/agents-limit-hit.test.js
