# Mission: Fix opencode launcher model handling (-m flag rejects valid model) (task-1351)

## Goal

Investigate why `opencode -m <model-identifier>` rejects the raw model name `cyankiwi/Qwen3.6-35B-A3B-AWQ-4bit` from `workflow.config.json` with "Model not found", determine the correct identifier format opencode expects for custom models, and fix `buildOpencodeInvocation` in `lib/agents/opencode.js` to pass the correct identifier so the `-m` flag works again.

## Why Now

The interim mitigation (removing `custom` from `adapters.agents.models` in `workflow.config.json`) means the launcher omits the `-m` flag and relies on opencode's default model selection. This works but loses explicit model control — if opencode's default changes or selects a different model, the workflow silently switches to an unintended agent. Restoring `-m` model selection restores deterministic, configurable model routing for the draft step.

## Refinement Signals

- Estimated agent % usage limit: 25-50%
- Confidence: High
- Selection note: activate as-is
- Main drivers: explicit model override is broken; interim workaround removes configurability

## Scope

- Investigate opencode's expected model identifier format for the `-m` flag (e.g., provider/model form, alias, or internal name)
- Trace the model resolution path: `workflow.config.json` → `resolveAgentModel()` in `lib/core/product-config.js` → `agents.js` line 702 → `buildOpencodeInvocation()` in `lib/agents/opencode.js` line 115
- Determine whether `buildOpencodeInvocation` should translate/normalize the configured model id before passing it to `-m`
- Fix the model identifier passing so `cyankiwi/Qwen3.6-35B-A3B-AWQ-4bit` (or whatever the correct format is) works with opencode `-m`
- Restore the `custom` model entry in `workflow.config.json` once `-m` handling works
- Add a regression test covering the opencode `-m` model identifier handling

## Out of Scope

- Changing opencode's internal model registry or how opencode resolves models
- Modifying the `-m` flag behavior in opencode itself
- Handling model resolution for agents other than opencode (mistral, codex, claude)
- Adding new configuration schema fields to `workflow.config.json`
- Modifying the hard-error retry logic in `HARD_OPENCODE_PATTERNS` (unless the investigation determines the model identifier should be treated as transient)

## Success Criteria

> **Falsifiability rule (ADR 0039 Part 2):** Each criterion must be falsifiable.

- [ ] `buildOpencodeInvocation({ model: 'cyankiwi/Qwen3.6-35B-A3B-AWQ-4bit' })` produces an invocation whose `-m` argument is the correct identifier that opencode accepts (verified by test)
- [ ] A new unit test in `test/opencode.test.js` (or `test/opencode-retry.test.js`) asserts that model identifiers from config are correctly formatted before being passed to `-m`
- [ ] The `custom` entry is restored in `workflow.config.json` under `adapters.agents.models` with value `cyankiwi/Qwen3.6-35B-A3B-AWQ-4bit`
- [ ] `npm test` passes with all 1667+ existing tests still passing (no regressions)
- [ ] The file `lib/agents/opencode.js` line 115 passes a normalized/translated model identifier to `-m`, not the raw config value (unless the raw value is already correct)

## Risks and Assumptions

- **Risk:** opencode may not support custom model names via `-m` at all — it may only accept its built-in model aliases. Mitigation: if confirmed, the fix becomes a fallback strategy (omit `-m` when the configured model is unrecognized) rather than an identifier translation.
- **Assumption:** the model identifier format is consistent across opencode invocations (not session-dependent or environment-dependent).
- **Assumption:** the raw model name `cyankiwi/Qwen3.6-35B-A3B-AWQ-4bit` is the correct value in `workflow.config.json` and does not need to change there — only the launcher needs to translate it.
- **Risk:** changing how `-m` is populated could affect telemetry extraction in `opencode-telemetry.js` if the model name in telemetry differs from the one passed via `-m`.
- **Assumption:** the existing feature-detect for `--format json` and the JSON fallback path (`runWithJsonFallback`) are unaffected by model identifier changes.

## Checkpoints

- CP 1: Investigation complete — model identifier format determined, fix approach selected
- CP 2: Fix implemented in `lib/agents/opencode.js` and `workflow.config.json` restored
- CP 3: Regression test added and `npm test` passes

## Gates

- [ ] `npm test` passes (all existing tests + new regression test)

## Restricted Areas

- Do not modify opencode's source code (it is an external binary/tool, not part of this repo)
- Do not change the retry logic in `TRANSIENT_OPENCODE_PATTERNS` or `HARD_OPENCODE_PATTERNS` unless the investigation conclusively shows the model-identifier issue should be treated as transient
- Do not modify `lib/agents/agents.js` model resolution logic outside the model translation layer in `opencode.js`
- Do not change the `workflow.config.json` adapter schema or add new config keys

## Stop Rules

- Stop if the investigation reveals opencode does not support `-m` with arbitrary/custom model names — in that case, the fix scope changes to a documented limitation with a fallback strategy, and the mission deliverable becomes a config-level workaround rather than a code fix
- Stop if the raw model identifier `cyankiwi/Qwen3.6-35B-A3B-AWQ-4bit` is found to be incorrect and the correct identifier lives elsewhere in the config hierarchy — redirect to fix the source of truth instead
- Stop if `npm test` reveals a broader regression beyond the opencode model handling scope — escalate before proceeding
