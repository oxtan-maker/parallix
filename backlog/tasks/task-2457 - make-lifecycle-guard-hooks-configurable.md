---
id: TASK-2457
title: make lifecycle guard hooks configurable
status: backlog
assignee: []
created_date: '2026-09-05 14:30'
labels: [bug, configuration, workflow]
dependencies: []
---

## Description

Parallix hardcodes the handoff-to-review and pre-integration safeguards in its
lifecycle commands. It exposes only `adapters.integrate.postIntegrateCommand`.
Repositories therefore cannot declare phase-specific commands that extend the
defense-in-depth checks before handoff, before a reviewer engages, or before
integration.

This is not language-specific: a C++ repository can configure its verification
command (for example, `ctest`), but it cannot configure lifecycle hook commands
for these phases. The existing hardcoded controls also use Parallix-specific
area assumptions, so a repository cannot describe its own guard sequence
without editing Parallix.

Add a schema-declared, documented lifecycle-hook configuration surface for
pre-handoff, pre-review, and pre-integration commands. Commands must run from
the relevant repository checkout with structured mission context in their
environment, fail the enclosing transition on a non-zero exit, and extend
rather than replace the existing mandatory safeguards.

## Acceptance Criteria

- [ ] A repository can declare commands for pre-handoff, pre-review, and
      pre-integration phases without modifying Parallix source.
- [ ] Each command receives the mission slug, checkout path, and phase in its
      environment, and a non-zero exit blocks that phase before its state
      transition or merge.
- [ ] The schema, `px config`, and configuration reference describe the three
      hook fields and their disabled-by-default behavior.
- [ ] Regression tests prove execution at each phase, failure blocking, and
      preservation of the existing mandatory safeguards.
