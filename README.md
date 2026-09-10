# Parallix

**Parallix is an agent-agnostic, local-first workflow for running multiple AI coding agents in parallel without giving up Git isolation, review, verification, or operator control.**

Coding agents become much more useful when you can run several pieces of work at once. But simply starting more agents quickly creates a new bottleneck: they compete for the same working tree, lose context across long runs, hit provider limits, and produce more changes than one engineer can safely supervise and integrate.

Parallix is the delivery layer around those agents. It gives every piece of work an isolated mission, lets multiple missions progress concurrently, preserves execution across sessions, separates implementation from review, runs repository-owned verification, and leaves the final integration decision with the human operator.

Parallix is deliberately not tied to one agent vendor or model family. The same mission workflow can use different agent families for drafting, implementation, and review, including commercially hosted agents, locally hosted AI, and custom runtimes.

**The first concrete thing you can do** is run one complete mission:

[![Terminal demonstration showing a new directory, mission drafting, mission inspection, autonomous review, diff inspection, and operator integration](docs/assets/first-value-demo.gif)](docs/assets/first-value-demo.gif)

The operator inspects the drafted mission before execution, then inspects the reviewed diff and decides whether to run `px integrate`. Parallix does not merge autonomously.

## Why Parallix?

The main reason to use coding agents is leverage: while one agent is working, another can be working on something else. The useful ceiling is therefore not how fast one agent can type code, but **how much trustworthy work one engineer can keep moving in parallel**, and running one session at a time leaves most of that unused. Simply starting several agents, however, creates a new set of coordination problems:

- **One working tree, many agents.** Point two agents at the same checkout and they fight over the index, the branch, and uncommitted files. You either serialize them — throwing away the parallelism — or hand-manage `git worktree` and branch names yourself.
- **Runs die on usage caps.** An agent prints "usage limit reached", the run stops, and you babysit it: restart later or hand-switch to a different model.
- **Long tasks lose their place.** A crashed or context-exhausted agent leaves you reconstructing what was already done by re-reading diffs.
- **The author grades its own homework.** The agent that wrote the change also declares it done. Nobody independent looks before it lands.

Parallix is a mission-based development workflow that addresses each of these directly so parallel agents can translate into actual delivery throughput. The mechanics live in tested code rather than in prompts. It is not another agent or model — it is the operator-owned layer around the agents you already use.

## What it does

- **Run several AI coding agents on one repo without clobbering each other**. Every mission gets its own `mission/<slug>` branch and its own sibling git worktree (`../<repo>-<slug>`) automatically, so N agents make progress independently and each lands by squash-merge.
- **Use different agent families — including local AI — in the same workflow**. Parallix owns the mission lifecycle rather than one vendor's agent framework. Drafting, implementation, and review can use different eligible families, and custom/local runtimes participate in the same branch, checkpoint, review, and integration model.
- **Fail over automatically when an agent hits its usage limit**. Per-family limit messages are pattern-detected; the agent family is written to a timed blocklist and the run retries with the next eligible, unblocked family. Only when all are exhausted does it fail loudly. Agent usage limits stop a single session; they don't have to stop the mission.
- **Resume a long mission deterministically**. The execution agent records completed checkpoints with evidence and a concrete next action, and commits them locally, so a later session or a different agent can resume from the recorded progress.
- **Force a second, preferentially-different coding agent review before merge**. Review is a separate step whose reviewer selection excludes the implementer to prefer a different agent family, and a self-approval is code-blocked at the provider. It falls back to the same family when no other agent is runnable, so this forces a second review *attempt* — it only guarantees a different reviewer when one is available.
- **Publish work to a Forgejo reviewer surface without making Forgejo your branch authority**. When the review provider is enabled, Parallix syncs the local baseline to a dedicated `review` remote running locally and opens or updates the PR there; if Forgejo is disabled, the branch/worktree flow still runs without it.
- **Use a repo-local Graphify knowledge graph for smaller codebase context pulls**. In repositories where the operator has already installed the Graphify skill, the workflow keeps `graphify-out/` isolated per worktree and refreshes it during review/integration, while the installed agent guidance steers codebase questions toward `graphify query` / `path` / `explain` before full reports or raw grep. That reduces token-usage.
- **Keep your existing verification gate instead of agent self-reporting**. The gate is a configured shell command with a no-op default: declare your existing `make` / `npm` / script command in `workflow.config.json` and it runs verbatim; declare nothing and verification is a documented no-op pass, not an invented gate.
- **Confine supported agent processes with Bubblewrap on Linux**. When Bubblewrap is available, Parallix mounts the host filesystem read-only and selectively grants write access required by the current mission. Implementation gets its mission worktree and required Git state writable; review keeps the worktree read-only. If Bubblewrap is unavailable, Parallix warns explicitly that the agent is running unsandboxed.
- **Evaluate which agent family actually pays off across every repo one runtime drives**. A single operator-owned measurement database (`<PARALLIX_HOME>/parallix.db`) accumulates per-agent usage telemetry across repositories.

## The core workflow

A mission moves through a fixed lifecycle, one branch and one worktree at a time:

```
backlog → draft → active → review → approved → done
            │        │        │         │
         worktree  agent     second   squash-
         + branch   run +    review +  merge +
                  checkpoints  gates   cleanup
```

In practice: a human drafts a mission, Parallix creates the branch and worktree, an agent runs and writes checkpoints, a verification gate runs, a second (preferentially different) agent reviews the diff, and only then is the work integrated back to your primary branch by squash-merge. Blocking review findings loop back to `active` on the same branch and PR.

## Defence in depth

Running several agents in parallel is only worth doing if you can trust what comes back. Parallix combines isolation, mission-specific checks, separate review, and automatic repair so confidence comes from checked results throughout delivery.

1. **Isolation.** Every mission gets its own branch and sibling worktree, so parallel agents do not compete over the same working tree, index, or branch.
2. **Confinement.** On Linux with Bubblewrap enabled, supported agent processes see a read-only host filesystem, with write access limited to the mission worktree and the Git, temporary, and agent-state paths needed for the current step. During review, the mission worktree is read-only too.
3. **Your existing checks at lifecycle transitions.** Connect your test pyramid by assigning existing test commands to the stages where you want them to run. For example, run fast unit tests and static analysis before a mission moves from `active` to `review`, and reserve expensive integration and end-to-end suites for the final merge. Parallix runs the selected commands and blocks progress when they fail. The [lifecycle check configuration](docs/config.md#lifecycle-gates) shows how to connect those commands to each stage.
4. **Defences tailored to the mission.** Parallix instructs the drafting agent to investigate the codebase and mission, define concrete success criteria, and select suitable verification commands. For bug fixes, it calls for a failing reproduction test before implementation. The mission's declared checks run before it moves from `active` to `review`, turning the plan into checks on the delivery.
5. **Evidence for review.** Before a mission moves from `active` to `review`, Parallix checks that the final checkpoint connects success criteria to concrete references, such as tests or runnable repository commands. Missing mission or checkpoint documents block that transition. Reviewers get a stated goal and supporting evidence to examine; generic claims such as “verified” are insufficient.
6. **Separate review.** A second agent reviews the delivery, using a different agent family when one is available. The pull request author cannot formally approve their own work.
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

Parallix runs on built-in defaults with no config file; `px setup` writes one when you want to declare your own verification gate, mission layout, or Forgejo review wiring. See the [configuration reference](docs/config.md) for the supported overrides and their defaults. The verification gate that runs at each phase is whatever you declare in `workflow.config.json`. In this repo that dispatcher is `./scripts/verify-local.sh {{area}}`: earlier phases use the fast general suite, while `px integrate` calls `verify-local.sh integrate`, which resolves repo-side integration gates from `config/integration-pipelines.json` and runs the stricter pre-merge checks there.

When a mission goes wrong and you want to start it over, `px cancel <slug> --yes`
retires it: it deletes that one mission's lifecycle rows from the operator
database, archives its Backlog task file so the card leaves the board, keeps its
recorded usage and cost, and prints the
`git worktree remove ... && git branch -D ...` cleanup for you to run yourself.
The same action sits behind a confirmation on the TUI board (`Shift+X`) and on
the web board (the `cancel ✕` button). See the [board guide](docs/tui-board.md)
for the details.

## Working with Backlog.md and Forgejo

Both are optional integrations, and each one is wired independently of the other.

**Backlog.md.** Point `px draft` at a task key and Parallix adopts the existing record instead of creating one: it reads the ID, title, labels, and classification from `backlog/tasks/<slug> - <title>.md` and carries them through the mission. As the mission moves, Parallix writes the task's `status` frontmatter and, on completion, moves the file into `backlog/completed/`, so the board reflects mission state without a second bookkeeping step. Drafting from free text instead produces an equivalent synthetic record, so nothing downstream depends on you keeping task files.

**Forgejo.** Review publication is off until you configure it. `px setup` bootstraps the pieces — the review repository, agent tokens, and the `review` git remote — and from then on each mission opens or updates its PR there automatically. Forgejo user accounts must already exist before setup runs; see [`docs/forgejo-setup.md`](docs/forgejo-setup.md) for account creation, token layout, and running a local instance.

## Use cases

The durable capability guide and confidence boundaries are in [`docs/use-cases.md`](docs/use-cases.md).

The isolated worktree-per-mission model is the *specific* mechanic an internal retrospective measured as the only configuration to beat a human baseline. Depending on whether you frame output as direct user-value missions or total completed missions in an already-productized setup, the observed gain ranges from roughly **+57%** to about **an order of magnitude**.

## What Parallix is not

- **Not a model and not an AI coding agent.** It does not generate code itself. It is agent-agnostic infrastructure around the agents and models you already use, including hosted and local AI.
- **Not an IDE or an editor plugin.** It is a CLI workflow harness around Git and your existing toolchain. It has a terminal mission board, but no code editor, autocomplete, or inline suggestions.
- **Not a magic autonomous engineer.** This is a human-in-the-loop workflow. Nothing merges itself, and the safe operating model is that a human decides what to queue, when to run `px active`, how to respond to review findings, and whether `px integrate` should happen at all.
- **Not a guaranteed throughput multiplier.** The observed gain varies with context.

## Current status

**Alpha, local-first, and best suited to operators comfortable with Git and CLI workflows.**

- **Distribution:** Published to the public npm registry as `@magnusekdahl/parallix`. Local tarball install (`npm pack`) is also supported. No Homebrew, no Docker image, no standalone binary, and no CI/release automation today.
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

## Development

```sh
npm test
npm run test:integration  # real process, Git/worktree, package, and local-network boundary coverage
```

The test suite is the verification gate this repo declares in `workflow.config.json`. Run it before integrating any change. Contributions follow the same mission lifecycle the tool itself runs: branch, worktree, checkpoints, a second review, and a passing gate before integration. To exercise the packaged artifact the way a user receives it: `npm pack && npm install -g ./magnusekdahl-parallix-*.tgz`.

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
