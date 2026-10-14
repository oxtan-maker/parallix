# Real-agent launcher smoke test

`test/e2e/agents/real-agent-smoke.test.ts` is a **blocking** integration gate
(`custom-agent-smoke` in `config/integration-pipelines.json`) that launches
the real `opencode` binary against a pinned local model through the
production launcher path in `src/adapters/agents/opencode.ts`. It exists specifically
to fail closed when Parallix breaks its own local-agent launch path while
developing itself — see `missions/task-1359/MISSION.md` and `missions/task-2201/MISSION.md`
for the original implementation and the retake that corrected the lifecycle coverage.

This is a second, additive tier on top of the deterministic
`test/e2e/lifecycle/mission-lifecycle.test.ts` harness (the `workflow` gate), which
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
- For the self-development Codex override, `codex` must be on `PATH` and
  `gpt-5.6-luna` must be available to that Codex installation.
- The default custom smoke route needs no cloud credentials because its model is
  local. The explicit Codex override instead requires the operator's usable
  Codex authentication and model access.

## Invocation

```
node --import tsx --import ./test/bootstrap-e2e-parallix-home.ts test/e2e/agents/real-agent-smoke.test.ts
```

During the run, `[agent-smoke]` lines appear live in the terminal and inherited
integration-gate output. Drafting, implementing, and
reviewing are announced from the corresponding workflow output, including the
reviewer launched inside `px active`.

`state=tool command=…` shows the current tool's command or input summary, with
credential patterns scrubbed using the existing redaction conventions. A tool
completion advances the output to `state=model`; this means no tool remains
reported as running, rather than proof that the model is generating tokens.
Model prose and tool results stay in the workflow capture rather than the live
progress feed. The disposable repository starts with a committed root
`AGENTS.md`, so agents can find its instructions in the mission worktree.

## Configured admission and concurrent replay

Custom launches use production admission and the canonical checkout's
`adapters.agents.maxConcurrentCustom`. Separate smoke repositories and mission
worktrees share a lease-only admission database, while each retains its own
mission database, blocklist, credentials and runner sessions. There is no
lifecycle-wide smoke lock or separate smoke concurrency limit. A stalled tool
occupies its session's slot; other sessions can use the remaining capacity.

Build the CLI before replaying (`npm run build`). Use the configured custom
runner with a reachable model backend and sufficient temporary storage. For a
capacity-two replay, confirm the canonical checkout already configures two
slots; do not change capacity to make a replay pass. Run two copies of the
smoke invocation in separate terminals. They share admission automatically.
Give the first a bounded tool wait so overlap can be observed:

```sh
PARALLIX_REAL_AGENT_TOOL_WAIT_SECONDS=45 PARALLIX_E2E_KEEP_TMP=1 npm run test:agent-e2e
```

Start the second without the tool delay:

```sh
PARALLIX_E2E_KEEP_TMP=1 npm run test:agent-e2e
```

The optional tool delay accepts 0–60 seconds and only changes the disposable
hello-world fixture. Both runs must pass the existing lifecycle assertions.
The `[smoke-fixture]` output identifies each disposable repository, operator
home, runner state and shared admission directory. Observe two live admission
leases and a second runner making progress while the first has a sleeping tool;
verify that the operator homes and runner directories differ. Admission at
capacity waits for a lease to be released rather than changing agent family.

For a replay with its own lease database, give both invocations the same
absolute `PARALLIX_CUSTOM_ADMISSION_HOME` beneath a disposable directory.
Capacity still comes from the canonical checkout. Keep the session and active
wall deadlines finite; `PARALLIX_REAL_AGENT_TIMEOUT_MS` bounds each session,
with twice that allowance for the active phase. Retained fixtures and captures
contain copied credentials: remove only the directories belonging to these
runs after inspection, once their children have exited. Do not remove a shared
admission database while another run is using it.

## First-value rehearsal

This is an operator-run recording, not this blocking smoke gate. It invokes
real agents, so timing and availability vary; its non-zero exit is convenience
feedback that the recorded mission did not reach integration or its configured
verification gate was not observed.

Use a globally installed executable without editing the script. Keep the cast
and plain-text transcript together for each run:

```
PX_BIN="$(command -v px)" \
  ELIGIBLE_AGENT_FAMILIES='["custom"]' \
  DEMO_CAST=docs/assets/first-value-demo-single-family.cast \
  DEMO_TRANSCRIPT=docs/assets/first-value-demo-single-family.transcript \
  ./scripts/record-first-value-demo.sh

PX_BIN="$(command -v px)" \
  DEMO_CAST=docs/assets/first-value-demo-three-family.cast \
  DEMO_TRANSCRIPT=docs/assets/first-value-demo-three-family.transcript \
  ./scripts/record-first-value-demo.sh
```

The first run exercises only the configured `custom` family; retain its
verbatim `Selected reviewer:` output as evidence of that configuration's
selection mode. The second omits the eligibility input and therefore exercises
the default `codex`, `claude`, and `custom` configuration. Neither recording
proves first-run configuration detection, CI behavior, deterministic timing,
or provider availability: the rehearsal writes an isolated configuration and
is observational evidence only.

Also runs as part of `px integrate` (or `./scripts/verify-local.sh integrate`)
whenever the changed areas include `workflow` or `lib`, alongside the
`workflow` gate.

### Self-development Codex override

When this repository cannot use its local custom-agent route, request the
Codex smoke lifecycle explicitly during integration:

```
px integrate task-2269 --real-agent codex --real-agent-model gpt-5.6-luna
```

The flags are a required pair. `px integrate` and
`./scripts/verify-local.sh integrate` reject an incomplete pair, duplicate
values, unsupported families, and unknown options before gate execution. The
values are forwarded as dedicated environment values only to
`custom-agent-smoke`; they are never concatenated into its shell command.
Without both flags, the configured `custom-agent-smoke` command remains
`node --import tsx --import ./test/bootstrap-e2e-parallix-home.ts test/e2e/agents/real-agent-smoke.test.ts`, and smoke selection retains the
configured custom runner (`opencode` or `pi`) and its existing model behavior.

The gate runs **one** full lifecycle per invocation, with whichever custom
runner this repository configures (`adapters.agents.runners.custom` in
`workflow.config.json`, currently `opencode`). Running every supported runner
back-to-back would multiply the gate's wall time, so the non-configured runner
is exercised on demand instead — the harness itself is runner-parameterized
(`opencode` and `pi`), and switching costs only an env var:

```
PARALLIX_REAL_AGENT_RUNNER=pi node --import tsx --import ./test/bootstrap-e2e-parallix-home.ts test/e2e/agents/real-agent-smoke.test.ts
```

## Expected runtime and determinism

Unlike the stubbed lifecycle harness, this test drives real local-model
inference calls for the draft, execute, and review agents and is expected to be
**slower and less deterministic**. Runs using the configured custom local model
share production admission capacity across worktrees; a queued session waits
until an occupied slot is released.
A green full-lifecycle run measured ~4
minutes (242s) on the reference workstation; failing runs usually fail faster
(a draft-phase failure is often visible within ~40s). After a draft failure,
the diagnostic health probe allows up to 120s by default so a cold or queued
local backend can return its first response; set
`PARALLIX_REAL_AGENT_HEALTHCHECK_TIMEOUT_MS` to tune that limit. The
single-session timeout defaults to 600s and can be raised via
`PARALLIX_REAL_AGENT_TIMEOUT_MS`; the health-probe limit is capped at that
single-session budget, and the active phase gets twice that budget because one
`px active` invocation covers up to three sequential model sessions (execute
agent, a possible repair relaunch, and the autonomous review loop). Occasional local-model flakiness
(slow tool calls, transient backend hiccups) is a known risk of this tier —
see the failure-bucket classification below for how to tell that apart from
a genuine Parallix regression.

## Lifecycle depth covered

The gate runs the full `draft -> active -> review` lifecycle with the real
`custom` agent family, through the production launcher path in `src/adapters/agents/opencode.ts`.

While the original implementation stopped at `draft` (because `draft` and `active` both
funnel through the same launcher code path), the corrected smoke test exercises
the complete `draft -> refine -> active -> review` flow to:

- Prove the launcher boundary for `draft` (catches `TASK-1351` launcher-argument regressions)
- Prove the draft records a complete mission contract in Mission state, without a harness retry (catches `TASK-1273` phantom drafts)
- Verify `active` phase execution: every planned checkpoint has recorded evidence in Mission state, with a Goal Check row for each success criterion
- Verify `review` phase execution and reviewer selection behavior
- Strengthen telemetry isolation assertions with actual file-content validation

The test uses a representative minimal mission prompt based on the hello-world shell
program task ("Create a .sh hello world program") rather than the fabricated
greeting-helper placeholder, ensuring the smoke validates against how Parallix
actually asks agents to do things.

The harness does not repair the product on its behalf. It runs `px draft` once
and never retries it: when the drafting agent leaves the contract incomplete,
Parallix itself sends the missing parts back to the agent, and a draft that
still ends incomplete fails the gate. The contract is asserted in full — goal,
why, scope, success criteria, checkpoint plan, gates and predicted NEL bucket —
and the mission is activated with the gates the agent recorded, not gates the
harness substituted.

For authoring, prefer one `px mission author` invocation and use its successful
output as readback. The launch prompt includes the exact runnable flags and an
authoritative status snapshot. Recover missing context or a conflict with `px status`. Criteria and evidence values can use plain
text without literal backticks or embedded double quotes. A greeting criterion
can be `hello.sh prints Hello, World! and exits successfully`; its execution
evidence can be `hello.sh was run with ./hello.sh; output was Hello, World!;
exit status was 0`. The repository-relative path supplies the verifiable
reference. Status reports the stored Mission classification, with `unset`
(distinct from an explicit `unknown`) when none has been recorded. Unknown may
be recorded at intake, including for a harness-created task; the draft agent must
choose `ai_sdlc` or `user_value` before the Mission can be refined.

The lifecycle continues through integration, verifies the landed greeting, and
checks that the disposable mission worktree was removed.

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
  `src/adapters/agents/opencode.ts` or `src/adapters/agents/agents.ts`.
- `[parallix-workflow-failure]` — `opencode` launched and produced output,
  but the mission did not get through the lifecycle: the draft ended with an
  incomplete mission contract after Parallix's own bounce-back, the draft-stats
  line was missing or malformed, or a later phase exited unsuccessfully
  without a recognized environment or launcher error. Timeouts in the active
  phase use the same environment classification as draft and health-probe
  timeouts. This is the
  `TASK-1273` class of bug.

Mission activation and integration read the recorded contract in SQLite, and
handoff checks its recorded checkpoint evidence. These steps do not require a
`MISSION.md` file or a mission metadata directory; a recorded base branch must
still exist locally.

The smoke harness does two preflight checks before the full lifecycle run:

- It verifies that the real `opencode` binary is present on `PATH`.
- It runs a tiny real `opencode run ... 'Reply with exactly OK'` probe with the
  configured model and the same child environment the lifecycle test will use.

That fast launcher probe is intentional: it catches broken local `opencode`
runtime state (for example SQLite/WAL or missing-model failures) in seconds
instead of letting the main draft phase burn the full timeout and misattribute
the problem to Parallix lifecycle logic. The probe is judged on its answer, not
only on its exit status: a runner can exhaust its own provider retries and still
exit 0, so the probe must actually return `OK`. An unreachable backend therefore
reports `[local-model-environment]` up front instead of surfacing later as a
`[parallix-workflow-failure]` phantom draft.

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
  highest-precedence input to `resolveParallixHome` (`src/adapters/storage/storage.ts`),
  which anchors both the measurement database `parallix.db` and the agent
  blocking file `agents.local.json`. The test points `PARALLIX_HOME` at a temp
  directory and validates that:
  - Measurements are written to the isolated `PARALLIX_HOME` (temp directory)
  - The stored draft-stage measurement records the expected model
  - No `stats.csv` is written at all — the database is the statistics authority
  - Neither `parallix.db` nor `agents.local.json` in the developer's default
    Parallix state roots (`~/.local/state/parallix` on Linux, `~/.parallix`
    fallback) contains any smoke-run data
  - Runner configuration and credentials are copied into disposable directories.
    Pi sessions and settings, and opencode session databases and XDG state,
    remain isolated; the operator's session database is never copied into a fixture.

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

- **Verification gate that fails where missions stalled**: The throwaway repo
  ships a `scripts/verify-local.sh` that is also its configured verification
  command. It fails when the mission worktree was not prepared by the
  repository's pre-draft hook — the condition that stalled a real mission when
  its gates ran in a worktree with no dependencies installed. A green smoke
  therefore shows that worktree preparation works end to end.

- **Representative task content**: The throwaway repo's backlog task uses "Create a
  .sh hello world program" instead of the fabricated greeting-helper placeholder,
  ensuring the smoke test validates against realistic Parallix mission prompts.
