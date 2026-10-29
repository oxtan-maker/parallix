---
id: TASK-2819
title: Correct mission workflow repair classification
status: done
assignee: [codex]
created_date: '2026-10-25'
labels:
  - bug
  - ai_sdlc
dependencies: []
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Manual collaborative review and repair of mission workflow behavior. Work is
prepared on `mission/task-2819` on an older Mac; the operator will create the
manual Parallix mission on the main computer. Keep this task updated with agreed
findings, implemented fixes, and actual verification evidence as work continues.

Initial finding: `approvableFromActiveLane` treats any previous revoked approval
as an integration repair. Revocation also has operator, review-repair, and
rebase-repair causes. Establish the intended approval behavior for each cause,
then correct the predicate and its explanation without weakening the requirement
that integration repairs return through submission and review.

Reuse existing domain owners and owning test suites. Do not change architecture,
verification gates, or CPU budgets. This machine cannot properly run the Parallix
verification infrastructure; record checks that actually run and leave unavailable
verification explicitly pending for the main computer. Do not claim completion
from source inspection alone.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria

<!-- AC:BEGIN -->
- [x] #1 Agreed approval behavior distinguishes integration-gate repair from other revocation causes; comments and diagnostics accurately describe the enforced rule.
- [x] #2 The owning suite retains a focused parent-red/fixed-green reproduction and preserves integration-repair submission requirements.
- [x] #3 Additional findings and fixes agreed during collaborative review are recorded here with their verification status.
- [x] #4 Focused checks and manual end-to-end validation are completed on isolated state where supported; unavailable checks remain pending until run on the main computer.
<!-- AC:END -->

## Work log

- 2026-10-25: Created local branch `mission/task-2819` from the existing `main`
  checkout, without rebasing or changing its commits. Allocated 2819 from local
  backlog files; reconcile task ID with the main computer before mission intake.
- Review finding: command string literals are a typed discriminated union; no
  enum migration is needed. `REBOUND_REASONS` supplies human-readable revocation
  audit messages; typed causes carry behavior.
- Fixed the active-lane approval predicate to recognize an integration repair
  only when the previous approval's revocation cause is integration-gate-failure.
  Operator, review-repair, rebase-repair, and legacy untyped revocations no longer
  trigger that restriction. Awaiting-review status, reviewed revision, approved
  decision, and implementer identity checks remain enforced. Corrected the
  misleading comment; no competing implementation or gate changes were added.
- Extended the owning domain-mission-contract suite with four non-integration
  regression cases and a gate-rebound/submission/approval case. Before the fix:
  32 passed, four failed with the incorrect integration-repair rejection. After
  the fix: all 36 passed, no skips. Direct Node 22.23.1 execution used experimental
  TypeScript transformation and a temporary resolver mapping relative .js imports
  to .ts; this is standalone evidence, not a repository-runner/headroom result.
- Standard tsx execution could not start: its esbuild 0.28.2 postinstall failed
  on Darwin 19.6.0. No dependency manifest, lockfile, or runner changes were made.
- Manually exercised MissionLifecycleService with the existing isolated in-memory
  store fixture: all four typed causes reached done with approval history intact.
  Non-integration causes recorded approve then integrate; integration-gate-failure
  refused direct approval without writes, then recorded submit-for-review,
  approve, and integrate. This proves application/domain behavior with a doubled
  persistence boundary, not CLI/provider/database end-to-end behavior.
- Local scratch evidence: /private/tmp/parallix-task-2819.zALuY4 contains parent.tap,
  fixed.tap, resolve-typescript.mjs, and manual-lifecycle.mjs. These are temporary
  local artifacts; reproduce the retained suite on the main computer.
- Pending on the main computer: owning suite through the normal runner,
  npm test -- --unit-test-headroom (focused selection where supported), lint and
  type checks, and isolated CLI/database end-to-end validation. Normal Parallix
  verification still owns release readiness; this task is not complete.
- Follow-up audit (subsequently fixed below): integrationRepairNeedsReview used any historical
  gate withdrawal, rather than whether the current pending work belongs to an
  unresolved integration repair. Reproduced gate withdrawal -> fresh approval ->
  later operator/review-repair/rebase-repair withdrawal: it returns true for all
  three. latestIntegrationRepair reports the old gate and labels its re-review
  pending again; the reviewer brief receives that stale gate context.
  integrate-workflow consumes the same predicate to choose its repaired-mission
  review route. Scope the repair episode explicitly before changing this policy;
  retain genuine multi-round integration repairs and their historical display.
  Reproduction is in local scratch audit-repair-history.mjs, using production
  domain functions and explicit judged revisions. No live state was accessed.

## Review consolidation investigation

The normal ReviewCommandUseCase and review loop already execute every review.
The integration callback invokes that same entry; it is not another review
engine. Retain the composition boundary that borrows an admitted integration's
service graph, uses normal admission for unowned calls, publishes nested work,
captures command exits, and verifies the persisted approval. Nested invocation
also deliberately lacks the operator-resume acknowledgment port: automatic work
must not acknowledge a human-only repair stop.

The redundant orchestration is in the immediate gate-repair closeout and later
integration restart: both invoke the callback, interpret success/failure, and
stop integration for the human, but use different error and success handling.
The immediate path additionally wraps the callback in a gate-step method that
throws on false; its caller then checks the boolean and has an unreachable
false-result branch. The restart path bypasses that wrapper.

Proposed consolidation, preserving current ownership and automatic-review behavior:

1. Bound the integration-repair episode using existing typed review rounds. A
   subsequent approval resolves that episode; withdrawing it for another cause
   does not reopen the old gate failure. Keep request-changes/rework rounds inside
   an unresolved episode. Separate historical reporting from pending obligations;
   freeze a resolved repair's displayed result at its resolving approval.
2. Use one application-owned review continuation for immediate and restarted
   integration, invoking the existing normal review entry and consistently
   stopping for the human afterward. Remove the superseded gate-step invocation
   wrapper and unreachable outcome handling. Keep provider invalidation checks
   at the repair boundary before review is allowed to start.
3. Repair-specific gate evidence and diff ranges remain review context. Preserve
   existing classifier and mechanical-restoration policies; changing those is a
   separate behavioral decision, not required by orchestration consolidation.
4. Preserve regression coverage for resolved-repair/later-operator-revocation,
   genuine multi-round repairs, failed approval dismissal, rejected or throwing
   review, interruption/restart, nested admission, and the final human stop.

Alternative: make integration stop and require a separate manual px review on
every repair. That removes more orchestration but changes the operator workflow;
it is not assumed authorized by this consolidation investigation. A new persisted
repair-state subsystem is also unnecessary for the demonstrated defect: review
rounds already retain cause, identity, revision, and resolution evidence.

The consolidation above is now implemented as described below. Composition,
normal-runner, static checks and full CLI verification remain pending.

## Implemented continuation and history fixes

- One domain repair predicate now supplies both active-lane approval eligibility
  and integration restart routing. The first approval following a gate withdrawal
  resolves that repair; later operator, review-repair, rebase-repair or untyped
  revocations do not reopen it. Requested-change rounds remain inside an unresolved
  repair, and a new gate withdrawal starts a new repair. Display facts separately
  require a known decided revision to describe a repair range; unknown legacy
  heads still require review and never authorize landing.
- Historical repair facts retain the resolving approval's revision, baseline and
  outcome. Completed repairs no longer supply stale context to a later review.
- Immediate gate-repair closeout and integration restart now share the same
  review invocation/error handling/human stop. Removed the gate-step wrapper
  and unreachable false-result handling. Existing composition admission,
  nested work, provider invalidation eligibility, and persisted approval checks
  remain with their original owners.
- Kept Jev's specialized integration-repair weakening question, ordinary panel,
  general reviewer and mechanical restoration policies. Ordinary classifier
  scope already checks the immediate typed cause; do not claim it previously
  routed every historical repair through the weakening question. The demonstrated
  history defect affected integration routing and reviewer context.
- Updated the live classification guidance to explain resolved repair history.
- Mechanical lifecycle cleanup is separate TASK-2820 on mission/task-2820,
  created from main in /Users/admin/code/parallix-task-2820. No mechanical
  approval-order changes were made here.

## Verification on the older Mac

All runs below use Node 22.23.1 and isolated fixture state. No real provider or
operator database was modified. Temporary loaders are local execution aids;
repository runner, gate configuration, budgets and dependency files are unchanged.

- Parent reproduction: four non-integration active-lane cases failed before the
  first fix. Four resolved-repair/later-revocation cases also failed before the
  episode fix, demonstrating the historical routing defect. The regressions remain
  in the existing owning suites.
- 85 focused cases passed across domain-mission-contract, integration-repair-review-
  projection, mission-draft-refine-contract and integration-gate-policy. Covers
  ordinary revocations, retained history, multi-round repair, renewed gate failure,
  resubmission, restart approval/rejection/exception/unavailable review, final human
  stop and ownership release. Log: contracts-headroom.tap.
- 59 repeat-review classifier/restoration cases passed, preserving ordinary human
  feedback routing, repair-specific Jev questions, fallback and restoration
  behavior. Log: jev-restoration.tap (the second requested authority suite could
  not load via native stripping; its successful rerun is recorded next).
- 36 integration-gate-rebound-and-repair-contract cases passed with a temporary
  TypeScript 5.9.3 compiler loader. Log: routing-compiled.tap. The separately
  requested composition suite failed to load because jevtok-ts is not installed;
  this combined invocation therefore exited nonzero.
- 17 review-decision-authority-contract cases passed using that compiler loader.
  Log: authority-compiled.tap. Across successful suites: 197 passing cases. The
  existing cpu-test-hook.mjs was preloaded with
  PARALLIX_UNIT_TEST_CPU_HEADROOM_US=500000 for these checks; no per-case CPU
  headroom failure occurred. This is not the normal npm runner's result.
- Manual application/SQLite check passed: seeded a disposable migrated database,
  rebounded an approved mission, closed/reopened storage, resumed integration
  through the shared review continuation and real MissionLifecycleService, then
  verified an approved integration lane with no automatic landing. A subsequent
  human revocation survived another reload as ordinary review, retained the
  resolved repair facts, produced no stale repair brief, and preserved all four
  lane events. Agent/provider/landing boundaries were doubled; this is not a full
  public CLI/provider E2E claim. Script: manual-sqlite-continuation.mjs;
  output: manual-sqlite.log. The disposable database was cleaned up in finally.
- Scratch evidence remains under /private/tmp/parallix-task-2819.zALuY4. Native
  runs use resolve-typescript.mjs; suites needing type-only import elision or
  mock file-URL resolution use compile-typescript.mjs. These scratch artifacts
  are temporary and must not be a main-computer dependency.
- git diff --check passed. Changed production/test files remain within size caps.
- Final cleanup removed the restart helper's unused state parameter; all four
  restart outcome cases passed again with the 500 ms CPU hook (restart-final.tap).

### Required follow-up on the main computer

- Run the focused owning suites through the normal runner with unit headroom.
- Run the existing lifecycle-composition admission suite with installed dependencies;
  confirm owned/unowned nested review and denial behavior.
- Run repository type and lint checks for the changed files.
- Run the existing isolated CLI integration-repair lifecycle check, including
  interruption/restart and the human stop. Keep provider tests isolated.
- Perform normal Parallix mission intake and verification before integration;
  reconcile locally allocated task IDs. This task remains incomplete until the
  outstanding verification is recorded. No integration/E2E suite or gate was changed.


## Supported-host review corrections, round 2 (2026-10-29)

- Removed the production-dead history predicate. The owning projection suite
  retains the reason-text assertion against the live withdrawal selector and
  review predicate, and asserts that unknown decided revisions still owe review
  while their display facts remain absent.
- Moved the shared review continuation and human-stop error into their own
  application module. Both production callers use it. Restored the pre-review
  progress message, the repaired revision on immediate closeout, and the approval
  progress message. Restart unit cases retain their existing owning suite; its
  broad historical name is naming debt, with no suite move requested.
- Extended the existing CLI repair-loop suite with a persisted interruption/restart
  case. Real CLI, Git and isolated SQLite reload the withdrawn approval, submit
  fresh checkpoint evidence, review the repair, exit zero and stop in integration.
  The gate sentinel is absent and main is unchanged. Both cases passed in 2.37 s
  (2.75 s total runner CPU), within existing budgets; no gate or budget changed.
- Separately replayed the CLI restart with an unknown legacy decided revision in
  disposable Git/SQLite state. Review ran once without an invented repair range,
  approved through the CLI verdict, and stopped in integration with main unchanged
  and no integration gate execution. Agents and provider boundaries were controlled;
  no real model/provider or operator database was used.
- Focused normal-runner unit headroom: 120/120 pass. Declared
  `./scripts/verify-local.sh all`: 4,520/4,520 pass on this supported host.
  Source/web, script and test typechecks, lint and test hygiene all pass.
  The launch-time claim that vacation test TypeScript diagnostics remain was
  removed from the Mission scope. CP-1's earlier gate/lint caveats are historical
  and are superseded by the current-round evidence.
- AC4 is now complete based on supported-host verification and isolated CLI
  validation, rather than vacation scratch checks. Independent re-review and
  human integration remain separate workflow steps.
