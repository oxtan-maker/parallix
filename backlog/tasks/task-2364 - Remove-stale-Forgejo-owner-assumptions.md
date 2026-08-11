---
id: TASK-2364
title: Remove stale Forgejo owner assumptions from review setup
status: backlog
assignee: []
created_date: '2026-07-15 00:00'
labels:
  - bug
  - forgejo
  - configuration
  - user_value
dependencies: []
priority: medium
---

## Description

The local review configuration and Forgejo bootstrap flow assumed the owner/repository identity `magnus/parallix`. On a fresh local Forgejo instance the available administrative account was `human`, so `px setup-review` defaulted to an account that did not exist and token creation could not proceed until that account was created manually.

Identify every stale owner-specific assumption across configuration defaults, setup/bootstrap logic, test fixtures, and documentation. Make setup derive or explicitly collect the correct local Forgejo owner and review repository without requiring a manually-created compatibility account. Preserve existing configured review remotes and token files during migration.

## Acceptance Criteria

- [ ] #1 A fresh local Forgejo setup does not require a pre-existing `magnus` account or `magnus/parallix` repository.
- [ ] #2 `px setup-review` clearly selects or prompts for the Forgejo owner and review repository when existing configuration is absent or stale.
- [ ] #3 Existing valid review remotes and local token files are preserved; no token values are logged.
- [ ] #4 Regression tests cover a local owner that differs from `magnus`.
- [ ] #5 `npm test` passes.

