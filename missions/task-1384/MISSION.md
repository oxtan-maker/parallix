# Mission: Research and decide fail-closed harness defense against agent hallucinations (task-1384)

## Goal

Produce an ADR that recommends how Parallix should defend the codebase specifically against agent hallucinations and incomplete work by detecting incomplete/invalid handoffs mechanically and sending the mission back to the implementer automatically when possible.

The ADR must answer one practical workflow question: given Parallix's current harness, which checks already exist, which missing checks should be added, and which harness outcomes should trigger an automatic send-back or repair path instead of consuming reviewer/human time.

## Why Now

Parallix already has several partial defenses against bad agent output, but they are scattered across commands and missions rather than expressed as one coherent harness policy. Some work is already fail-closed: exact-tree verification proof, gatekeeper mandatory-artifact checks, integration gates, checkpoint requirements, and review loops. But the current harness still leaves obvious hallucination paths:

- some checks happen too late, after reviewer time has already been spent
- some gate text is prose rather than runnable command, so "the gate passed" is not trustworthy
- some incomplete or malformed handoffs strand instead of auto-returning to the implementer
- `repair-handoff.js` handles only a narrow subset of mechanical failure classes
- the repo has no single decision saying which classes of "incomplete task" should bounce automatically, which should be repaired automatically, and which genuinely require human intervention

This mission exists to consolidate the current evidence into one decision and one prioritized backlog for fail-closed harness behavior against agent hallucinations.

It must also correct the hallucinated backlog child-task slugs created during refinement: Backlog in this repo supports integer task IDs only, so the invalid `task-1384.01`-style children must be renumbered to real integer slugs as part of the backlog rewrite.

## Refinement Signals

- Predicted NEL bucket: Small (0–80)
- Confidence: High
- Selection note: activate as-is
- Main drivers: recurring incomplete-handoff incidents, existing checks already in-tree, unresolved decisions about auto-send-back versus human escalation

## Scope

- Review the current anti-hallucination controls already established in Parallix:
  - verification proof / exact-tree verification
  - gatekeeper mandatory-artifact validation
  - handoff pre-checks
  - declared `MISSION.md` gates
  - review verification path
  - existing repair-handoff behavior
  - task-1268 shift-left verification concept
  - task-1335 fail-closed publish-path hardening
  - the existing child tasks for this mission, including correcting any invalid non-integer task slugs
- Build an error-class model specific to hallucinated or incomplete agent output, covering at minimum:
  1. unverifiable "tests passed" claims
  2. malformed or non-runnable declared gates
  3. missing mandatory mission artifacts
  4. incomplete checkpoint evidence / uncommitted checkpoint state
  5. mechanical git/handoff blockers that should auto-repair or auto-bounce
  6. genuine implementation failures that should relaunch the implementer with a fix prompt
- Inventory, with code references, which checks already exist and where they run:
  - before handoff
  - during handoff
  - before review
  - during review / `--verify`
  - during integrate
- Identify the missing checks needed to make incomplete work fail closed earlier.
- Produce a new ADR under `docs/adr/` that:
  - states the hallucination/incomplete-work failure classes
  - inventories the checks already present in this repo
  - evaluates at least 5 candidate harness controls in a decision matrix
  - recommends an implementation order with explicit "implement now", "defer", and "human-only" calls
  - defines which classes should auto-repair, auto-send-back, or require human intervention
- Include the targeted runtime fix required to keep `node px.ts rebase` working under Node's native TypeScript strip-only execution path.
- Update `docs/adr/index.md` to list the ADR.
- Rewrite the parent backlog task and its child tasks so the backlog reflects the ADR's recommended implementation plan.
- Fix any invalid hallucinated child-task slugs during that rewrite so every task file and `id:` field uses an integer task ID.

## Out of Scope

- Implementing any harness control in code
- Changing files under `lib/`, `scripts/`, `config/`, or `test/` (except the targeted fix in order to make this mission complete the px to be integrated, review fixes for example)
- Broad CLI/runtime refactors outside the targeted `px.ts` entrypoint fix for `node px.ts rebase`
- Creating a generic security checklist
- Researching hosted branch/release security controls unrelated to the harness send-back problem

## Success Criteria

> **Falsifiability rule (ADR 0039 Part 2):** Each criterion must be falsifiable.

- SC1: A new ADR exists under `docs/adr/` and is listed in `docs/adr/index.md`. The ADR explicitly cites at least 4 prior Parallix artifacts as inputs, including task-1268 and task-1335.
- SC2: The ADR contains an explicit inventory of existing checks with at least 5 distinct check points or mechanisms, each mapped to the failure classes it catches today.
- SC3: The ADR contains a decision matrix comparing at least 5 candidate harness controls or repair/send-back policies, and every candidate is marked as one of: implement now, defer, or human-only. No candidate is left unclassified.
- SC4: The ADR explicitly classifies at least 5 incomplete-work or hallucination failure classes as one of: auto-repair, auto-send-back, or requires-human.
- SC5: The backlog reflects the decision: the parent `TASK-1384` description is rewritten to match the ADR mission, at least 4 child tasks under `backlog/tasks/` are updated or created to implement the recommended controls, and no child task under this mission uses a non-integer slug such as `task-1384.01`.
- SC6: The final checkpoint contains a Goal Check table with at least 6 evidence rows citing real file:line references, ADR references, or test names used by the research.

## Risks and Assumptions

- Risk: the work can drift back into generic security language instead of concrete harness behavior. Mitigation: every recommendation must map to a specific harness check, failure class, or send-back path.
- Risk: some desired checks may already exist under a different command or phase. Mitigation: the ADR must inventory current checks before recommending new ones.
- Risk: "automatic handling" can overreach into areas that need human judgment. Mitigation: the ADR must separate auto-repair from auto-send-back from true human-only cases.
- Assumption: prior ADRs and completed mission artifacts in this repo are accurate enough to use as evidence for current controls.

## Checkpoints

- CP 1: Current-state check inventory complete. Existing harness checks and current repair/send-back behavior documented with code references and failure coverage.
- CP 2: Failure-class matrix complete. Incomplete-work / hallucination classes mapped to current handling and proposed auto-repair / auto-send-back / human-only outcomes.
- CP 3: ADR written and backlog plan aligned. Parent task and child tasks rewritten to reflect the recommended implementation sequence, and any invalid non-integer child slugs renumbered.
- CP 4: Final checkpoint with Goal Check table and explicit rationale for each send-back or repair recommendation.

## Gates

- [ ] ./scripts/verify-local.sh docs

## Restricted Areas

- Do not modify `lib/`, `scripts/`, `config/`, or `test/`.
- Do not create or modify milestone files.
- Keep changes scoped to `missions/task-1384/`, `docs/adr/`, `docs/adr/index.md`, `backlog/tasks/`, and the targeted `px.ts` entrypoint fix for `node px.ts rebase`.

## Stop Rules

- Stop if the research does not support a clear prioritized implementation order; in that case the ADR must explicitly say so rather than fabricate certainty.
- Stop if the proposed solution depends mainly on hosted-platform security controls instead of harness behavior; that would mean the mission has drifted off intent.
- Stop if more than 2 recommended controls cannot be traced to concrete files or commands in this repo; that would mean the plan is not grounded enough.
