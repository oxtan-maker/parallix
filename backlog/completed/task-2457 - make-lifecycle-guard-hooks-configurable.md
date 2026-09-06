---
id: TASK-2457
title: make lifecycle gates repository-configured and self-hosted
status: done
assignee: [custom]
created_date: '2026-09-05 14:30'
labels: [bug, user_value]
dependencies: []
---

## Description

Parallix must orchestrate repositories without assuming their language,
package manager, test runner, directory layout, or helper scripts. Today its
lifecycle and integration paths still encode Parallix/Node-specific gate
commands and area assumptions. A C++ repository should be able to use Parallix
with its own build and test commands (for example, CMake and CTest), without
providing Node tooling or a `scripts/verify-local.sh` compatibility script.

Make lifecycle gates repository configuration, not Parallix behavior. The
generic product supplies a command runner and schema for gates at pre-handoff,
pre-review, and pre-integration; all such gates are disabled when a repository
does not configure them. Each configured command runs in the checkout for its
phase, receives structured mission context, and blocks the transition or merge
when it exits non-zero.

Parallix must also configure itself as a consumer of that surface: its
repository configuration opts into the build, verification, workflow, and
agent-smoke gates appropriate to developing Parallix. Move those Node-specific
commands and any Parallix-only changed-area selection out of generic lifecycle
code and into that self-hosting configuration. Preserve generic workflow
safety checks, but do not retain an implicit Node/script gate as a product
requirement.

## Acceptance Criteria

- [ ] A repository can declare ordered commands for pre-handoff, pre-review,
      and pre-integration without modifying Parallix source; absent
      configuration runs no lifecycle gate.
- [ ] Each command receives the mission slug, checkout path, and phase in its
      environment, and a non-zero exit blocks that phase before its state
      transition or merge.
- [ ] Generic lifecycle and integration code contains no Node, npm, tsx,
      `scripts/verify-local.sh`, or Parallix-directory/area assumptions needed
      to select or execute gates.
- [ ] This repository's configuration explicitly enables its existing
      Parallix build, verification, workflow, and agent-smoke gates, so
      Parallix continues to protect its own development without making those
      gates product defaults.
- [ ] The schema, `px config`, and configuration reference describe the gate
      fields and their disabled-by-default behavior.
- [ ] Regression tests prove an unconfigured repository needs no Node-specific
      scripts, configured commands run at every phase, failures block the
      correct phase, and Parallix's self-hosting configuration selects its
      gates.
