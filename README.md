# Parallix

**Parallix is a local-first workflow and trust layer for AI coding agents: it runs each piece of work as an isolated mission in its own Git worktree, sends the result to a separate code review that prefers a different agent family when one is available, runs repository-owned verification where you configure a gate, confines agents with Linux Bubblewrap when available (falling back to an agent's native sandbox, or blocking until explicit consent when neither exists), and leaves the squash merge to a human.**

It works with Codex CLI, Claude Code, Qwen Code, and Mistral Vibe, and runs OpenCode or Pi through its configurable custom runner, so drafting, implementation, and review can use different agent families, including locally hosted AI.

Coding agents become much more useful when you can run several pieces of work at once. But simply starting more agents quickly creates a new bottleneck: they compete for the same working tree, lose context across long runs, hit provider limits, and produce more changes than one engineer can safely supervise and integrate.

Parallix is the delivery layer around those agents. It gives every piece of work an isolated mission, lets multiple missions progress concurrently, preserves execution across sessions, separates implementation from review, runs repository-owned verification, and leaves the final integration decision with the human operator. Parallel Git isolation is how that trust ladder can operate across concurrent missions instead of one shared checkout.

## Install

For Bash, install Parallix and load its bundled worktree-switching integration
in one step:

```sh
npm install -g @magnusekdahl/parallix && eval "$(px shell-init bash)"
```

**The first concrete thing you can do** is run one complete mission:

[![Terminal demonstration showing a new directory, mission drafting, mission inspection, autonomous review, diff inspection, and operator integration](https://raw.githubusercontent.com/oxtan-maker/parallix/main/docs/assets/first-value-demo.gif)](https://raw.githubusercontent.com/oxtan-maker/parallix/main/docs/assets/first-value-demo.gif)

The operator inspects the drafted mission before execution, then inspects the reviewed diff and decides whether to run `px integrate`. Parallix does not merge autonomously.


## Why Parallix?

The main reason to use coding agents is leverage: while one agent is working, another can be working on something else. The useful ceiling is therefore not how fast one agent can type code, but **how much trustworthy work one engineer can keep moving in parallel**, and running one session at a time leaves most of that unused. Simply starting several agents, however, creates a new set of coordination problems:

- **One working tree, many agents.** Point two agents at the same checkout and they fight over the index, the branch, and uncommitted files. You either serialize them — throwing away the parallelism — or hand-manage `git worktree` and branch names yourself.
- **Runs die on usage caps.** An agent prints "usage limit reached", the run stops, and you babysit it: restart later or hand-switch to a different model.
- **Long tasks lose their place.** A crashed or context-exhausted agent leaves you reconstructing what was already done by re-reading diffs.
- **The author grades its own homework.** The agent that wrote the change also declares it done. Nobody independent looks before it lands.

Parallix is a mission-based development workflow that addresses each of these directly so parallel agents can translate into actual delivery throughput. The mechanics live in tested code rather than in prompts. It is not another agent or model — it is the operator-owned layer around the agents you already use.

![Observed one-maintainer dogfooding throughput: all completed Parallix missions per full UTC ISO week, with a historical baseline of approximately 2 delivery units/week.](https://raw.githubusercontent.com/oxtan-maker/parallix/main/docs/assets/velocity-throughput.svg)

Observed one-maintainer dogfooding throughput. The [methodology and evidence](docs/metrics/velocity/README.md) define the mission population, historical reference, and limitations.

## What it does

- **Run several AI coding agents on one repo without clobbering each other**. Every mission gets its own `mission/<slug>` branch and its own sibling git worktree (`../<repo>-<slug>`) automatically, so N agents make progress independently and each lands by squash-merge.
- **Use different agent families — including local AI — in the same workflow**. Parallix owns the mission lifecycle rather than one vendor's agent framework. Drafting, implementation, and review can use different eligible families, and custom/local runtimes participate in the same branch, checkpoint, review, and integration model.
- **Fail over automatically when an agent hits its usage limit**. Per-family limit messages are pattern-detected; the agent family is written to a timed blocklist and the run retries with the next eligible, unblocked family. Only when all are exhausted does it fail loudly. Agent usage limits stop a single session; they don't have to stop the mission.
- **Resume a long mission deterministically**. The execution agent records completed checkpoints with evidence and a concrete next action, and commits them locally, so a later session or a different agent can resume from the recorded progress.
- **Force a second, preferentially-different coding agent review before merge**. Review is a separate step whose reviewer selection excludes the implementer to prefer a different agent family, and a self-approval is code-blocked at the provider. It falls back to the same family when no other agent is runnable, so this forces a second review *attempt* — it only guarantees a different reviewer when one is available.
- **Publish work to a Forgejo reviewer surface without making Forgejo your branch authority**. When the review provider is enabled, Parallix syncs the local baseline to a dedicated `review` remote running locally and opens or updates the PR there; if Forgejo is disabled, the branch/worktree flow still runs without it.
- **Use a repo-local Graphify knowledge graph for smaller codebase context pulls**. In repositories where the operator has already installed the Graphify skill, the workflow keeps `graphify-out/` isolated per worktree and refreshes it during review/integration, while the installed agent guidance steers codebase questions toward `graphify query` / `path` / `explain` before full reports or raw grep. That reduces token-usage.
- **Keep your existing verification gate instead of agent self-reporting**. The gate is a configured shell command with a no-op default: declare your existing `make` / `npm` / script command in `workflow.config.json` and it runs verbatim; declare nothing and verification is a documented no-op pass, not an invented gate.
- **Confine supported agent processes with Bubblewrap on Linux**. When Bubblewrap is available, Parallix mounts the host filesystem read-only and selectively grants write access required by the current mission. Implementation gets its mission worktree and required Git state writable; review keeps the worktree read-only. If Bubblewrap is unavailable, Parallix falls back to the agent's own native sandbox where the family exposes one (e.g. Codex `--sandbox`, Qwen `-s`), otherwise it blocks the mutating launch until the operator explicitly consents to run unsandboxed — no silent fallback.
- **Evaluate which agent family actually pays off across every repo one runtime drives**. A single operator-owned measurement database (`<PARALLIX_HOME>/parallix.db`) accumulates per-agent usage telemetry across repositories.

## Supported coding agents

- **Built-in families:** Codex CLI (`codex`), Claude Code (`claude`), Qwen Code (`qwen`), and Mistral Vibe (`vibe`). Install and sign in to each agent CLI you want Parallix to use.
- **Custom runner:** OpenCode (`opencode`) or Pi (`pi`) run as the `custom` family. Select one with `adapters.agents.runners.custom` in `workflow.config.json`; OpenCode is the default. Pi needs the optional `@earendil-works/pi-coding-agent` package.

Which families may draft, implement, and review is set per step in `config/agents.json`; Parallix chooses among the eligible families that are installed and not blocked by a usage limit. Mistral Vibe runs do not resume an earlier session; an interrupted Vibe run starts fresh from the recorded checkpoints. See the [agent configuration](docs/config.md#agents) for model and runner options.

## The core workflow

A mission moves through a fixed lifecycle, one branch and one worktree at a time:

```
backlog → draft → active → review → approved → done
            │        │        │         │
         worktree  agent     second   squash-
         + branch   run +    review +  merge +
                  checkpoints  gates   cleanup
```

In practice: a human drafts a mission, Parallix creates the branch and worktree, an agent runs and writes checkpoints, a configured verification gate runs, a second agent reviews the diff, and only then is the work integrated back to your primary branch by squash-merge. Each mission lands as one squash commit whose subject is the recorded mission title and whose body records the mission's task reference, so the primary branch history names what was delivered at a glance. Review uses a different agent family when one is available; when none is runnable, it falls back to the same family as a second review attempt. An operator can opt into a no-output deadline for silent reviewers with `WORKFLOW_REVIEW_AGENT_NO_OUTPUT_MAX_MS`, after which the next eligible reviewer is tried. Blocking review findings loop back to `active` on the same branch and PR.

The mission enters `review` before each review round and `integration` when approval succeeds. Review gate repairs return it to `active` before repair work and back to `review` after verification. Commit and rebase repairs needed to finish integration stay in `integration`. Integration gate failures return the mission to `active` and require a fresh review before integration resumes. The mission reaches `done` only after integration and cleanup succeed. A failed lifecycle write stops dependent work and is reported as a failure. Once activation commits, a failed agent run leaves the mission and its Backlog mirror active for retry. Agents use the launching CLI for their workflow commands so an older global installation cannot bypass these boundaries.

## Defence in depth

Running several agents in parallel is only worth doing if you can trust what comes back. Parallix combines isolation, mission-specific checks, separate review, and automatic repair so confidence comes from checked results throughout delivery.

1. **Isolation.** Every mission gets its own branch and sibling worktree, so parallel agents do not compete over the same working tree, index, or branch.
2. **Confinement.** On Linux with Bubblewrap enabled, supported agent processes see a read-only host filesystem, with write access limited to the mission worktree and the Git, temporary, and agent-state paths needed for the current step. During review, the mission worktree is read-only too.
3. **Your existing checks at lifecycle transitions.** Connect your test pyramid by assigning existing test commands to the stages where you want them to run. For example, run fast unit tests and static analysis before a mission moves from `active` to `review`, and reserve expensive integration and end-to-end suites for the final merge. Parallix runs the selected commands and blocks progress when they fail. The [lifecycle check configuration](docs/config.md#lifecycle-gates) shows how to connect those commands to each stage.
4. **Defences tailored to the mission.** Parallix instructs the drafting agent to investigate the codebase and mission, define concrete success criteria, and select suitable verification commands. For bug fixes, it calls for a failing reproduction test before implementation. The mission's declared checks run before it moves from `active` to `review`, turning the plan into checks on the delivery.
5. **Evidence for review.** Before a mission moves from `active` to `review`, Parallix checks that the final checkpoint connects success criteria to concrete references, such as tests or runnable repository commands. Missing mission or checkpoint documents block that transition. Reviewers get a stated goal and supporting evidence to examine; generic claims such as “verified” are insufficient.
6. **Separate review.** A second agent reviews the delivery, using a different agent family when one is available. The pull request author cannot formally approve their own work. On any review round, Jev can judge the prior findings, a repaired integration failure or, on a first review, the mission success criteria from revision-pinned evidence, then clear them or return them to the implementer. This runs by default when Jev and its review identity are available; uncertain evidence and broader changes go to the general reviewer. Operators can [opt out](docs/config.md#review-classification).
7. **Automatic, focused repair.** When checks detect a repairable delivery failure, Parallix sends the agent back with a tight prompt containing the specific failure, captured output, and the repair required. It reruns the failing check to confirm the fix. Retries are bounded, and unresolved failures are surfaced to the operator.
8. **Validate the final tree before merge.** When you choose to integrate an approved mission, Parallix runs the checks you assigned to integration against the exact tree about to land. This is where the broader tests from your pyramid check that the change works with the rest of the system. A failing check stops the merge.
9. **Operator decision.** Nothing merges itself. A human reads the diff and decides whether to integrate at all.

Repository checks and mission-specific defences complement separate review: passing a command or finding an evidence reference does not prove the change meets its goal. Parallix runs the checks your repository and mission declare; the operator retains the final judgement. See [use cases](docs/use-cases.md) for supported capabilities.

## Example

A realistic human-in-the-loop pass — mission → worktree → agent run → checkpoint → review → integrate:

```sh
# Start from a real Backlog task key. Draft creates branch mission/task-042
# and a sibling worktree ../myrepo-task-042
px draft task-042

# Run the implementer in that isolated worktree. If the chosen family
# hits its usage cap mid-run, Parallix blocks it and retries on
# the next eligible family. Each checkpoint commits a doc with a
# literal "Next action:" line, so the work is resumable.
px active task-042

# A second, preferentially-different agent reviews <main>..HEAD.
# If Forgejo review is enabled, the PR is published to the dedicated
# review surface; a self-approval by the implementing agent is blocked.

# Land it: runs configured integration gates, squash-merges to
# the primary branch, updates board state, removes the branch
# and worktree. In this repo that means a fast general verifier
# during earlier phases and a stricter lifecycle E2E gate before
# integrate lands.
px integrate task-042
```

Parallix runs on built-in defaults with no config file; `px setup` writes one when you want to declare your own verification gate or mission layout. See the [configuration reference](docs/config.md) for the supported overrides and their defaults. The verification gate that runs at each phase is whatever you declare in `workflow.config.json`. In this repo, earlier phases use the fast general suite; `px integrate` runs the stricter pre-integration gates declared in `workflow.config.json`. Independent gates can run concurrently, while a gate that consumes an artifact waits for its producer. In a terminal, integration shows one row per configured gate and lets you inspect its isolated output; failures expand their output automatically. When a repair attempt exhausts its budget, integration exits with a failure status and returns control to the shell for the stated manual action. Local SonarQube Cloud analysis waits for fresh coverage from the same mission checkout; the service decision and reconsideration triggers are in [ADR 0060](docs/adr/0060-per-worktree-sonarqube-analysis-identity.md). The Cloud scan entrypoint shared with GitHub is `npm run sonar` (config in `sonar-project.properties`; the operator token is exported, never committed).

When a mission goes wrong and you want to start it over, `px cancel <slug> --yes`
retires it: it deletes that one mission's lifecycle rows from the operator
database, archives its Backlog task file so the card leaves the board, keeps its
recorded usage and cost, and prints the
`git worktree remove ... && git branch -D ...` cleanup for you to run yourself.
The same action sits behind a confirmation on the TUI board (`Shift+X`) and on
the web board (the `cancel ✕` button). See the [board guide](docs/tui-board.md)
for the details.

`px lead` works down the board's "needs your attention" queue — the same list
the board shows you. For each item it presses the action the board already
advertises (`px active`, `px review`, …), the same command you would, and when
that does not clear the item it starts a fresh agent in that mission's worktree
with what the board reported, asking it to work out why progress stopped and
restore a state the normal workflow can continue from. An item only counts as
cleared when the board stops asking about it, never because an agent said so.

Attempts are counted per failure, like every other retry budget here: the same
attention reason surviving `--budget` agents (2 by default) is escalated with
what was observed, while a genuinely different failure gets its own attempts. An
item that clears and comes back is stuck again and is worked afresh. Liveness is
rechecked before anything is dispatched, so a mission whose agent is running is
left alone even when the board ranks its failed gate above that; the recovery
agent starts a new session rather than resuming the stuck one, and its token
usage is recorded against the mission like any other launch. One mission's
running agent never stops the rest of the queue from being worked.

One exception, always: an item asking for integration is left for you. The
supervisor never integrates anything, and there is no path from it to
`px integrate`; a recovery agent may not weaken a gate, manufacture a review, or
absorb a defect that belongs to your primary branch either.

Without `--once` it keeps going until the queue drains, polling every `--poll`
seconds (60 by default), so it holds the terminal the way a watch command does;
`--once` takes a single pass and exits. `--dry-run` prints the queue without
acting, and naming missions narrows the run to those.

## Optional integrations

Both are optional integrations, and each one is wired independently of the other.

**Backlog.md.** Point `px draft` at a task key and Parallix adopts the existing record instead of creating one: it reads the ID, title, labels, and classification from `backlog/tasks/<slug> - <title>.md` and carries them through the mission. The key must name an existing task: `px draft task-12.04` stops with a missing-task error when only `task-12` exists, before any branch, worktree, or Mission state is created, while a suffixed slug such as `task-12-followup` still adopts `task-12`. From then on the Mission owns its classification: `px classification set` changes it, and startup preflight and stage statistics read the stored value, so a later empty or conflicting task label neither blocks nor overrides it. Classification-dependent commands require a readable stored Mission; import legacy missions before recording statistics. A task label cannot replace missing or unreadable Mission state. As the mission moves, Parallix writes the task's `status` frontmatter and, on completion, moves the file into `backlog/completed/`, so the board reflects mission state without a second bookkeeping step. Drafting from free text instead produces an equivalent synthetic record, so nothing downstream depends on you keeping task files.

**Forgejo.** Review publication is off until you opt in. If you want its reviewer surface, `px setup` can bootstrap the review repository, agent tokens, and the `review` git remote; otherwise the branch/worktree workflow runs without Forgejo. Forgejo user accounts must already exist before that optional setup; see [`docs/forgejo-setup.md`](docs/forgejo-setup.md) for account creation, token layout, and running a local instance.

## Use cases

The durable capability guide and confidence boundaries are in [`docs/use-cases.md`](docs/use-cases.md).
For automatic interactive mission terminals and bounded retained agent-run output,
see [agent-run history](docs/agent-run-history.md).

## What Parallix is not

- **Not a model and not an AI coding agent.** It does not generate code itself. It is agent-agnostic infrastructure around the agents and models you already use, including hosted and local AI.
- **Not an IDE or an editor plugin.** It is a CLI workflow harness around Git and your existing toolchain. It has a terminal mission board, but no code editor, autocomplete, or inline suggestions.
- **Not a magic autonomous engineer.** This is a human-in-the-loop workflow. Nothing merges itself, and the safe operating model is that a human decides what to queue, when to run `px active`, how to respond to review findings, and whether `px integrate` should happen at all.
- **Not a guaranteed throughput multiplier.** The observed gain varies with context.

## Current status

**Alpha, local-first, and best suited to operators comfortable with Git and CLI workflows.**

- **Distribution:** Published to the public npm registry as @magnusekdahl/parallix. Verified main commits are continuously published through GitHub Actions using npm Trusted Publishing with provenance, with a matching Git tag and GitHub Release. Local tarball installation (npm pack) is also supported.
- **Review surface:** Forgejo is supported as the hosted PR viewer/publication surface, but the workflow remains local-first and can run without Forgejo when that provider is disabled.
- **Telemetry:** structured token/usage telemetry exists for the codex and claude families; the local-custom and mistral paths record honest zeros by design rather than fabricated numbers.
- **Graphify:** the knowledge-graph path is supported for codex, claude, and custom/opencode after one-time operator setup. It is optional, not a workflow prerequisite. The credible claim today is better-scoped context retrieval, not a proven token-savings benchmark.

This is a tool for a local-first developer workflow on one machine, driven by an operator who reads the caveats.

## Documentation

- [`docs/use-cases.md`](docs/use-cases.md) — durable capability identities, confidence levels, and positioning boundaries.
- [`docs/forgejo-setup.md`](docs/forgejo-setup.md) — how the Forgejo review surface, tokens, and `review` remote are bootstrapped.
- [`docs/operator-setup.md`](docs/operator-setup.md) — one-time Graphify skill installation for codex, claude, and custom/opencode.
- [`AGENTS.md`](AGENTS.md) — hard rules, restricted actions, and verification entrypoints.
- `docs/adr/` — architecture decision records, including ADR 0044 (distribution model) and ADR 0048 (the fail-closed harness defence inventory cited above).

## Built with Parallix

Parallix is developed using Parallix itself. Changes are broken into bounded missions, implemented in isolated worktrees, checked by repository-owned verification, reviewed in a separate agent pass — preferentially by a different agent family — and integrated only after human inspection. This repository is therefore both the product and a continuously exercised test case for the workflow it provides.

The maintainer owns product direction, architecture, acceptance criteria, release/review decisions, and the final integration decision. Coding agents are implementation and review tools: they may investigate the codebase, draft plans, implement bounded changes, run checks, and review diffs, but they do not autonomously decide what the product should become or merge their own work.

Because the workflow uses task-scoped execution identities, agent-created intermediate commits may carry mission-specific authorship. Responsibility for the architecture and for what ultimately lands in main remains with the maintainer. Architectural decisions are recorded in docs/adr/, while AGENTS.md and the repository verification configuration define the constraints and gates agents work within.

## Development

```sh
npm test
npm run test:integration  # real process, Git/worktree, package, and local-network boundary coverage
npm run test:codeql       # CodeQL SAST scan (javascript-typescript security/code-scanning), run manually; not part of local integration
```

LCOV reports omit TypeScript modules that compile to no runtime code. Modules
with runtime declarations or imports remain subject to coverage requirements.

The test suite is the verification gate this repo declares in `workflow.config.json`. Run it before integrating any change. Coverage runs (`PARALLIX_TEST_COVERAGE=1`, used by GitHub CI and the local pre-integration gates) use Node's built-in coverage with `--test-coverage-include-all` and need Node 26.7 or newer; the runner picks one from `PATH` or nvm, or from `PARALLIX_TEST_NODE` (ADR 0062).

Four Node floors are distinct here: the shipped runtime floor is `>=22.23.1` (`package.json` `engines.node`, also the bundle target); the ordinary development and unit-test floor is Node `24.15.0` or newer, which the unit-test module mock helper needs; the coverage-tooling floor is Node `26.7` or newer for `--test-coverage-include-all`; and GitHub CI selects Node `26` for the coverage run and Node `24` for the release path. The local verifier accepts any Node `20` or newer so `node --test` runs, but coverage still needs the `26.7` floor. Contributions follow the same mission lifecycle the tool itself runs: branch, worktree, checkpoints, a second review, and a passing gate before integration. To exercise the packaged artifact the way a user receives it: `npm pack && npm install -g ./magnusekdahl-parallix-*.tgz`.

If you are developing Parallix itself from a checkout, use the built runtime
after `npm run build`, or run the TypeScript entry directly with the development
script:

```sh
npm run build
node build/px.mjs <command>

# Direct-source development path
npm run dev -- <command>
```

## License

Copyright (C) 2026 Magnus Ekdahl.

Parallix is free software: you can redistribute it and/or modify it under the terms of the **GNU Affero General Public License** as published by the Free Software Foundation, either version 3 of the License, or (at your option) any later version. See [`LICENSE`](LICENSE) for the full text.

The AGPL covers Parallix itself and any modified or network-hosted fork of it. Running `px` as a tool inside your own repository does **not** make your project a derivative work — your code remains entirely yours under whatever terms you choose.
