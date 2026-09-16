# Mission: Keep integration-gate rebound from stranding a landed mission (task-2517)

## Goal
Stop the `px integrate` landing path from performing irreversible remote side effects before it has proven that lifecycle closeout can succeed, and recover the mission a rebound has stranded.

Two defects combine into one foot gun (backlog task TASK-2517):

1. **Rebound drops the lane without restoring it before landing.** A green re-run after an integration-gate rebound bounces the Mission from `integration` back to `active` through `transitionTaskFn(slug, 'active')` (`src/application/integrate/gates.ts`). The landing path then reaches `persistLandedIntegrationOrAbort` (`src/adapters/cli/commands/integrate-post.ts`), which calls `decideIntegration`. Because `decideMission('integrate')` in `src/domain/mission-workflow.ts` requires the mission to already be `integration`, `decideIntegration` rejects with `Cannot integrate while <slug> is active; expected integration.` — after the squash commit has already been pushed to the base branch, the Forgejo PR already merged, and the remote branch already deleted.
2. **Landing effects run before the closeout decision.** `createSquashLanding.squashAndLand` (`src/application/integrate/squash.ts`) performs the Forgejo sync-merge, the squash commit, and then `finishLanding` calls `persistLandedIntegrationOrAbort`, which is where `decideIntegration` runs. The remote effects precede the decision, so a rejection leaves a shipped change on the base branch, a Mission that is not `done`, a retained worktree and local branch, and a Backlog file on the mission branch that no longer matches the base branch.

After the fix, a gate rebound that re-runs green must return the Mission to `integration` at an authoritative timestamp before any landing effect runs; integration must prove the Mission can accept the `integrate` decision before pushing to the base branch, merging the review PR, or deleting the remote branch and abort with zero remote side effects when it cannot; and a mission whose work already landed but whose aggregate is stranded in `active`/`review` must be closable to `done` with a non-null `closedAt` through a supported command with worktree/branch cleanup.

## Why Now
TASK-2513 just produced the real incident: a red `integration-suite` gate during `px integrate` bounced the mission through `transitionTaskFn(slug, 'active')`, the repair re-ran green, integrate pushed squash commit `93e0b7425` to main, marked Forgejo PR #438 merged and deleted the remote branch, and only then did `decideIntegration` reject. The operator was left with a shipped change on main, a mission that is not `done`, a retained worktree and local branch, and a stale Backlog file on the mission branch. A follow-up `px review --push` then moved the aggregate to `review` and committed a stale status change on the dead branch — nothing warns that the work already landed. The defect is live and reproducible on the current `px integrate` flow; it must be closed before the next rebound lands.

## Refinement Signals
- Predicted NEL bucket: Medium (81–235)
- Confidence: High
- Selection note: activate as-is
- Main drivers: live regression from TASK-2513, irreversible-landing ordering defect, stranded-mission recovery gap, broken operator hint

## Scope
- Fix the landing ordering in `px integrate` so the Mission is restored to `integration` and the `integrate` decision is validated before any remote side effect (push to base branch, Forgejo PR merge, remote branch deletion).
- Make `persistLandedIntegrationOrAbort` / `decideIntegration` and the `github-pr` landing abort with zero remote side effects when the Mission cannot accept the integration decision.
- Add a supported closeout path that closes a mission whose squash already landed on the base branch but whose aggregate is stranded in `active` or `review` with an approved round to `done` with a non-null `closedAt`, and cleans up its worktree and local branch.
- Guard `px review` and `px active` so neither runs for a mission whose payload has already landed on the base branch, pointing at the closeout command instead.
- Replace the stale `scripts/cleanup-mission-worktree.sh` hint in `px status` (`src/adapters/cli/commands/status.ts` and `src/adapters/cli/commands/status-adapter.ts`) with a command that exists.
- Regression coverage that locks the rebound-then-land path before any fix is written.

## Out of Scope
- No changes to the review policy, reviewer eligibility, or the review-round lifecycle outside what the closeout recovery needs.
- No changes to the Forgejo provider contract, PR observation, or sync-merged transport beyond the abort ordering.
- No new integration gate keys and no change to `workflow.config.json` gate ordering.
- No changes to the `github-pr` remote mode beyond the same pre-landing validation it must share with the local mode.
- No rework of the rebound kernel budget (`src/application/rebound-kernel.ts`) beyond ensuring the rebound returns the lane to `integration`.

## Success Criteria
> **Falsifiability rule (ADR 0039 Part 2):** Each criterion is falsifiable and metric-bearing.

- [ ] SC1 After a gate rebound re-runs green, the Mission aggregate is `integration` at an authoritative timestamp before `createSquashLanding.finishLanding` runs any landing effect. Falsified if a test shows `persistLandedIntegrationOrAbort` calling `decideIntegration` against a mission whose status is `active` or `review`.
- [ ] SC2 `decideIntegration` rejects a mission that is not `integration` (e.g. `active` after a rebound) and the landing path aborts with `IntegrationAbort` before any `git push` to the base branch, Forgejo PR merge, or remote branch deletion. Falsified if a test observes a remote side effect before the decision fails.
- [ ] SC3 A stranded mission whose squash already landed on the base branch but whose aggregate is `active` or `review` with an approved round closes to `done` with non-null `closedAt` through a supported command, and its worktree and local `mission/<slug>` branch are removed. Falsified if the command leaves `closedAt` null or leaves the worktree/branch.
- [ ] SC4 `px review <slug>` and `px active <slug>` refuse to run for a mission whose payload has already landed on the base branch and emit a hint naming the closeout command. Falsified if either command proceeds or emits the stale `scripts/cleanup-mission-worktree.sh` hint.
- [ ] SC5 The stale-worktree cleanup hint in `px status` names a command that exists on disk or a real `git`/`px` command. Falsified if the hint still references `scripts/cleanup-mission-worktree.sh`.
- [ ] SC6 The regression test in SC0 fails (red) at the mission's parent commit and passes (green) after the fix, proving both the pre-landing guard (SC2) and the closeout recovery (SC3).

## Risks and Assumptions
- **Authoritative timestamp.** The restored `integration` transition must carry an authoritative time (the approval `decidedAt` or the rebound recovery entry), not the wall clock, or the review-dwell projection silently drops (assumes the existing recovery timestamp rules in `src/application/integrate/recovery.ts` apply here).
- **Idempotency.** `decideIntegration`/`close` use `idempotencyKey`-guarded lane events; the recovery closeout must reuse a stable key so a re-run does not double-emit the `integration -> done` event.
- **Local vs github-pr parity.** The pre-landing guard must apply to both the local (Variant B) landing in `squash.ts` and the `github-pr` landing in `github-pr.ts`; the local mode lands first, the github-pr mode observes an already-merged PR, so the guard must reject before the push/merge/delete in each.
- **Stranded detection.** Detecting "payload already landed on the base branch" requires a git fact (the mission branch's squash is an ancestor of the base branch / a landed commit exists on the base branch); assume a git-based check, not a file-only heuristic.
- **No silent recovery.** Recovery must not assign `Mission.status` directly; it must flow through workflow transitions (`src/domain/mission-workflow.ts`) so the lane history stays authoritative.

## Checkpoints
- CP 1: Failing reproduction test that locks the rebound-then-land regression (red at parent commit).
- CP 2: Pre-landing guard — restore the Mission to `integration` and validate the `integrate` decision before any remote side effect; abort with zero remote side effects when it cannot.
- CP 3: Stranded-mission closeout recovery with worktree/branch cleanup.
- CP 4: `px review` / `px active` landed-payload guards and the fixed `px status` hint.
- CP 5: Regression suite green, static analysis green, no focused/unannotated skipped tests.

### Checkpoint Documentation Requirements
Every checkpoint document (CP-N.md) MUST include:
- A summary of work done
- A `## Goal Check` section
- A 3-column pipe-delimited markdown table with columns: Criterion | Evidence | Status
- At least one evidence row per criterion using durable, verifiable references. Parallix already accepts:
  1. **Recognized repo commands or paths** — e.g., `` `npm test -- test/task-2517-...test.ts` ``, `` `px integrate <slug> --dry-run` ``, `` `./scripts/verify-local.sh static-analysis` ``, `` `npm run test:integration` ``
  2. **Test names** — must match a test name in the repo (see existing suites such as `test/task-2492-integrate-gate-bounce.test.ts`, `test/task-2377.03-rebound-kernel.test.ts`, `test/task-2397-integrate-active-approved-recovery.test.ts`)
  3. **Test file paths** — e.g., `test/task-2517-integrate-rebound-landing-guard.test.ts` (must be an existing test file)
  4. **ADR references** — e.g., `ADR 0039` (must correspond to an existing file under `docs/adr/`)
  5. **File:line references** — accepted when needed, but line numbers eventually rot; prefer the forms above
- Raw `stat`/`ls` output or generic prose may appear as supplemental context, but pair them with one of the accepted references above. A raw `node --import tsx ...` or `git log` dump alone is NOT enough: pair it with one of the accepted references (a test name, a test file path, an ADR, or a recognized command such as `` `npm run test:integration` ``). This is the weak-agent failure mode: `stat`/`ls`/generic prose without an accepted reference is rejected.
- A non-generic `Next action:` line at the bottom

## Gates
- [ ] ./scripts/verify-local.sh static-analysis
- [ ] npm run test:integration

## Restricted Areas
- `docs/adr/` architecture decisions (read only unless the mission changes an invariant, in which case an ADR update is required and reviewed).
- `workflow.config.json` gate ordering and `config/state-map.json` state map.
- The rebound kernel budget semantics in `src/application/rebound-kernel.ts` — the rebound still owns its per-occurrence budget; only the lane it restores may change.
- Any Forgejo transport code outside the abort ordering.

## Stop Rules
- Stop before implementing anything in the draft phase: this mission is draft-only — only the mission contract and the backlog-task labels are authored now.
- Do not author the fix during draft; the reproduction test and its `Reproduction-Test:` declaration are the only bug-specific drafting outputs.
- Do not push mission branches to `origin`; only `main` may be pushed to `origin` (review/Forgejo is the sole push target for mission branches).
- Do not run tests beyond the single `./scripts/verify-local.sh all` draft gate.
- Do not transition the task to `ready` yourself; the harness does it after a clean draft.

---
Reproduction-Test: test/task-2517-integrate-rebound-landing-guard.test.ts
