# Mission: REQUEST_CHANGES → act-on-review → re-review as a first-class trust loop (task-2478)

## Goal
Make the `REQUEST_CHANGES → act-on-review → re-review → APPROVED` trust loop a first-class, operator-visible outcome in Parallix: the reviewer's concrete finding, the implementer's response to that exact finding, the actual tree change, the post-fix verification rerun, the second review of the revised revision, and the final approval associated with the later round — all presented as one causal chain the operator can read without opening internal artifact files.

Acceptance is a deterministic production-seam replay of the review + act-on-review path, with no direct state injection. It proves both the ordinary immediate-`APPROVED` path and a correction path that reaches `REQUEST_CHANGES`, is acted on, re-reviewed, and approved. Recording live agent demos or transcripts is optional and is not an integration blocker.

## Why Now
The current first-value recording produced a genuine `REQUEST_CHANGES` round, but it is not a stable demonstration. The transcript shows the state machine (`Round 1: reviewer outcome = REQUEST_CHANGES`, `launching implementer … for act-on-review`, `implementer disposition = CHANGES_MADE`, `implementer made changes. Continuing to round 2`) but does not tell the operator what the reviewer objected to, what the implementer changed, whether the change addressed the finding, whether verification passed afterward, or whether the second review approved the revised code.

Strong agents usually solve the Hello World task in one pass, so a demo that depends on an agent randomly making a mistake is not reproducible. We need a small, nontrivial, deterministic scenario that reliably produces a meaningful reviewer finding — without sabotaging the implementer or injecting a fake finding — plus operator presentation that exposes the causal chain.

## Refinement Signals
- Predicted NEL bucket: Medium (81–235)
- Confidence: Medium
- Selection note: workflow/prompt/presentation + deterministic correction replay; classified `ai_sdlc` (ADR 0047 NEL basis).
- Main drivers: reviewer-finding visibility, act-on-review causal presentation, and revision-integrity guarantees.

## Scope
- Operator-facing presentation for the correction path: `REQUEST_CHANGES` with concrete findings → `ACTING ON REVIEW` (implementer identity + finding) → `✓ F1 addressed` / `✓ verification passed` → `Re-reviewing revised implementation…` → `APPROVED · round 2`. Exact wording is implementation-owned; the causal relationship is not.
- The deterministic correction scenario: a small but nontrivial demo problem (a tiny CLI/string utility with at least one objectively reviewable edge case) that proves the review loop handles a concrete finding from code/tests/contract and keeps the fix legible in a terminal diff. It must not rely on random agent failure or inject review state.
- Revised-tree verification presentation: verification reruns against the changed tree and failed verification cannot silently advance to re-review.
- Round-transition presentation and re-round review presentation.
- Focused tests proving stale approval / stale-revision mixups cannot masquerade as a successful correction (e.g. an earlier-round approval cannot satisfy the later round; `CHANGES_MADE` disposition alone is not proof the finding was resolved).
- Regression-run the ordinary first-value Hello World demo to confirm it still takes the immediate-`APPROVED` path.

## Out of Scope
- Forcing the main README Hello World demo to fail review.
- Injecting reviewer findings directly into SQLite/state files for demo setup.
- Making reviewer prompts intentionally hostile or incorrect.
- Broad review-loop redesign unrelated to the correction path.
- Integration output (Forgejo PR output is out of scope; the loop runs against local review artifacts when the provider is disabled).

## Success Criteria
> **Falsifiability rule (ADR 0039 Part 2):** Each criterion is falsifiable and free of unqualified subjective adjectives.

1. A deterministic production-seam replay for the chosen correction scenario reaches `REQUEST_CHANGES` through `recordRequestedChanges` in `src/adapters/review/review-round.ts`, not by writing fixture state.
2. The reviewer finding is concrete and visible before `act-on-review` starts: `renderReviewVerdict` emits `====== CHANGES REQUESTED ======` and at least one `Blocking finding: <text>` line (see `src/adapters/review/review-loop.ts`) before the implementer is launched.
3. The finding flows through the reviewer path (`consumeReviewerArtifacts` / `recordRequestedChanges`), not from a written SQLite/state file.
4. The `act-on-review` invocation and its finding context remain visible in the loop output.
5. The operator can tell which specific finding the implementer is addressing — the act-on-review presentation names the finding id/summary (e.g. `Finding F1: …`).
6. The implementation tree changes after the finding: a new committed revision hash is recorded (`beginNextReviewRound` / `changeRevision` in `src/domain/review.ts`) and the second review evaluates that revised revision, not the pre-fix tree.
7. Verification reruns against the revised tree after the correction; a failed verification run does not advance the loop to re-review.
8. Re-review evaluates the later round/revised revision; an earlier-round `APPROVED` cannot satisfy the later round.
9. Final approval is clearly associated with the later round (presentation shows `APPROVED · round 2` or equivalent, and the persisted `round`/`revision` match the approved tree).
10. The terminal loop is understandable without inspecting internal artifact filenames (`review-events/`, artifact dirs) — the causal chain is in the console output.
11. The ordinary first-value Hello World path still completes with immediate `APPROVED` in the regression replay.
12. Focused review-loop tests run directly and pass (no `.only`, no bare `.skip`).
13. Full repository gate passes (`./scripts/verify-local.sh all`).
14. The deterministic replay verifies all six correction checks: finding visible before implementer, implementer receives that finding context, code changes after the finding, verification reruns against the changed tree, the second decision follows the fix, and final approval is for the revised revision.
15. All replay defects are documented under `## Demo Replay Findings`.

## Risks and Assumptions
- The replay must not write findings, dispositions, revisions, or approvals directly into persistence; all transitions flow through the Review aggregate.
- A live recording may be added later as supplementary product evidence, but it is not required for this mission.
- Presentation changes must not regress the existing `renderReviewVerdict` contract asserted by `test/task-2477-review-presentation.test.ts` (APPROVED-before-stop ordering, REQUEST_CHANGES emits no APPROVED line, verbose poll/timeout lines).
- ADR 0053: the Review aggregate is the sole write authority for review state; any revision/integrity wiring must persist through `store.save`, never by overwriting flat review-state.
- ADR 0048: fail-closed — stale-approval defenses must not be openable by an agent hallucinating an approval.

## Checkpoints
- CP 1 — Design deterministic correction scenario: choose and prove a small task that exercises the correction path without fake state injection.
- CP 2 — Finding-first presentation: make `REQUEST_CHANGES` and concrete findings the visible cause for `act-on-review`.
- CP 3 — Correction and revised verification: show implementer correction, actual revision change, and post-fix verification.
- CP 4 — Re-review and revision integrity: prove the second decision evaluates the revised tree and cannot reuse stale approval.
- CP 5 — Replay closure: run the deterministic correction replay and the ordinary immediate-approval regression; document replay verification.

### Checkpoint Documentation Requirements
Every checkpoint document (CP-N.md) MUST include:
- A summary of work done
- A `## Goal Check` section
- A 3-column pipe-delimited markdown table with columns: `| Criterion | Evidence | Status |`
- At least one evidence row per criterion using durable, verifiable references. Parallix already accepts:
  1. **Recognized repo commands or paths** — e.g., `` `./scripts/verify-local.sh all` ``, `` `npm test -- test/review.test.ts` ``, `` `px review <slug> --verify` ``, `` `git -C <worktree> log --oneline -3` ``
  2. **Test names** — must match a real test name in the repo, e.g. `"verdict prominence: APPROVED emitted before the review-stopped transition line"` (from `test/task-2477-review-presentation.test.ts`)
  3. **Test file paths** — must be an existing test file, e.g. `test/review.test.ts`, `test/review-commands.test.ts`, `test/task-2477-review-presentation.test.ts`, `test/e2e-real-agent-smoke.test.ts`
  4. **ADR references** — must correspond to an existing file under `docs/adr/`, e.g. `ADR 0053` (persistence authority), `ADR 0057` (verification tiers), `ADR 0048` (fail-closed harness)
  5. **File:line references** — accepted when needed, but line numbers eventually rot; prefer the forms above
- Raw `stat`/`ls` output or generic prose may appear as supplemental context, but they are **not sufficient on their own**. The weak-agent failure mode to defeat: an agent pastes bare `ls`/`stat`/`git log` output or free-form "the tests pass" prose and stops. Pair every such shell snippet with one of the accepted references above — cite the exact test name or file path the output proves, or the exact command that was run. Prose claims without a test name, file path, ADR, or recognized repo command are rejected.
- A non-generic `Next action:` line at the bottom

Example Goal Check table:

| Criterion | Evidence | Status |
|---|---|---|
| Draft prompt defines checkpoint evidence rules | `prompts/draft.md` | PASS |
| REQUEST_CHANGES presentation emits concrete blocking findings | `src/adapters/review/review-loop.ts`, `"non-APPROVED persisted state emits no APPROVED presentation"` | PASS |
| Verification gate ran | `./scripts/verify-local.sh all` | PASS |

## Gates
- [ ] ./scripts/verify-local.sh all

## Restricted Areas
- The ordinary first-value Hello World demo must keep its immediate-`APPROVED` path; do not route it through the correction scenario.
- Persistence: do not write reviewer findings, dispositions, revisions, or approvals directly into SQLite or review-state files as demo setup. All review state flows through the Review aggregate (`src/domain/review.ts`) and `store.save` (ADR 0053).
- Reviewer prompts: do not hardcode the edge-case answer or make the reviewer hostile; correction evidence must flow through the production reviewer artifacts and Review aggregate.
- Test hygiene: no `.only`, no bare `.skip`, no unannotated skipped tests (DOD #3).
- Do not inject the correction result at the state layer; the loop must run end to end.

## Stop Rules
- Stop before implementing if the deterministic replay cannot reach `REQUEST_CHANGES` without direct state injection; document the limitation instead of injecting a finding.
- Stop and escalate if a stale-approval defense must be added but the Review aggregate offers no seam to enforce it without violating ADR 0053.
- Do not proceed to CP 5 until CP 1–4 evidence rows each cite an accepted reference form.
- Do not claim a finding was fixed because the implementer said so; require the revised-tree verification and round-2 decision as evidence.
- Do not push the mission branch to `origin` (local-only; `review` remote is the sole push target for mission branches).
