# Real-agent launcher smoke test

`test/e2e/agents/real-agent-smoke.test.ts` is a **blocking** integration gate
that runs a real agent through the full production lifecycle. It normally uses
the `gemma-kub2` provider from the operator's pi model configuration when that
provider is configured and reachable. Otherwise it uses the repository's
configured custom runner and model behavior or, when production custom
admission is saturated, Codex with `gpt-6-luna` and low reasoning effort. It
exists to fail closed when Parallix breaks its own launcher or lifecycle path
while developing itself.

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

- For the preferred self-development route, `pi` must be present on `PATH`, the
  operator's pi `models.json` must declare the `gemma-kub2` provider and model,
  and that provider's `/models` endpoint must be reachable. The smoke only uses
  this cheap endpoint check for selection; the lifecycle itself proves model
  capability. Its disposable pi settings pin the selected provider and model
  without changing the operator's defaults, credentials, or sessions.
- `opencode` installed and present on `PATH`, with a working default local
  model configured in opencode's own state, is required when the kub2 route is
  unavailable and the configured runner is `opencode` (no repo config needed
  for this — opencode remembers its own last-selected model).
- `adapters.agents.models.custom` in this repo's `workflow.config.json` is an
  *optional* override, not a prerequisite: pinning a specific model string
  there is a footgun (it goes stale whenever the operator repoints the
  locally-served model). When unset, the test omits `-m` and lets the
  launcher fall back to opencode's own default, mirroring production
  behavior. If `adapters.agents.models.custom` is set, the test reads it and
  writes it into the throwaway repo's own `workflow.config.json` so the
  smoke run exercises that exact override.
- For the capacity fallback or self-development Codex override, `codex` must be
  on `PATH` and `gpt-6-luna` must be available to that Codex installation.
- The default custom smoke route needs no cloud credentials because its model is
  local. Both the capacity fallback and explicit Codex override require the
  operator's usable Codex authentication and model access.

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

## Smoke selection, admission, and concurrent replay

An explicit real-agent override remains first. Without one, the smoke reads the
`gemma-kub2` provider and model from the operator's pi model configuration and
selects it when a no-inference `GET /models` check succeeds. That route uses pi
with a disposable settings directory that isolates credentials and sessions. If the
provider is missing or unreachable, the existing order is unchanged: an
admitted production custom probe keeps the configured custom runner; saturated
custom admission selects Codex with `gpt-6-luna` and low effort when agent
policy, block authority, and launcher availability allow it; otherwise custom
remains selected and follows its existing admission wait/failure behavior.

This decision is made once. A kub2 or other custom launcher or lifecycle
failure never retries on another family, and a capacity change after custom was
selected is handled by normal custom admission. The kub2 route has its own
shared disposable lease home and a capacity of two, independent of
`adapters.agents.maxConcurrentCustom` and production admission state. Separate
smoke repositories and mission worktrees therefore can hold two kub2 smoke
leases while retaining isolated mission state, credentials, blocklists, and
runner sessions. The kub2 llama.cpp server itself reports one backend slot, so
two admitted smokes may queue inference even though both lifecycle processes
run concurrently.

Build the CLI before replaying (`npm run build`). Ensure the selected backend is
reachable and temporary storage is sufficient. Run two copies of the smoke
invocation in separate terminals. Kub2 runs share their dedicated two-slot
admission pool automatically; fallback custom runs share the existing smoke
admission pool and use the canonical checkout's configured custom capacity.
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
verify that the operator homes and runner directories differ. If capacity
changes after a run has selected custom, its launch waits for a lease under the
normal custom policy rather than changing family mid-lifecycle.

For a replay with its own lease database, give both invocations the same
absolute `PARALLIX_E2E_CUSTOM_ADMISSION_HOME` beneath a disposable directory.
The E2E bootstrap maps that explicit test-only value to
`PARALLIX_CUSTOM_ADMISSION_HOME`; an inherited production admission home is
still discarded to protect operator state.
Kub2 capacity remains two; fallback custom capacity comes from the canonical
checkout. Keep the session and active wall deadlines finite;
`PARALLIX_REAL_AGENT_TIMEOUT_MS` bounds each session, with three times that
allowance for the active phase. Retained fixtures and captures contain copied
credentials: remove only the directories belonging to these runs after
inspection, once their children have exited. Do not remove a shared admission
database while another run is using it.

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
px integrate task-2269 --real-agent codex --real-agent-model gpt-6-luna
```

The flags are a required pair. `px integrate` and
`./scripts/verify-local.sh integrate` reject an incomplete pair, duplicate
values, unsupported families, and unknown options before gate execution. The
values are forwarded as dedicated environment values only to
`custom-agent-smoke`; they are never concatenated into its shell command.
Without both flags, the configured `custom-agent-smoke` command remains
`node --import tsx --import ./test/bootstrap-e2e-parallix-home.ts test/e2e/agents/real-agent-smoke.test.ts`, and smoke selection retains the
normal order: a reachable kub2 route first, then the configured custom runner
or Codex capacity fallback.

The gate runs **one** full lifecycle per invocation. When kub2 is configured and
reachable, that route uses pi regardless of `PARALLIX_REAL_AGENT_RUNNER`; the
environment value only selects the configured custom runner after kub2 falls
through. This repository currently configures pi. To bypass kub2 and exercise
a custom runner and the configured custom model explicitly, select the custom
family as well as the runner:

```
PARALLIX_REAL_AGENT=custom PARALLIX_REAL_AGENT_RUNNER=opencode \
  node --import tsx --import ./test/bootstrap-e2e-parallix-home.ts test/e2e/agents/real-agent-smoke.test.ts
```

## Expected runtime and determinism

Unlike the stubbed lifecycle harness, this test drives real local-model
inference calls for the draft, execute, and review agents and is expected to be
**slower and less deterministic**. Concurrent kub2 runs can hold both smoke
leases but queue on the server's single inference slot. Runs using the fallback
configured custom model share production admission capacity across worktrees;
a queued session waits until an occupied slot is released.
A green full-lifecycle run measured ~4
minutes (242s) on the reference workstation; failing runs usually fail faster
(a draft-phase failure is often visible within ~40s). The smoke makes no
separate real-model probe: the actual lifecycle command is the availability
check and its captured output supplies the failure diagnostic. The
single-session timeout defaults to 600s and can be raised via
`PARALLIX_REAL_AGENT_TIMEOUT_MS`; the active phase gets three times that budget because one
`px active` invocation covers up to three sequential model sessions (execute
agent, a possible repair relaunch, and the autonomous review loop). Occasional local-model flakiness
(slow tool calls, transient backend hiccups) is a known risk of this tier —
see the failure-bucket classification below for how to tell that apart from
a genuine Parallix regression.

## Lifecycle depth covered

The gate runs the full `draft -> active -> review` lifecycle through the
production launcher for the family selected before launch: preferably the kub2
pi route, otherwise the configured custom runner or Codex capacity fallback.

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

For authoring, prefer one `px mission author` invocation followed by `px status`
readback; see `px mission --help`. Criteria and evidence values can use plain
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
  phase use the same environment classification as draft timeouts. This is the
  `TASK-1273` class of bug.

Mission activation and integration read the recorded contract in SQLite, and
handoff checks its recorded checkpoint evidence. These steps do not require a
`MISSION.md` file or a mission metadata directory; a recorded base branch must
still exist locally.

Before the lifecycle, the harness only performs cheap executable and
configuration checks for the selected launcher. It does not call a model. A
missing binary fails immediately; model, provider, and workflow failures come
from the real draft/active command, with its finite deadline and captured
stdout/stderr.

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
  every family except the runner selected before the lifecycle. Reviewer
  selection therefore takes its single-family fallback, and the test strictly
  asserts that the selected family also performs review. This prevents a
  second, unintended cloud or local family from entering the disposable run.
  `FORGEJO_USER` does not force the reviewer; `startAgent` overwrites it with
  the chosen family.

- **Verification gate that fails where missions stalled**: The throwaway repo
  ships a `scripts/verify-local.sh` that is also its configured verification
  command. It fails when the mission worktree was not prepared by the
  repository's pre-draft hook — the condition that stalled a real mission when
  its gates ran in a worktree with no dependencies installed. A green smoke
  therefore shows that worktree preparation works end to end.

- **Representative task content**: The throwaway repo's backlog task uses "Create a
  .sh hello world program" instead of the fabricated greeting-helper placeholder,
  ensuring the smoke test validates against realistic Parallix mission prompts.
