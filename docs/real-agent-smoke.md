# Real custom-agent launcher smoke test

`test/e2e-real-agent-smoke.test.js` is a **blocking** integration gate
(`custom-agent-smoke` in `config/integration-pipelines.json`) that launches
the real `opencode` binary against a pinned local model through the
production launcher path in `lib/agents/opencode.ts`. It exists specifically
to fail closed when Parallix breaks its own local-agent launch path while
developing itself — see `missions/task-1359/MISSION.md` and `missions/task-2201/MISSION.md`
for the original implementation and the retake that corrected the lifecycle coverage.

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

- `opencode` installed and present on `PATH`, with a working default local
  model configured in opencode's own state (no repo config needed for this —
  opencode remembers its own last-selected model).
- `adapters.agents.models.custom` in this repo's `workflow.config.json` is an
  *optional* override, not a prerequisite: pinning a specific model string
  there is a footgun (it goes stale whenever the operator repoints the
  locally-served model). When unset, the test omits `-m` and lets the
  launcher fall back to opencode's own default, mirroring production
  behavior. If `adapters.agents.models.custom` is set, the test reads it and
  writes it into the throwaway repo's own `workflow.config.json` so the
  smoke run exercises that exact override.
- No network access or cloud credentials are required — the model is local.

## Invocation

```
node test/e2e-real-agent-smoke.test.js
```

Also runs as part of `px integrate` (or `./scripts/verify-local.sh integrate`)
whenever the changed areas include `workflow` or `lib`, alongside the
`workflow` gate.

The gate runs **one** full lifecycle per invocation, with whichever custom
runner this repository configures (`adapters.agents.runners.custom` in
`workflow.config.json`, currently `opencode`). Running every supported runner
back-to-back would multiply the gate's wall time, so the non-configured runner
is exercised on demand instead — the harness itself is runner-parameterized
(`opencode` and `pi`), and switching costs only an env var:

```
PARALLIX_REAL_AGENT_RUNNER=pi node test/e2e-real-agent-smoke.test.js
```

## Expected runtime and determinism

Unlike the stubbed lifecycle harness, this test drives real local-model
inference calls for the draft, execute, and review agents and is expected to be
**slower and less deterministic**. A green full-lifecycle run measured ~4
minutes (242s) on the reference workstation; failing runs usually fail faster
(the launcher health probe fails in seconds, a draft-phase failure within
~40s). The single-session timeout defaults to 600s and can be raised via
`PARALLIX_REAL_AGENT_TIMEOUT_MS`; the active phase gets twice that budget
because one `px active` invocation covers up to three sequential model
sessions (execute agent, a possible repair relaunch, and the autonomous
review loop). Occasional local-model flakiness
(slow tool calls, transient backend hiccups) is a known risk of this tier —
see the failure-bucket classification below for how to tell that apart from
a genuine Parallix regression.

## Lifecycle depth covered

The gate runs the full `draft -> active -> review` lifecycle with the real
`custom` agent family, through the production launcher path in `lib/agents/opencode.ts`.

While the original implementation stopped at `draft` (because `draft` and `active` both
funnel through the same launcher code path), the corrected smoke test exercises
the complete `draft -> refine -> active -> review` flow to:

- Prove the launcher boundary for `draft` (catches `TASK-1351` launcher-argument regressions)
- Prove parseability of `MISSION.md` output (catches `TASK-1273` parseability regressions)
- Verify `active` phase execution and artifact generation (CP-1.md)
- Verify `review` phase execution and reviewer selection behavior
- Strengthen telemetry isolation assertions with actual file-content validation

The test uses a representative minimal mission prompt based on the hello-world shell
program task ("Create a .sh hello world program") rather than the fabricated
greeting-helper placeholder, ensuring the smoke validates against how Parallix
actually asks agents to do things.

Between `draft` and `active` the harness performs the same minimal refinement
step a human operator does before activating a drafted mission: it pins the
mission's `## Gates` checklist to the repo's runnable verification gate and
commits. All launcher-boundary and parseability assertions run against the RAW
draft output before this step. The refinement exists because small local models
routinely write prose instead of runnable commands in the Gates checklist, and
the workflow executes declared gates literally at handoff — activating a raw
drafted mission unrefined is not the real operating flow.

Note: The test stops at `review` and does not include `integrate`, as the integrate
phase is not required to catch the target bug classes (TASK-1351, TASK-1273) and
adding it would increase runtime without proportionally increasing bug coverage.

## Failure interpretation (SC6)

A failing run prefixes its assertion message with one of three buckets:

- `[local-model-environment]` — `opencode` or its default (or explicitly
  overridden) local model is unavailable on this workstation, or the run was
  killed by a timeout/signal waiting on the local backend. Action: check that
  `opencode` and the local model backend are running and reachable; this is
  not necessarily a Parallix regression.
- `[opencode-launcher-failure]` — the real `opencode` invocation rejected
  the launch itself (bad `-m` argument, auth failure, missing binary). This
  is the `TASK-1351` class of bug: a launcher-argument regression in
  `lib/agents/opencode.ts` or `lib/agents/agents.ts`.
- `[parallix-workflow-failure]` — `opencode` launched and produced output,
  but Parallix could not parse it into the required mission artifact
  contract (missing `## Goal` / `## Scope` / `## Success Criteria`
  headings, missing `MISSION.md`, or a missing/malformed draft-stats line).
  This is the `TASK-1273` class of bug.

The smoke harness does two preflight checks before the full lifecycle run:

- It verifies that the real `opencode` binary is present on `PATH`.
- It runs a tiny real `opencode run ... 'Reply with exactly OK'` probe with the
  configured model and the same child environment the lifecycle test will use.

That fast launcher probe is intentional: it catches broken local `opencode`
runtime state (for example SQLite/WAL or missing-model failures) in seconds
instead of letting the main draft phase burn the full timeout and misattribute
the problem to Parallix lifecycle logic.

The harness also removes the inherited `PWD` variable from the child
environment. `opencode` trusts `PWD` over the process's real working directory
when resolving its project, so a stale `PWD` pointing at the developer's
primary repo makes the launcher child attach to that project instead of the
throwaway repo — colliding with concurrently running `opencode` sessions.
Observed symptoms of that collision were SQLite WAL-checkpoint failures and
the child hanging at exit until the run timeout killed it.

## Additional validations

Beyond the original launcher-boundary and parseability checks, the corrected smoke
test (TASK-2201) adds explicit validation of:

- **CLI-under-test provenance**: The test verifies that `CLI_ENTRY` (the `px` CLI
  entrypoint being tested) exists and points to `px.js` in the repository, ensuring
  we test the actual code under test rather than a stale global/installed `px`.

- **Parallix-owned state isolation (config route)**: `PARALLIX_HOME` is the
  highest-precedence input to `resolveParallixHome` (`lib/core/storage.ts`),
  which anchors both `stats.csv` and the agent blocking file
  `agents.local.json`. The test points `PARALLIX_HOME` at a temp directory and
  validates that:
  - Stats files are written to the isolated `PARALLIX_HOME` (temp directory)
  - Stats file content includes the expected model and provider fields
  - Neither `stats.csv` nor `agents.local.json` in the developer's default
    Parallix state roots (`~/.local/state/parallix` on Linux, `~/.parallix`
    fallback) contains any smoke-run data
  - `opencode`'s own runtime state (`XDG_DATA_HOME`) is deliberately **not**
    sandboxed: the launcher child keeps the developer's normal `opencode`
    configuration, avoiding false negatives from hiding its local
    configuration/database. Parallix-owned state never lives there.

- **Reviewer forcing (and cost containment)**: The harness writes an
  `agents.local.json` blocklist into the isolated `PARALLIX_HOME` that blocks
  every agent family except `custom` (the product's supported local-blocklist
  mechanism, see `docs/agents.md`). Reviewer selection in `startReviewLoop`
  therefore finds no different-family candidate and takes its single-family
  fallback: `custom` reviews its own PR. The test asserts
  `review-state.json.reviewer === "custom"` strictly. This both encodes the
  original "force custom as reviewer on its own PR" requirement and guarantees
  the blocking gate can never fall back to launching an expensive cloud agent
  (claude/codex). Note that `FORGEJO_USER` does not force the reviewer — it is
  overwritten by `startAgent` with the chosen agent family.

- **Declared-gate runnability**: The throwaway repo ships a no-op
  `scripts/verify-local.sh`, because drafted missions declare gates such as
  `./scripts/verify-local.sh docs` (the scaffold default) and the workflow
  executes mission-declared gates literally at handoff. A real px-managed repo
  has this script; without it every draft would fail its own declared gates.

- **Representative task content**: The throwaway repo's backlog task uses "Create a
  .sh hello world program" instead of the fabricated greeting-helper placeholder,
  ensuring the smoke test validates against realistic Parallix mission prompts.
