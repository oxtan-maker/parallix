---
id: TASK-1336
title: Rewrite README.md as a credible GitHub landing page
status: backlog
assignee: []
created_date: '2026-06-23 05:04'
updated_date: '2026-06-23 16:37'
labels: []
dependencies: []
ordinal: 48000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Mission type

Product positioning / documentation rewrite / developer marketing.

Objective

Rewrite the repository README.md so it works as a credible GitHub landing page for Parallix.

The README should help a skeptical engineering manager, senior engineer, or AI-workflow operator understand:

what Parallix is,
who it is for,
what concrete problems it solves,
why it is different from using a single coding agent directly,
how to try it,
what claims are proven, partial, or explicitly not claimed.

The current README is useful as an internal authority reference but not as a public-facing landing page. Preserve any important operational authority content by moving it into an appropriate docs file instead of deleting it.

Core positioning constraint

Do not dilute the value.

Parallix is not “another AI coding agent.”

Parallix is a workflow harness for running AI coding work as isolated, resumable, reviewable missions across multiple agent families.

The strongest credible positioning should be built around:

Parallel multi-agent execution without clobbering one working tree
Automatic failover when one AI provider hits usage limits
Deterministic checkpoint/resume across long-running missions
A forced second review step before integration, with honest caveats
Repo-configured verification gates instead of agent self-reporting
Operator-owned cross-repo telemetry, with current limitations stated

Use docs/use-cases.md as the primary source of truth.

Required research

Before editing the README, research how successful GitHub READMEs for similar developer tools structure themselves.

Inspect at minimum:

Aider
Goose
OpenCode
at least two other relevant CLI / AI coding / agent workflow / developer-tool repositories

For each benchmark, record:

opening headline / tagline pattern
first paragraph structure
whether it leads with features, problems, examples, screenshots, install, or docs
quickstart depth
how it handles credibility, caveats, or limitations
what is worth borrowing
what should not be copied because it would make Parallix less credible

Create:

docs/readme-rewrite-benchmark.md

This file must be committed before the README rewrite.

Primary source of truth: The code and docs/use-cases.md

Required README shape

Rewrite README.md using this structure unless the benchmark research gives a clearly better structure:

# Parallix

<one-line positioning statement>

<short paragraph: what it does and for whom>

## Why Parallix?

<problem-first framing>

## What it does

<5-7 value bullets, each tied to a real use case>

## The core workflow

<simple lifecycle / diagram / command flow>

## Quick start

<minimal credible install and first mission path>

## Example

<one realistic example showing mission → worktree → agent run → checkpoint/review/integrate>

## Use cases

<link to docs/use-cases.md and summarize top use cases>

## What Parallix is not

<credibility section: not a model, not an IDE, not a magic autonomous engineer, not guaranteed 2x forever>

## Current status

<alpha / local-first / public distribution caveats / known limitations>

## Documentation

<links to deeper docs>

## Development

<test command, contribution basics>

## License

Landing-page style requirements

The top 300 words matter most.

Within the first 300 words, the README must answer:

What is Parallix?
Who is it for?
What pain does it solve?
Why not just use Claude Code / Codex / Aider / OpenCode directly?
What is the first concrete thing I can do with it?

Prefer a landing-page rhythm:

clear promise
concrete user pain
differentiated mechanism
fast path to try
proof and caveats later

Avoid starting with internal abstractions such as:

authority stack
state-map
adapter internals
mode tables
config boundary
canonical markdown companion
conflict resolution

Those can move to deeper documentation.

SEO / discoverability requirements

Optimize for natural developer search terms without keyword stuffing.

Include these phrases where they are accurate and readable:

AI coding workflow
AI coding agents
multi-agent coding
git worktree
coding agent review
agent usage limits
local-first developer workflow
mission-based development
CLI

The title and first paragraph should naturally contain the most important terms.

Do not over-optimize at the expense of senior-engineer credibility.

Credibility requirements

The README must sound like it was written by a skeptical engineering manager, not a hype marketer.

Allowed tone:

“Parallix helps you run several AI coding agents against one repo without clobbering the same checkout.”
“It turns agent work into isolated missions with checkpoints, review, and integration gates.”
“It is early, local-first, and currently best suited to operators comfortable with Git and CLI workflows.”
<!-- SECTION:DESCRIPTION:END -->
