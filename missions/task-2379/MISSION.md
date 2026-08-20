# Mission: Make lifecycle recovery authoritative and delete obsolete review-stat inference (task-2379)

## Goal
Make the Mission lifecycle and the Review aggregate one truth end to end:

1. Every authoritative Review approval — provider-backed, provider=none/local, human/manual override, self/local approval, automated/artifact review — persists `Mission: review → integration` at the approval boundary with `occurredAt = ReviewerDecision.decidedAt`, without waiting for `px integrate`. The Backlog task promotion follows that durable transition and never precedes or replaces it.
2. `px integrate` is a recovery/orchestration command only: it reconciles stale `active` / `review` / `integration` / `done`-resume states by invoking the existing workflow operations (`submit-for-review`, `approve`, `integrate`) in sequence, with recovered transitions timestamped by the stored `ReviewerDecision.decidedAt` — never `new Date()`, never the integration start time. It never re-implements transition rules, never creates shadow approvals, and never skips to `done`.
3. A human review override is persisted as a real `ReviewerDecision(kind=approved, decidedAt=T)` through the existing Review domain, not as an integrate-preflight boolean (`defaultUserApproved`) that bypasses Review.
4. The `integrate` domain command requires `Mission.status = integration` only; direct `review → done` is a `MissionRuleViolation`.
5. Contemporary statistics derive implementer and reviewFixRounds exclusively from the authoritative Mission/Review aggregate: MissionStore is a required parameter (omission is a wiring/invariant error, never a fallback trigger), and all PR-comment, Git/branch-history, review-state-history, and backlog-task-text inference paths are deleted along with imports/tests that exist only to preserve them.
6. The deterministic delayed fixture — review entered 10:00, approved 10:30, `px integrate` invoked 14:00, integration lands 14:15 — projects through the same lifecycle projection consumed by Board/FLOW to exactly review dwell = 30 minutes and integration dwell = 225 minutes.

## Why Now
TASK-2371/2376/2378 built the authoritative machinery — the `decidedAt` approval boundary in `src/adapters/review/review-state.ts`, the MissionStore-required derivation in `src/adapters/cli/commands/stats.ts`, the `recoverMissionForIntegration` recovery in `src/adapters/cli/commands/integrate.ts` — but two correctness defects remain. First, approval producers that do not route through the bound review-persistence boundary (baseline candidates: the `defaultUserApproved` preflight boolean in `src/adapters/cli/commands/integrate.ts`, and the unbound `bindReviewPersistence(services.mission.store)` call site in `src/composition/create-cli.ts`) leave the Mission in `review` until `px integrate` later reconciles it at integration-command time, so every mission integrated hours after approval reports a wrong review dwell and a wrong integration dwell in Board/FLOW. Second, the null-store adapter form `createStatsWorkflowAdapter(missionStore: MissionStore | null)` still lets a caller omit the Mission authority and surface a runtime invariant error instead of a wiring-time defect, and residual external-inference readers keep a competing truth source alive that previously produced fabricated zeros and agent slop. These defects corrupt the bottleneck statistics the team triages on and silently re-create the divergence this mission series has been eliminating; fixing them now closes the loop before the next statistics-dependent decision.

## Refinement Signals
- Predicted NEL bucket: Medium (81–235)
- Confidence: High
- Selection note: activate as-is
- Main drivers: converging every approval producer onto the existing `decidedAt` boundary (review-commands/review-state/composition wiring), the `px integrate` recovery matrix over four stale states, deletion of external stats inference plus the required-store signature change and caller fixes, and the R1–R13 regression suite on deterministic fixtures.

## Scope
- `src/adapters/cli/commands/integrate.ts`: `recoverMissionForIntegration` recovery matrix (stale `active`, `review`, `integration`, `done`-resume); remove `defaultUserApproved` as a lifecycle/approval authority in `evaluateTaskStatusForIntegration` / preflight; recovery invokes existing workflow operations only.
- `src/domain/mission-workflow.ts`, `src/domain/mission.ts`: `integrate` command requires `status = integration`; direct `review → done` is a domain error.
- `src/adapters/review/review-commands.ts`, `src/adapters/review/review-state.ts`, `src/adapters/review/review-round.ts`, `src/adapters/review/review-artifacts.ts`: every genuine approval producer converges on the one shared boundary transition with `occurredAt = ReviewerDecision.decidedAt`; human override persists a real `ReviewerDecision`.
- `src/composition/review-persistence.ts`, `src/composition/create-cli.ts`, `src/composition/application-services.ts`: every production review-persistence call site injects the MissionStore and the lifecycle service (no unbound sites remain).
- `src/adapters/cli/commands/stats.ts`, `src/application/ports/cli-workflows.ts`: delete PR-comment / branch-history / review-state-history / task-text inference helpers and their orphaned imports, dependencies, and tests; `deriveImplementerAndFixRounds` takes the authoritative store as a required parameter; `createStatsWorkflowAdapter` no longer accepts `null`; fix every caller that omitted the store.
- `src/adapters/cli/commands/integrate-post.ts`: verify (no behavior change) that `persistLandedIntegrationOrAbort` owns `integration → done` at landed-commit time and that resume/idempotent closeout creates no duplicate lifecycle events.
- Tests under `test/`: `test/task-2379-approval-boundary-repro.test.ts` (red reproduction) plus R1–R13 coverage, extending `test/integrate.test.ts`, `test/task-2376-lifecycle-timing.test.ts`, `test/review-stats.test.ts` as fitting.
- Checkpoint documents under `missions/task-2379/`; backlog task labels.

## Out of Scope
- Historical SQLite measurement repair, migration, or backfill of pre-cutover missions; stored rows keep being read as stored measurements.
- Preserving execution of ancient missions lacking Review aggregates.
- Dashboard/FLOW redesign; new statistics; telemetry architecture changes (telemetry stays unrelated to Mission completion authority).
- TASK-2372 integrate-file consolidation beyond the changes this mission requires; general `stats.ts` cleanup beyond deleting the obsolete inference.
- Review-domain redesign; new recovery state machine; second review subsystem.
- Real-agent E2E; network-backed tests; any agent/LLM/mission-runner dependency in certification tests.

## Success Criteria
> **Falsifiability rule (ADR 0039 Part 2):** Each criterion must be falsifiable. Forbidden: subjective adjectives ("easy, fast, simple, intuitive, user-friendly, responsive, quick, efficient" without an attached metric) and vague quantifiers ("multiple, several, some, many, few, various"). For refactor / condense / migration missions, the criterion must enumerate the specific elements (rules, files, behaviours) that must survive — generic phrases like "preserve critical content" are not sufficient.

- SC1 (R1): For every supported approval producer, immediately after the authoritative Review records `kind=approved, decidedAt=T` — and before `px integrate` runs — the Mission store shows `status=integration` and one persisted `review → integration` transition with `occurredAt = T`.
- SC2 (R2): With review entered 10:00, approved 10:30, `px integrate` 14:00, land 14:15, the lifecycle projection consumed by Board/FLOW reports review dwell = 30 minutes and integration dwell = 225 minutes.
- SC3 (R3): Seeding `status=review` with an already-approved Review (`decidedAt=10:30`) and running `px integrate` at 14:00 persists `review → integration` at 10:30 (not 14:00); the subsequent landing produces exactly one `integration → done` event at the landed commit time.
- SC4 (R4): Seeding stale `active` with valid authoritative Review facts, `px integrate` reaches integration through the existing `submit-for-review` and `approve` operations (no direct status writes) before landing.
- SC5 (R5): Seeding stale `active` with no approved Review plus an explicit supported human override, `px integrate` persists a real `ReviewerDecision(kind=approved)`, then `active → review → integration` through existing workflow operations.
- SC6 (R6): Seeding stale `active` with no sufficient Review facts and no override, `px integrate` exits non-zero with an actionable error and the Mission is not `done`.
- SC7 (R7): Seeding `status=review` with an unapproved Review and no override, `px integrate` exits non-zero and the Mission remains `review`.
- SC8 (R8): At the domain level, the `integrate` command on a Mission with `status=review` throws `MissionRuleViolation`; no path reaches `review → done`.
- SC9 (R9): `px integrate` on `status=integration` does not re-run review/approval logic; successful landing leaves `status=done` with exactly one `integration → done` event; a failed landing never creates `done`.
- SC10 (R10/R11/R13): reviewFixRounds derives only from the authoritative Review aggregate: approved on first round → known 0; two request-changes cycles then approval → known 2; genuinely insufficient authoritative evidence → unknown, never a fabricated 0.
- SC11 (R12): With PR comments, branch history, and backlog task text deliberately containing misleading values, derivation returns the authoritative values (reviewFixRounds=2, implementer=terra) and the external fallback readers are never invoked.
- SC12 (R13): A contemporary derivation with missing authoritative Review yields unknown or an invariant error; it performs no PR lookup, no branch-history lookup, no task-text lookup, and fabricates no implementer.
- SC13 (AC21/AC22): `deriveImplementerAndFixRounds` and the `StatsWorkflowPort` implementation take the MissionStore as a required parameter; no production call site passes `null`; omitting the store is a wiring-time defect, not a runtime heuristic trigger.
- SC14 (AC23–AC28): PR-comment, Git/branch-history, review-state-history, and backlog-task-text inference helpers are deleted, together with imports, dependencies, and tests whose only purpose is preserving them; a repo-wide search for the backlog's named patterns finds zero production callers.
- SC15 (AC33/AC35/AC36/AC37): TASK-2371 aggregation semantics are unchanged — `[0, 2, unknown, unknown] → values [0,2], n=2, average 1.00`; PR-fix observation-count semantics are unchanged; historical SQLite measurement rows are read unchanged; telemetry remains unrelated to Mission completion authority.
- SC16 (AC39): Old-bug sensitivity is demonstrated: temporarily using `new Date()` for the approval transition makes the SC2/SC3 tests fail (review dwell too large, integration dwell too small); temporarily allowing `integrate` from `review` makes SC8 red; temporarily restoring one obsolete PR/Git/task-text fallback makes SC11/SC12 red. No mutation is committed.
- SC17 (AC38 + anti-slop): No new recovery state machine, no second Review/lifecycle subsystem, no integration-specific shadow approval record, no `active → integration` or `active → done` shortcuts, and no replacement heuristics for the deleted inference.
- SC18 (AC40): Certification tests require no agent, LLM, mission runner, or network.
- SC19 (AC41–AC43): `git diff --check` and `./scripts/verify-local.sh all` pass on the final tree; no `.only` and no bare `.skip` are introduced.

## Risks and Assumptions
- Assumption: no genuine currently supported workflow reaches `integration` without a Review aggregate. CP 2 proves it from domain/application code; if one exists, document it and adapt narrowly instead of deleting it blind (see Stop rules).
- Risk: some approval producer (Forgejo provider-backed approval, provider=none CLI outcome, artifact-driven review) is wired through an unbound persistence site; convergence may touch more call sites than the baseline candidate list.
- Risk: changing `createStatsWorkflowAdapter` / `deriveImplementerAndFixRounds` to a required store ripples into composition roots; caller fixes must keep the integration-stats write path byte-compatible.
- Risk: deleting obsolete stats helpers exposes test-only callers; delete such tests only when their sole purpose is preserving the obsolete behavior.
- Risk: deterministic dwell fixtures need controlled timestamps; reuse the existing `occurredAt`/`decidedAt` parameters already accepted by lifecycle transitions rather than adding a global fake clock.
- Assumption: historical stored measurements remain valid read-only data and need no recomputation or migration.

## Checkpoints
- CP 1: Baseline + red reproduction. Record `BASELINE_SHA` and `git status`. Author `test/task-2379-approval-boundary-repro.test.ts`: the 10:00 review / 10:30 approval / 14:00 integrate / 14:15 land fixture driven through the approval producer that currently bypasses the `decidedAt` boundary (baseline candidates: the `defaultUserApproved` human-override preflight path and the unbound `bindReviewPersistence` call site in `src/composition/create-cli.ts`; confirm against the baseline before finalizing the test body). Assert `Mission.status = integration` before `px integrate` runs, `review → integration occurredAt = 10:30`, and dwell 30m/225m through the Board/FLOW lifecycle projection. Run it and capture the exact red failure output at the parent commit; it goes green once the fix lands.
- CP 2: Inventory + invariant proof. Trace and classify every approval producer (provider-backed, provider=none/local, human override, self/local approval, automated/artifact review), every `bindReviewPersistence` call site, the `defaultUserApproved` boolean flow, `recoverMissionForIntegration`, the `deriveImplementerAndFixRounds` caller graph, and every external-inference reader. Prove from `src/domain/mission-workflow.ts` that a normal Mission cannot reach `integration` without a Review aggregate.
- CP 3: Boundary convergence (Parts A/B/E). Make every genuine approval persist `review → integration @ ReviewerDecision.decidedAt` through the one shared boundary operation; make the human override persist a real `ReviewerDecision` first; keep Backlog promotion strictly after the durable transition.
- CP 4: Recovery orchestration (Parts C/D/F). Make `px integrate` reconcile stale `active` / `review` / `integration` by invoking the existing `submit-for-review` / `approve` operations in sequence with stored `decidedAt`; keep `integration` passthrough and idempotent `done` resume unchanged; stop clearly when authoritative facts are missing.
- CP 5: Domain hardening (Part G). Require `Mission.status = integration` for the `integrate` command; make direct `review → done` a `MissionRuleViolation`; re-run the R4–R9 recovery regressions.
- CP 6: Delete obsolete inference (Parts H/I/J). Remove PR/Git/task-text fallback inference, the `null` store adapter form, and orphaned imports/tests; make the store required; fix every caller.
- CP 7: Review metric certification (R10–R13). Prove known-zero, known-nonzero, and unknown semantics from the Review aggregate alone, with misleading external artifacts present and never consulted.
- CP 8: Lifecycle statistics proof (Part M). Run the persisted projection of the 10:00/10:30/14:00/14:15 fixture and assert review dwell = 30m, integration dwell = 225m.
- CP 9: Contradiction + dead-code sweep. Search and classify every pattern in the backlog's contradiction list (`requireStatus(mission, ['review', 'integration'`, the three transition commands, `decidedAt`, `new Date().toISOString()`, the four named inference helpers, `branch-history`, `pr-comments`, `backlog-fallback`, `MissionStore?`); delete orphans; confirm final semantics.
- CP 10: Full verification. `git diff --check`, `./scripts/verify-local.sh all`, and a scan for `.only` / bare `.skip` in changed tests.

Reproduction-Test: test/task-2379-approval-boundary-repro.test.ts

### Checkpoint Documentation Requirements
Every checkpoint document (CP-N.md) MUST include:
- A summary of work done in that checkpoint
- A `## Goal Check` section
- A 3-column pipe-delimited markdown table with columns: `| Criterion | Evidence | Status |`
- At least one evidence row per Success Criterion the checkpoint touches. Parallix already verifies these durable evidence forms — lead with them:
  1. **Recognized repo commands or paths** — e.g., `` `npm test -- test/task-2379-approval-boundary-repro.test.ts` ``, `` `npm test -- test/integrate.test.ts` ``, `` `./scripts/verify-local.sh all` ``, `` `git diff --check` ``, `` `px integrate task-2379 --dry-run` ``
  2. **Test names** — the exact `test(...)`/`it(...)` title as written in the repo, e.g., `"delayed integration: review dwell is 30m and integration dwell is 225m (R2)"` (must match a test name in the tree)
  3. **Test file paths** — e.g., `test/task-2379-approval-boundary-repro.test.ts`, `test/task-2376-lifecycle-timing.test.ts` (must exist in the tree)
  4. **ADR references** — e.g., `ADR 0053` (operational persistence and authority boundaries), `ADR 0048` (must correspond to an existing file under `docs/adr/`)
- File:line references are accepted parenthetically when no command or test pins the fact (e.g., the recovery matrix in `src/adapters/cli/commands/integrate.ts`), but are discouraged because line numbers rot — prefer the forms above.
- Weak-agent failure mode: raw `stat`/`ls`/`grep` output or generic prose such as "recovery now reuses existing workflow operations" is not enough evidence on its own. Pair any shell output with one of the accepted references above (a runnable command, a test name/file path, or an ADR).
- A non-generic `Next action:` line at the bottom.

Example Goal Check table:

| Criterion | Evidence | Status |
|---|---|---|
| Red reproduction locks the approval-boundary divergence | `test/task-2379-approval-boundary-repro.test.ts`, `npm test -- test/task-2379-approval-boundary-repro.test.ts` | PASS |
| Approval transition timestamp equals `decidedAt` | `test/task-2376-lifecycle-timing.test.ts`, `"review → integration persisted at ReviewerDecision.decidedAt"` | PASS |
| Verification gate ran | `./scripts/verify-local.sh all` | PASS |

## Gates
- [ ] git diff --check
- [ ] ./scripts/verify-local.sh all

## Restricted Areas
- `origin` remote: this mission branch must never be pushed to `origin`; only `main` may push to `origin`, and `review` (Forgejo) is the sole push target for mission branches.
- `scripts/verify-local.sh` and `config/integration-pipelines.json`: no gate or pipeline changes.
- `backlog/archive/` and every `missions/*/` directory except `missions/task-2379/`: read-only.
- Dashboard/FLOW rendering, telemetry architecture, and the review domain's public shape: no redesign; only the boundary/convergence and deletion changes in Scope.
- No new dependencies; no TASK-2372 consolidation beyond what the authoritative boundaries require.

## Stop Rules
- If the CP 2 invariant trace finds a genuine currently supported workflow that reaches `integration` without a Review aggregate: stop, document it, and ask before deleting that path — do not preserve inference by default, but do not delete a real workflow either.
- If any recovery case appears to require a transition that does not exist in `src/domain/mission-workflow.ts` (e.g., `active → integration`): stop and report — inventing shortcuts is forbidden by the mission.
- If the red reproduction test in CP 1 passes on the parent commit: the baseline understanding is wrong — stop and re-trace the approval paths before writing any fix.
- If a stats-inference helper slated for deletion has a production caller absent from the CP 2 inventory: stop, inventory and classify that caller first.
- If the lifecycle projection cannot express the exact 30m/225m fixture without changing its public behavior: stop and report instead of approximating.
- If `./scripts/verify-local.sh all` fails on the final tree and cannot be fixed within this mission's scope: stop and report — never loosen a gate, skip a test, or commit a focused test to force a pass.
