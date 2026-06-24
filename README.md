# Parallix

**Parallix is a local-first Git workflow CLI for running AI coding agents in isolated, reviewable missions instead of letting one long-lived agent session mutate your main checkout.**

It is for engineers who already use Git and terminal-first coding agents such as Claude Code, Codex, OpenCode/Qwen, and Vibe/Mistral, and want branch isolation, resumable checkpoints, agent-family failover, and a forced review step without building that harness by hand.

It wraps your existing AI coding workflow without replacing it: each mission gets its own branch and worktree, long runs checkpoint to markdown, review is a separate phase, and integration still goes through your repo's own verification command. A human still chooses the mission, launches each phase, reads the output, and decides what lands.

**The first concrete thing you can do** is install the CLI and run one complete mission:

```sh
npm install -g @magnusekdahl/parallix
px draft "create a hello world program"
px active
px review
px integrate
```

That path shows the whole value: isolate the work on its own branch and worktree, let an agent execute it with checkpoints, run a separate review phase, and only then integrate it back.

## Why Parallix?

Running AI coding agents one session at a time hits a ceiling fast:

- **One working tree, many agents.** Point two agents at the same checkout and they fight over the index, the branch, and uncommitted files. You either serialize them — one idle while the other runs — or hand-manage `git worktree` and branch names yourself.
- **Runs die on usage caps.** An agent prints "usage limit reached", the run stops, and you babysit it: restart later or hand-switch to a different model.
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

Install from the public npm registry and run a complete mission:

```sh
npm install -g @magnusekdahl/parallix
px --version
px draft "hello world"
px active
px review
px integrate
```

`px draft` creates the mission branch, sibling worktree, mission file, and task record. Then `cd` into the mission worktree and run `px active`, `px review`, and `px integrate` there with no slug; the CLI infers the mission from the current branch/worktree.

Other draft entry points are available when you need them:

```sh
# Draft from the current repository directory name
px draft .

# Draft from an existing structured task file
px draft task-001
```

Optional but useful: run `px setup` if you want help creating `workflow.config.json`, appending workflow entries to `.gitignore`, or bootstrapping Forgejo review wiring.

Optional but useful: add `px shell-init` to your shell rc so mission transitions can `cd` your terminal into the next worktree:

```sh
echo 'eval "$(px shell-init bash)"' >> ~/.bashrc
```

Alternatively, install from a local tarball (useful for development or when offline):

```sh
npm pack
npm install -g ./magnus-parallix-*.tgz
```

Parallix runs on built-in defaults without setup. `px setup` becomes useful when you want to configure your verification command, customize the mission layout, or bootstrap the Forgejo review surface (repo, token files, and `review` remote). Forgejo is the PR viewer and publication surface here, not the authority for local branch ancestry or integration.

`px draft` now works without a pre-existing task file. If the input is free text or a directory path, Parallix creates a synthetic markdown task with classification `unknown` so the later phases, stats, and preflight checks still have a consistent record to work from.

If you already use Backlog.md-style task files, that still works. `px draft task-001` remains valid, and Parallix will use the existing task metadata and classification when it is present.

## Optional task files

Structured markdown task files are now optional. They are still useful when you want stable IDs, explicit labels, or an external task-management flow.

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

Then run the mission by slug:

```sh
px draft task-001
px active task-001
```

Optional but useful: install the Graphify skill once per supported agent family if you want graph-backed codebase navigation in long missions and reviews. This is not a hard requirement like having a task file for `px draft`; when Graphify is not installed, Parallix skips graph updates and continues the workflow. The operator setup is documented separately because it is a workstation capability, not a minimum install step.

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

- **Distribution:** Published to the public npm registry as `@magnusekdahl/parallix`. Local tarball install (`npm pack`) is also supported. No Homebrew, no Docker image, no standalone binary, and no CI/release automation today.
- **Review surface:** Forgejo is supported as the hosted PR viewer/publication surface, but the workflow remains local-first and can run without Forgejo when that provider is disabled.
- **Versioning:** `CHANGELOG.md` is the versioning authority; PATCH bumps are the release discipline.
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
