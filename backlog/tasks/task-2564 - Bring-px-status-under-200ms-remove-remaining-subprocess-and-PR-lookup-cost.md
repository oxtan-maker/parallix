---
id: TASK-2564
title: 'Bring px status under 200ms: remove remaining subprocess and PR-lookup cost'
status: backlog
assignee: []
created_date: '2026-09-23 11:53'
labels:
  - cli
  - performance
  - ai_sdlc
dependencies: []
priority: medium
ordinal: 99008
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Follow-up to TASK-2561, which took `px status <slug>` from ~46-59s to ~0.41s wall time (built bundle, local Forgejo reachable, mission with no PR). This ticket covers what remains to reach the original TASK-2556 target of under 200ms.

## What TASK-2561 fixed (for context)

- PR lookup (`resolvePrAccess` in src/adapters/forgejo/forgejo-pr.ts) listed every pull request page by page (`/pulls?state=open`, then `state=all`, 50 per page, ~1.2s per page) and repeated that for each fallback token (current user, implementer, repo owner, default user). A mission with no open PR paid the full scan several times. It now asks Forgejo directly with `GET /pulls/{base}/{head}` (~15-50ms), and scans only if that endpoint gives no usable answer.
- The 'Agent launcher matrix' ran `<agent> --help` for every family on every call (~1.3s of the remaining 1.7s). It was removed. Status now reports configured families and their operator-database blocks, the same way the web board does, with no launcher probe.

## Where the remaining ~410ms goes (CPU profile + strace of `node build/px.mjs status task-2561`)

- ~95ms: Node ESM load and compile of the bundle (`loadAndTranslate` / `compileSourceTextModule`). Only a smaller or lazily split bundle for status can cut this.
- ~110ms: `getPrInfo`, 3 sequential curl calls. The direct lookup returns 404 for a branch with no PR, and `resolvePrAccess` still retries with each fallback token, re-resolving the base branch, task file and Forgejo settings each time (git `worktree list` / `branch --list` subprocesses between the curls). A 404 from the base/head endpoint with a token that can read the repo is final; only retry fallback tokens when the repo itself is unreadable.
- ~60-80ms: repeated git subprocesses. `git worktree list --porcelain` runs about 8 times and `git branch --list` about 10 times per status call, from separate helpers (slug inference, mission base resolution, board projection worktree topology, stale-worktree detection). One worktree/branch snapshot per invocation would replace them.
- ~50ms: `loadRunningSessions` (`ps -eo pid=,etimes=,args=` plus parsing) for the mission card's running-session view.
- `git status --porcelain` for the uncommitted count: ~0.1s on this repo when untracked files are present.
- The per-call curl subprocess itself; an in-process `fetch` would remove the process spawn per request.

## Related observation

Status prints 'Backlog status: backlog' for every mission because it reads `missions.raw_status`, which is not updated when the lifecycle moves (all refined/active missions in the operator DB show raw_status 'backlog').

## Dead code found

`src/adapters/cli/commands/status.ts` (the pre-port `status()` command) has no production importer; `px status` runs through `StatusCommandUseCase` and `status-adapter.ts`. It still carries its own launcher health-probe matrix and is exercised only by tests (status.test.ts, status-characterization-cp4, rebase_diagnostics, task-2508/2516/2344/2350 repros, integration-mode-cli). Port what those tests prove onto the production path, then delete it.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 px status <slug> on a normal mission completes in under 200ms wall time with the built bundle, measured and recorded before and after
- [ ] #2 Every fact px status reports today is still reported
- [ ] #3 A PR lookup for a branch with no PR makes at most one HTTP request when the first token can read the repository, covered by a test
- [ ] #4 git worktree and branch listings run at most once per px status invocation, covered by a test
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 Verification gate ran and passed on the final tree with captured proof rather than an unverified claim
- [ ] #2 Lint and static analysis report clean on every changed file
- [ ] #3 No focused or unannotated skipped tests were introduced (no .only and no bare .skip)
- [ ] #4 Final checkpoint Goal Check table cites real evidence using file:line references and test names
- [ ] #5 Docs updated to reflect any workflow or user-facing behavior change
- [ ] #6 Bug-labeled missions include a red-to-green reproduction test that fails before the fix and passes after
<!-- DOD:END -->
