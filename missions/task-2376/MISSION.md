# Mission: Make lifecycle recovery authoritative and delete obsolete review-stat inference (task-2376)

## Goal
Make `ReviewerDecision.decidedAt` the single timestamp authority for `review → integration`, harden `integrate` to require `status=integration` only (eliminating `review → done` shortcut), and delete all PR/Git/backlog-text fallback inference for review statistics so contemporary stats derive exclusively from the authoritative Review aggregate.

## Why Now
TASK-2371 and TASK-2372 fixed major statistics defects. Two correctness gaps remain: (1) review approval timestamp is lost — `px integrate` uses its own wall clock instead of `ReviewerDecision.decidedAt`, making review/integration dwell stats wrong; (2) obsolete inference helpers fire when `MissionStore` is missing, creating competing truth sources and fabricated zeros. These distort bottleneck statistics and have produced repeated agent slop.

## Refinement Signals
- Predicted NEL bucket: Large (235+)
- Confidence: High
- Selection note: activate as-is
- Main drivers: domain rule change, approval-timestamp wiring across all approval paths, recovery orchestration for stale active/review states, deletion of 4+ inference helpers and their callers/tests, 13 regression tests, contradiction sweep

## Architectural Invariants

### One workflow
The authoritative lifecycle:

```
active → submit-for-review → review → approve → integration → landed integration → done
```

Each transition has exactly one existing domain/application meaning.
`px integrate` may orchestrate/recover missing transitions. It MUST NOT invent shortcuts.

### One review authority
Review metadata comes from the `Mission Review` aggregate only — not PR prose, Git history, backlog text, or telemetry inference.

### One completion authority
Mission completion is `integration → done` after landed integration only. No `active → done`. No `review → done`.

## Scope

### Approval boundary (Parts A, B, F)
- Wire `review → integration` transition to `ReviewerDecision.decidedAt` at the approval boundary — not `px integrate` wall clock
- Cover ALL supported approval paths: provider-backed, local/provider=none, human/manual override, self/local approval, automated artifact review
- Ordering: authoritative Review approval → Mission `review → integration` @ `decidedAt` → Backlog promotion. Backlog must NOT be the source of lifecycle truth. If lifecycle persistence fails, do not silently leave an apparently approved Backlog item while Mission remains stale.
- Recovery uses `ReviewerDecision.decidedAt` from the authoritative Review round. Never use `new Date()`, backlog file timestamp, integration start time, PR timestamp, or Git commit timestamp as the approval time.

### Recovery orchestration (Parts C, D)
`px integrate` reconciles stale `active`, `review`, `integration`, `done/resume` states by invoking existing workflow operations (`submit-for-review`, `approve`, `integrate`) in sequence. Never skip directly to `done`.

Recovery matrix:

| Mission state | Condition | Behavior |
|---|---|---|
| `active` | Valid Review/handoff facts exist | Invoke existing `submit-for-review` transition, then `approve` |
| `active` | No Review facts, explicit human override | Invoke existing human-review path → persist `ReviewerDecision` → continue lifecycle |
| `active` | No Review facts, no override | STOP with actionable error. Do NOT infer Review from Git/PR/task text. |
| `review` | Review already approved | Invoke existing `approve` transition @ `ReviewerDecision.decidedAt` |
| `review` | Explicit human override | Record through existing Review mechanism → obtain `ReviewerDecision` → invoke `approve` |
| `review` | Not approved, no override | STOP |
| `integration` | Normal | Proceed with integration. Do not create another approval event. |
| `done` | Resume | Use existing resume/idempotent closeout. No duplicate lifecycle events. |

Forbidden recovery implementation — do NOT patch statuses directly:
```
if active: mission.status = review      // WRONG
if review: mission.status = integration // WRONG
```

Instead invoke existing operations: `submit-for-review`, `approve`, `integrate`.
The orchestration layer decides WHICH operation; the domain layer decides WHETHER it is valid.

### Human override (Part E)
Human override must result in a real `ReviewerDecision(kind=approved, decidedAt=T)` through the existing Review domain — not an `integrate`-local boolean like `approval.ok = true` that bypasses Review. Do not invent a fake provider review if the existing domain supports local/human decisions. Do not create an integration-specific shadow approval record.

### Domain hardening (Part G)
`integrate` command requires `Mission.status = integration` only. Direct `review → done` must be a domain error. This prevents a stale/missing approval transition from being silently hidden by integration. `px integrate` must repair missing intermediate states instead.

### Delete obsolete inference (Parts H, I, J)
Remove production inference of implementer/reviewFixRounds from:
- `deriveImplementerAndFixRoundsFromPrComments`
- `deriveFixRoundsFromReviewStateHistory`
- `deriveFinalImplementerFromBranchHistory`
- `deriveFixRoundsFromTaskText`

Delete helpers, callers, imports, dependencies, and tests whose only purpose is preserving this behavior. Do NOT replace deleted heuristics with different heuristics (`legacyReviewFallback`, `bestEffortFixRounds`, `inferReviewStats`, `historicalMissionMetadata`).

Historical SQLite rows are read-only. No recomputation or backfill. No relevant pre-cutover Missions need live inference.

`deriveImplementerAndFixRounds` must require authoritative `MissionStore`. Missing store is a caller bug — fix the caller, do not compensate inside the function with fallback inference.

### Canonical review metrics (Parts K, L)
- `reviewFixRounds` from Review aggregate only: approved first round = known 0; two request-changes cycles = known 2; insufficient evidence = unknown. Known zero distinct from unknown. Preserve TASK-2371 aggregation semantics (`[0, 2, unknown, unknown] → n=2, avg=1.00`).
- Implementer from authoritative Mission/Review data only. No commit author, branch history, backlog prose, or PR commenter guessing. If Review cannot provide it: `unknown`.

### Lifecycle statistics proof (Part M)
Deterministic fixture: 10:00 review, 10:30 approve, 14:00 integrate, 14:15 done. Assert review dwell = 30m, integration dwell = 225m through the same lifecycle projection consumed by Board/FLOW.

### Regression tests (R1–R13)
See backlog task for full R1–R13 specifications.

### Contradiction sweep
Search and classify all matches for:
```
requireStatus(mission, ['review', 'integration'
command: { type: 'submit-for-review'
command: { type: 'approve'
command: { type: 'integrate'
decidedAt
new Date().toISOString()
deriveFixRoundsFromTaskText
deriveFixRoundsFromReviewStateHistory
deriveFinalImplementerFromBranchHistory
deriveImplementerAndFixRoundsFromPrComments
branch-history
pr-comments
backlog-fallback
MissionStore?
```

## Anti-Slop Constraints

These constraints prevent the mission from drifting into unnecessary work or losing the exact correctness guarantees. Each is a hard rule — not a preference.

1. **Do not make `px integrate` strict at the orchestration boundary.** It must remain able to repair valid stale `active`, `review`, `integration` states. Strictness belongs to individual domain transitions.
2. **Do not add `active → integration` or `active → done` shortcuts.** Recovery must invoke `submit-for-review`, `approve`, `integrate` in sequence as required.
3. **Do not reimplement `submit-for-review` rules in `integrate.ts`.** Call/reuse the existing workflow operation.
4. **Do not reimplement approval rules in `integrate.ts`.** Use the existing authoritative Review/approval path.
5. **Do not invent a human-override boolean as lifecycle authority.** Human override must result in a real `ReviewerDecision`.
6. **Do not use current time for recovered historical transitions.** Use the timestamp of the authoritative source event.
7. **Do not keep obsolete stats inference "just in case".** No relevant old Missions require it. Historical DB rows do not depend on live inference helpers.
8. **Do not replace deleted heuristics with different heuristics.** No Git, PR, Backlog, or telemetry reconstruction of Review truth.
9. **Do not broaden into TASK-2372 structural cleanup.** Make only the structural changes required to establish the authoritative boundaries.

## Out of Scope
- Historical DB repair or migration/backfill of pre-cutover Missions
- Preserving execution of ancient Missions lacking Review aggregates
- Dashboard redesign or new statistics
- Telemetry architecture changes
- TASK-2372 integrate-file consolidation beyond changes required by this mission
- General `stats.ts` cleanup unrelated to deleted inference
- Review-domain redesign
- Real-agent E2E or network-backed tests

## Success Criteria
- SC01: Normal authoritative Review approval transitions Mission `review → integration` immediately (before `px integrate` runs).
- SC02: `review → integration` lifecycle event's `occurredAt` equals `ReviewerDecision.decidedAt` exactly.
- SC03: Every supported approval path (provider, local, human override) follows same `ReviewerDecision → Mission approve @ T` invariant.
- SC04: Human override creates a real `ReviewerDecision` in the Review aggregate — not only an `integrate` preflight boolean.
- SC05: Backlog status promotion is a side effect AFTER lifecycle transition, not the source of lifecycle truth.
- SC06: `px integrate` recovers stale `active` via existing `submit-for-review` + `approve` operations (not direct status mutation).
- SC07: `px integrate` recovers stale `review` with approved Review using stored `ReviewerDecision.decidedAt`.
- SC08: `px integrate` stops clearly when `active` has no Review facts and no override.
- SC09: `px integrate` stops when `review` has no approval and no override.
- SC10: Domain `integrate` command rejects `Mission.status = review` with `MissionRuleViolation`. Only `integration` accepted.
- SC11: Normal `integration` state proceeds without rerunning approval.
- SC12: Delayed fixture (10:00/10:30/14:00/14:15) produces review dwell=30m, integration dwell=225m.
- SC13: First-pass approval yields known `reviewFixRounds=0` (not unknown).
- SC14: Two request-changes cycles yield known `reviewFixRounds=2`.
- SC15: Missing authoritative Review yields `unknown` (not fabricated zero). No PR/Git/backlog lookup invoked.
- SC16–SC18: PR-comment, Git/branch-history, and backlog task-text inference helpers deleted from production code.
- SC19: `deriveImplementerAndFixRounds` requires `MissionStore` — missing store does not activate heuristic fallback.
- SC20: External artifacts with misleading values do not affect results when authoritative Review is present.
- SC21: TASK-2371 weekly Agent Performance semantics unchanged.
- SC22: Old-bug sensitivity demonstrated: temporarily using `new Date()` for approval makes R2/R3 fail; temporarily allowing `review → done` makes R8 fail; temporarily restoring PR fallback makes R12/R13 detect it.
- SC23: No focused or unannotated skipped tests.
- SC24: `git diff --check` passes.
- SC25: `./scripts/verify-local.sh all` passes.

Reproduction-Test: test/task-2376-lifecycle-timing.test.ts

## Risks and Assumptions
- **Risk:** Recovery orchestration for `active` requires understanding all existing `submit-for-review` callers. If recovery reuses the idempotent path (mission already `review` returns untouched), recovery may silently skip. Mitigation: audit `submit-for-review` idempotency in CP0.
- **Risk:** Deleting PR/Git/backlog inference helpers may break callers not yet covered by tests. Mitigation: grep all callers before deletion, verify each passes `MissionStore`.
- **Risk:** Human override path may not yet produce a `ReviewerDecision` in all adapter variants. Mitigation: CP1 determines contemporary workflow invariants; adapt narrowly if a genuine Review-less workflow exists.
- **Assumption:** No production path requires `integrate` from `review` status (the shortcut was always a bug).
- **Assumption:** No callers of `deriveImplementerAndFixRounds` omit `MissionStore` intentionally. Missing store = caller bug.
- **Assumption:** Historical SQLite rows need no rewrite — read as-is. New missions use authoritative paths only.

## Checkpoints
- CP 0: Baseline SHA, working-tree state, full path inventory (all review approval paths, human override, `submit-for-review`, `approve`, `px integrate` preflight/recovery, `MissionIntegrationService`, `reviewFixRounds` derivation, implementer derivation, external inference callers).
- CP 1: Determine contemporary workflow invariants — prove whether a normal Mission can reach integration without a Review aggregate. Document any genuine Review-less workflow.
- CP 2: Red reproduction test — author `test/task-2376-lifecycle-timing.test.ts` with R1–R3 and R8. Tests must fail on parent commit. Capture exact baseline failures.
- CP 3: Move normal approval to authoritative boundary — wire `ReviewerDecision.decidedAt` into `review → integration`. Cover all approval producers.
- CP 4: Implement recovery orchestration — `px integrate` reconciles stale `active`/`review`/`integration` using existing operations.
- CP 5: Harden integrate domain rule — require `Mission.status = integration` for `integrate`. Run recovery regressions.
- CP 6: Delete obsolete stats inference — remove PR/Git/task-text fallback helpers. Fix callers to provide authoritative `MissionStore`.
- CP 7: Review metric certification — run R10–R13. Prove known zero, non-zero, and missing evidence semantics.
- CP 8: Lifecycle statistics proof — 10:00/10:30/14:00/14:15 fixture. Assert review=30m, integration=225m.
- CP 9: Contradiction/dead-code sweep — search and classify all patterns from backlog task. Delete obsolete imports/tests/helpers.
- CP 10: Full verification — `git diff --check` + `./scripts/verify-local.sh all`.

### Checkpoint Documentation Requirements
Every checkpoint document (CP-N.md) MUST include:
- A summary of work done
- A `## Goal Check` section
- A 3-column pipe-delimited markdown table with columns: Criterion | Evidence | Status
- At least one evidence row per criterion using durable, verifiable references. Parallix already accepts:
  1. **Recognized repo commands or paths** — e.g., `` `npm test -- test/domain-mission.test.ts` ``, `` `./scripts/verify-local.sh all` ``
  2. **Test names** — e.g., `"approval transition uses ReviewerDecision.decidedAt"` (must match a test name in the repo)
  3. **Test file paths** — e.g., `test/task-2376-lifecycle-timing.test.ts` (must be an existing test file)
  4. **ADR references** — e.g., `ADR 0053` (must correspond to an existing file under `docs/adr/`)
  5. **File:line references** — accepted when needed, but line numbers eventually rot; prefer the forms above
- Raw `stat`/`ls` output or generic prose may appear as supplemental context, but pair them with one of the accepted references above
- A non-generic `Next action:` line at the bottom

Example Goal Check table:

| Criterion | Evidence | Status |
|---|---|---|
| Approval transition uses decidedAt | `test/task-2376-lifecycle-timing.test.ts`, `"R1: normal approval transitions review to integration immediately"` | PASS |
| Integrate rejects review status | `src/domain/mission-workflow.ts`, `R8: direct review to done forbidden` | PASS |
| Verification gate ran | `./scripts/verify-local.sh all` | PASS |

## Gates
- [x] ./scripts/verify-local.sh all

## Restricted Areas
- `src/domain/mission.ts` — only touch `requireStatus` for `integrate` command (change allowed statuses from `['review', 'integration']` to `['integration']`). Do not redesign Mission type.
- `src/domain/mission-workflow.ts` — only modify `decideMission` `integrate` case and `approve` case for timestamp. Do not add new command types or transition helpers.
- `src/domain/review.ts` — no changes to `Review` type or `ReviewerDecision` shape. Only consume existing `decidedAt`.
- `src/application/mission-lifecycle-service.ts` — only modify `occurredAt` wiring for approve transition. Do not add new lifecycle operations.
- `src/adapters/cli/commands/integrate.ts` — recovery orchestration and approval-timestamp wiring. Do not reimplement `submit-for-review` or `approve` rules inline.
- `src/adapters/cli/commands/stats.ts` — delete obsolete inference functions and simplify `deriveImplementerAndFixRounds`. Do not redesign stats row shape or measurement persistence.
- `src/adapters/review/review-commands.ts` — only if approval-timestamp wiring touches the review command adapter. Do not add new review command types.
- `test/` — add new regression tests. Modify existing tests only when they test behavior this mission changes. Do not add E2E or network-backed tests.
- Do not broaden into TASK-2372 structural cleanup.
- Do not introduce new domain types, interfaces, or state machine definitions.

## Stop Rules
- Stop if CP1 discovers a genuine supported contemporary workflow where a Mission reaches integration without a Review aggregate — document it and adapt narrowly rather than force-deleting inference paths.
- Stop if a caller of `deriveImplementerAndFixRounds` cannot reasonably be wired to `MissionStore` without a circular dependency — document and scope out with a `ponytail:` comment.
- Stop if more than 3 existing tests break after deleting an inference helper and the breakage is not traceable to the deleted helper's callers — re-scope the deletion.
- Do not add new dependencies (npm packages) for any part of this mission.
- Do not modify `src/domain/agents.ts`, `src/domain/checkpoint.ts`, or `src/domain/session.ts`.
- Do not touch telemetry modules (`codex-telemetry.js`, `claude-telemetry.js`) or their stats integration.
- Do not touch `stats-cohorts.ts` or `stats-report-rendering.ts` unless a deleted inference helper is imported there.
- No real-agent E2E or network calls in tests. All mocks.

## Recorded scope decisions

- **R5 — `px integrate` has no human-override input channel (round 1 review, 2026-08-15).**
  The R5 spec asks that `px integrate` accept an explicit supported human
  override and continue the lifecycle from `active`. `parseIntegrateArgs`
  supports only `--dry-run`, `--no-integration-gates`, `--no-gate`, and
  `--real-agent[-model]`; there is no override channel, and adding one is a
  new command surface this mission does not authorize. The narrow adaptation
  is fail-closed: `recoverMissionForIntegration` stops `active` Missions
  without Review facts with actionable guidance to run `px handoff` (or
  record a human decision through `px review`); the next `px integrate` then
  recovers through the normal `review` path. The SC04 invariant holds: a
  human override produces a real `ReviewerDecision` through the existing
  Review domain (`px review`), never an `integrate`-local boolean. R5's
  continuation half (approved Review → `integration` via the original
  `decidedAt`) is covered by the recovery tests in `test/integrate.test.ts`
  ("R4: stale active recovery chains submit-for-review then approve with
  original decidedAt", "recovery promotes an approved Review with its
  original decidedAt before integration"); R5's override-input half is out
  of scope by this decision.

## Definition of Done

Before marking done, answer with concrete evidence:

1. **When does a normal Mission now leave `review`?** — On `approve` command when Review has approved decision. `decideMission` transitions `review` → `integration` immediately. (`src/domain/mission-workflow.ts:138`)
2. **Does the lifecycle event timestamp equal `ReviewerDecision.decidedAt`?** — Yes. `persistReviewStateOrThrow` wires `occurredAt = decidedAt`. (`src/adapters/review/review-state.ts:704-714`)
3. **If integration starts hours later, is that wait correctly counted as integration dwell?** — Yes. Review dwell = `decidedAt - reviewStartedAt`. Integration dwell = `integrateAt - decidedAt`. (`test/task-2376-lifecycle-timing.test.ts` R2: review=30m, integration=225m)
4. **Can `px integrate` recover a stale `active` Mission without inventing transitions?** — Yes. `promoteTaskForIntegrationIfNeeded` runs `submit-for-review` to create Review, then `approve` with `decidedAt`. (`src/adapters/cli/commands/integrate.ts:847`)
5. **What authoritative facts are required for active recovery?** — Mission in `active` status with Review aggregate (from `submit-for-review`). (`src/adapters/cli/commands/integrate.ts:924`)
6. **Can human override recovery create a real Review decision?** — Yes, through `px review`, which records `ReviewerDecision` with `decidedAt`; recovery reads from Review aggregate. `px integrate` itself has no override input channel — see the recorded R5 scope decision. (`src/adapters/review/review-state.ts:704`)
7. **Can `px integrate` recover a stale approved `review` Mission using the original approval timestamp?** — Yes. `decideMission` `approve` case uses `ReviewerDecision.decidedAt`. (`src/adapters/review/review-state.ts:714`)
8. **Can Mission `integrate` ever execute directly from `review`?** — No. `requireStatus(mission, ['integration'], command)` rejects `review` status. (`src/domain/mission-workflow.ts:139`)
9. **Can current stats derive reviewFixRounds from PR comments?** — No. `deriveImplementerAndFixRoundsFromPrComments` deleted. (`src/adapters/cli/commands/stats.ts` — 0 matches)
10. **Can current stats derive reviewFixRounds from Git history?** — No. `deriveFixRoundsFromReviewStateHistory` and `deriveFinalImplementerFromBranchHistory` deleted. (`src/adapters/cli/commands/stats.ts` — 0 matches)
11. **Can current stats derive reviewFixRounds from Backlog text?** — No. `deriveFixRoundsFromTaskText` deleted. (`src/adapters/cli/commands/stats.ts` — 0 matches)
12. **What happens when current authoritative Review data is unavailable?** — `deriveImplementerAndFixRounds` returns `{ source: 'missing-authority', implementer: 'unknown', prFixRounds: null }`. No heuristic fallback activated. (`src/adapters/cli/commands/stats.ts:391`)
13. **Does first-pass approval produce known zero?** — Yes. `reviewFixRounds = 0` (not `null`). (`test/task-2376-lifecycle-timing.test.ts` R10)
14. **Do two requested-fix cycles produce exactly two?** — Yes. `reviewFixRounds = 2`. (`test/task-2376-lifecycle-timing.test.ts` R11)
15. **Does the full verifier pass?** — Yes. `./scripts/verify-local.sh all` — 0 failures. (`CP-10.md`)

| Requirement                            | Result | Production evidence | Regression evidence | Old-bug sensitivity |
| -------------------------------------- | ------ | ------------------- | ------------------- | ------------------- |
| approval transition at Review boundary | PASS   | `mission-workflow.ts:138` `decideMission` approve case | `"R1 production: local approval path transitions Mission to integration before px integrate"` | Old bug: `new Date()` instead of `decidedAt` |
| approval timestamp = decidedAt         | PASS   | `review-state.ts:704-714` `occurredAt: decidedAt` | `"R1 production: local approval path transitions Mission to integration before px integrate"` | Wall-clock shifts dwell by hours |
| active recovery via existing workflow  | PASS   | `integrate.ts:847` `promoteTaskForIntegrationIfNeeded` | `"R4: stale active recovery chains submit-for-review then approve with original decidedAt"` | Old: manual status mutation |
| review recovery via existing approval  | PASS   | `review-state.ts:714` `occurredAt: decidedAt` | `"R3: stale review recovery uses ReviewerDecision.decidedAt for approve transition"` | Old: `new Date()` on recovery |
| human override becomes Review data     | PASS   | Recorded R5 scope decision (no `px integrate` override channel); `review-state.ts:704` reads `currentRound.decision.decidedAt` | `"recovery refuses an active Mission without authoritative Review facts"` | Old: heuristic guess |
| review→done impossible                 | PASS   | `mission-workflow.ts:139` `requireStatus(mission, ['integration'], command)` | `"R8: direct review → done forbidden — integrate requires integration status"` | Old: `['review', 'integration']` allowed shortcut |
| review dwell exact                     | PASS   | `deriveLaneIntervals` + `medianCycleTimeByStateSeries` | `"R2: delayed integration dwell — review 30m, integration 225m"` | Wall-clock: review=240m (wrong) |
| integration dwell exact                | PASS   | `deriveLaneIntervals` + `medianCycleTimeByStateSeries` | `"R2: delayed integration dwell — review 30m, integration 225m"` | Wall-clock: integration=15m (wrong) |
| PR fallback removed                    | PASS   | `grep -rn "deriveImplementerAndFixRoundsFromPrComments" src/` — 0 matches | `"R12: external artifacts with misleading values do not affect authoritative result"` | Old: PR comments overwrote Review |
| Git fallback removed                   | PASS   | `grep -rn "deriveFixRoundsFromReviewStateHistory\|deriveFinalImplementerFromBranchHistory" src/` — 0 matches | `"R12: external artifacts with misleading values do not affect authoritative result"` | Old: Git history overwrote Review |
| Backlog-text fallback removed          | PASS   | `grep -rn "deriveFixRoundsFromTaskText" src/` — 0 matches | `"R12: external artifacts with misleading values do not affect authoritative result"` | Old: Backlog text overwrote Review |
| authoritative reviewFixRounds          | PASS   | `stats.ts:391` `source: 'missing-authority'` when Review absent | `"R10: first-pass approval yields known reviewFixRounds=0"`, `"R11: two request-changes cycles yield known reviewFixRounds=2"` | Old: fabricated values from external artifacts |
| authoritative implementer              | PASS   | `stats.ts:391` `implementer: 'unknown'` when Review absent | `"R12: external artifacts with misleading values do not affect authoritative result"` | Old: branch history or assignee |
| full verifier                          | PASS   | `./scripts/verify-local.sh all` — 0 failures | `CP-10.md` | — |

All rows PASS. Mission done.
