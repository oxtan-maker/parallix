# Checkpoint 3 — Affected suites, docs, and final goal-check evidence

## Work done

Exercised the affected launcher and guard unit coverage, updated
`docs/agents.md` with the review-profile writable-state-home contract, and ran
the required gates.

- Production: `src/adapters/process/bubblewrap.ts`
  (`resolveSandboxProfile` + `resolveReviewLauncherStateHomes`) and
  `src/adapters/config/state-homes.ts` grant each reviewer launcher its real
  state home as a writable bind while the worktree stays `--ro-bind`.
  `src/adapters/agents/agents.ts` passes the chosen family.
- Docs: `docs/agents.md` "Bubblewrap agent guard" section states the review
  worktree stays read-only and the writable set is the resolved review-artifact
  directory, each launcher's own state home, and `/tmp` — naming claude's
  mangled-worktree transcript directory and the custom family's host-home runner
  directories. This supersedes the task-2374 permission-table omission; the
  task-2374 backlog record was left untouched per the mission's restricted areas.
- Regression coverage in `test/bubblewrap-guard.test.ts` (red at the mission
  parent source, green after the fix — see CP-1).
- Round-1 review findings F1–F5 are addressed: the claude transcript directory is
  derived from the mangled worktree path instead of the mission slug (F1); the
  custom family binds its configured runner's real state homes instead of a
  placeholder `.workflow/custom-home` (F2); the claude tests stub `HOME` outside
  `/tmp` so they assert the bind unconditionally and never touch the operator's
  home (F3); the state-home paths have one shared definition
  (`src/adapters/config/state-homes.ts`) reused by launchers and guard (F4); and
  the inert `handleGateFailureAutoBounceFn` option was removed from
  `src/adapters/review/review-loop.ts` in favour of typing the
  `reboundPreReviewFailureFn` stub in
  `test/task-2377-02-pre-review-rebase-inprocess.test.ts` (F5).

### Gate evidence

- `./scripts/verify-local.sh static-analysis` — ALL STAGES PASSED
  (ESLint clean, `npm run typecheck` clean, test-hygiene clean, test typecheck
  clean).
- `./scripts/verify-local.sh all` — EXIT 0; `node scripts/verify-docs.mjs`
  passes (no volatile implementation evidence, relative links resolve), bundle
  size 3.1 MB within the 5 MB stop rule, 1949 pass / 0 fail / 0 skipped.
- Affected guard suite: `npm test -- test/bubblewrap-guard.test.ts` —
  17 pass / 0 fail.
- Affected launcher suite: `npm test -- test/agents.test.ts` — 100 pass / 0 fail.
- Architecture boundary suite: `npm test -- test/dependency-graph.test.ts` — pass.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Review sandbox resolves a writable bind for each launcher state home (Codex `CODEX_HOME`, Qwen `QWEN_HOME`, Vibe `VIBE_HOME`, Claude per-worktree transcript, custom-agent state home) | `test/bubblewrap-guard.test.ts` → `review profile grants each worktree-local launcher state home as a writable bind`, `review profile grants claude the transcript directory named after the mangled worktree path`, `review profile grants the custom family its configured runner state homes`; resolver in `src/adapters/process/bubblewrap.ts` + `src/adapters/config/state-homes.ts` | PASS |
| Each supported launcher reaches prompt processing under `bwrap` without an `EROFS`/read-only init failure | `test/bubblewrap-guard.test.ts` → `review profile buildBubblewrapArgs binds the claude transcript directory writable without widening the worktree`; `npm test -- test/bubblewrap-guard.test.ts` (17/0). Each bound path is the launcher's own resolver output: `codexHomeRoot`/`qwenHomeRoot`/`vibeHomeRoot` in `src/adapters/config/state-homes.ts` are the same functions `src/adapters/agents/codex.ts`, `qwen.ts`, `vibe.ts` use to set `CODEX_HOME`/`QWEN_HOME`/`VIBE_HOME` | PASS |
| Claude round-N session resumable in round N+1 via a writable per-worktree transcript dir | `test/bubblewrap-guard.test.ts` → `review profile grants claude the transcript directory named after the mangled worktree path` (also asserts no writable path is slug-derived); `claudeProjectDir` in `src/adapters/config/state-homes.ts` resolves `<HOME>/.claude/projects/<worktree path with every non-alphanumeric character replaced by `-`>`, the directory Claude itself writes its `.jsonl` transcripts to | PASS |
| Only artifact dir, `/tmp`, and the enumerated state homes are writable; a reviewed source/config/test/doc/mission write is denied | `test/bubblewrap-guard.test.ts` → `review profile keeps the reviewed worktree read-only and binds no reviewed source`; `npm test -- test/bubblewrap-guard.test.ts` (17/0) | PASS |
| `docs/agents.md` states the read-only-worktree / writable-set contract and supersedes the task-2374 omission | `docs/agents.md` "Bubblewrap agent guard" section; `node scripts/verify-docs.mjs` passes; ADR 0039 Part 2 falsifiability | PASS |
| `./scripts/verify-local.sh static-analysis` and affected unit suites pass with no focused/unannotated skipped tests | `./scripts/verify-local.sh static-analysis` ALL STAGES PASSED; `npm test -- test/agents.test.ts` 100/0; `./scripts/verify-local.sh all` EXIT 0, 1949/0/0 skipped | PASS |

## Round-1 review carry (codex — state consistency)

A second round-1 reviewer (codex) returned `request-changes` on a single
blocking finding: the operator database's projected review history was
internally inconsistent with the committed checkpoint and round-1 artifacts
(`px status` reported a pending round while `CP-3.md` recorded F1–F5 as
addressed). The reviewer stated the code already resolved the technical
findings and that *operator state must be reconciled before a valid next review
disposition can be recorded.*

Disposition: **pushed back as operator/workflow-state reconciliation**, not a
mission code change. The implementer cannot repair the operator database's
projected round history from code, and the branch is current (clean working
tree). The mission code diff is complete and both gates pass; the reviewer was
sent the round back for the next formal decision via the review artifacts.

## Next action

Round-1 technical findings F1–F5 are addressed and both gates (`static-analysis`
and `all`) pass; the sole remaining finding (projected-history inconsistency) is
pushed back as operator-state. Awaiting the reviewer's next round-1 disposition.
