---
id: TASK-2820
title: Simplify mechanical approval retention during integration repair
status: done
assignee: [codex]
created_date: '2026-10-25'
labels:
  - ai_sdlc
dependencies: []
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Mechanical restoration intentionally restores an approval after equivalent mission
patches and green integration evidence establish that the original judgment still
covers the candidate. Simplify the lifecycle by evaluating retention of the original
approval, bound to its judged revision, while failed gates and pending repair block
landing. After verification, retain approval only with proven patch equivalence;
withdraw it and enter existing re-review when the mission patch changed. Unknown
evidence or equivalence must not authorize landing.

Trace and reuse existing approval coverage, supersession, repair, validation and
admission owners. Present the proposed transitions and risks before implementation.
Preserve interruption/restart safety, concurrent human decisions, local and provider
protections, committed-tree verification, and the human final integration decision.
Keeping historical approval must not imply current landing eligibility. Follow the
repository's explicit decision requirement if architectural principles must change.

Preserve the specialized integration-repair Jev weakening question and shared
general reviewer. Classification and stale repair-history routing stay in TASK-2819.
After caller migration, delete superseded revoke/restore lifecycle machinery and
redundant tests while retaining distinct assertions and historical record readability.
Do not add a parallel approval system, change gates, or inflate CPU budgets.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria

<!-- AC:BEGIN -->
- [x] #1 Reviewed transitions distinguish historical approval from current landing eligibility, including provider protections and interruption/restart.
- [x] #2 Equivalent approved patches with valid integration evidence retain approval without revoke/restore churn; changed patches withdraw approval and enter existing re-review.
- [x] #3 Failed/cancelled checks, uncommitted repair, missing evidence, concurrent changes and interrupted work cannot authorize landing or overwrite human decisions.
- [x] #4 Jev's repair-specific question, shared general review, workflow ownership, human final integration and operator gates retain intended behavior.
- [x] #5 Production callers use the simplified owner; obsolete lifecycle code is removed, distinct assertions remain, and historical restoration records remain readable.
- [x] #6 Owning suites and isolated manual end-to-end validation cover retention, withdrawal, interruption and stale evidence; unavailable checks stay explicitly pending.
<!-- AC:END -->

## Work log

- 2026-10-25: Created manually for later mission intake. ID allocated locally;
  reconcile with the main computer's backlog before intake.
- Branch mission/task-2820 starts from main at 22d180e76 in the separate worktree
  /Users/admin/code/parallix-task-2820. TASK-2819 work remains on its own branch.
- No production changes or tests for this task. Main-computer verification remains
  necessary; the old Mac cannot properly run normal Parallix test infrastructure.

- 2026-10-25: Rebased mission/task-2820 onto human-review-missions
  (ffac4fe2c); fast-forward, no replay conflicts. Executed manually without a
  live Parallix mission or writes to the operator database.
- Presented transitions and risks before implementation. Gate failure now
  retains the original judged decision in active repair; generic approval
  recovery cannot promote it. One application assessment retains proven
  equivalent patches with exact committed-tree integration evidence, or
  withdraws changed patches and enters the existing review workflow. Both
  successful routes stop for human integration. Unknown comparison/evidence
  leaves landing blocked. Concurrent aggregate/branch changes fail closed;
  provider dismissal targets the judged revision and preserves newer decisions.
- Reused versioned lifecycle writes, patch comparison, validation history,
  approval coverage, revocation and review entry. Preserved verified evidence
  from the same repair incident across delayed withdrawal without rewriting
  recording history. Removed restoration dispatch and its review-loop wiring;
  historical mechanical-restoration records remain readable. Jev weakening,
  general review and TASK-2819 classification/history routing remain in place.
- Focused verification with the repository bootstrap and a temporary TypeScript
  loader: 276 checks passed across the owning suites, including historical
  record parsing, provider dismissal, repair freshness, coverage and file caps.
  Additional restart-selection check passed. TypeScript and focused source
  lint passed. No operator gates, category membership or CPU budgets changed.
- Isolated CLI validation used disposable Git repositories and SQLite state:
  equivalent patch retained the original round/decision without reviewer or
  classifier dispatch; changed patch withdrew approval, completed review and
  stopped for human integration. A separate manual CLI run covered interrupted
  repair, dirty restart refusal and newer failed evidence forcing verification
  before retention; the base branch stayed unchanged. Fixtures cleaned up.
- Pending on the main computer: standard Parallix verification and timing
  certification, including unit headroom and integration CPU/wall limits.
  npm test -- --unit-test-headroom could not start on this Mac because esbuild
  requires the unavailable _SecTrustCopyCertificateChain macOS symbol. The
  temporary-loader observations exceed normal timing limits here and do not
  certify the required 3.5-second integration limit. No budgets were relaxed.
- 2026-10-25 review follow-up: reproduced the historical-restoration reload
  failure and the missing feedback/checkpoint guards before fixing them.
  Preserved the original restored assessment in an independent archive and
  validated SQLite mechanical provenance against that archive during reload.
  Shared human-feedback reconciliation now runs without consuming corrections
  before retention and again before landing; missing provider reads fail closed.
- Restart now checks the existing repair contract/evidence owner, reruns the
  authorized verifier for outstanding checkpoints and certifies through the
  rebound/checkpoint service. An aggregate gate result does not manufacture
  fresh exact-check coverage. Concurrent mission writes during verification
  prevent certification. Blocked or missing repair evidence stops before rebase.
- Restart uses the existing integration rebase owner before capturing the
  candidate baseline. Pending repair defers branch-move supersession until the
  rebased mission patch can be compared; unrelated upstream changes do not
  withdraw the judgment. Existing recorded supersessions remain authoritative.
- Follow-up verification: 379 focused checks passed together; the additional
  concurrent-certification regression also passed. Provider reconciliation,
  restart/rebase and checkpoint regressions remain in their owning suites.
  The composed SQLite/CLI retention case now starts with a historical mechanical
  approval and a distinct judged revision; it survives reload and retains its
  original source. Changed-patch re-review also passed. A disposable manual CLI
  restart advanced the base during interruption, rebased and certified the
  repair, retained the decision and stopped before landing. Standard runner,
  headroom and timing certification remain pending for the platform limitation
  recorded above; operator gate configuration and CPU budgets were not changed.
- 2026-10-25 second review follow-up: retained focused red reproductions for
  dismissal of an agent-authored provider approval and base advancement during
  live repair. Both now pass. Provider comment normalization preserves commit
  identity; retention validates the matching provider approval and dismissal
  state independently of the human-author filter, using the same provider read
  as feedback reconciliation. Missing matching approval remains fail-closed.
- Live repair assessment and its validation marker now use the committed
  candidate's actual merge base, rather than the moving target tip. Ambiguous
  or unreadable bases cannot prove retention. Unrelated upstream advancement
  during the repair does not trigger withdrawal or re-review.
- Second follow-up checks: 116 owning-suite checks and 49 adjacent contract/file
  cap checks passed; typecheck, focused lint and diff hygiene passed. The real
  Git/SQLite composed CLI case advanced the base during live repair and retained
  the historical approval without reviewer dispatch. The disposable manual
  run also verified that dismissal of Codex's provider approval blocks both
  retention and landing while preserving the original local judgment. Standard
  runner/headroom and integration timing certification remain pending on the
  main computer for the already recorded platform limitation; budgets and gate
  configuration were not changed.

- 2026-10-25 change-request withdrawal follow-up: reproduced the false block
  before the fix, then excluded dismissed REQUEST_CHANGES reviews from effective
  provider-decision selection. Dismissed approvals remain unusable; a withdrawn
  request cannot create an approval or revive one. Dismissal remains optional
  and does not change normal repair, patch coverage, lifecycle or gate checks.
- Extended the existing provider-state case with human/agent request sequences,
  active-request blocking, withdrawn-request metadata, dismissed approvals and
  absence of any approval. The 120 focused contract/file-cap checks passed;
  typecheck, focused lint and diff hygiene passed. Disposable manual Git/SQLite
  and CLI validation also passed with both author types. Standard timing and
  unit-headroom certification remain pending on the main computer for the
  platform limitation already recorded above; no gate or budget changes.
