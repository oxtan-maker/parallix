# Mission: add configuration for max amount of subagents in opencode (task-1363)

## Goal

Add a `adapters.agents.subagents.maxParallel` configuration field to the parallix workflow config system, implement a prompt-injection module that prefixes opencode prompts with a directive limiting concurrent subagent forks, wire this into the opencode launcher in `lib/agents/opencode.js`, and set `maxParallel: 2` in `workflow.config.json` when parallix is developing itself.

## Why Now

Opencode (the `custom` agent family) can internally spawn parallel subagents with no upper bound controlled by parallix. During parallel mission execution this leads to runaway token consumption and resource contention — each execute-phase agent can spin dozens of subagents simultaneously. The current `adapters.agents` config section (defined in `lib/core/product-config.js:11-34` and validated by `workflow.config.schema.json:83-94`) only supports `models` key-value pairs; there is no surface for operational limits. Adding this config now prevents unbounded subagent fan-out during self-development and establishes a reusable pattern for other operational knobs.

## Refinement Signals

- Estimated agent % usage limit: 25-50%
- Confidence: High
- Selection note: activate as-is
- Main drivers: Unbounded opencode subagent fan-out during parallel missions; no config surface for operational limits; need to cap parallelism at 2 for parallix self-development.

## Scope

- Add `subagents` (with `maxParallel` integer field) to the `adapters.agents` section of the workflow config schema at `config/workflow.config.schema.json`.
- Update `lib/core/product-config.js` to recognize and validate `adapters.agents.subagents.maxParallel` alongside the existing `adapters.agents.models` field.
- Implement `lib/core/subagent-limit.js` — a pure module that reads `maxParallel` from the effective config and returns a prompt-prefix string (e.g., `Do not spawn more than N parallel subagents. If you need more, pause and wait.`) or an empty string when `maxParallel` is unset/null/zero.
- Wire the prompt prefix into `lib/agents/opencode.js:startOpencodeAgent` so the prefix is prepended to every opencode prompt before invocation.
- Default behavior: when `adapters.agents.subagents.maxParallel` is absent, no prompt injection occurs (backward compatible).
- Set `adapters.agents.subagents.maxParallel: 2` in `workflow.config.json` for parallix self-development.

## Out of Scope

- Modifying opencode's internal behavior or source code.
- Adding runtime enforcement (e.g., monitoring active subagent count and killing excess); this is a prompt-level advisory only.
- Per-mission or per-task subagent limits; the config is global per repository.
- Configuring limits for other agent families (codex, claude, mistral).
- Adding a CLI flag to override the limit at launch time.
- Writing integration tests that spawn real opencode processes.

## Success Criteria

> **Falsifiability rule (ADR 0039 Part 2):** Each criterion must be falsifiable.

1. `config/workflow.config.schema.json` includes `adapters.agents.subagents` as an object with an integer `maxParallel` property (nullable), and the schema validates correctly via `ajv` or equivalent.
2. `loadEffectiveConfig()` in `lib/core/product-config.js` merges `adapters.agents.subagents.maxParallel` from `workflow.config.json` over the built-in default (absent), and `validateWorkflowConfig()` does not reject it.
3. `lib/core/subagent-limit.js` exports a `buildSubagentLimitPrefix(maxParallel)` function that returns:
   - A non-empty string containing the integer value when `maxParallel >= 1`
   - An empty string when `maxParallel` is `null`, `undefined`, `0`, or negative
4. `lib/agents/opencode.js:startOpencodeAgent` calls the subagent-limit module and prepends the returned prefix to the prompt before passing it to `spawnAndTee`.
5. Running `px config` (which invokes `lib/commands/config.js`) prints `subagents: { maxParallel: 2 }` under `adapters.agents` when `workflow.config.json` contains it.
6. Existing tests in `test/opencode.test.js`, `test/opencode-launcher-telemetry.test.js`, `test/agents.test.js`, and `test/product-config.test.js` all pass without modification (the default absence of the config field produces no prompt injection, preserving original behavior).
7. `npm test` passes with zero failures on the final tree.

## Risks and Assumptions

- **Assumption:** Opencode respects the prompt directive and does not spawn more than `maxParallel` subagents. This is advisory, not enforced.
- **Risk:** The prompt prefix increases prompt token count slightly; negligible for typical mission prompts.
- **Risk:** If opencode adds native subagent limits in a future release, this module becomes dead code. Plan to deprecate and remove in a follow-up task.
- **Assumption:** The `workflow.config.json` override file exists at the repo root during self-development. If absent, `loadWorkflowConfig` returns `{ found: false }` and the default (no limit) applies.
- **Risk:** The prompt prefix must be short enough to avoid truncating mission-critical context. Target prefix length: under 200 characters.

## Checkpoints

- CP 1: Schema and config parsing — extend `workflow.config.schema.json` with `subagents.maxParallel`, update `product-config.js` validation and merge logic, confirm `px config` prints the field. Evidence: `px config` output, `test/product-config.test.js` passes.
- CP 2: Prompt injection module and wiring — implement `lib/core/subagent-limit.js`, integrate into `lib/agents/opencode.js:startOpencodeAgent`, verify prefix appears in test-invoked prompts. Evidence: `test/opencode.test.js` assertions on built invocation prompt.
- CP 3: Self-development config and verification — set `maxParallel: 2` in `workflow.config.json`, run `npm test` gate, confirm all 1694+ tests pass. Evidence: `npm test` output, `workflow.config.json` content.

## Gates

- [ ] ./scripts/verify-local.sh docs
- [ ] npm test

## Restricted Areas

- Do not modify any agent launcher for families other than `custom` (opencode): `lib/agents/codex.js`, `lib/agents/claude.js`, `lib/agents/mistral.js`.
- Do not touch the opencode binary or any external dependency.
- Do not modify `lib/agents/agents.js` startAgent loop logic — only the prompt content.
- Do not change the `config/agents.json` eligibility/blocklist system.

## Stop Rules

- Stop if the prompt prefix approach cannot convey the limit clearly in under 200 characters.
- Stop if integrating the prefix breaks any existing `test/opencode.test.js` or `test/agents.test.js` assertion.
- Stop if `validateWorkflowConfig()` rejects the new schema field — revert schema changes and report.
- Stop if `npm test` fails with more than 0 failures after the draft phase.
