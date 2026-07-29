# Mission: Reconcile mission authority, SQLite scope, and ADR consistency before persistence cutover (task-2322)

## Goal
Determine the smallest architecture change the codebase already supports for moving mission state toward SQLite, then update the accepted ADR set and this repository's mission contract to match that direction. The mission must resolve whether Parallix should keep `Mission` as the primary aggregate, whether `Attempt` is a true first-class domain entity or only persistence/projection data, whether SQLite is operator-local or repository-local, and whether ADR 0052 should be narrowed, superseded, or retired entirely.

## Why Now
The checked-in code, accepted ADRs, and current mission text no longer agree. The current domain and application layers model `Mission` as the aggregate root and route mission mutations through a target-repository authority seam, while accepted ADR text also claims post-cutover SQLite mission authority and a task-catalog cutover with assumptions that do not match the implemented adapter split. Continuing into persistence work without reconciling those contradictions would hard-code a design that the repository has not actually accepted.

## Refinement Signals
- Predicted NEL bucket: Medium (120-220)
- Confidence: High
- Selection note: replace implementation-first scope with a design-reconciliation mission grounded in checked-in code and accepted ADR evidence.
- Main drivers: resolve ADR 0044/0051/0052 inconsistency; align `src/domain`, `src/application`, and mission authority rules; define the minimal safe follow-up persistence slice.

## Scope
- Audit the checked-in domain, application, runtime, and SQLite adapter code to document the current authority split for mission lifecycle, review, NEL, session metadata, usage, and board telemetry.
- Decide whether the production aggregate remains `Mission` for the next persistence slice, and explicitly prove whether `Attempt` belongs in the domain now, only in persistence/read models, or not at all yet.
- Decide whether the post-cutover SQLite authority is operator-local (`PARALLIX_HOME`) or repository-local, and align that decision with repository identity, backup, import, and multi-checkout behavior.
- Update ADR 0044, ADR 0052, and any directly conflicting architecture notes so they describe one coherent authority model. If the evidence supports removing ADR 0052 instead of reconciling it, scope that removal or supersession as part of this mission.
- Update `src/domain/README.md` and any other repository-owned design notes that currently contradict the accepted ADR direction.
- Rewrite the follow-up implementation plan so the next mission starts from the reconciled architecture rather than from the current blocked `Repository -> Mission -> Attempt` assumption.

## Out of Scope
- Implementing the final SQLite mission store, mission import, or full lifecycle cutover in this mission.
- Introducing a new `Attempt` runtime/persistence model unless the design work proves it is already required and the mission is explicitly revised again.
- Converting `px draft`, `px active`, `px review`, or `px integrate` to a new persistence backend.
- Repairing unrelated backlog records, TUI behavior, review publication, integration-gate behavior, or general build issues.
- Keeping contradictory ADRs alive by adding compatibility prose that avoids making a real authority decision.

## Success Criteria
> **Falsifiability rule (ADR 0039 Part 2):** Each criterion must be falsifiable. Forbidden: subjective adjectives ("easy, fast, simple, intuitive, user-friendly, responsive, quick, efficient" without an attached metric) and vague quantifiers ("multiple, several, some, many, few, various"). For refactor / condense / migration missions, the criterion must enumerate the specific elements (rules, files, behaviours) that must survive — generic phrases like "preserve critical content" are not sufficient.

- SC1 — The mission records a code-grounded authority inventory showing, with file references, which current facts are target-repository authority, operator-local authority, operator-local cache, and tool-owned configuration. The inventory explicitly covers mission lifecycle, review, NEL, resumable session metadata, usage measurements, blocklist state, and board/event telemetry.
- SC2 — Accepted ADR text is internally consistent after the mission: ADR 0044, ADR 0052, and any directly edited cross-reference no longer disagree about database scope, mutable mission authority, or the role of task Markdown after cutover.
- SC3 — The resulting ADR set makes one explicit decision about ADR 0052 itself: keep and narrow it, supersede it, or retire it. The final repository state must show that decision in the edited ADR files rather than only in checkpoint prose.
- SC4 — `src/domain/README.md` and any edited repository-owned design note align with the accepted ADR set on all of the following: the primary aggregate, current compatibility authority, future SQLite authority, closure semantics, and the role of review/session metadata.
- SC5 — The mission produces a clear recommendation for the next implementation slice, with exact elements that are in-scope next: for example a SQLite-backed `MissionStore` for the existing `Mission` model, or a narrower adapter migration. The recommendation explicitly states whether `Attempt` is deferred, persistence-only, or required in the domain.
- SC6 — At least one automated characterization or type-level proof remains or is added to anchor the chosen direction against checked-in code paths. Pure prose is insufficient; the evidence must include either an existing exact test/path retained as the basis of the decision or a new automated check that would fail if the chosen authority model regressed.
- SC7 — The mission does not introduce production persistence code that assumes repository-local mission SQLite, operator-local mission SQLite, or a first-class `Attempt` aggregate before those choices are accepted in the reconciled ADR set.

## Risks and Assumptions
- The repository's checked-in TypeScript domain/application code is better evidence of current architectural convergence than generated mission prose.
- ADR 0044's statement that SQLite becomes the eventual mutable authority is still likely directionally correct, but its interaction with repository-owned compatibility state and database placement must be reconciled.
- ADR 0052 may have overfit the task-catalog cutover and may need narrowing, supersession, or removal rather than incremental patching.
- The cleanest near-term design may be smaller than a new `Attempt` aggregate; existing usage/session/history structures may already cover most of that need.
- If accepted evidence truly supports a first-class `Attempt` entity or repository-local database scope, the mission must document that with concrete code and operational impacts rather than assumption.

## Checkpoints
- CP 1: Build the authority inventory from checked-in code and ADR text. Identify every concrete contradiction across ADR 0044, ADR 0052, `src/domain/README.md`, `src/application/mission-authority.ts`, and the current SQLite adapters.
- CP 2: Decide the target architecture for the next persistence slice: aggregate boundary, database scope, and whether `Attempt` is domain, persistence, or deferred. Record the rejected alternatives, including whether retiring ADR 0052 is cleaner than reconciling it.
- CP 3: Edit the accepted ADRs and repository design notes to one coherent story, and update this mission's criterion-by-criterion evidence accordingly.
- CP 4: Write the follow-up implementation plan and stop. The next mission should be able to start persistence work without reopening the same architecture questions.

### Checkpoint Documentation Requirements
Every checkpoint document (`CP-N.md`) MUST summarize the completed checkpoint work and end with a concrete `Next action:` for its successor. It MUST include the exact heading `## Goal Check` followed by this exact 3-column table header:

| Criterion | Evidence | Status |
|---|---|---|

Include at least one row for each applicable SC1-SC7. Evidence must use forms Parallix verifies today: existing file:line references (for example, `src/application/mission-authority.ts:16`); exact test names; ADR references (for example, `ADR 0044`); test file paths; and recognized repository commands or paths such as `npm ...`, `node ...`, `git ...`, `px ...`, or `./...`.

Raw `stat`/`ls` output or generic prose alone is not acceptable evidence. Shell output may be supplemental only when paired with an accepted file:line reference, exact test name, ADR reference, test path, or recognized command/path.

## Gates
- [ ] ./scripts/verify-local.sh docs

## Restricted Areas
- Do not start implementing a new persistence authority before the ADR reconciliation is complete.
- Do not assume `Attempt` is a first-class aggregate merely because agent runs and session markers exist.
- Do not assume repository-local SQLite merely because task records are repository-scoped, or operator-local SQLite merely because current adapters live under `PARALLIX_HOME`; prove the choice.
- Do not preserve contradictory ADR language for convenience.
- Do not repair unrelated runtime, TUI, backlog-catalog, or build defects in this mission.

## Stop Rules
- Stop and record the exact conflict if accepted ADR text and checked-in code cannot be reconciled without a fresh human architecture decision.
- Stop if the evidence shows two materially different viable target architectures and the repository has no basis to prefer one.
- Stop if reconciling the ADRs would require sneaking in persistence implementation or compatibility behavior changes that deserve their own mission.
- Stop on unrelated failing verification; capture it as separate evidence instead of repairing it here.
