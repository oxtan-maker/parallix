# Mission: Replace agent-usage % size signal with Net Engineering Lines (NEL) bucket capture at handoff (task-1379)

## Goal

Replace the draft-time size signal in `MISSION.md` from "Estimated agent % usage limit" to a predicted Net Engineering Lines (NEL) bucket (Small 0–80 / Medium 81–235 / Large 235+), implement a reusable NEL computation function that honors the exclusion globs defined in ADR 0047, and at handoff/integration compute the actual NEL from the merge diff and persist a per-mission record of `(predicted bucket, actual NEL, actual bucket, review rounds)`. Update ADR 0032 and ADR 0036 references to the old "% usage" signal so they point at NEL instead. No enforcement, gate, block, or review escalation is added — this task changes only the estimation unit and the data-recording mechanism.

## Why Now

ADR 0047 was accepted on 2026-06-27 as a direct outcome of task-1355's research, which demonstrated that the current "% usage limit" signal is agent-specific, non-portable, and impossible to calibrate because the workflow has never recorded a predicted size against actual delivery. The research found that NEL correlates with review rounds at Pearson +0.39 / Spearman +0.37, and that missions above ~270 NEL had a 73% rework rate versus 11% below ~80 NEL. Until this task ships, every mission drafted under ADR 0047 will still carry the obsolete "% usage" signal, and the workflow will continue to lack its first `(predicted, actual)` data pair. The dataset from task-1355 (n=29 archived missions) is the last corpus that can be analyzed without NEL — every subsequent mission will need NEL records to maintain continuity. This task is the implementation bridge between the ADR decision and the first live NEL data collection.

## Refinement Signals

- Predicted NEL bucket: Small (0–80) / Medium (81–235) / Large (235+)
- Confidence: High
- Selection note: activate as-is
- Main drivers: ADR 0047 accepted and blocks all future missions from using the old signal; small, self-contained change with no enforcement gate; dependency on task-1355 data is already resolved.

## Scope

- **`MISSION.md` template / draft refinement signals**: Update the `## Refinement Signals` section in the MISSION.md template (and any inline template references) to replace "Estimated agent % usage limit" with "Predicted NEL bucket: Small (0–80) / Medium (81–235) / Large (235+)" and remove the old percentage-band field.
- **Reusable NEL computation function**: Implement a small, reusable function that computes NEL from `git diff --numstat -w`, excluding `missions/**`, `backlog/**`, `review-*`, `CP-*`, `**/*.md`, `docs/**`, `package-lock.json`, `coverage/**`, and lockfiles/build output. The function should accept a diff range (e.g., `base..head`) and return the total insertions+deletions count.
- **Handoff NEL capture**: At handoff/integration, invoke the NEL function against the merge diff and persist a per-mission record containing `(predicted bucket, actual NEL, actual bucket, review rounds)` in the appropriate location (e.g., `review-state.json`, a dedicated NEL record file, or appended to the mission's task metadata). The record must survive in the repository so the prediction-vs-actual series accumulates across missions.
- **ADR 0032 and ADR 0036 updates**: In `docs/adr/0032-mission-refinement-state-and-usage-budget-signals.md` and `docs/adr/0036-mission-sizing-and-dependency-wave-heuristics.md`, replace references to "Estimated agent % usage limit" and "% usage" with NEL bucket terminology and cross-reference ADR 0047. Specifically:
  - ADR 0032: Replace the `Estimated agent % usage limit` field definition with a NEL bucket field; update the interpretation rule and default activation guidance to reference NEL buckets instead of percentage bands.
  - ADR 0036: Replace "Too Large" thresholds (which reference agent-specific % limits) with NEL bucket equivalents, and update sizing tracks to reference NEL ranges.

## Out of Scope

- Any threshold gate, hard block, review-depth escalation, or forced decomposition on NEL breach. This task only changes the unit and records data.
- Building cyclomatic-complexity-delta tooling (ADR 0047 §Future Work).
- Re-tuning the NEL bucket edges (80 / 235) — these are frozen at the ADR 0047 empirical terciles for now.
- Modifying any ADR beyond 0032 and 0036 (other ADRs that mention "% usage" are not referenced in this task's scope).
- Creating a new CLI command or modifying the existing `px.js` entry point — the NEL function is a library/utility module, not a user-facing command.

## Success Criteria

> **Falsifiability rule (ADR 0039 Part 2):** Each criterion must be falsifiable. Forbidden: subjective adjectives and vague quantifiers.

- **SC1:** The `## Refinement Signals` section in the MISSION.md template (and any active MISSION.md files that serve as templates) contains "Predicted NEL bucket: Small (0–80) / Medium (81–235) / Large (235+)" and does not contain "Estimated agent % usage limit" or any percentage-band field.
- **SC2:** A reusable NEL computation function exists in the codebase (e.g., `lib/core/nels.js` or `tools/nels.js`), accepts a git diff range, and returns an integer NEL count computed from `git diff --numstat -w` with all exclusion globs applied.
- **SC3:** The NEL function correctly excludes lines in `missions/**`, `backlog/**`, `review-*`, `CP-*`, `**/*.md`, `docs/**`, `package-lock.json`, `coverage/**`, and lockfiles. Verified by a test that constructs a mock diff with mixed inclusion/exclusion paths and asserts the returned NEL count matches the expected sum.
- **SC4:** At handoff/integration, the actual NEL is computed from the merge diff and a per-mission record `(predicted bucket, actual NEL, actual bucket, review rounds)` is persisted to a machine-readable location in the mission directory (e.g., `review-state.json` or a dedicated `nel-record.json`).
- **SC5:** No enforcement, gate, block, or review escalation logic is introduced — theNEL capture is purely observational. Verified by confirming no conditional `if NEL > threshold then block/escalate` branches exist in the handoff flow.
- **SC6:** `docs/adr/0032-mission-refinement-state-and-usage-budget-signals.md` no longer defines "Estimated agent % usage limit" as a field; instead it references NEL buckets and cross-references ADR 0047.
- **SC7:** `docs/adr/0036-mission-sizing-and-dependency-wave-heuristics.md` no longer references agent-specific "% usage" thresholds; "Too Large" sizing is restated in NEL bucket terms with a reference to ADR 0047.
- **SC8:** `npm test` passes (0 failures, same or fewer skipped tests than baseline).

## Risks and Assumptions

- **Risk:** The NEL exclusion globs may inadvertently exclude files that should count as engineering change (e.g., `.ts` test files or configuration files that affect behavior). Mitigation: the exclusion list is explicitly defined in ADR 0047 and this task implements it verbatim; if new exclusions are needed, they require a separate ADR.
- **Risk:** The per-mission NEL record location is not yet standardized — `review-state.json` exists but its schema is not locked. Mitigation: append the NEL record as a new top-level field in `review-state.json` without altering existing fields, minimizing schema collision risk.
- **Risk:** The NEL function needs to handle edge cases: empty diffs, merges with conflicts, and non-git environments. Mitigation: the function returns 0 for empty or uncomputable diffs rather than throwing, and documents this behavior.
- **Risk:** Updating ADR 0032 and 0036 may introduce inconsistencies with other ADRs that still reference "% usage" (e.g., ADR 0047 itself references the old signal in its "Context" section as the thing being replaced). Mitigation: only modify ADR 0032 and 0036; ADR 0047's contextual references to the old signal are historical and intentionally retained.
- **Assumption:** The NEL bucket edges (80 / 235) from ADR 0047's empirical terciles are correct for this repository and do not need adjustment during this task.
- **Assumption:** The handoff/integration code path already has a place to attach metadata (e.g., `review-state.json` write logic) that can accept an NEL record without structural changes.
- **Assumption:** The task-1355 dataset at `missions/task-1355/data/dataset.md` is stable and serves as the authoritative source for the NEL bucket definitions referenced in this task.

## Checkpoints

- **CP 1:** NEL computation function implemented and tested — the function accepts a git diff range, applies all exclusion globs, and returns the correct NEL count. Unit test covers inclusion, exclusion, and empty-diff edge cases.
- **CP 2:** MISSION.md template updated — `## Refinement Signals` section replaces "% usage" with NEL bucket; all inline template references are updated.
- **CP 3:** Handoff NEL capture wired — the integration/handoff flow invokes the NEL function and persists the `(predicted bucket, actual NEL, actual bucket, review rounds)` record.
- **CP 4:** ADR 0032 and ADR 0036 updated — both files no longer define or reference "% usage limit"; NEL bucket terminology and ADR 0047 cross-references are in place.
- **CP 5:** Verification — `npm test` passes, `./scripts/verify-local.sh docs` passes, no enforcement logic was introduced, all file references resolve.

## Gates

- [ ] ./scripts/verify-local.sh docs
- [ ] npm test

## Restricted Areas

- **Cyclomatic-complexity tooling** — do not build or integrate AST-based complexity delta measurements (ADR 0047 §Future Work, explicitly out of scope).
- **Enforcement logic** — do not add conditional gates, blocks, escalations, or decomposition triggers based on NEL values. The NEL capture is purely observational.
- **Bucket edge tuning** — do not adjust the NEL bucket boundaries (80 / 235) from the ADR 0047 terciles.
- **ADR files beyond 0032 and 0036** — do not modify any ADR other than `docs/adr/0032-mission-refinement-state-and-usage-budget-signals.md` and `docs/adr/0036-mission-sizing-and-dependency-wave-heuristics.md`.
- **CLI entry point (`px.js`)** — do not add new subcommands or modify the existing CLI interface.

## Stop Rules

- Stop if the NEL exclusion globs conflict with an existing test expectation that must be changed — flag as a separate task rather than modifying test behavior.
- Stop if `review-state.json` schema changes are required to accommodate the NEL record — this indicates the metadata storage needs a separate design task; proceed with NEL capture in a separate file (e.g., `nel-record.json`) instead.
- Stop if ADR 0032 or 0036 references "% usage" in a way that cannot be updated without introducing contradictions in other ADRs — freeze the ADR edits at the current scope and note the remaining references for follow-up.
- Stop if the NEL function cannot be implemented as a pure utility (e.g., it requires invasive changes to the git wrapper or build pipeline) — defer the NEL function to a separate infrastructure task.
- Stop if `npm test` fails due to a pre-existing test issue unrelated to this task's changes — do not attempt to fix pre-existing failures.
