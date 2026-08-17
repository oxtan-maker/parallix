# Mission: Make lifecycle recovery authoritative and delete obsolete review-stat inference (task-2378)

## Goal
Complete the authoritative lifecycle / review-authority program that task-2376 started (its round is green on main: approval boundary on bound paths, `px integrate` recovery matrix, `integrate` domain hardening, deleted inference helpers, canonical review metrics, exact dwell proof). This round closes the two remaining defects:

1. **Stats derivation still treats `MissionStore` as optional.** The production `px stats` wiring (`createStatsWorkflowAdapter` in `src/adapters/cli/commands/stats.ts`) calls `deriveImplementerAndFixRounds(slug, rootDir)` without a store, so a contemporary Mission that HAS an authoritative Review aggregate reports `implementer = 'unknown'` and `reviewFixRounds = null` (`source: 'missing-authority'`). `recordIntegrationStats` / `recordPostIntegrationStats` keep `missionStore = null` defaults, and `stats-backfill.ts` omits the store. The program's rule — "Mission/Review required → caller must provide it" — is not yet enforced.
2. **Approval-boundary failure is silent and Backlog promotion is not ordered after the lifecycle transition.** `save()` in `src/adapters/review/review-state.ts` swallows a failed `review → integration` transition ("non-fatal"), and the approval command flow in `src/adapters/review/review-commands.ts` promotes the Backlog task to `approved` regardless. A Backlog item can therefore appear approved while the Mission is still `review` — exactly the divergence the program forbids.

Outcomes: every approval-producing review-persistence call site is proven bound to the lifecycle service (or provably cannot produce a decision); boundary failure is surfaced and blocks Backlog promotion; `MissionStore` is required end-to-end for contemporary stats derivation; R5 human-override regression exists via the existing `px review` decision path; R13 semantics updated (store omission = invariant error, not `missing-authority`).

## Why Now
Task-2376 removed the fabricated-value defects and landed the recovery/dwell fixes, but two live defects remain on main today:

- `px stats` (via `StatsCommandUseCase` + `createStatsWorkflowAdapter`) derives implementer/fixRounds for contemporary Missions **without** the MissionStore, so the board-adjacent stats path reports `unknown` for Missions whose authoritative Review exists. This is the "caller failed to provide the MissionStore" hole the backlog calls out, still open in the stats command path (the `px integrate` post-stats path does pass `missionServices.store`; the stats reporting path does not).
- A failed lifecycle transition at the approval boundary is swallowed inside `save()`, and Backlog promotion to `approved` proceeds independently — a silent competing-truth source between Backlog and Mission lifecycle.

Both are small, bounded, and block the "one review authority" invariant from being true in every production path. Fixing them now keeps the stats and lifecycle projections trustworthy before the next statistics round builds on them.

## Refinement Signals
- Predicted NEL bucket: Large (235+)
- Confidence: Medium
- Selection note: activate as-is
- Main drivers: required-store signature and wiring change across stats port/adapter/callers (`stats.ts`, `stats-backfill.ts`, `integrate-post.ts`, `cli-workflows.ts`, `stats-command-use-case.ts`, composition), approval-boundary failure surfacing + Backlog ordering in `review-commands.ts`/`review-state.ts`, full call-site audit of review persistence, R5 + boundary-failure regressions, R13 semantics update. Audit may shrink the binding work if suspect call sites prove non-approval-producing.

## Architectural Invariants
- **One workflow:** `active → review → integration → done`. `px integrate` may orchestrate missing existing transitions (`submit-for-review`, `approve`, `integrate`) in sequence; it never invents shortcuts and never skips to `done`.
- **One review authority:** current review metadata comes from the Mission Review aggregate only — not PR prose, Git history, Backlog text, or telemetry inference.
- **One completion authority:** `integration → done` after landed integration only. No `active → done`, no `review → done`.
- **Approval boundary:** every genuine approval path converges on `ReviewerDecision(kind=approved, decidedAt=T) → Mission review → integration @ T`, and Backlog promotion happens only after that transition succeeds.

## Scope
- **CP audit (verify, do not re-implement):** confirm task-2376's landed parts are green on main — recovery matrix (R4/R6/R7/R9 in `test/integrate.test.ts`), domain hardening (R8), helper deletion (R12; 0 grep matches for `deriveImplementerAndFixRoundsFromPrComments`, `deriveFixRoundsFromReviewStateHistory`, `deriveFinalImplementerFromBranchHistory`, `deriveFixRoundsFromTaskText`), canonical metrics (R10/R11), dwell proof (R2), boundary on bound paths (R1/R3) — all in `test/task-2376-lifecycle-timing.test.ts` and `test/integrate.test.ts`.
- **Call-site audit (Part B):** classify every `writeReviewState` / `persistReviewStateOrThrow` / `ReviewStatePersistence.save` / `createEvent` call site under `src/` as approval-producing or not. Known suspects: `review-event` command (`src/composition/create-cli.ts` binds persistence without a lifecycle service), `src/adapters/rebase/rebase-workflow-adapter.ts` (2 raw `persistReviewStateOrThrow` calls), `src/adapters/cli/commands/integrate-post.ts` (1 raw call), and the unbound defaults in `src/adapters/review/review-commands.ts` (`options.writeReviewStateFn || writeReviewState`). Bind the lifecycle service at every approval-producing unbound site; document each site's verdict in CP2.
- **Non-silent boundary + Backlog ordering (Part A):** `save()` reports the boundary transition outcome in its persistence result instead of swallowing it. The approval command flow surfaces a failed transition (operator-visible failure) and does NOT promote the Backlog task to `approved` while the Mission remains `review`. `px integrate` recovery remains the repair path.
- **Required authoritative store (Part J):** `loadMissionReview` / `deriveImplementerAndFixRounds` require `MissionStore` — omission is an invariant error (drop the `= null` default and the `missing-authority` return for store omission). Store present but Review absent → `{ implementer: 'unknown', prFixRounds: null }` (unknown, never a fabricated zero). Thread the store through `recordIntegrationStats` (drop null default), `recordPostIntegrationStats` (drop null default; `px integrate` already passes `missionServices.store`), `createStatsWorkflowAdapter` + `StatsWorkflowPort` (resolve and pass the operator store), and `stats-backfill.ts`. Fix the R13 test to the new semantics.
- **R5 human-override regression:** seed `active` Mission with an awaiting Review, apply a human approval through the existing `px review` decision path, assert a persisted `ReviewerDecision(kind=approved)` exists and the Mission reaches `integration` with `occurredAt = ReviewerDecision.decidedAt`, then `px integrate` proceeds without re-running approval. No new CLI flag on `px integrate` (carried scope decision from task-2376).
- **Contradiction/dead-code sweep:** search and classify the backlog's pattern list (`requireStatus(mission, ['review'`, `command: { type: 'approve' | 'integrate' | 'submit-for-review' }`, `decidedAt`, `new Date().toISOString()`, the four deleted helper names, `MissionStore?`); delete anything left over from this mission's changes.

## Scope Addendum (post-CP-7, round 1 F1)

Added after CP-7 in response to round 1 finding F1, which flagged that commit
`48aceda15` landed work the locked Scope above never named. Disclosed here
rather than folded silently into the sections above.

- **Request-changes half of the review round loop.** CP-3 made the *approval*
  boundary authoritative. The *request-changes* boundary was not: a reviewer's
  request-changes verdict reached the review-event trail only, so the round kept
  `decision: null`, the Mission never moved `review → active` through the
  `request-changes` command, no implementer resolution was recorded, and the
  next handoff's resubmission was rejected. The round loop now records the
  reviewer decision and the implementer resolution through the existing domain
  commands (`src/adapters/review/review-round.ts`), and handoff advances the
  existing aggregate via `beginNextReviewRound`.
- **Restricted-area exception:** `src/domain/mission-workflow.ts` — one existing
  rule narrowed (resubmitting an *undecided* recorded round is a relaunch, not a
  new round). Stop rule 4 covers a domain rule that still *permits* a shortcut;
  this rule *forbade* a legitimate transition. No new command types, no
  `Review` / `ReviewerDecision` shape changes. `src/domain/mission.ts` and
  `src/domain/review.ts` remain unchanged.
- Justification, F1–F5 dispositions, and evidence: `missions/task-2378/CP-8.md`.

## Out of Scope
- Historical DB repair, migration, or backfill of pre-cutover Missions
- Preserving execution of ancient Missions lacking Review aggregates
- Dashboard redesign or new statistics
- Telemetry architecture changes
- TASK-2372 integrate-file consolidation beyond changes this mission requires
- General `stats.ts` cleanup unrelated to the required-store change
- Review-domain redesign; new domain types, command types, or state machines
- A new human-override input flag on `px integrate` (override goes through the existing `px review` decision path)
- Re-implementing any part task-2376 already landed (recovery matrix, domain hardening, helper deletion, canonical metrics, dwell proof) — verify only
- Real-agent E2E or network-backed tests

## Success Criteria
> **Falsifiability rule (ADR 0039 Part 2):** Each criterion must be falsifiable. Forbidden: subjective adjectives ("easy, fast, simple, intuitive, user-friendly, responsive, quick, efficient" without an attached metric) and vague quantifiers ("multiple, several, some, many, few, various"). For refactor / condense / migration missions, the criterion must enumerate the specific elements (rules, files, behaviours) that must survive — generic phrases like "preserve critical content" are not sufficient.

- SC01: `test/task-2378-authoritative-stats.test.ts` fails on the parent commit (both new cases red: live stats adapter returns `missing-authority`/`unknown` for a Mission with an authoritative Review; approval command promotes Backlog to `approved` after a swallowed boundary failure) and passes on the final tree.
- SC02: No `missionStore = null` / optional-store default remains in `deriveImplementerAndFixRounds`, `loadMissionReview`, `recordIntegrationStats`, or `recordPostIntegrationStats`; omitting the store throws an invariant error naming the caller obligation.
- SC03: Through the production `StatsCommandUseCase` + `createStatsWorkflowAdapter` wiring, a contemporary Mission with a Review aggregate approved in round 1 derives its authoritative implementer and `reviewFixRounds = 0`, and one with two request-changes cycles derives `reviewFixRounds = 2`, with no PR/Git/backlog-text lookup invoked.
- SC04: Store present but Review absent derives `{ implementer: 'unknown', prFixRounds: null }` — unknown, never a fabricated zero, never an external lookup.
- SC05: When the `review → integration` transition fails at the approval boundary, the approval command surfaces the failure (operator-visible, non-zero outcome) and the Backlog task is NOT promoted to `approved`; the Mission remains `review`; a subsequent `px integrate` recovers it via the existing approve transition.
- SC06: CP2 documents a verdict (approval-producing vs not, file reference) for every `writeReviewState` / `persistReviewStateOrThrow` / `save` / `createEvent` call site under `src/`, and every approval-producing site is bound to a lifecycle service.
- SC07: R5 regression: `active` Mission + awaiting Review + human `px review` approval produces a persisted `ReviewerDecision(kind=approved)` and `review → integration` with `occurredAt` exactly equal to `decidedAt`; `px integrate` then lands without creating a second approval event.
- SC08: R13 (updated in place): store omission throws the invariant error; no PR lookup, no branch-history lookup, no task-text lookup, no fabricated zero or implementer.
- SC09: Existing task-2376 regressions pass unchanged on the final tree: R1–R4, R6–R12 in `test/task-2376-lifecycle-timing.test.ts` and `test/integrate.test.ts` (R13 updated per SC08 is the only edit).
- SC10: Canonical metrics unchanged: first-pass approval → known `reviewFixRounds = 0`; two request-changes cycles → known 2; TASK-2371 aggregation `[0, 2, unknown, unknown] → n=2, average 1.00`.
- SC11: No new domain types, no second Review/lifecycle subsystem, no new review-inference framework, no new npm dependency; recovery still routes through the existing `submit-for-review` / `approve` / `integrate` operations.
- SC12: `git diff --check` reports no errors on the final tree.
- SC13: `./scripts/verify-local.sh all` passes.
- SC14: No focused (`.only`) or unannotated skipped (`.skip`) tests introduced.

Reproduction-Test: test/task-2378-authoritative-stats.test.ts

## Risks and Assumptions
- **Audit outcome uncertainty:** suspect call sites (`review-event`, rebase adapter, integrate-post) are expected to be non-approval-producing (events don't set `ReviewerDecision`, rebase/integrate-post don't approve). If the audit confirms that, the binding work shrinks to failure-surfacing + ordering only. The CP2 classification is authoritative; do not bind speculatively.
- **Required-store ripple:** making `MissionStore` required may surface a stats caller without store access (e.g., `stats-backfill` when the operator DB is unavailable). Mitigation: such callers resolve the store at the composition root; if a caller genuinely cannot obtain one, apply Stop rule 2 and mark with a `ponytail:` comment rather than restoring fallback inference.
- **R13 test change:** the existing R13 test asserts `missing-authority` for a null store — it codifies the old optional semantics and must be updated in place (same file, same test name), not deleted.
- **Failure-visibility blast radius:** surfacing boundary failure as a command failure could affect an interrupted/resumed approval flow. Mitigation: keep `px integrate` recovery as the documented repair path and test the recovery-after-failure sequence (SC05).
- **Assumption:** task-2376's landed parts are green on main; CP1/CP2 verify before any rework.
- **Assumption:** no genuine contemporary workflow reaches `integration` without a Review aggregate (re-verified in CP2; if false, Stop rule 1 applies).

## Checkpoints
- CP 1: **Red reproduction test (bug lock).** Record `BASELINE_SHA` and `git status`. Author `test/task-2378-authoritative-stats.test.ts` with two failing cases: (1) "live stats workflow adapter derives authoritative implementer and reviewFixRounds from the Review aggregate" — seed a Mission with a Review aggregate, run derivation through the `createStatsWorkflowAdapter` production wiring, assert authoritative values; RED on parent because the adapter omits `MissionStore` (result is `missing-authority`/`unknown`). (2) "failed approval boundary transition surfaces and blocks Backlog promotion" — force the lifecycle transition to fail during an approval, assert the command surfaces the failure and the Backlog task is not promoted to `approved`; RED on parent because `save()` swallows the failure and promotion proceeds. Capture exact baseline failure output in the CP doc.
- CP 2: **Call-site audit and invariant check.** Classify every review-persistence call site (SC06); confirm 0 grep matches for the four deleted inference helper names; prove no contemporary workflow reaches `integration` without a Review aggregate; run the existing `test/task-2376-lifecycle-timing.test.ts` + `test/integrate.test.ts` suites green to confirm task-2376 parts. Document any genuine Review-less workflow before continuing.
- CP 3: **Non-silent boundary and Backlog ordering.** `save()` reports the boundary transition outcome in the persistence result; the approval command flow propagates failure and orders Backlog promotion after a successful transition. Add/extend the CP1 case-2 test to green. Bind the lifecycle service at any approval-producing site the audit flagged.
- CP 4: **Required authoritative store.** Drop optional-store defaults in `loadMissionReview` / `deriveImplementerAndFixRounds` / `recordIntegrationStats` / `recordPostIntegrationStats`; thread the operator store through `createStatsWorkflowAdapter` + `StatsWorkflowPort` + `stats-backfill`; update the R13 test to the new semantics (SC02, SC03, SC04, SC08).
- CP 5: **R5 human-override regression.** Add the R5 test (SC07) through the existing `px review` decision path; assert the persisted `ReviewerDecision` and the exact `decidedAt` transition; confirm `px integrate` proceeds without re-running approval.
- CP 6: **Contradiction/dead-code sweep.** Search and classify the backlog pattern list; delete imports/tests/helpers orphaned by this mission's changes; re-run the full R1–R13 regression set.
- CP 7: **Full verification.** `git diff --check` + `./scripts/verify-local.sh all`; answer the Definition of DoD questions with evidence.

### Checkpoint Documentation Requirements
Every checkpoint document (CP-N.md) MUST include:
- A summary of work done
- A `## Goal Check` section
- A 3-column pipe-delimited markdown table with columns: Criterion | Evidence | Status
- At least one evidence row per criterion using durable, verifiable references. Parallix already accepts:
  1. **Recognized repo commands or paths** — e.g., `` `npm test -- test/task-2378-authoritative-stats.test.ts` ``, `` `./scripts/verify-local.sh all` ``, or `` `src/adapters/cli/commands/stats.ts` ``
  2. **Test names** — e.g., `"live stats workflow adapter derives authoritative implementer and reviewFixRounds from the Review aggregate"` (must match a test name in the repo)
  3. **Test file paths** — e.g., `test/task-2378-authoritative-stats.test.ts` (must be an existing test file)
  4. **ADR references** — e.g., `ADR 0039` (must correspond to an existing file under `docs/adr/`)
  5. **File:line references** — accepted when needed, but line numbers eventually rot; prefer the forms above
- Raw `stat`/`ls` output or generic prose may appear as supplemental context, but pair them with one of the accepted references above
- A non-generic `Next action:` line at the bottom

Example Goal Check table:

| Criterion | Evidence | Status |
|---|---|---|
| Reproduction test locks the bug (red on parent, green on final) | `test/task-2378-authoritative-stats.test.ts`, `"live stats workflow adapter derives authoritative implementer and reviewFixRounds from the Review aggregate"` | PASS |
| Required store enforced in stats derivation | `src/adapters/cli/commands/stats.ts`, `"R13: missing MissionStore cannot activate heuristic inference"` | PASS |
| Approval boundary failure blocks Backlog promotion | `test/task-2378-authoritative-stats.test.ts`, `"failed approval boundary transition surfaces and blocks Backlog promotion"` | PASS |
| Verification gate ran | `./scripts/verify-local.sh all` | PASS |

## Gates
- [x] ./scripts/verify-local.sh all

## Restricted Areas
- `src/domain/mission.ts`, `src/domain/mission-workflow.ts`, `src/domain/review.ts` — expected unchanged. No new command types, no `Review`/`ReviewerDecision` shape changes; consume existing `decidedAt` only. If CP2 proves a domain rule still permits a shortcut, stop (Stop rule 4) instead of editing.
- `src/application/mission-lifecycle-service.ts` — no new lifecycle operations.
- `src/adapters/review/review-state.ts` — only surface the boundary transition outcome in the persistence result; do not rework save/retry/version logic.
- `src/adapters/review/review-commands.ts` — failure propagation and Backlog-promotion ordering only; do not add new review command types.
- `src/adapters/review/review-events.ts` — unchanged unless the audit proves an event can produce a `ReviewerDecision` (expected: none).
- `src/adapters/cli/commands/integrate.ts` — recovery is complete from task-2376; change only if CP2 finds a broken recovery path.
- `src/adapters/cli/commands/stats.ts`, `src/adapters/cli/commands/stats-backfill.ts`, `src/adapters/cli/commands/integrate-post.ts` — required-store changes only; do not redesign stats row shape, canonicalization, or measurement persistence.
- `src/application/ports/cli-workflows.ts`, `src/application/stats-command-use-case.ts` — store plumbing through the existing port only.
- `src/composition/create-cli.ts`, `src/composition/application-services.ts`, `src/composition/review-persistence.ts` — binding/wiring only.
- `test/` — add `test/task-2378-authoritative-stats.test.ts`, extend R5, update R13 in place; no E2E or network-backed tests.
- No new npm dependencies. Do not touch telemetry modules. Do not broaden into TASK-2372 consolidation.

## Stop Rules
- Stop if CP2 discovers a genuine supported contemporary workflow where a Mission legitimately reaches `integration` without a Review aggregate — document it, adapt the required-store rule narrowly for that caller, do not force it.
- Stop if a stats caller cannot obtain a `MissionStore` without a circular dependency or a new composition seam — document, re-scope that caller with a `ponytail:` comment naming the ceiling; never restore heuristic inference as the fix.
- Stop if surfacing boundary failure as a command failure breaks a supported resume/recovery flow — degrade to an operator-loud warning plus the `px integrate` repair path, and document the decision in the CP doc.
- Stop if more than 3 existing tests break and the breakage is not traceable to this mission's changed call sites — re-scope rather than force.
- No real-agent E2E and no network calls in tests; all dependencies mocked.
