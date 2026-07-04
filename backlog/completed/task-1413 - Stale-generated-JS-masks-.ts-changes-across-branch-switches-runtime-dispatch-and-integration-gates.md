---
id: TASK-1413
title: >-
  Stale generated JS masks .ts changes across branch switches, runtime dispatch,
  and integration gates
status: done
assignee: [custom]
created_date: '2026-07-03 19:11'
updated_date: '2026-07-04 09:00'
labels:
  - bug
  - ai_sdlc
dependencies: []
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Problem

Parallix ships TypeScript sources (`lib/**/*.ts`, `px.ts`) that are compiled to gitignored JS (`lib/**/*.js`, `px.js`, `index.js`, `dist/`) via `npm run build:cjs`. Nothing guarantees that compiled JS reflects the current `.ts` source at the moments it matters, and this has now surfaced in two independent, related ways:

### 1. Local runtime dispatch (originally filed as a separate task-1413 draft, merged here)

`node px.ts stats` regressed even though the tracked TypeScript source already contained the task-1409 fix:

- `lib/commands/stats.ts` had the correct task-1409 logic.
- The local runtime path still loaded generated `lib/commands/stats.js`.
- Generated `lib/**/*.js`, `index.js`, and `px.js` are gitignored, so branch switches do not refresh or remove them.
- An older generated artifact remained on disk and masked the current source.
- Running `npm run build:cjs` immediately restored the expected `stats` output.

This is a local runtime hygiene bug, not a git-history bug: the stale generated files do not need to be committed to break `node px.ts`; they only need to survive in the working tree across branch/worktree changes.

### 2. The `workflow` integration gate (task-1411)

The `workflow` gate in `config/integration-pipelines.json` (`node test/e2e-mission-lifecycle.test.js`) invokes the compiled `px.js` CLI directly. Because it's a bare `node` invocation (not `npm test`), the `pretest` script (`npm run build:cjs`) never fires, so the gate can run against stale compiled JS that predates the mission's actual `.ts` diff. Reproduced directly on task-1411: the gate failed against a stale build and only passed after manually running `npm run build:cjs`. `refresh-global-px.sh` (the post-integrate hook) only rebuilds *after* a successful integrate — too late to protect the gate that runs during it.

Both are the same underlying gap: nothing in the mission lifecycle (execute, act-on-review, gate commands, or plain local dispatch) guarantees compiled JS is fresh relative to `.ts` source before it's exercised.

## Ask

- Add a preflight freshness check that compares `.ts` sources against generated `.js` siblings (at least root entrypoints `px.ts`/`index.ts` and `lib/**/*.ts`) and fails fast with a clear `npm run build:cjs` instruction when artifacts are missing or stale, so a stale build can never silently mask newer/different source during local dispatch.
- Add a lifecycle hook (post-execute and/or post-act-on-review) and/or harden the `workflow` gate command itself (`npm run build:cjs && node test/e2e-mission-lifecycle.test.js`) so compiled JS is always regenerated before any gate or e2e suite exercises the CLI during `px integrate`.

## Why it matters

Without this, both local development (`node px.ts ...`) and the `workflow` integration gate can behave according to accidental, stale build state rather than the actual `.ts` source — silently masking real fixes/regressions in one direction, or blocking good missions on false failures in the other.

## Concrete reproductions

- `node px.ts stats` → agent tables inconsistent with the task-1409 fix → inspect `lib/commands/stats.ts` vs generated `lib/commands/stats.js` → `npm run build:cjs` → rerun and observe corrected output.
- `node test/e2e-mission-lifecycle.test.js` against a stale build → "configured post-integrate hook runs exactly once ... (SC2/SC3)" fails → `npm run build:cjs` → rerun → all 6 cases pass.
<!-- SECTION:DESCRIPTION:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 Verification gate ran and passed on the final tree with captured proof rather than an unverified claim
- [ ] #2 Lint and static analysis report clean on every changed file
- [ ] #3 No focused or unannotated skipped tests were introduced (no .only and no bare .skip)
- [ ] #4 Final checkpoint Goal Check table cites real evidence using file:line references and test names
- [ ] #5 Docs updated to reflect any workflow or user-facing behavior change
- [ ] #6 Bug-labeled missions include a red-to-green reproduction test that fails before the fix and passes after
- [ ] #7 A deterministic reproduction test or harness proves that stale generated JS can currently mask newer `.ts` source across branch/worktree state changes
- [ ] #8 Local runtime startup detects missing or stale generated artifacts before command dispatch and fails with a clear actionable message, or an approved alternative guarantees equivalent safety
- [ ] #9 The detection scope covers root entrypoints and command modules, not only a single file pair
- [ ] #10 `node px.ts stats` and at least one other representative command are verified against the protected path so the defense is not stats-specific
- [ ] #11 The `workflow` integration gate rebuilds (or is proven fresh) before `test/e2e-mission-lifecycle.test.js` runs during `px integrate`
<!-- DOD:END -->
