# Parallix

**Parallix is a CLI for a local-first, human-in-the-loop developer workflow that runs several supported AI coding agents against one repository as isolated, resumable, reviewable missions — instead of one agent improvising in your working tree.**

It is built for solo maintainers and small-team leads who already drive AI coding agents such as Claude Code, Codex, OpenCode/Qwen, and Vibe/Mistral and have hit the real problems: two agents fighting over one checkout, a run dying when a provider hits its usage cap, no clean way to resume a long task where it stopped, and the agent that wrote the code also being the one that declares it done.

It wraps your AI coding workflow without replacing it: Parallix turns each piece of work into a *mission* with its own branch and its own git worktree, fails over to another agent family when one hits its usage limit, checkpoints long runs so they resume deterministically, and forces a second coding agent review step plus your own repo-configured verification gates before anything is integrated. A human still chooses the task, launches each phase, reads the review, and decides whether the work should land.

**Why not just use Claude Code, Codex, or OpenCode directly?** Those are the agents — Parallix is the harness around them. It does not replace your agent or your model. It coordinates several of them as one multi-agent coding workflow with isolation, automatic failover, deterministic checkpoints, and a forced review pass that a single agent session does not give you.

**The first concrete thing you can do** is build the local tarball, run setup, create one Backlog.md-style task, and draft it:

```sh
npm pack                                  # builds magnus-parallix-<version>.tgz
npm install -g ./magnus-parallix-*.tgz
px setup
px draft task-001
```

`px draft` does not accept free-text slugs like `my-first-task`, and it does not create the task for you. It expects an existing Backlog.md-style task key such as `task-001`.

Everything below is the longer version, with the proof and the caveats kept honest.

## Why Parallix?

Running AI coding agents one session at a time hits a ceiling fast:

- **One working tree, many agents.** Point two agents at the same checkout and they fight over the index, the branch, and uncommitted files. You either serialize them — one idle while the other runs — or hand-manage `git worktree` and branch names yourself.
- **Runs die on usage caps.** An agent prints "usage limit reached", the run stops, and you babysit it: restart later, or hand-switch to a different model.
- **Long tasks lose their place.** A crashed or context-exhausted agent leaves you reconstructing what was already done by re-reading diffs.
- **The author grades its own homework.** The agent that wrote the change also declares it done. Nobody independent looks before it lands.

Parallix is a mission-based development workflow that addresses each of these directly, with the mechanics living in tested code rather than in prompts. It is not another agent or model — it is the operator-owned layer around the agents you already use.

## What it does

Each capability below is tied to a use case in [`docs/use-cases.md`](docs/use-cases.md), with the confidence level (Confirmed / Partial) carried through honestly.

- **Run several AI coding agents on one repo without clobbering each other** *(UC-1 — Confirmed mechanic).* Every mission gets its own `mission/<slug>` branch and its own sibling git worktree (`../<repo>-<slug>`) automatically, so N agents make progress independently and each lands by squash-merge.
- **Fail over automatically when an agent hits its usage limit** *(UC-2 — Confirmed).* Per-family limit messages are pattern-detected; the agent family is written to a timed blocklist and the run retries with the next eligible, unblocked family. Only when all are exhausted does it fail loudly. Agent usage limits stop a single session; they don't have to stop the mission.
- **Resume a long mission deterministically** *(UC-3 — Confirmed).* Every checkpoint runs the gate, commits a checkpoint document with a literal `Next action:` line, and pushes it — so a later session or a different agent resumes from a written instruction, not a guess.
- **Force a second, preferentially-different coding agent review before merge** *(UC-4 — Partial).* Review is a separate step whose reviewer selection excludes the implementer to prefer a different agent family, and a self-approval is code-blocked at the provider. It falls back to the same family when no other agent is runnable, so this forces a second review *attempt* — it does not guarantee a different reviewer.
- **Publish work to a Forgejo reviewer surface without making Forgejo your branch authority** *(Confirmed mechanic).* When the review provider is enabled, Parallix syncs the local baseline to a dedicated `review` remote and opens or updates the PR there; if Forgejo is disabled, the branch/worktree flow still runs locally.
- **Use a repo-local Graphify knowledge graph for smaller codebase context pulls** *(Confirmed mechanic, optional, unproven payoff).* In repositories where the operator has already installed the Graphify skill, the workflow keeps `graphify-out/` isolated per worktree and refreshes it during review/integration, while the installed agent guidance steers codebase questions toward `graphify query` / `path` / `explain` before full reports or raw grep. That should reduce context bloat, but this repo does not currently claim a measured token-usage reduction.
- **Keep your existing verification gate instead of agent self-reporting** *(UC-5 — Confirmed).* The gate is a configured shell command with a no-op default: declare your existing `make` / `npm` / script command in `workflow.config.json` and it runs verbatim; declare nothing and verification is a documented no-op pass, not an invented gate.
- **See which agent family actually pays off across every repo one runtime drives** *(UC-6 — Partial).* A single operator-owned `stats.csv` accumulates per-agent telemetry across repositories. Token-cost comparison is complete today only for the families with structured telemetry (codex, claude); two families record honest zeros by design.

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

## Quick start

Parallix is distributed as a **local npm tarball built from this repository** — not a public registry install and not a container image (see [Current status](#current-status)). The shortest supported path:

```sh
# 1. Build the tarball from the repo root (produces magnus-parallix-<version>.tgz)
npm pack

# 2. Install the px CLI globally (use --prefix "$HOME/.local" if you lack sudo)
npm install -g ./magnus-parallix-*.tgz

# 3. Run the setup wizard for workflow.config.json, review wiring, and the
#    standard Backlog.md-style layout under backlog/ and missions/
px setup

# 4. Confirm which px is on PATH
px --version
```

If you want the hosted review surface, `px setup` can also create or update the Forgejo review repo, token files, and the `review` remote. Forgejo is the PR viewer and publication surface here, not the authority for local branch ancestry or integration.

Before `px draft`, create a task first. If you already use Backlog.md, create it there. If you do not, create the markdown file yourself under `backlog/tasks/`:

```md
backlog/tasks/task-001 - my-first-task.md
---
id: TASK-001
title: my first task
status: backlog
assignee: []
labels: ["user_value"]
dependencies: []
---
```

Then draft and run it with the actual workflow command:

```sh
px draft task-001
px active task-001
```

Optional but useful: install the Graphify skill once per supported agent family if you want graph-backed codebase navigation in long missions and reviews. This is not a hard requirement like having a task file for `px draft`; when Graphify is not installed, Parallix skips graph updates and continues the workflow. The operator setup is documented separately because it is a workstation capability, not a minimum install step.

Optionally add `px shell-init` to your shell rc so mission transitions can `cd` your terminal into the next worktree.

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
px review task-042

# Land it: runs configured integration gates, squash-merges to
# the primary branch, updates board state, removes the branch
# and worktree.
px integrate task-042
```

The verification gate that runs at each checkpoint is whatever you declare in `workflow.config.json` (this repo declares `npm test`), so the workflow adopts your existing CI rather than replacing it.

## Use cases

The full evidence-backed inventory is in [`docs/use-cases.md`](docs/use-cases.md). The README focuses on the three claims that are best supported by the current code and retrospective data:

1. **Parallel multi-agent execution (UC-1).** The isolated worktree-per-mission model is the *specific* mechanic an internal retrospective measured as the only configuration to beat a human baseline. Depending on whether you frame output as direct user-value missions or total completed missions in an already-productized setup, the observed gain ranges from roughly **+57%** to about **+1,280%**.
2. **Usage-limit auto-failover (UC-2).** Family-specific limit detection → timed blocklist → retry-next-eligible is a tested control loop, not a retry button.
3. **Second review gate (UC-4, Partial).** A self-approval is code-blocked and reviewer selection excludes the implementer family — forcing a second review *attempt* by a preferentially different agent, with an honest same-family fallback.

## What Parallix is not

- **Not a model and not an AI coding agent.** It does not generate code itself. It coordinates the agents and models you already use (Claude Code, Codex, OpenCode/Qwen, and Vibe/Mistral).
- **Not an IDE or an editor plugin.** It is a CLI workflow harness around Git and your existing toolchain — there is no UI, no autocomplete, no inline suggestions.
- **Not a magic autonomous engineer.** This is a human-in-the-loop workflow. Nothing merges itself, and the safe operating model is that a human decides what to queue, when to run `px active`, how to respond to review findings, and whether `px integrate` should happen at all.
- **Not a guaranteed throughput multiplier.** The observed gain varies with context. In the data we have, it ranges from roughly **+57%** on strict user-value output to about **+1,280%** on total completed-mission throughput in a later productized setup. Those are both real observations, but they are different mission-output measures and should be labeled that way.

## Current status

**Alpha, local-first, and best suited to operators comfortable with Git and CLI workflows.**

- **Distribution:** local `npm pack` + global install only. There is **no** public npm registry publish, no Homebrew, no Docker image, no standalone binary, and no CI/release automation today. This is a deliberate near-term model (ADR 0044), not an oversight.
- **Review surface:** Forgejo is supported as the hosted PR viewer/publication surface, but the workflow remains local-first and can run without Forgejo when that provider is disabled.
- **Versioning:** `CHANGELOG.md` is the versioning authority; PATCH bumps are the release discipline until a first public release.
- **Telemetry:** structured token/usage telemetry exists for the codex and claude families; the local-Qwen and mistral paths record honest zeros by design rather than fabricated numbers.
- **Graphify:** the knowledge-graph path is supported for codex, claude, and qwen/opencode after one-time operator setup. It is optional, not a workflow prerequisite. The credible claim today is better-scoped context retrieval, not a proven token-savings benchmark.
- **Review coverage** is best-effort, not guaranteed — see UC-4's caveats in [`docs/use-cases.md`](docs/use-cases.md).

This is a tool for a local-first developer workflow on one machine, driven by an operator who reads the caveats.

## Documentation

- [`docs/use-cases.md`](docs/use-cases.md) — evidence-backed use-case inventory with confidence levels and red-team analysis (primary source of truth for what Parallix actually does today).
- [`docs/authority-reference.md`](docs/authority-reference.md) — the internal operator reference: workflow modes, the authority model, agent selection, the layered validation model, checkpoint model, state mapping, command aliases, stats, persistent operator data, and the full public-distribution story.
- [`docs/forgejo-setup.md`](docs/forgejo-setup.md) — how the Forgejo review surface, tokens, and `review` remote are bootstrapped.
- [`docs/operator-setup.md`](docs/operator-setup.md) — one-time Graphify skill installation for codex, claude, and qwen/opencode.
- [`docs/readme-rewrite-benchmark.md`](docs/readme-rewrite-benchmark.md) — how comparable developer-tool READMEs are structured, and the decisions behind this one.
- [`AGENTS.md`](AGENTS.md) — hard rules, restricted actions, and verification entrypoints.
- `docs/adr/` — architecture decision records, including ADR 0044 (distribution model).

## Development

```sh
npm test     # FORCE_COLOR=0 node --test test/*.test.js
```

The test suite is the verification gate this repo declares in `workflow.config.json`. Run it before integrating any change. Contributions follow the same mission lifecycle the tool itself runs: branch, worktree, checkpoints, a second review, and a passing gate before integration.

If you are developing Parallix itself from a checkout, the repo-root dispatcher is:

```sh
node index.js <command>
```

## License

Copyright (C) 2026 Magnus Ekdahl.

Parallix is free software: you can redistribute it and/or modify it under the terms of the **GNU Affero General Public License** as published by the Free Software Foundation, either version 3 of the License, or (at your option) any later version. See [`LICENSE`](LICENSE) for the full text.

The AGPL covers Parallix itself and any modified or network-hosted fork of it. Running `px` as a tool inside your own repository does **not** make your project a derivative work — your code remains entirely yours under whatever terms you choose.
