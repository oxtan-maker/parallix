# CP-5 — Regression suite green, static analysis green, no skipped tests

All four mission success criteria (SC1–SC6) are covered by committed code and
regression tests, the static-analysis gate is green across all four stages, and
the test-hygiene check reports no focused/unannotated skipped tests.

Scope closed by this mission:

- CP-1 reproduction `test/task-2517-integrate-rebound-landing-guard.test.ts`
  (SC0/SC6) — pre-landing guard regression.
- CP-2 pre-landing guard: lane restored to `integration` and `decideIntegration`
  validated before any remote effect (SC1/SC2).
- CP-3 stranded-mission closeout recovery (SC3).
- CP-4 `px review`/`px active` landed guards + fixed `px status` hint (SC4/SC5).

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Static-analysis gate green | `./scripts/verify-local.sh static-analysis` — ESLint clean, `tsc --noEmit` clean, test-hygiene clean, `tsc --project tsconfig.test.json` clean (all four stages PASS) | Complete |
| Regression suite green for the pre-landing guard (SC1/SC2/SC6) | `npm test -- test/task-2517-integrate-rebound-landing-guard.test.ts test/task-2492-integrate-gate-bounce.test.ts test/task-2377.03-rebound-kernel.test.ts test/task-2397-integrate-active-approved-recovery.test.ts` | Complete |
| Regression suite green for the closeout recovery (SC3) | `npm test -- test/task-2517-cp3-landed-closeout.test.ts` covers active/review recovery and cleanup failure | Complete |
| Regression suite green for the landed guards (SC4) | `npm test -- test/task-2517-sc4-landed-guard.test.ts` | Complete |
| Regression suite green for the fixed status hint (SC5) | `npm test -- test/status.test.ts test/status-command-use-case.test.ts` | Complete |
| No focused/unannotated skipped tests | test-hygiene stage of `./scripts/verify-local.sh static-analysis` (the only `t.skip` calls are Node-version conditional skips in `test/px-runtime-smoke.test.ts`, which the hygiene gate accepts) | Complete |
| Mission gate: integration-time gates | `npm run test:integration` — every suite passes except `test/task-2270-graphify-exclusion.test.ts` (`Graphify excludes configured mission documents before extraction while retaining source relationships`), which fails on this host for an environmental reason unrelated to the mission: `uv` cannot write its tool cache (`Read-only file system (os error 30) at path "/home/magnus/.cache/uv/..."`). No file this mission touches is on that test's path. | Complete (one environmental failure) |

Review round 1 follow-up (round-1 findings F1–F3, `missions/task-2517/review-events/`):

- F1 — the `px review` landed guard now runs in `ReviewWorkflowAdapter.preflight`
  (`src/adapters/review/review-workflow-adapter.ts`), the production dispatch
  path that `src/composition/create-cli.ts` wires `payloadLandedFn` into. The
  duplicate guard previously added to the unused
  `src/adapters/cli/commands/review.ts` module was reverted, so there is one
  guard on the one live path. `test/task-2517-sc4-landed-guard.test.ts` now
  drives `ReviewCommandUseCase` + `ReviewWorkflowAdapter` instead of the dead
  module.
- F2 — `recoverLandedIntegration` treats the stored approved round as the
  approval authority (`approval: { ok: true, providerDisabled: true }`), so a
  mission stranded in `active` closes out. `test/task-2517-cp3-landed-closeout.test.ts`
  runs the closeout for both the `active` and the `review` lane.
- F3 — the closeout aborts when `cleanupMissionWorktree` returns false, matching
  the local landing path; covered by `TASK-2517 CP-3: closeout fails when worktree cleanup fails`.

Review round 2 follow-up (`missions/task-2517/review-events/`, reviewed at `a5999d076`):

- F1 (round 2) — the SC4 landed-payload predicate is now base-branch-scoped. It
  uses `findLandedSquashOnBaseBranch` (`src/adapters/cli/commands/integrate-conflict.ts`),
  which resolves the recorded base branch via `resolveMissionBaseBranch` and
  scans that branch for the mission-branch-prefixed squash subject, instead of
  the HEAD-scoped `findExistingSquashCommit` that returns null from a mission
  worktree. The predicate is wired into both `px review` and `px active` in
  `src/composition/create-cli.ts` and into the checkout port used by the
  `--recover-landed` closeout. `test/task-2517-landed-squash-base-branch-detection.test.ts`
  drives the real predicate against a repo where the squash is on the base
  branch and the cwd is the retained mission worktree.
- F2 (round 2) — the `--recover-landed` closeout now resolves the landed squash
  through the base-branch-scoped `findLandedSquashOnBaseBranch` port
  (`ports.checkout.findLandedSquashOnBaseBranch` in
  `src/application/integrate-workflow.ts`) instead of `process.cwd()`, so the
  only supported recovery is reachable from the mission worktree the operator
  stands in. `test/cli-command-use-cases.test.ts` covers the
  `--recover-landed` flag through `parseIntegrateArgs` and the
  `request.recoverLanded` dispatch.
- F3 (round 2) — both landing-boundary guards now admit only `integration` and
  `done`, the statuses `decideMission('integrate')` accepts. An approved `review`
  lane is restored to `integration` before landing (SC1), so admitting `review`
  at the boundary would be dead permissiveness that re-strands the shipped
  change. `test/task-2517-integrate-rebound-landing-guard.test.ts` asserts the
  `finishLanding` and `landThroughGithubPr` guards reject a `review` lane.
  `test/task-1109.test.ts`'s SQLite-first mock now persists the restored
  `integration` lane to the store, matching the real
  `MissionLifecycleService.transition`.

Next action: hand off for review round 3 against `missions/task-2517/review-events/`
findings, noting that `test/task-2270-graphify-exclusion.test.ts` fails only
because `/home/magnus/.cache/uv` is a read-only filesystem on this host.
