# Mission: Stop `px status <slug>` from building the whole board (task-2402)

## Goal
Make `px status <slug>` answer for the selected mission through a focused status read/query, without constructing the full board projection or loading every mission solely to find that mission.

## Why Now
An explicit-slug status request currently pays for unrelated mission, review, gate, and board-metric work. The command already has a narrow user intent; narrowing its read boundary removes unnecessary repository-wide work while retaining the status information callers rely on.

## Refinement Signals
- Predicted NEL bucket: Medium (81–235)
- Confidence: High
- Selection note: activate as-is
- Main drivers: focused application query, preservation of established mission/review semantics, read-boundary regression coverage

## Scope
- Trace the explicit-slug `px status <slug>` application path and introduce or adapt a focused mission-status projection/query for it.
- Reuse existing domain and projection rules for lifecycle, activity, checkpoints, review phase/round/disposition/history, approval owed, and genuinely global status fields.
- Add behavioural coverage that compares the selected mission’s returned status fields with the established command contract.
- Add a cost-shape test using unrelated mission fixtures that proves an explicit-slug request does not materialise or read those unrelated missions.
- Preserve the broader read path for `px status` without an explicit slug where repository-level information remains required.

## Out of Scope
- General caching, changes to board-projection performance, or optimisation of `px status` without a slug beyond what the focused path requires.
- Duplicating lifecycle or review interpretation in CLI adapter code.
- Work owned by TASK-2400 or TASK-2401; consume their integrated abstractions if available, but do not depend on them for correctness.
- Removing branch, rebase, PR, agent, or other status information that is genuinely mission-specific or global in the current command contract.

## Success Criteria
> **Falsifiability rule (ADR 0039 Part 2):** Each criterion must be falsifiable. Forbidden: subjective adjectives ("easy, fast, simple, intuitive, user-friendly, responsive, quick, efficient" without an attached metric) and vague quantifiers ("multiple, several, some, many, few, various"). For refactor / condense / migration missions, the criterion must enumerate the specific elements (rules, files, behaviours) that must survive — generic phrases like "preserve critical content" are not sufficient.

- For `px status <slug>`, the selected mission is obtained without calling the full `BoardProjectionBuilder.build()` or `loadAllMissions()` route merely to locate its card.
- The explicit-slug result remains correct for activity, lifecycle/backlog state, latest checkpoint, review round, review phase, review disposition, review history, approval owed, and every retained genuinely global status field covered by the existing status contract.
- A test fixture with unrelated missions proves those missions are neither materialised nor read while answering an explicit request for the selected mission; the assertion observes the read boundary rather than elapsed time.
- `px status` without a slug retains its existing repository-level status behaviour under its existing coverage.
- `./scripts/verify-local.sh all` completes successfully on the final tree.

## Risks and Assumptions
- Assumption: existing domain/projection code exposes enough reusable semantics to avoid a second lifecycle or review ruleset.
- Risk: status fields that look mission-local may depend on global repository state; retain and test genuinely global fields rather than silently dropping them.
- Risk: a focused query can drift from the board projection; tests must cover the named status fields and route all interpretation through shared logic where practical.
- Risk: parallel TASK-2400/TASK-2401 work may change available abstractions; the implementation must remain independently correct if those changes are absent.

## Checkpoints
- CP 1: Map the explicit-slug status flow, identify the full-board read boundary and all returned mission/global fields, then add focused behavioural and read-boundary tests that fail against the board-wide route.
- CP 2: Implement the focused mission-status projection/query, wire only the explicit-slug command path to it, and retain shared domain/projection semantics for lifecycle and review interpretation.
- CP 3: Verify selected-mission correctness and the unrelated-mission read boundary, confirm no-slug status remains covered by its existing path, and record final goal evidence.

### Checkpoint Documentation Requirements
Every checkpoint document (CP-N.md) MUST begin its evidence with durable references Parallix verifies today: exact test names, ADR references, test file paths, and recognized repository commands or paths such as `npm ...`, `node ...`, `git ...`, `px ...`, or `./...`. File:line references are accepted when necessary but discouraged because line numbers rot.

Every checkpoint document MUST include:
- A summary of work done.
- The exact heading `## Goal Check`.
- The exact 3-column table header `| Criterion | Evidence | Status |`, with one evidence row per Success Criterion.
- Evidence for this mission’s focused-status behaviour, read-boundary test, retained no-slug coverage, and final `./scripts/verify-local.sh all` gate, using the accepted references above.
- A non-generic `Next action:` line at the bottom.

Raw `stat`/`ls` output or generic prose alone is not enough. Shell output may be supplemental only when paired with an accepted command, path, exact test name, or ADR reference above.

## Gates
- [ ] ./scripts/verify-local.sh all

## Restricted Areas
- Do not optimise or alter the general `BoardProjectionBuilder.build()` / `loadAllMissions()` path except where a minimal shared extraction is required by the focused query.
- Do not add a cache, a parallel board loader, or a CLI-local copy of lifecycle/review semantics.
- Do not modify TASK-2400 or TASK-2401 scope, backlog ownership, or implementation.
- Do not remove genuinely required branch, rebase, PR, or agent status fields without contract evidence that they are unrelated.

## Stop Rules
- Stop and escalate if preserving a named status field requires loading all missions and no existing shared query can provide the needed global fact; do not silently drop or approximate the field.
- Stop and escalate if the only viable change broadens into board-builder optimisation, generic caching, or TASK-2400/TASK-2401 work.
- Stop and escalate if a test can show only timing improvement rather than whether unrelated missions were read or materialised.
