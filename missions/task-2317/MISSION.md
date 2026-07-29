# Mission: Compact Context at Mission and Review Boundaries (task-2317)

## Goal
Make the mission workflow explicitly compact an agent's context at all three long-running mission boundaries: after every completed mission-declared verification gate, when an implementer transitions from implementation into `act-on-review`, and before a reviewer begins each review round after the first. The implementation-to-review compaction requirements must still apply when `MISSION.md` declares no gates.

## Why Now
Mission execution can accumulate unnecessary context across verification gates and across the autonomous review loop. Many changes do not have useful mission-declared gates, so a gate-only instruction would leave two high-context paths uncovered: an implementation agent continuing into `act-on-review`, and the same reviewer taking a second or later review round. The workflow needs durable, independently testable compaction requirements at each boundary without losing the evidence required by the next phase.

## Refinement Signals
- Predicted NEL bucket: Small (0–80)
- Confidence: High
- Selection note: activate as-is
- Main drivers: mission workflow prompt/instruction change; gate, implementation-to-review, and repeated-review context boundaries; verification and documentation evidence

## Scope
- Locate the mission workflow instructions and orchestration paths that govern:
  1. behavior immediately after a mission-declared verification gate succeeds;
  2. an implementation agent entering `act-on-review`; and
  3. a reviewer agent beginning review round 2 and every later review round.
- Add an explicit compaction requirement at each boundary before the agent performs work in the next phase or round.
- Treat the three triggers independently. In particular, implementation-to-`act-on-review` and repeated-review compaction must not depend on a `MISSION.md` `## Gates` entry existing, running, or succeeding.
- Preserve only the durable context needed after each compaction: the locked mission goal and scope, committed checkpoint or gate evidence when present, current review round and disposition, unresolved findings and implementer resolutions, and the exact revision being reviewed.
- Add focused automated coverage for all three boundaries, including a mission with no declared gates and a reviewer continuing into round 2.
- Update workflow documentation if it describes agent behavior at gate, `act-on-review`, or review-round boundaries.

## Out of Scope
- Changing the commands that constitute verification gates or their pass/fail semantics.
- Compacting context before a gate has completed or when a gate fails.
- Requiring a mission to declare a gate merely to trigger implementation-to-`act-on-review` or repeated-review compaction.
- Redesigning mission phases, checkpoint file format, or the broader token-budget policy.
- Changing source code unrelated to mission workflow instructions, their tests, and directly affected documentation.

## Success Criteria
> **Falsifiability rule (ADR 0039 Part 2):** Each criterion must be falsifiable. Forbidden: subjective adjectives ("easy, fast, simple, intuitive, user-friendly, responsive, quick, efficient" without an attached metric) and vague quantifiers ("multiple, several, some, many, few, various"). For refactor / condense / migration missions, the criterion must enumerate the specific elements (rules, files, behaviours) that must survive — generic phrases like "preserve critical content" are not sufficient.

- After every successful mission-declared verification gate, the workflow explicitly directs the executing agent to compact context before continuing; a failed gate does not trigger that compaction.
- When an implementation agent transitions into `act-on-review`, the workflow explicitly directs that implementer to compact implementation context before acting on findings, even when `MISSION.md` has no declared gate.
- Before the same reviewer begins review round 2 or any later round, the workflow explicitly directs that reviewer to compact the prior round's working context and reload the durable review state for the new round.
- Each compact instruction identifies the durable state that survives or is reloaded: locked mission goal and scope; committed checkpoint or gate evidence when present; current round, disposition, unresolved findings, implementer resolutions, and reviewed revision when applicable.
- Focused automated coverage separately names and verifies the successful-gate path, the no-declared-gates implementation-to-`act-on-review` path, and the reviewer round-2 path.
- Focused automated coverage verifies that repairable error bounce-backs compact before the relaunched agent starts repair work and retain the failure diagnostic and retry state.
- Focused automated coverage verifies that review-round compaction after a successful rebase reloads the rewritten branch revision and post-rebase review baseline rather than retaining the pre-rebase revision.
- `./scripts/verify-local.sh all` completes successfully on the final tree.
- Any documentation that states gate, `act-on-review`, or review-round behavior describes the matching compaction requirement and makes clear that review-loop compaction does not depend on `MISSION.md` gates.

## Risks and Assumptions
- Risk: compacting at the wrong boundary could discard information needed to repair a failed gate. Assumption: the instruction is emitted only after the workflow records a successful gate result.
- Risk: a gate-only implementation would appear complete while leaving missions without declared gates unchanged. Assumption: the implementation-to-`act-on-review` and repeated-review triggers are implemented and tested independently of gate parsing or execution.
- Risk: repeated compaction could erase live review findings or cause the reviewer to compare the wrong revision. Assumption: the workflow persists and reloads the current round, disposition, findings, resolutions, and reviewed revision before work resumes.
- Risk: an overly broad prompt change could affect non-mission workflows. Assumption: implementation will identify and limit the change to the three mission boundaries in Scope.
- Risk: weak proof could claim behavior without checking generated instructions and transition order. Assumption: focused tests will assert both the compaction content and its position before `act-on-review` work and round-2 review, and checkpoint evidence will cite the test name and source location.

## Corner Cases
- **Pre-review gate failure auto-bounce:** A failed gate does not satisfy the successful-gate compaction trigger, but an implementer relaunched to repair that failure still starts from compacted context. Reload the captured gate output, failure classification, retry count, mission contract, and current branch revision before repair work; do not carry the aborted reviewer-round working context.
- **Handoff, validation, checkpoint, or artifact repair bounce:** Any repairable error that returns work to an implementer compacts before the repair attempt, including repeated bounded retries. Preserve the exact diagnostic, requested repair, retry count, committed checkpoint state, and current review disposition. A human-only or stranded failure stops without pretending compaction made the workflow resumable.
- **Reviewer or implementer recovery relaunch:** Timeout, incomplete-artifact, invalid-artifact, or stale-disposition recovery must not reuse an unbounded failed-attempt context. Compact before the recovery attempt and reload the same round identity, current revision, unresolved findings or required artifact, and retry counter so recovery neither advances nor silently resets the round.
- **Successful rebase before review:** Rebase first, capture the rewritten branch revision and fresh review baseline, persist them, then compact before launching or resuming the reviewer. The compacted reviewer must not retain a pre-rebase SHA, diff, finding, or file-state assumption.
- **Rebase conflict or failure:** Do not start reviewer-round compaction or consume a review round when rebase fails. If the workflow bounces conflict repair to an implementer, that repair launch follows the error-bounce rule and reloads the conflict diagnostics and current Git state.
- **Rebase between later rounds:** The same reviewer taking round 2 or later compacts after the round's successful rebase and post-rebase baseline capture, then reloads prior findings and implementer resolutions against the rewritten revision.
- **Adjacent triggers:** When a successful gate, rebase, and phase/round transition occur back-to-back, the implementation may coalesce redundant compactions only if one compaction occurs after the last state-changing operation and reloads every durable item required by all applicable triggers.
- **Fresh replacement agent:** If fallback selects a genuinely fresh agent session with no inherited working context, no redundant compaction command is required, but the workflow must provide the same durable reload state and tests must distinguish this from resuming the original agent.

## Checkpoints
- CP 1: Inspect the mission gate, implementation-to-`act-on-review`, repeated-review, error-bounce, recovery-relaunch, and rebase workflow paths; identify the exact instruction, prompt, or orchestration point for each; and record current behavior for a mission with declared gates and one without them using file:line evidence.
- CP 2: Add the independent compaction requirements and corner-case ordering, retaining or reloading the durable mission, gate/checkpoint, diagnostic/retry, finding/resolution, round/disposition, and post-rebase revision/baseline state required after each boundary.
- CP 3: Add or update focused tests for successful-gate compaction, no-declared-gates implementation-to-`act-on-review` compaction, reviewer round-2 compaction, a repairable error bounce, a recovery relaunch, and post-rebase reviewer compaction; update directly affected workflow documentation; and run the required verification gate.

### Checkpoint Documentation Requirements
Every checkpoint document (CP-N.md) MUST include:
- A summary of work done
- The exact heading `## Goal Check`
- The exact 3-column pipe-delimited Markdown table header `| Criterion | Evidence | Status |`
- At least one evidence row per criterion using verifiable references. Parallix already accepts:
  1. **File:line references** — e.g., `lib/commands/handoff.ts:292` (must point to an existing file and line)
  2. **Test names** — e.g., `"real custom-agent launcher smoke: full lifecycle with hello-world task (SC3/SC4/SC5/SC6/SC7)"` (must match a test name in the repo)
  3. **Test file paths** — e.g., `test/e2e-real-agent-smoke.test.ts` (must be an existing test file)
  4. **ADR references** — e.g., `ADR 0048` (must correspond to an existing file under `docs/adr/`)
  5. **Recognized repo commands or paths** — e.g., `` `npm ...` ``, `` `node ...` ``, `` `git ...` ``, `` `px ...` ``, or `` `./...` ``
- Raw `stat`/`ls` output or generic prose alone is not evidence. It may appear as supplemental context only when paired with at least one accepted reference above.
- A non-generic `Next action:` line at the bottom

Example Goal Check table:

| Criterion | Evidence | Status |
|---|---|---|
| Draft prompt defines checkpoint evidence rules | `prompts/draft.md:28` | PASS |
| Repair loop has targeted incomplete-evidence coverage | `test/repair-handoff.test.ts`, `"buildRelaunchPrompt returns string containing Goal Check table and mission slug"` | PASS |
| Verification gate ran | `./scripts/verify-local.sh docs` | PASS |

## Gates
- [ ] ./scripts/verify-local.sh all

## Restricted Areas
- Do not change gate commands, integration-pipeline configuration, checkpoint table schema, backlog assignee, or unrelated agent/prompt workflows.
- Do not introduce networked or real-Forgejo access in tests; unit tests must mock dependencies and remain fast.
- Do not modify generated graph artifacts except through the required graph update if source code changes during implementation.

## Stop Rules
- Stop and request direction if the only viable implementation changes compaction behavior for failed gates, non-mission workflows, or the global context-retention policy.
- Stop and request direction if preserving or reloading the mission goal and scope, successful-gate/checkpoint evidence when present, current review state, unresolved findings and resolutions, or reviewed revision cannot be guaranteed at the applicable compaction boundary.
- Stop and request direction if compaction cannot be ordered after a successful rebase and post-rebase baseline capture, or if a repair bounce cannot retain its exact diagnostic and retry state.
- Stop and request direction if the required verification gate cannot run because of failures unrelated to the mission change; capture the failing command and affected path/test name.
