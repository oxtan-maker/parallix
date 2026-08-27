# Mission: Recognize provider approval from the assigned reviewer during integration recovery (task-2420)

## Goal
Make `px integrate` recovery authority recognize a provider `APPROVED` decision posted by the **assigned/configured reviewer** (for example `qwen`), not only the hard-coded default user (`human`), so an active Mission whose Review is already approved by that reviewer recovers to `integration`. Keep the recovery fail-closed: a missing, stale, dismissed, superseded, or wrong-reviewer provider approval must not recover the Mission.

## Why Now
TASK-2379 made the Mission lifecycle the approval authority and made recovery persist the provider approval as an authoritative `ReviewerDecision`. But the recovery authority (`recoveryEstablishesApproval` / `recoverMissionForIntegration` in `src/adapters/cli/commands/integrate.ts`, fed by `getLatestReviewDecision` in `src/adapters/forgejo/forgejo-pr.ts`) only recognizes an approval when the approving Forgejo login equals `DEFAULT_FORGEJO_USER` (`'human'`). Autonomous review posts the formal approval as the configured reviewer (`qwen`/`codex`/…), so a legitimate approved provider review plus a persisted `ReviewerDecision` leaves the Mission unintegratable: recovery aborts with "stored approval without the required provider approval". This closes that gap without weakening the fail-closed guarantee.

## Refinement Signals
- Predicted NEL bucket: Medium (81–235)
- Confidence: High
- Selection note: activate as-is
- Main drivers: recovery authority mismatch between repo default user and configured reviewer; fail-closed invariant must be preserved (ADR 0048); TASK-2379 lifecycle-authoritative recovery.

## Scope
- `src/adapters/forgejo/forgejo-pr.ts` — `getLatestReviewDecision`: recognize the qualifying `APPROVED` from the assigned reviewer's Forgejo identity in addition to the repo default user (`human`). Preserve the pre-TASK-2379 result shape for callers that compare it whole; add a reviewer-aware field rather than overwriting `defaultUserApproved`.
- `src/adapters/cli/commands/integrate.ts` — `recoveryEstablishesApproval`, `recoverMissionForIntegration`, `evaluateTaskStatusForIntegration`, and `recordHumanOverrideDecision`: route a reviewer-matched approval through the same recovery path the default-user approval currently takes, using the qualifying reviewer approval timestamp as `decidedAt`.
- `src/domain/mission-workflow.ts` — only if the already-approved-round `submit-for-review` fast path (line ~96) needs the reviewer identity to stay consistent; otherwise leave untouched.
- New focused unit test(s) under `test/` covering the assigned-reviewer approval, wrong-user rejection, and a later `REQUEST_CHANGES` superseding the approval.

## Out of Scope
- Changing who is assigned as the reviewer or how `resolveForgejoUserForIntegration` picks the login.
- The request-changes / review-loop advancement logic (`src/adapters/review/review-round.ts`).
- Non-Forgejo provider paths.
- Rewriting the existing default-user (`human`) recovery path — it must keep working (backward compatible).
- Any change outside the four areas above.

## Success Criteria
> **Falsifiability rule (ADR 0039 Part 2):** Each criterion is falsifiable; no unmetric adjectives.

- SC1 An active Mission whose last review round is `approved` by the configured reviewer (`qwen`, not `human`) recovers to `integration` under `px integrate`; the recovery returns `{ recovered: true, status: 'integration', occurredAt: <reviewerApprovalAt> }` and does not throw an IntegrationAbort.
- SC2 A stored `approved` round with no current formal provider approval still aborts recovery (red at parent commit and after fix).
- SC3 A current provider `APPROVED` posted by an unrelated user (not `human`, not the assigned reviewer) still aborts recovery.
- SC4 A later `REQUEST_CHANGES` by the assigned reviewer supersedes the earlier `APPROVED` and aborts recovery (no retracted approval is persisted as authoritative).
- SC5 The recovery decision timestamp equals the qualifying reviewer approval timestamp (`reviewerApprovedAt`), not the recovery wall clock.
- SC6 The existing recovery tests in `test/task-2397-integrate-active-approved-recovery.test.ts` still pass unchanged (no regression to the default-user path).
- SC7 `./scripts/verify-local.sh static-analysis` passes on every changed file; no `.only` and no bare `.skip` in the test tree.

## Risks and Assumptions
- `defaultUserApproved` / `defaultUserApprovedAt` is read by many callers and tests (e.g. `test/task-2397-integrate-active-approved-recovery.test.ts`, `test/forgejo.test.ts`, `test/task-2379-approval-boundary-repro.test.ts`). Assumption: add a reviewer-aware field and keep the existing properties intact so the whole-object shape used by callers does not change.
- Fail-closed invariant (ADR 0048): expanding who can recover must not open a path for an unrelated user. The assigned reviewer is derived from the recorded Review round identity, not from the caller-supplied context, so it cannot be forged.
- The assigned reviewer stored in the round is an `AgentFamily` (`src/domain/review.ts`); the Forgejo login is resolved via `resolveForgejoUserForIntegration(taskAssignee)`. The mapping between the two must be handled without trusting untrusted input.
- `getLatestReviewDecision` sorts reviews and treats a later `REQUEST_CHANGES` by the same user as superseding; the reviewer-matched logic must reuse that same supersedes rule.

## Checkpoints
- CP 1: Failing reproduction test that locks the bug (red at the mission parent commit) before any fix.
- CP 2: Fix `getLatestReviewDecision` to recognize the assigned reviewer's `APPROVED` and propagate its timestamp.
- CP 3: Wire the reviewer-matched approval through `recoverMissionForIntegration` / `recoveryEstablishesApproval` and add focused unit tests (assigned-reviewer green, wrong-user red, later `REQUEST_CHANGES` red).
- CP 4: Run the verification gate on the final tree, capture proof, and fill the Goal Check table.

### Checkpoint Documentation Requirements
Every checkpoint document (CP-N.md) MUST include:
- A summary of work done
- A `## Goal Check` section
- A 3-column pipe-delimited markdown table with columns: Criterion | Evidence | Status
- At least one evidence row per criterion using durable, verifiable references. Parallix already accepts:
  1. **Recognized repo commands or paths** — e.g., `` `node --import tsx test/task-2420-integrate-recovery-assigned-reviewer.test.ts` ``, `` `px integrate task-2420 --dry-run` ``, or `` `./scripts/verify-local.sh static-analysis` ``
  2. **Test names** — must match a test name in the repo, e.g. `"task-2420: active approved review by assigned reviewer recovers to integration"`
  3. **Test file paths** — must be an existing test file, e.g. `test/task-2420-integrate-recovery-assigned-reviewer.test.ts` or `test/task-2397-integrate-active-approved-recovery.test.ts`
  4. **ADR references** — must correspond to an existing file under `docs/adr/`, e.g. `ADR 0048` (fail-closed harness), `ADR 0039` (falsifiability)
  5. **File:line references** — accepted when needed, but line numbers eventually rot; prefer the forms above
- Raw `stat`/`ls` output or generic prose may appear as supplemental context, but pair them with one of the accepted references above. Concretely: a raw `ls test/` or `git grep` dump is NOT enough on its own — pair it with the exact accepted reference (a test name that exists, a test file path that exists, an ADR number that exists, or a recognized command/path). This is the weak-agent failure mode: a raw shell dump or generic prose like "the fix works" reads as evidence but proves nothing.
- A non-generic `Next action:` line at the bottom

Example Goal Check table:

| Criterion | Evidence | Status |
|---|---|---|
| Draft prompt defines checkpoint evidence rules | `prompts/draft.md` | PASS |
| Repair loop has targeted incomplete-evidence coverage | `test/repair-handoff.test.ts`, `"buildRelaunchPrompt returns string containing Goal Check table and mission slug"` | PASS |
| Verification gate ran | `./scripts/verify-local.sh docs` | PASS |

## Gates
- [ ] ./scripts/verify-local.sh static-analysis
- [ ] npm run test:integration
- [ ] ./scripts/verify-local.sh all

## Restricted Areas
- Do not change `resolveForgejoUserForIntegration`'s login selection (`src/adapters/cli/commands/integrate-post.ts`).
- Do not change the NEL capture path (`captureNelAtHandoff` / `recordNel`) — recovery is not a handoff.
- Do not alter the Backlog task classification frontmatter or the `assignee` field.
- Do not add new dependencies or new top-level configuration.

## Stop Rules
- Stop if the reviewer→Forgejo-login mapping requires trusting caller-supplied input; instead derive the assigned reviewer from the recorded Review round (fail-closed).
- Stop editing if any test in `test/task-2397-integrate-active-approved-recovery.test.ts` regresses — the default-user path is in scope to preserve, not rewrite.
- Stop before implementing once the draft is verified; this mission is draft-only — no feature, no fix, no review/execute/integrate phase.

<!-- BUG-LABELED: first checkpoint authors a failing reproduction test. -->
Reproduction-Test: test/task-2420-integrate-recovery-assigned-reviewer.test.ts
