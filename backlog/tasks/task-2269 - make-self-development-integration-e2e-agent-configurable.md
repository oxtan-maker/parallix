---
id: TASK-2269
title: make self-development integration E2E agent configurable
status: backlog
assignee: []
created_date: '2026-07-15 00:00'
labels: [self-hosting, e2e]
dependencies: []
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Only Codex is available on this development machine. Add an explicit `px integrate`
parameter that is forwarded to the integration verification script, and a corresponding
parameter on that script, to select the real-agent E2E runner and model when Parallix is
integrating changes to itself.

The self-development invocation must be able to run the real-agent E2E with Codex and
`gpt-5.6-luna` instead of the current Pi/custom-agent path. Preserve the current default
behaviour for other repositories and for callers that do not supply the override.

Document the supported command-line interface and add regression coverage proving that:

- `px integrate` forwards the selected runner/model settings to the integration script;
- the integration script selects Codex with `gpt-5.6-luna` for the self-development E2E
  invocation; and
- the existing default Pi/custom path is unchanged when no override is requested.
<!-- SECTION:DESCRIPTION:END -->

## Codex Pre-Draft

Prepared manually while the supported Node runtime is unavailable. This ticket remains
`backlog`; it must enter the normal `px draft` / `px active` lifecycle after Node is
restored.

### Goal

Allow a Parallix self-development integration to select the real-agent smoke-test agent
family and model without altering the configured default for ordinary integrations. The
required invocation is:

```text
px integrate <slug> --real-agent codex --real-agent-model gpt-5.6-luna
```

The selected values must reach the integration runner and the real-agent smoke harness
as structured arguments/environment, not interpolated into a shell command.

### Implementation Scope

- Extend `px integrate` argument parsing to accept the paired `--real-agent <agent>`
  and `--real-agent-model <model>` options, reject missing/duplicate values, and retain
  the existing usage/error behaviour for unrelated options.
- Extend `./scripts/verify-local.sh integrate` to accept the same validated override
  and pass it only to the real-agent smoke integration gate. Do not append unchecked
  user input to a gate command string.
- Extend `test/e2e-real-agent-smoke.test.js` from a custom-runner-only selector
  (`PARALLIX_REAL_AGENT_RUNNER`, currently `opencode`/`pi`) to a family-and-model
  selector that can launch Codex with `gpt-5.6-luna`, while retaining the current custom
  runner behavior when neither override is present.
- Ensure the Codex smoke fixture permits Codex as the selected workflow agent and does
  not retain the current fixture blocklist that prevents Codex selection.
- Keep the integration configuration's default `custom-agent-smoke` command unchanged
  for callers without the override. The new path is opt-in and must not make ordinary
  repositories require Codex or a cloud model.
- Document the supported integrate/script flags, the self-development use case, model
  prerequisites, and the default/fallback behaviour in the relevant operator-facing
  documentation.

### Success Criteria

- `px integrate <slug> --real-agent codex --real-agent-model gpt-5.6-luna` produces an
  integration invocation whose real-agent gate receives exactly `codex` and
  `gpt-5.6-luna`.
- `./scripts/verify-local.sh integrate --real-agent codex --real-agent-model gpt-5.6-luna`
  passes the same values to the real-agent smoke process without changing any other gate
  command or environment contract.
- The smoke test launches the Codex adapter with `gpt-5.6-luna` and completes its
  existing lifecycle assertions using a test-controlled Codex command fixture.
- No-override integration retains the present custom-agent runner/model selection and
  remains compatible with Pi/OpenCode environments.
- Invalid agent/model pairs, incomplete flag pairs, and unknown agent families fail
  before any integration gate or merge action begins, with an actionable error.

### Checkpoints

- CP 1: Inventory the integrate invocation, script-level integration gate runner, and
  real-agent smoke fixture. Add failing parser/forwarding tests for the exact two flags
  and for invalid input.
- CP 2: Implement validated forwarding through `px integrate` and
  `verify-local.sh integrate`, proving the override affects only the real-agent gate.
- CP 3: Generalize the smoke fixture for agent family/model selection and add the Codex
  `gpt-5.6-luna` lifecycle path plus no-override regression coverage.
- CP 4: Update docs and run focused tests, the real-agent smoke test with the Codex
  override, and the applicable integration gates; capture the selected agent/model in
  checkpoint evidence.

### Non-Goals and Stop Rules

- Do not change the global default agent, the configured custom runner, or unrelated
  repositories' integration behavior.
- Do not add arbitrary command passthrough or shell-string interpolation to integration
  gates; only the two validated options are in scope.
- Stop if Codex does not accept `gpt-5.6-luna` through its existing model-selection
  contract; capture the actual CLI capability and request a model/adapter decision.
- Stop if making the smoke fixture selectable would weaken its existing lifecycle,
  isolation, or fail-closed assertions; add a separate Codex fixture rather than
  silently removing those checks.

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 Verification gate ran and passed on the final tree with captured proof rather than an unverified claim
- [ ] #2 Lint and static analysis report clean on every changed file
- [ ] #3 No focused or unannotated skipped tests were introduced (no .only and no bare .skip)
- [ ] #4 Final checkpoint Goal Check table cites real evidence using file:line references and test names
- [ ] #5 Docs updated to reflect any workflow or user-facing behavior change
- [ ] #6 Bug-labeled missions include a red-to-green reproduction test that fails before the fix and passes after
<!-- DOD:END -->
