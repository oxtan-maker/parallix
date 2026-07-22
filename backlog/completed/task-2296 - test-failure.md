---
id: TASK-2296
title: Correct packaged rebase launcher regression assertion
status: done
assignee: [codex]
created_date: '2026-07-22 05:33'
labels:
  - ai_sdlc
  - bug
dependencies: []
ordinal: 50000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
TASK-2294 was blocked by the default test suite, not by a production rebase
failure. `rebaseBeforeReviewRound` intentionally selects `tsx` for source
checkouts and the compiled launcher adjacent to its loaded runtime module for
packaged installations. The source-runtime test preload aliases that module
into `.test-runtime/`; the regression test incorrectly hard-coded this
checkout's `dist/px.js` path.

Correct the assertion so it verifies the actual packaged-runtime contract:
Node launches the `px.js` entrypoint resolved from the loaded review module,
followed by `rebase <slug> --push`. Do not change launcher selection,
domain-model code, or persistence architecture.
<!-- SECTION:DESCRIPTION:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 `test/task-1107-repro.test.ts` proves the packaged-launcher path is derived from the loaded review runtime, including under the `.test-runtime` alias
- [ ] #2 The test retains exact `rebase`, slug, and `--push` arguments and introduces no `.only` or bare `.skip`
- [ ] #3 `./scripts/verify-local.sh all` passes on the final tree
<!-- DOD:END -->
