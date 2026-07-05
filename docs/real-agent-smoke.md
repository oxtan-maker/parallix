# Real custom-agent launcher smoke test

`test/e2e-real-agent-smoke.test.js` is a **blocking** integration gate
(`custom-agent-smoke` in `config/integration-pipelines.json`) that launches
the real `opencode` binary against a pinned local model through the
production launcher path in `lib/agents/opencode.ts`. It exists specifically
to fail closed when Parallix breaks its own local-agent launch path while
developing itself — see `missions/task-1359/MISSION.md`.

This is a second, additive tier on top of the deterministic
`test/e2e-mission-lifecycle.test.js` harness (the `workflow` gate), which
stubs `opencode` entirely and is not weakened or replaced by this test.

## Why it's blocking, not advisory

The deterministic stubbed harness cannot see launcher-boundary bugs: invalid
`-m` / model-launch arguments (`TASK-1351`) or real-agent draft output that
Parallix cannot parse into a valid mission artifact (`TASK-1273`) both bypass
the stub. If this repo cannot successfully launch and consume its own
configured local agent, integration must stop rather than merge silently.

## Prerequisites

- `opencode` installed and present on `PATH`.
- The pinned local model for the `custom` family available and reachable:
  `vllm/cyankiwi/Qwen3.6-35B-A3B-AWQ-4bit`. This mirrors this repo's own `workflow.config.json`
  `adapters.agents.models.custom` at the time this gate was added; the test
  pins its own copy of this string so it stays reproducible even if this
  repo's config changes independently.
- No network access or cloud credentials are required — the model is local.

## Invocation

```
node test/e2e-real-agent-smoke.test.js
```

Also runs as part of `px integrate` (or `./scripts/verify-local.sh integrate`)
whenever the changed areas include `workflow` or `lib`, alongside the
`workflow` gate.

## Expected runtime and determinism

Unlike the stubbed lifecycle harness, this test drives a real local-model
inference call and is expected to be **slower and less deterministic**.
Budget several minutes; the run timeout defaults to 600s and can be raised
via `PARALLIX_REAL_AGENT_TIMEOUT_MS`. Occasional local-model flakiness
(slow tool calls, transient backend hiccups) is a known risk of this tier —
see the failure-bucket classification below for how to tell that apart from
a genuine Parallix regression.

## Lifecycle depth covered

The gate runs `px draft <slug> --agent custom` once, through the real
launcher, and asserts on the resulting `MISSION.md`. It intentionally stops
at `draft` rather than running the full `draft -> active -> review ->
integrate` cycle: `draft` and `active` both funnel through the same
launcher code path (`lib/agents/agents.ts` -> `startOpencodeAgent` ->
`buildOpencodeInvocation`), so a single real invocation already proves the
launcher/model/argument boundary and the parseability contract without the
extra runtime and flakiness cost of a full multi-turn real-model lifecycle.

## Failure interpretation (SC6)

A failing run prefixes its assertion message with one of three buckets:

- `[local-model-environment]` — `opencode` or the pinned model is
  unavailable on this workstation, or the run was killed by a timeout/signal
  waiting on the local backend. Action: check that `opencode` and the local
  model backend are running and reachable; this is not necessarily a
  Parallix regression.
- `[opencode-launcher-failure]` — the real `opencode` invocation rejected
  the launch itself (bad `-m` argument, auth failure, missing binary). This
  is the `TASK-1351` class of bug: a launcher-argument regression in
  `lib/agents/opencode.ts` or `lib/agents/agents.ts`.
- `[parallix-workflow-failure]` — `opencode` launched and produced output,
  but Parallix could not parse it into the required mission artifact
  contract (missing `## Goal` / `## Scope` / `## Success Criteria`
  headings, missing `MISSION.md`, or a missing/malformed draft-stats line).
  This is the `TASK-1273` class of bug.

The preflight check only verifies that the real `opencode` binary is present.
The pinned-model validation happens in the actual `px draft --agent custom`
launch, so the smoke test stays focused on the production launcher path
instead of failing early on auxiliary `opencode` subcommands.
