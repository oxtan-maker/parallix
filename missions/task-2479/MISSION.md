# Mission: Rebuild px integrate as the human trust decision and concise landing record (task-2479)

## Goal
Rebuild the default `px integrate` operator output so it leads with the human trust decision and ends with a concise landing record, instead of dumping implementation-level preflight and full weekly/telemetry reporting on the happy path.

Concretely, the command must present, in this order:
1. A concise readiness/evidence view before landing: mission, review approval, reviewer, independence (agent family), verification, target branch, workspace cleanliness — showing only claims Parallix can establish authoritatively.
2. The actual landing operation and its result: the destination branch and the landed SHA transition `<before> → <after>`, plus a summarized cleanup status.
3. Required stats/telemetry recording stays intact but is no longer printed in full by default; it moves behind `px stats`, an explicit flag, `DEBUG`, or another existing analytical surface.

The user's invocation of `px integrate` itself is the human decision; the command must not fabricate a "human inspected diff" claim.

## Why Now
The current first-value recording's integration phase begins with useful facts then expands into implementation-level preflight and reporting, inverting the desired information hierarchy:

- `[INFO] Integration preflight for parallix-adhoc-0001`
- `[PASS] Mission branch: ...`, `[PASS] Mission doc: ...`, `[PASS] Backlog task: ...`, `[PASS] Mission classification: unknown`, `[PASS] Backlog status follows the Mission lifecycle ...`
- `[INFO] Forgejo PR/approval checks skipped ...`
- `[PASS] Integration checkout branch: ... is on main`, `[PASS] Integration checkout conflicts: no unresolved merge entries ...`, `[PASS] Integration checkout dirty state: clean`
- After integration, the full weekly stats/reporting payload is dumped into the hero path (weekly agent performance, spend by stage, previous-week comparison, full mission telemetry table).
- The cast returns to `[INFO] Step 7: Cleaning up the local mission worktree...`, `[INFO] No existing graphify graph found...`, `[PASS] Integration completed successfully.`, `[INFO]`, then `[INFO] Next: cd ...`.

Specific defects from the current cast to address:
- Full weekly statistics dumped during integration.
- Full mission phase telemetry dumped during integration.
- `Mission classification: unknown` visually elevated despite not helping the integration decision.
- DB/backlog authority wording exposed to a first-time user.
- Forgejo-disabled plumbing exposed.
- Preflight shows many `[PASS]` lines of equal priority rather than a concise readiness result.
- Cleanup narrated as `Step 7`.
- Graphify absence exposed.
- Empty `[INFO]` line before `Next: cd`.
- Final output does not prominently show the landed commit/revision transition.
- Approval/reviewer evidence less prominent than incidental implementation checks.

Stats are useful but are not the primary result of `px integrate`. They belong behind an explicit analytical surface.

## Refinement Signals
- Predicted NEL bucket: Medium (81–235)
- Confidence: High
- Selection note: activate as-is
- Main drivers: user-facing `px integrate` output presentation; the same `integrate` command and `recordPostIntegrationStats` path that the first-value recording exercises; no new feature or API.

## Scope
- Default `px integrate` preflight presentation: recompute the concise readiness/evidence view (review approval, reviewer, independence, verification, target, workspace clean) without weakening any check.
- Integration gate presentation: keep gates visible at the level needed to know what ran and whether they passed; a failed gate stays loud and blocks landing.
- Landing/squash result presentation: make landing the primary output and prominently show the destination branch and landed SHA transition `<before> → <after>`.
- Post-integration stats success presentation: keep required telemetry/statistics recording, but remove the automatic full weekly-report and mission-telemetry-table dumps on the success path; keep stats failure visible (fail-closed).
- Cleanup/final summary presentation: summarize cleanup without numbered internal steps; silence graphify absence on an ordinary successful path; remove the empty `[INFO]` line before `Next: cd`.
- Explicit review approval / verification evidence where already authoritative (Mission store review, Forgejo approval, integration-gate pass).
- Re-record / re-render the first-value demo (cast + GIF) and inspect it.
- Focused direct tests for the changed presentation paths.

## Out of Scope
- Changing what conditions permit integration unless replay discovers an actual correctness bug.
- Weakening mandatory integration gates.
- Automatically merging without explicit `px integrate`.
- Claiming the operator inspected the diff.
- Redesigning `px stats` itself.
- Review or act-on-review output.
- Moving stats recording out of the transaction/closeout semantics merely to silence it.

## Success Criteria
> **Falsifiability rule (ADR 0039 Part 2):** Each criterion is falsifiable; no unqualified subjective adjectives.

1. The first-value cast makes it obvious that `px integrate` is the human-triggered landing decision (observable in the re-recorded cast/GIF, not merely asserted).
2. Before landing, the user sees concise authoritative evidence for review approval, verification, and target readiness — no more than the claims Parallix can establish (Mission store/Forgejo/integration-gates/git).
3. Incidental DB/backlog/provider implementation details do not dominate the happy path: `px integrate` on a normal success path must not print the DB authority wording, the Forgejo-disabled notice, or a numbered "Step N" cleanup line.
4. Full weekly reports are not printed by default during successful integration: `recordPostIntegrationStats` no longer emits the full weekly report body on the success path.
5. Full mission telemetry tables are not printed by default during successful integration.
6. Required telemetry/statistics are still recorded: `recordPostIntegrationStats` still calls the measurement store (PARALLIX_HOME/parallix.db) and the mission-completion row is still persisted.
7. Stats recording failure retains its current required failure semantics: `recordPostIntegrationStatsOrAbort` still throws `IntegrationAbort` on failure, landing still blocks.
8. Integration gates remain visible at the level needed to know what ran and whether they passed; a failed gate still blocks landing.
9. A failed gate remains loud and blocks landing (unchanged fail-closed behavior).
10. Successful landing clearly identifies the destination branch and landed revision/SHA transition (`<before> → <after>`).
11. Successful cleanup is summarized without numbered internal steps.
12. Graphify absence is silent on an ordinary successful path.
13. No empty/malformed status lines remain (the empty `[INFO]` line before `Next: cd` is removed).
14. The final cast and GIF are re-recorded/rendered and inspected (real `.cast` and GIF paths cited in the final checkpoint).
15. Focused integrate tests run directly and pass.
16. Full repository gate passes.

## Risks and Assumptions
- Stats recording is an architectural requirement for closeout (TASK-2378); assume it must stay and stay fail-closed. We only change what is *printed*, not what is recorded.
- The landed SHA transition `<before> → <after>` requires reading the pre-integration base-branch tip and the post-squash HEAD; assume both are readable via git in the base worktree.
- Readiness evidence must be authoritative only: assume approval comes from Mission store review (ADR 0053) or Forgejo decision (ADR 0048 fail-closed), verification from integration gates, independence from agent family.
- Changing `recordPostIntegrationStats` output affects existing tests in `test/integrate.test.ts` (e.g. `recordPostIntegrationStats prints mission-phase telemetry after weekly stats`); assume those tests must be updated to match the new summarized behavior, not deleted to weaken coverage.
- The exact layout is implementation-owned; assume the operator-facing text is free-form as long as it carries the required claims.
- Assumption: replay of the real first-value recording is the acceptance evidence; dry-run or synthetic output is not acceptable as final proof.

## Checkpoints
- CP 1 — Integration replay inventory: inspect the existing cast and classify every integration line as human decision evidence / integration progress / diagnostics / analytics / anomaly.
- CP 2 — Readiness presentation: recompose preflight into a concise evidence-based readiness view without weakening checks.
- CP 3 — Landing and stats separation: make landing the primary output; retain stats recording but remove automatic analytical report dumps.
- CP 4 — Cleanup and final record: produce a concise final landing record with destination revision and cleanup status.
- CP 5 — Real replay closure: re-record, inspect raw cast and GIF, fix all in-scope issues, run focused files directly, then repository gates.

### Checkpoint Documentation Requirements
Every checkpoint document (CP-N.md) MUST include:
- A summary of work done
- A `## Goal Check` section
- A 3-column pipe-delimited markdown table with columns: `| Criterion | Evidence | Status |`
- At least one evidence row per criterion using durable, verifiable references. Parallix already accepts, in priority order:
  1. **Recognized repo commands or paths** — e.g., `` `px integrate <slug> --dry-run` ``, `` `npm test -- test/integrate.test.ts` ``, `` `node --import tsx test/e2e-mission-lifecycle.test.ts` ``, `` `./scripts/verify-local.sh all` ``, or the exact first-value recording command.
  2. **Test names** — e.g., `"recordPostIntegrationStats prints mission-phase telemetry after weekly stats"` (must match a test name in `test/integrate.test.ts`).
  3. **Test file paths** — e.g., `test/integrate.test.ts` (must be an existing test file).
  4. **ADR references** — e.g., `ADR 0041` (integration pipeline gates), `ADR 0048` (fail-closed harness defense), `ADR 0053` (operational persistence and authority boundaries) — must correspond to an existing file under `docs/adr/`.
  5. **File:line references** — accepted when needed, but line numbers eventually rot; prefer the forms above.
- Raw `stat`/`ls` output or generic prose alone is NOT enough: pair any shell output with one of the accepted references above. This is the weak-agent failure mode — an agent that pastes `ls`/`stat` dumps or says "output looks cleaner" without a test name, ADR, recognized command, or test file path fails the checkpoint.
- A non-generic `Next action:` line at the bottom.

Example Goal Check table:

| Criterion | Evidence | Status |
|---|---|---|
| Draft prompt defines checkpoint evidence rules | `prompts/draft.md` | PASS |
| Stats recording still persists the mission-completion row | `test/integrate.test.ts`, `"recordPostIntegrationStats logs the persisted stats row including pr_fix_rounds"` | PASS |
| Verification gate ran | `./scripts/verify-local.sh all` | PASS |

## Gates
- [ ] ./scripts/verify-local.sh all
- [ ] ./scripts/verify-local.sh static-analysis

## Restricted Areas
- Do not modify the integration gate *logic* or the fail-closed merge/verification invariants: `src/adapters/cli/commands/integrate-gates.ts`, `src/adapters/config/repository-gates.ts`, and the `decideIntegration`/`close` path in `src/application/mission-integration-service.ts` — only their presentation output, and only if replay surfaces a genuine defect.
- Do not change what conditions permit integration: `src/adapters/cli/commands/integrate.ts` control flow (the merge/squash/closeout sequence) is out of scope except for output lines.
- Do not redesign `px stats`: `src/application/stats-command-use-case.ts`, `src/application/services/statistics-service.ts`, `src/adapters/cli/commands/stats.ts`.
- Do not touch the real Forgejo network path beyond skipping the already-existing Forgejo-disabled notice on the happy path.
- Do not add new dependencies or new public CLI flags beyond existing ones.

## Stop Rules
- Stop before implementing: this document is a mission contract only; do not edit source outside `MISSION.md` and the backlog task file.
- Stop if replay would require touching integration gate logic or weakening a mandatory gate — that is out of scope.
- Stop if the required stats recording cannot be kept fail-closed; escalate rather than silence it.
- Do not transition the task to `ready`; the harness does that after a clean draft.
