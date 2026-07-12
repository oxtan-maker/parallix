# Mission: Fix pi custom runner in e2e test (task-2236)

## Goal

Make the `pi` runner work end-to-end when configured as the custom runner (`adapters.agents.runners.custom: "pi"`) in `test/e2e-real-agent-smoke.test.js`, so the full lifecycle smoke test (draft + active) completes successfully with pi instead of defaulting to opencode.

## Why Now

The agent that implemented the pi runner (`lib/agents/pi.ts`) claims it works, but configuring pi as the custom runner and running the e2e tests fails. This blocks validation of the pi integration path and means the `custom: "pi"` configuration option is untrusted in CI and local development.

## Refinement Signals
- Predicted NEL bucket: Small (0–80)
- Confidence: High
- Selection note: activate as-is
- Main drivers: targeted bug in pi e2e test wiring; fix is likely a small configuration or env-var mismatch between `test/e2e-real-agent-smoke.test.js` pi setup and `lib/agents/pi.ts` invocation

## Scope
- Diagnose why the pi runner fails when `workflow.config.json` sets `adapters.agents.runners.custom: "pi"` and `test/e2e-real-agent-smoke.test.js` executes
- Fix the specific wiring issue in the e2e test or pi runner configuration that prevents the full lifecycle from completing
- Add a regression reproduction test under `test/` that fails before the fix and passes after
- Labels: `bug`, `user_value` (the pi runner is a user-facing feature; the fix restores expected behavior)

## Out of Scope
- Adding pi support to `test/e2e-mission-lifecycle.test.js` (stub-only test; separate concern)
- Changes to `lib/agents/pi.ts` invocation logic beyond what is required to make the e2e test pass
- Pi runner performance optimization or additional model configuration
- Adding pi to other e2e or integration test suites

## Success Criteria
> **Falsifiability rule (ADR 0039 Part 2):** Each criterion must be falsifiable. Forbidden: subjective adjectives ("easy, fast, simple, intuitive, user-friendly, responsive, quick, efficient" without an attached metric) and vague quantifiers ("multiple, several, some, many, few, various"). For refactor / condense / migration missions, the criterion must enumerate the specific elements (rules, files, behaviours) that must survive — generic phrases like "preserve critical content" are not sufficient.

- SC1: `PARALLIX_REAL_AGENT_RUNNER=pi npm test -- test/e2e-real-agent-smoke.test.js` completes with exit code 0 and all assertions pass, including the full lifecycle test `real custom-agent launcher smoke (pi): full lifecycle with hello-world task (SC3/SC4/SC5/SC6/SC7)`
- SC2: The reproduction test file declared on the `Reproduction-Test:` line below fails (red) on the parent commit and passes (green) on the final commit
- SC3: `resolveCustomRunner()` in `lib/core/product-config.ts` returns `"pi"` when `workflow.config.json` contains `adapters.agents.runners.custom: "pi"` for the throwaway repo created by `setupRepository()`
- SC4: The pi healthcheck (`runPiHealthcheck()`) in the e2e test returns status 0 for the configured model when pi is available on PATH
- SC5: `./scripts/verify-local.sh all` passes on the final tree with no new focused tests (`.only`) or unannotated skipped tests (bare `.skip`)

## Risks and Assumptions
- The pi binary (`pi`) is available on the developer's PATH and has valid config under `~/.pi/agent/` (models.json, settings.json, auth.json); if pi is not installed, the e2e test preflight will skip rather than fail
- The root cause is in the test wiring (env vars, PATH, config) rather than a fundamental flaw in `lib/agents/pi.ts`'s `startPiAgent` implementation
- The `PI_CODING_AGENT_DIR` env var set by the e2e test is recognized by the pi binary for sandboxed agent state
- Fix scope is contained to `test/e2e-real-agent-smoke.test.js` and possibly `lib/agents/pi.ts`; no changes to `lib/agents/launcher-selection.ts` or `lib/core/product-config.ts` are expected

## Checkpoints
- CP 1: Author a failing reproduction test that locks the bug. Create `test/task-2236-pi-e2e-repro.test.js` that configures pi as the custom runner in a throwaway repo and asserts the full lifecycle smoke completes successfully (the assertion fails red on the parent commit). The test should mirror the setup in `test/e2e-real-agent-smoke.test.js` `setupRepository({ runner: 'pi' })` but isolate the specific failure mode (healthcheck, config resolution, or invocation).
- CP 2: Implement the fix. Modify the e2e test wiring or pi runner configuration to resolve the identified failure. Common surface areas: `PI_CODING_AGENT_DIR` propagation, pi binary symlink in `binDir`, `workflow.config.json` runner field in the throwaway repo, or PATH construction for the child process.
- CP 3: Verify the fix. Run `PARALLIX_REAL_AGENT_RUNNER=pi npm test -- test/e2e-real-agent-smoke.test.js` and `./scripts/verify-local.sh all`. Confirm the reproduction test turns green. Update the Goal Check table with file:line evidence.

Reproduction-Test: test/task-2236-pi-e2e-repro.test.js

### Checkpoint Documentation Requirements
Every checkpoint document (CP-N.md) MUST include:
- A summary of work done
- A `## Goal Check` section
- A 3-column pipe-delimited markdown table with columns: Criterion | Evidence | Status
- At least one evidence row per criterion using verifiable references. Parallix already accepts:
  1. **File:line references** — e.g., `lib/commands/handoff.ts:292` (must point to an existing file and line)
  2. **Test names** — e.g., `"real custom-agent launcher smoke: full lifecycle with hello-world task (SC3/SC4/SC5/SC6/SC7)"` (must match a test name in the repo)
  3. **Test file paths** — e.g., `test/e2e-real-agent-smoke.test.js` (must be an existing test file)
  4. **ADR references** — e.g., `ADR 0048` (must correspond to an existing file under `docs/adr/`)
  5. **Recognized repo commands or paths** — e.g., `` `npm test -- test/repair-handoff.test.js` ``, `` `px review <slug> --verify` ``, or `` `./scripts/verify-local.sh all` ``
- Raw `stat`/`ls` output or generic prose may appear as supplemental context, but pair them with one of the accepted references above
- A non-generic `Next action:` line at the bottom

Example Goal Check table:

| Criterion | Evidence | Status |
|---|---|---|
| Draft prompt defines checkpoint evidence rules | `prompts/draft.md:28` | PASS |
| Repair loop has targeted incomplete-evidence coverage | `test/repair-handoff.test.js`, `"buildRelaunchPrompt returns string containing Goal Check table and mission slug"` | PASS |
| Verification gate ran | `./scripts/verify-local.sh all` | PASS |

## Gates
- [ ] `./scripts/verify-local.sh all`

## Restricted Areas
- `test/e2e-mission-lifecycle.test.js` — do not modify; pi stub support is out of scope
- `lib/agents/launcher-selection.ts` — do not modify unless the root cause is definitively in `resolveCustomLauncher()` dispatch
- `lib/core/product-config.ts` `resolveCustomRunner()` — do not modify unless the config resolution itself is wrong for the throwaway repo
- `config/workflow.config.schema.json` — do not modify; the schema already supports `"pi"` as a valid runner value

## Stop Rules
- Stop if the pi binary is not installed on the workstation and cannot be installed; the e2e test preflight is designed to skip in this case, and the fix may require a CI environment with pi available
- Stop if root cause analysis reveals that `lib/agents/pi.ts` `startPiAgent` has a fundamental architectural flaw (not a wiring issue); escalate to a larger mission with NEL re-estimation
- Stop if more than 2 checkpoints are needed without a clear fix; reassess whether the scope is contained to test wiring or has expanded to runner implementation
- Do not merge if `./scripts/verify-local.sh all` reports any new ESLint errors, tsc type errors, or test failures introduced by this mission
